// Server-only air-quality submission pipeline used by BOTH the online server
// action (`../actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Pure parsing + the threshold/severity engine live in `compute.ts`
// (unit-tested); this module adds the Supabase + notification I/O so an offline
// submission lands the same rows, with the same severity engine, as an online
// one.

import "server-only"

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"

import type { AirQualitySeverity } from "../types"
import {
  buildAlertLines,
  evaluateReading,
  lookupThreshold,
  maxSeverityOf,
  type AirQualityInput,
  type ExceedanceDetail,
  type ThresholdRow,
} from "./compute"

// Re-export the pure helpers the callers import from here.
export { buildInputFromFormData, buildInputFromPayload } from "./compute"
export type { AirQualityInput } from "./compute"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Persist (validate refs + insert report/readings + severity rollup + alert)
// ---------------------------------------------------------------------------

/**
 * Persist a validated air-quality submission. The caller is responsible for
 * authentication, resolving the active employee, and the `submit` permission
 * check; this function does the facility-scoped data validation, the inserts,
 * and the severity engine. On any insert failure after the report shell lands,
 * the shell is deleted so the submission can be retried cleanly.
 */
export async function persistAirQuality(
  supabase: SupabaseClient,
  {
    employeeId,
    facilityId,
    input,
  }: { employeeId: string; facilityId: string; input: AirQualityInput },
): Promise<PersistResult> {
  const { location_id, equipment_id, notes, readings, form_data } = input

  // Verify the location belongs to this facility and is active.
  const { data: location, error: locErr } = await supabase
    .from("facility_spaces")
    .select("id, name, is_active, facility_id")
    .eq("id", location_id)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .maybeSingle()

  if (locErr || !location) {
    return {
      ok: false,
      error: dbError(locErr, "Location not found or unavailable."),
    }
  }

  // Pull all active reading types for this facility.
  const { data: readingTypesRaw, error: rtErr } = await supabase
    .from("air_quality_reading_types")
    .select("id, key, label, unit, decimals, is_required, is_active")
    .eq("facility_id", facilityId)
    .eq("is_active", true)

  if (rtErr) {
    return { ok: false, error: dbError(rtErr, "Failed to load reading types.") }
  }
  const readingTypes = readingTypesRaw ?? []

  // Required-completeness check.
  const submittedByType = new Map<string, number>()
  for (const r of readings) submittedByType.set(r.reading_type_id, r.value)

  const missingRequired: string[] = []
  for (const rt of readingTypes) {
    if (rt.is_required && !submittedByType.has(rt.id)) {
      missingRequired.push(rt.label)
    }
  }
  if (missingRequired.length > 0) {
    return {
      ok: false,
      error: `Please fill in all required readings: ${missingRequired.join(", ")}.`,
    }
  }

  // Verify every submitted reading_type_id is one of our active types.
  const validIds = new Set(readingTypes.map((r) => r.id))
  for (const r of readings) {
    if (!validIds.has(r.reading_type_id)) {
      return { ok: false, error: "Submitted an unknown reading type." }
    }
  }

  // Verify equipment, if given, belongs to this facility and is either at this
  // location or facility-wide.
  if (equipment_id) {
    const { data: eqRow } = await supabase
      .from("air_quality_equipment")
      .select("id, location_id, is_active, facility_id")
      .eq("id", equipment_id)
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .maybeSingle()
    if (
      !eqRow ||
      (eqRow.location_id !== null && eqRow.location_id !== location.id)
    ) {
      return { ok: false, error: "Selected equipment is not valid here." }
    }
  }

  // 1) Insert the report shell.
  const { data: insertedReport, error: reportErr } = await supabase
    .from("air_quality_reports")
    .insert({
      facility_id: facilityId,
      employee_id: employeeId,
      location_id: location.id,
      equipment_id,
      notes,
      form_data,
      submitted_at: new Date().toISOString(),
      has_exceedance: false,
      max_severity: null,
    })
    .select("id")
    .single()

  if (reportErr || !insertedReport) {
    return {
      ok: false,
      error: dbError(reportErr, "Failed to submit air quality report."),
    }
  }

  const reportId = insertedReport.id

  // 2) Pull all active thresholds for this facility for matching.
  const { data: thresholdsRaw, error: thresholdErr } = await supabase
    .from("air_quality_thresholds")
    .select(
      "id, reading_type_id, location_id, alert_min, alert_max, compliance_min, compliance_max, severity",
    )
    .eq("facility_id", facilityId)
    .eq("is_active", true)

  if (thresholdErr) {
    await supabase.from("air_quality_reports").delete().eq("id", reportId)
    return {
      ok: false,
      error: dbError(thresholdErr, "Failed to load thresholds."),
    }
  }

  const thresholds = (thresholdsRaw ?? []) as ThresholdRow[]

  // 3) Build reading rows.
  type RowToInsert = {
    facility_id: string
    report_id: string
    reading_type_id: string
    key_snapshot: string
    label_snapshot: string
    unit_snapshot: string
    value_numeric: number
    threshold_id: string | null
    is_exceedance: boolean
    severity_at_submit: string | null
    compliance_min_at_submit: number | null
    compliance_max_at_submit: number | null
  }

  const rowsToInsert: RowToInsert[] = []
  const exceedanceDetails: ExceedanceDetail[] = []

  const rtById = new Map(readingTypes.map((rt) => [rt.id, rt]))

  for (const r of readings) {
    const rt = rtById.get(r.reading_type_id)
    if (!rt) continue
    const t = lookupThreshold(thresholds, r.reading_type_id, location.id)

    let isExceedance = false
    let severity: AirQualitySeverity | null = null

    if (t) {
      const evaluated = evaluateReading(r.value, t)
      isExceedance = evaluated.isExceedance
      severity = evaluated.severity
      if (isExceedance && severity) {
        exceedanceDetails.push({
          label: rt.label,
          value: r.value,
          unit: rt.unit,
          alert_min: t.alert_min,
          alert_max: t.alert_max,
          severity,
        })
      }
    }

    rowsToInsert.push({
      facility_id: facilityId,
      report_id: reportId,
      reading_type_id: rt.id,
      key_snapshot: rt.key,
      label_snapshot: rt.label,
      unit_snapshot: rt.unit,
      value_numeric: r.value,
      threshold_id: t?.id ?? null,
      is_exceedance: isExceedance,
      severity_at_submit: severity,
      compliance_min_at_submit: t?.compliance_min ?? null,
      compliance_max_at_submit: t?.compliance_max ?? null,
    })
  }

  // 4) Batch insert readings.
  if (rowsToInsert.length > 0) {
    const { error: readingsErr } = await supabase
      .from("air_quality_readings")
      .insert(rowsToInsert)
    if (readingsErr) {
      await supabase.from("air_quality_reports").delete().eq("id", reportId)
      return {
        ok: false,
        error: dbError(readingsErr, "Failed to save readings."),
      }
    }
  }

  // 5) Compute rollup and update report.
  const hasExceedance = exceedanceDetails.length > 0
  const maxSeverity = maxSeverityOf(exceedanceDetails.map((d) => d.severity))

  const { error: updateErr } = await supabase
    .from("air_quality_reports")
    .update({
      has_exceedance: hasExceedance,
      max_severity: maxSeverity,
    })
    .eq("id", reportId)

  if (updateErr) {
    await supabase.from("air_quality_reports").delete().eq("id", reportId)
    return {
      ok: false,
      error: dbError(updateErr, "Failed to finalize report."),
    }
  }

  // 6) Optional alert.
  if (hasExceedance && maxSeverity) {
    const { data: settingsRow } = await supabase
      .from("air_quality_settings")
      .select("alerts_enabled")
      .eq("facility_id", facilityId)
      .maybeSingle()

    if (settingsRow?.alerts_enabled) {
      // Best-effort. Failure does not roll back the report.
      await supabase.from("communication_alerts").insert({
        facility_id: facilityId,
        source_module: "air_quality",
        source_record_id: reportId,
        severity: maxSeverity,
        title: `Air Quality: exceedance at ${location.name}`,
        body: buildAlertLines(exceedanceDetails).join("\n"),
        created_by_employee_id: employeeId,
        requires_acknowledgement: true,
      })
    }
  }

  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "air_quality",
    sourceRecordId: reportId,
    subject: "Air quality report submitted",
  })

  return { ok: true, reportId }
}
