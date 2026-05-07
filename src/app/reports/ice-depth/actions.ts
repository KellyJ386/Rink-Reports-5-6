"use server"

import { redirect } from "next/navigation"

import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type { Severity, SubmittedMeasurement } from "./types"

export type SubmissionFormState = {
  ok?: false
  error?: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v)
}

function parseMeasurements(raw: unknown): SubmittedMeasurement[] | null {
  if (typeof raw !== "string") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const out: SubmittedMeasurement[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return null
    const obj = entry as Record<string, unknown>
    if (!isUuid(obj.point_id)) return null
    const depth =
      typeof obj.depth_value === "number"
        ? obj.depth_value
        : typeof obj.depth_value === "string"
          ? Number(obj.depth_value)
          : Number.NaN
    if (!Number.isFinite(depth)) return null
    out.push({ point_id: obj.point_id, depth_value: depth })
  }
  return out
}

function severityFor(
  value: number,
  low: number,
  high: number
): Severity {
  if (value <= low) return "low"
  if (value > high) return "high"
  return "ok"
}

type SubmissionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string }

async function performSubmit(formData: FormData): Promise<SubmissionResult> {
  const current = await requireUser()
  const supabase = await createClient()

  const layoutId = String(formData.get("layout_id") ?? "").trim()
  const layoutSlug = String(formData.get("layout_slug") ?? "").trim()
  const notesRaw = String(formData.get("notes") ?? "").trim()
  const notes = notesRaw.length > 0 ? notesRaw : null
  const measurementsRaw = formData.get("measurements_json")

  if (!isUuid(layoutId)) {
    return { ok: false, error: "Invalid layout." }
  }
  if (!layoutSlug) {
    return { ok: false, error: "Invalid layout." }
  }

  const measurements = parseMeasurements(measurementsRaw)
  if (!measurements) {
    return { ok: false, error: "Invalid measurements payload." }
  }

  // Dedupe by point_id; last write wins (form should already be 1:1).
  const byPoint = new Map<string, number>()
  for (const m of measurements) {
    byPoint.set(m.point_id, m.depth_value)
  }

  const { data: employeeRow, error: empErr } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (empErr) {
    return { ok: false, error: dbError(empErr, "Failed to load your account.") }
  }
  if (!employeeRow) {
    return {
      ok: false,
      error: "Your account isn't fully set up yet. Contact your administrator.",
    }
  }

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "ice_depth")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return {
      ok: false,
      error: "You don't have permission to submit ice depth reports.",
    }
  }

  const { data: layout } = await supabase
    .from("ice_depth_layouts")
    .select("id, name, slug, facility_id, is_active")
    .eq("id", layoutId)
    .eq("facility_id", employeeRow.facility_id)
    .maybeSingle()

  if (!layout || !layout.is_active || layout.slug !== layoutSlug) {
    return { ok: false, error: "Selected layout is not available." }
  }

  // Load points referenced in submission to verify and snapshot.
  const pointIds = Array.from(byPoint.keys())
  type PointRow = {
    id: string
    point_number: number
    label: string | null
    x_position: number
    y_position: number
    layout_id: string
    is_active: boolean
  }
  let pointRows: PointRow[] = []
  if (pointIds.length > 0) {
    const { data: pointsData, error: pointsErr } = await supabase
      .from("ice_depth_points")
      .select(
        "id, point_number, label, x_position, y_position, layout_id, is_active"
      )
      .in("id", pointIds)

    if (pointsErr) {
      return {
        ok: false,
        error: dbError(pointsErr, "Failed to load layout points."),
      }
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

  // Snapshot settings.
  const { data: settingsRow } = await supabase
    .from("ice_depth_settings")
    .select(
      "measurement_unit, low_threshold, high_threshold, alerts_enabled, alert_on, default_alert_severity"
    )
    .eq("facility_id", employeeRow.facility_id)
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

  // Insert session with zero counters first.
  const { data: insertedSession, error: sessionErr } = await supabase
    .from("ice_depth_sessions")
    .insert({
      facility_id: employeeRow.facility_id,
      layout_id: layout.id,
      employee_id: employeeRow.id,
      notes,
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

  // Build measurement rows.
  const measurementRows = pointRows.map((p) => {
    const depth = byPoint.get(p.id) as number
    const severity = severityFor(
      depth,
      lowThresholdSnapshot,
      highThresholdSnapshot
    )
    return {
      facility_id: employeeRow.facility_id,
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

  let lowCount = 0
  let highCount = 0
  for (const row of measurementRows) {
    if (row.severity === "low") lowCount += 1
    else if (row.severity === "high") highCount += 1
  }

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

  const totalMeasurements = measurementRows.length
  const hasLow = lowCount > 0
  const hasHigh = highCount > 0

  const { error: updateErr } = await supabase
    .from("ice_depth_sessions")
    .update({
      total_measurements: totalMeasurements,
      low_count: lowCount,
      high_count: highCount,
      has_low_reading: hasLow,
      has_high_reading: hasHigh,
    })
    .eq("id", sessionId)

  if (updateErr) {
    await supabase.from("ice_depth_sessions").delete().eq("id", sessionId)
    return {
      ok: false,
      error: dbError(updateErr, "Failed to finalize ice depth session."),
    }
  }

  // Best-effort alert insert.
  try {
    if (settingsRow?.alerts_enabled) {
      const alertOn = settingsRow.alert_on
      const shouldFire =
        (alertOn === "low" && hasLow) ||
        (alertOn === "high" && hasHigh) ||
        (alertOn === "any" && (hasLow || hasHigh))
      if (shouldFire) {
        const severity = settingsRow.default_alert_severity || "high"
        const title = `Ice Depth: ${layout.name} — ${lowCount} low / ${highCount} high`
        const bodyParts: string[] = []
        bodyParts.push(`Total measurements: ${totalMeasurements}`)
        bodyParts.push(`Low (≤ ${lowThresholdSnapshot}): ${lowCount}`)
        bodyParts.push(`High (> ${highThresholdSnapshot}): ${highCount}`)
        if (notes) bodyParts.push(`Notes: ${notes}`)
        await supabase.from("communication_alerts").insert({
          facility_id: employeeRow.facility_id,
          source_module: "ice_depth",
          source_record_id: sessionId,
          severity,
          title,
          body: bodyParts.join("\n"),
          created_by_employee_id: employeeRow.id,
          requires_acknowledgement: true,
        })
      }
    }
  } catch {
    // Alerts are best-effort; do not fail the submission.
  }

  return {
    ok: true,
    redirectTo: `/reports/ice-depth/${encodeURIComponent(
      layout.slug
    )}/done?id=${sessionId}`,
  }
}

export async function submitIceDepthSession(
  _prev: SubmissionFormState,
  formData: FormData
): Promise<SubmissionFormState> {
  const result = await performSubmit(formData)
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  redirect(result.redirectTo)
}
