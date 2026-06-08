// Server-only ice-depth submission pipeline used by BOTH the online server
// action (`../actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Pure parsing/severity/summary logic lives in `compute.ts` (unit-tested); this
// module adds the Supabase + notification I/O so an offline submission lands the
// same rows, with the same checks, as an online one.

import "server-only"

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"

import type { Severity } from "../types"
import {
  dedupeMeasurements,
  severityFor,
  shouldFireAlert,
  summarizeMeasurements,
  type IceDepthInput,
} from "./compute"

// Re-export the parsers the callers import from here.
export {
  buildInputFromForm,
  buildInputFromObject,
  buildInputFromPayload,
} from "./compute"
export type { IceDepthInput } from "./compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

type PointRow = {
  id: string
  point_number: number
  label: string | null
  x_position: number
  y_position: number
  layout_id: string
  is_active: boolean
}

/**
 * Full persist: validate the layout + referenced points, snapshot settings,
 * insert the session shell, insert the per-point measurements (recomputing
 * severity server-side), finalize the session counters, fire the optional
 * best-effort alert, and dispatch notifications. Mirrors the online action's
 * cleanup-on-failure (a failed measurement/finalize insert deletes the shell).
 */
export async function persistIceDepth(
  supabase: SupabaseClient,
  args: {
    employeeId: string
    facilityId: string
    input: IceDepthInput
  },
): Promise<PersistResult> {
  const { employeeId, facilityId, input } = args

  const byPoint = dedupeMeasurements(input.measurements)

  // 1) Validate the layout belongs to the facility, is active, and the slug
  //    matches what the client thinks it submitted against.
  const { data: layout } = await supabase
    .from("ice_depth_layouts")
    .select("id, name, slug, facility_id, is_active")
    .eq("id", input.layout_id)
    .eq("facility_id", facilityId)
    .maybeSingle()

  if (!layout || !layout.is_active || layout.slug !== input.layout_slug) {
    return { ok: false, error: "Selected layout is not available." }
  }

  // 2) Load + verify the points referenced in the submission, then snapshot.
  const pointIds = Array.from(byPoint.keys())
  let pointRows: PointRow[] = []
  if (pointIds.length > 0) {
    const { data: pointsData, error: pointsErr } = await supabase
      .from("ice_depth_points")
      .select(
        "id, point_number, label, x_position, y_position, layout_id, is_active",
      )
      .in("id", pointIds)

    if (pointsErr) {
      return { ok: false, error: dbError(pointsErr, "Failed to load layout points.") }
    }
    pointRows = pointsData ?? []
    if (pointRows.length !== pointIds.length) {
      return { ok: false, error: "One or more points are no longer available." }
    }
    for (const row of pointRows) {
      if (row.layout_id !== layout.id || !row.is_active) {
        return {
          ok: false,
          error: "One or more points don't belong to this layout.",
        }
      }
    }
  }

  // 3) Snapshot settings (with sane defaults when no settings row exists).
  const { data: settingsRow } = await supabase
    .from("ice_depth_settings")
    .select(
      "measurement_unit, low_threshold, high_threshold, alerts_enabled, alert_on, default_alert_severity",
    )
    .eq("facility_id", facilityId)
    .maybeSingle()

  const measurementUnitSnapshot = settingsRow?.measurement_unit ?? "inches"
  const lowThresholdSnapshot =
    typeof settingsRow?.low_threshold === "number"
      ? settingsRow.low_threshold
      : 1
  const highThresholdSnapshot =
    typeof settingsRow?.high_threshold === "number"
      ? settingsRow.high_threshold
      : 1.5

  // 4) Insert the session shell with zero counters first.
  const { data: insertedSession, error: sessionErr } = await supabase
    .from("ice_depth_sessions")
    .insert({
      facility_id: facilityId,
      layout_id: layout.id,
      employee_id: employeeId,
      notes: input.notes,
      submitted_at: new Date().toISOString(),
      measurement_unit_snapshot: measurementUnitSnapshot,
      low_threshold_snapshot: lowThresholdSnapshot,
      high_threshold_snapshot: highThresholdSnapshot,
      total_measurements: 0,
      low_count: 0,
      high_count: 0,
      has_low_reading: false,
      has_high_reading: false,
    })
    .select("id")
    .single()

  if (sessionErr || !insertedSession) {
    return {
      ok: false,
      error: dbError(sessionErr, "Failed to create ice depth session."),
    }
  }

  const sessionId = insertedSession.id

  // 5) Build measurement rows, recomputing severity server-side.
  const severities: Severity[] = []
  const measurementRows = pointRows.map((p) => {
    const depth = byPoint.get(p.id) as number
    const severity = severityFor(depth, lowThresholdSnapshot, highThresholdSnapshot)
    severities.push(severity)
    return {
      facility_id: facilityId,
      session_id: sessionId,
      point_id: p.id,
      depth_value: depth,
      severity,
      point_number_snapshot: p.point_number,
      label_snapshot: p.label,
      x_snapshot: p.x_position,
      y_snapshot: p.y_position,
    }
  })

  if (measurementRows.length > 0) {
    const { error: insMeasErr } = await supabase
      .from("ice_depth_measurements")
      .insert(measurementRows)
    if (insMeasErr) {
      // Best-effort cleanup; cascade deletes any partial measurements.
      await supabase.from("ice_depth_sessions").delete().eq("id", sessionId)
      return {
        ok: false,
        error: dbError(insMeasErr, "Failed to save measurements."),
      }
    }
  }

  // 6) Finalize the session counters from the computed severities.
  const summary = summarizeMeasurements(severities)

  const { error: updateErr } = await supabase
    .from("ice_depth_sessions")
    .update({
      total_measurements: summary.total_measurements,
      low_count: summary.low_count,
      high_count: summary.high_count,
      has_low_reading: summary.has_low_reading,
      has_high_reading: summary.has_high_reading,
    })
    .eq("id", sessionId)

  if (updateErr) {
    await supabase.from("ice_depth_sessions").delete().eq("id", sessionId)
    return {
      ok: false,
      error: dbError(updateErr, "Failed to finalize ice depth session."),
    }
  }

  // 7) Best-effort alert insert (never fails the submission).
  try {
    if (
      settingsRow?.alerts_enabled &&
      shouldFireAlert(
        settingsRow.alert_on,
        summary.has_low_reading,
        summary.has_high_reading,
      )
    ) {
      const severity = settingsRow.default_alert_severity || "high"
      const title = `Ice Depth: ${layout.name} — ${summary.low_count} low / ${summary.high_count} high`
      const bodyParts: string[] = []
      bodyParts.push(`Total measurements: ${summary.total_measurements}`)
      bodyParts.push(`Low (≤ ${lowThresholdSnapshot}): ${summary.low_count}`)
      bodyParts.push(`High (> ${highThresholdSnapshot}): ${summary.high_count}`)
      if (input.notes) bodyParts.push(`Notes: ${input.notes}`)
      await supabase.from("communication_alerts").insert({
        facility_id: facilityId,
        source_module: "ice_depth",
        source_record_id: sessionId,
        severity,
        title,
        body: bodyParts.join("\n"),
        created_by_employee_id: employeeId,
        requires_acknowledgement: true,
      })
    }
  } catch {
    // Alerts are best-effort; do not fail the submission.
  }

  // 8) Notification fan-out (best-effort).
  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "ice_depth",
    sourceRecordId: sessionId,
    subject: `Ice depth session submitted (${layout.slug})`,
  })

  return { ok: true, reportId: sessionId }
}
