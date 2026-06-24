// Server-only air-quality submission pipeline used by BOTH the online server
// action (`../actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Pure parsing lives in `compute.ts` and the jurisdiction engine in
// `compliance.ts` (both unit-tested); this module adds the Supabase +
// notification I/O so an offline submission lands the same rows, evaluated by
// the same engine, as an online one.
//
// The jurisdiction compliance engine is the SINGLE source of truth for
// evaluation (the legacy per-facility air_quality_thresholds table was retired).
// Every facility is auto-seeded a compliance profile, so a reading that maps to
// an active metric is always evaluated against the facility's effective
// (override-tightened) tiers.

import "server-only"

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"

import { emptyAirQualityFormData } from "../types"
import type { ComplianceSnapshot } from "../types"
import type { AirQualityInput } from "./compute"
import {
  describeHit,
  evaluateSustained,
  lookbackMsForSpecs,
  parseSustainedSpecs,
  pollutantOfReadingKey,
  type SeriesPoint,
} from "./sustained"
import {
  alertLevelToSeverity,
  evaluateMetric,
  maxAlertLevel,
  type AlertLevel,
} from "./compliance"
import { loadComplianceContext } from "./load-compliance"

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
 * and the jurisdiction-engine evaluation. On any insert failure after the
 * report shell lands, the shell is deleted so the submission can be retried
 * cleanly.
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

  // Jurisdiction engine: evaluate each active-metric reading against the
  // facility's effective (override-tightened) tiers. This is the authoritative
  // evaluation for both online and offline replays.
  const ctx = await loadComplianceContext(supabase, facilityId)

  type ReadingEval = { level: AlertLevel; complianceMax: number | null }
  const evalByReadingType = new Map<string, ReadingEval>()
  const metricAlerts: ComplianceSnapshot["metric_alerts"] = []
  const levels: AlertLevel[] = []

  if (ctx.profile) {
    for (const metric of ctx.metrics) {
      const rt = readingTypes.find(
        (r) => r.key === metric.key || r.key.startsWith(`${metric.key}_`),
      )
      if (!rt) continue
      const value = submittedByType.get(rt.id)
      if (typeof value !== "number") continue
      const tiers = ctx.effectiveTiers[metric.key] ?? {}
      const level = evaluateMetric(value, tiers)
      evalByReadingType.set(rt.id, {
        level,
        complianceMax: tiers.corrective?.max ?? null,
      })
      levels.push(level)
      metricAlerts.push({ metric_key: metric.key, value, alert_level: level })
    }
  }

  const overallAlert: AlertLevel = maxAlertLevel(levels)

  // Corrective-action note required before an over-threshold reading saves.
  if (overallAlert !== "within" && !input.corrective_action_notes) {
    return {
      ok: false,
      error:
        "This reading is over the corrective-action threshold. Add a corrective-action note before submitting.",
    }
  }

  const complianceSnapshot: ComplianceSnapshot | null = ctx.profile
    ? {
        profile_jurisdiction: ctx.profile.jurisdiction,
        reading_kind: input.reading_kind,
        overall_alert_level: overallAlert,
        corrective_action_notes: input.corrective_action_notes,
        metric_alerts: metricAlerts,
      }
    : null

  // Persist the snapshot inside the existing form_data jsonb.
  const formDataToStore = complianceSnapshot
    ? { ...(form_data ?? emptyAirQualityFormData()), compliance: complianceSnapshot }
    : form_data

  // 1) Insert the report shell.
  const { data: insertedReport, error: reportErr } = await supabase
    .from("air_quality_reports")
    .insert({
      facility_id: facilityId,
      employee_id: employeeId,
      location_id: location.id,
      equipment_id,
      notes,
      form_data: formDataToStore,
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

  // 2) Build reading rows, stamping the engine's per-reading verdict.
  type RowToInsert = {
    facility_id: string
    report_id: string
    reading_type_id: string
    key_snapshot: string
    label_snapshot: string
    unit_snapshot: string
    value_numeric: number
    is_exceedance: boolean
    severity_at_submit: string | null
    compliance_min_at_submit: number | null
    compliance_max_at_submit: number | null
  }

  const rtById = new Map(readingTypes.map((rt) => [rt.id, rt]))
  const rowsToInsert: RowToInsert[] = []

  for (const r of readings) {
    const rt = rtById.get(r.reading_type_id)
    if (!rt) continue
    const evaluated = evalByReadingType.get(rt.id)
    const level = evaluated?.level ?? "within"
    const severity = alertLevelToSeverity(level)
    rowsToInsert.push({
      facility_id: facilityId,
      report_id: reportId,
      reading_type_id: rt.id,
      key_snapshot: rt.key,
      label_snapshot: rt.label,
      unit_snapshot: rt.unit,
      value_numeric: r.value,
      is_exceedance: level !== "within",
      severity_at_submit: severity,
      compliance_min_at_submit: null,
      compliance_max_at_submit: evaluated?.complianceMax ?? null,
    })
  }

  // 3) Batch insert readings.
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

  // 4) Roll up onto the report from the engine result.
  const maxSeverity = alertLevelToSeverity(overallAlert)
  const hasExceedance = overallAlert !== "within"

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

  // 5) Optional alert.
  if (hasExceedance && maxSeverity) {
    const { data: settingsRow } = await supabase
      .from("air_quality_settings")
      .select("alerts_enabled")
      .eq("facility_id", facilityId)
      .maybeSingle()

    if (settingsRow?.alerts_enabled) {
      const lines = metricAlerts
        .filter((m) => m.alert_level !== "within")
        .map((m) => `${m.metric_key.toUpperCase()}: ${m.value} (${m.alert_level})`)
      // Best-effort. Failure does not roll back the report.
      await supabase.from("communication_alerts").insert({
        facility_id: facilityId,
        source_module: "air_quality",
        source_record_id: reportId,
        severity: maxSeverity,
        title: `Air Quality: exceedance at ${location.name} [${overallAlert}]`,
        body: lines.join("\n"),
        created_by_employee_id: employeeId,
        requires_acknowledgement: true,
      })
    }
  }

  // 6b) Sustained-exceedance ("evacuation") engine. Jurisdiction rules that
  //     can't be expressed as a single band live as {"sustained":[...]} JSON in
  //     air_quality_compliance_rules. Evaluate the recent series at this
  //     location (the just-inserted readings are already persisted) and, on a
  //     trigger, emit a critical requires-ack alert. Best-effort; never rolls
  //     back the report. No-op when no sustained rule is configured.
  await evaluateAndAlertSustained(supabase, {
    facilityId,
    locationId: location.id,
    locationName: location.name,
    employeeId,
    reportId,
  })

  await dispatchRulesForSubmission({
    facilityId,
    sourceModule: "air_quality",
    sourceRecordId: reportId,
    subject: "Air quality report submitted",
  })

  return { ok: true, reportId }
}

async function evaluateAndAlertSustained(
  supabase: SupabaseClient,
  args: {
    facilityId: string
    locationId: string
    locationName: string
    employeeId: string
    reportId: string
  },
): Promise<void> {
  const { facilityId, locationId, locationName, employeeId, reportId } = args

  const { data: ruleRows } = await supabase
    .from("air_quality_compliance_rules")
    .select("rule_body")
    .eq("facility_id", facilityId)
    .eq("is_active", true)

  const specs = (ruleRows ?? []).flatMap((r) =>
    parseSustainedSpecs(r.rule_body),
  )
  if (specs.length === 0) return

  const wantPollutants = new Set(specs.map((s) => s.pollutant))
  const windowStart = new Date(
    Date.now() - lookbackMsForSpecs(specs),
  ).toISOString()

  const { data: seriesRows } = await supabase
    .from("air_quality_readings")
    .select("value_numeric, key_snapshot, created_at, air_quality_reports!inner(location_id)")
    .eq("facility_id", facilityId)
    .eq("air_quality_reports.location_id", locationId)
    .gte("created_at", windowStart)

  const seriesByPollutant = new Map<string, SeriesPoint[]>()
  for (const row of seriesRows ?? []) {
    const pollutant = pollutantOfReadingKey(row.key_snapshot)
    if (!wantPollutants.has(pollutant)) continue
    const atMs = new Date(row.created_at).getTime()
    if (Number.isNaN(atMs)) continue
    const arr = seriesByPollutant.get(pollutant) ?? []
    arr.push({ atMs, value: row.value_numeric })
    seriesByPollutant.set(pollutant, arr)
  }

  const hits = evaluateSustained(specs, seriesByPollutant)
  if (hits.length === 0) return

  const { data: settingsRow } = await supabase
    .from("air_quality_settings")
    .select("alerts_enabled")
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!settingsRow?.alerts_enabled) return

  await supabase.from("communication_alerts").insert({
    facility_id: facilityId,
    source_module: "air_quality",
    source_record_id: reportId,
    severity: "critical",
    title: `Air Quality: SUSTAINED exceedance — evacuation criteria at ${locationName}`,
    body: [
      "Sustained exceedance detected — follow the facility evacuation protocol:",
      ...hits.map(describeHit),
    ].join("\n"),
    created_by_employee_id: employeeId,
    requires_acknowledgement: true,
  })
}
