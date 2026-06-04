// Shared air-quality submission pipeline used by BOTH the online server action
// (`../actions.ts`) and the offline replay endpoint (`/api/offline-sync`).
// Keeping parse → validate → persist (report + per-pollutant readings + severity
// rollup + alert) in one place means an offline submission lands the same rows,
// with the same severity engine, as an online one.
//
// Server-only: it imports the server Supabase client type and the notification
// dispatcher. The client form never imports this — it just builds the JSON
// payload that `buildInputFromPayload` parses here, or posts FormData that
// `buildInputFromFormData` parses.

import "server-only"

import { dispatchRulesForSubmission } from "@/lib/notifications/dispatch"
import type { createClient } from "@/lib/supabase/server"

import { emptyAirQualityFormData } from "../types"
import type {
  AirQualityFormData,
  AirQualityFuelType,
  AirQualityMeasurement,
  AirQualitySeverity,
  SubmittedReading,
} from "../types"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  return err.message?.trim() || fallback
}

const VALID_SEVERITIES = new Set<AirQualitySeverity>([
  "warn",
  "high",
  "critical",
])

const SEVERITY_RANK: Record<AirQualitySeverity, number> = {
  warn: 1,
  high: 2,
  critical: 3,
}

const MAX_ROWS = 100

/** Normalized, validated-shape submission input shared by both entry points. */
export type AirQualityInput = {
  location_id: string
  equipment_id: string | null
  notes: string | null
  readings: SubmittedReading[]
  form_data: AirQualityFormData | null
}

export type PersistResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Parsers / sanitizers
// ---------------------------------------------------------------------------

function parseReadings(raw: string): SubmittedReading[] | null {
  try {
    return readingsFromUnknown(JSON.parse(raw))
  } catch {
    return null
  }
}

function readingsFromUnknown(parsed: unknown): SubmittedReading[] | null {
  if (!Array.isArray(parsed)) return null
  const out: SubmittedReading[] = []
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const reading_type_id =
      typeof r.reading_type_id === "string" ? r.reading_type_id : null
    const value =
      typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null
    if (!reading_type_id || value === null) continue
    out.push({ reading_type_id, value })
  }
  return out
}

const FUEL_TYPES = new Set<AirQualityFuelType>([
  "electric",
  "natural_gas",
  "propane",
  "gasoline",
  "diesel",
  "other",
])

function jstr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}

function jnum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function jfuel(v: unknown): AirQualityFuelType | null {
  return typeof v === "string" && FUEL_TYPES.has(v as AirQualityFuelType)
    ? (v as AirQualityFuelType)
    : null
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

function jmeasurements(v: unknown): AirQualityMeasurement[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, MAX_ROWS).map((item) => {
    const r = asObj(item)
    return {
      location: jstr(r.location),
      time: jstr(r.time),
      co: jnum(r.co),
      no2: jnum(r.no2),
      temperature: jnum(r.temperature),
      note: jstr(r.note),
    }
  })
}

/**
 * Lenient sanitizer for the optional extended monitoring-log payload. Unknown
 * keys are dropped; bad values become null. Never throws — returns null only
 * when the input isn't a JSON object, so submission is never blocked.
 */
function formDataFromUnknown(parsed: unknown): AirQualityFormData | null {
  if (!parsed || typeof parsed !== "object") return null
  const src = parsed as Record<string, unknown>
  const fd = emptyAirQualityFormData()

  fd.tester_certification = jstr(src.tester_certification)
  fd.date_of_test = jstr(src.date_of_test)

  const eq = asObj(src.equipment)
  const co = asObj(eq.co_monitor)
  const no2 = asObj(eq.no2_monitor)
  fd.equipment.co_monitor = {
    type: jstr(co.type),
    model: jstr(co.model),
    calibration_date: jstr(co.calibration_date),
  }
  fd.equipment.no2_monitor = {
    type: jstr(no2.type),
    model: jstr(no2.model),
    calibration_date: jstr(no2.calibration_date),
  }
  fd.equipment.ventilation_last_inspection = jstr(
    eq.ventilation_last_inspection,
  )

  const s1 = asObj(src.section1)
  fd.section1.arena_status = jstr(s1.arena_status)
  fd.section1.ventilation_status = jstr(s1.ventilation_status)
  fd.section1.resurfacers = Array.isArray(s1.resurfacers)
    ? s1.resurfacers.slice(0, MAX_ROWS).map((item) => {
        const r = asObj(item)
        return { make_model: jstr(r.make_model), fuel_type: jfuel(r.fuel_type) }
      })
    : []
  fd.section1.other_equipment = Array.isArray(s1.other_equipment)
    ? s1.other_equipment.slice(0, MAX_ROWS).map((item) => {
        const r = asObj(item)
        return { name: jstr(r.name), fuel_type: jfuel(r.fuel_type) }
      })
    : []
  const maint = asObj(s1.maintenance)
  fd.section1.maintenance = {
    resurfacers: jstr(maint.resurfacers),
    ventilation: jstr(maint.ventilation),
    other: jstr(maint.other),
  }

  const s2 = asObj(src.section2)
  fd.section2.routine = jmeasurements(s2.routine)
  fd.section2.post_edging = jmeasurements(s2.post_edging)

  const s4 = asObj(src.section4)
  fd.section4.electric_equipment_consideration = jstr(
    s4.electric_equipment_consideration,
  )
  fd.section4.staff_trained = s4.staff_trained === true
  fd.section4.public_signage = s4.public_signage === true
  fd.section4.unusual_observations = jstr(s4.unusual_observations)

  return fd
}

function parseFormData(raw: string): AirQualityFormData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return formDataFromUnknown(parsed)
}

// ---------------------------------------------------------------------------
// Input builders (one per entry point)
// ---------------------------------------------------------------------------

/** Build from the online form's FormData (string-encoded hidden inputs). */
export function buildInputFromFormData(formData: FormData): AirQualityInput | null {
  const location_id = String(formData.get("location_id") ?? "")
  if (!location_id) return null

  const equipmentRaw = formData.get("equipment_id")
  const equipment_id =
    typeof equipmentRaw === "string" && equipmentRaw.length > 0
      ? equipmentRaw
      : null

  const notesRaw = formData.get("notes")
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim()
      : null

  const readings = parseReadings(String(formData.get("readings_json") ?? ""))
  if (!readings) return null

  const formDataRaw = formData.get("form_data")
  const form_data =
    typeof formDataRaw === "string" && formDataRaw.length > 0
      ? parseFormData(formDataRaw)
      : null

  return { location_id, equipment_id, notes, readings, form_data }
}

/**
 * Build from a queued offline payload (untrusted JSON). `readings` and
 * `form_data` may arrive as either parsed objects (the client's preferred
 * shape) or JSON strings, so both are accepted.
 */
export function buildInputFromPayload(
  payload: Record<string, unknown>,
): AirQualityInput | null {
  const location_id =
    typeof payload.location_id === "string" ? payload.location_id : ""
  if (!location_id) return null

  const equipment_id =
    typeof payload.equipment_id === "string" && payload.equipment_id.length > 0
      ? payload.equipment_id
      : null

  const notes =
    typeof payload.notes === "string" && payload.notes.trim().length > 0
      ? payload.notes.trim()
      : null

  const readings =
    typeof payload.readings === "string"
      ? parseReadings(payload.readings)
      : readingsFromUnknown(payload.readings)
  if (!readings) return null

  const form_data =
    typeof payload.form_data === "string"
      ? parseFormData(payload.form_data)
      : formDataFromUnknown(payload.form_data)

  return { location_id, equipment_id, notes, readings, form_data }
}

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
    .from("air_quality_locations")
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

  type ThresholdRow = {
    id: string
    reading_type_id: string
    location_id: string | null
    alert_min: number | null
    alert_max: number | null
    compliance_min: number | null
    compliance_max: number | null
    severity: string
  }
  const thresholds = (thresholdsRaw ?? []) as ThresholdRow[]
  const matchingLocationId = location.id

  function lookupThreshold(readingTypeId: string): ThresholdRow | null {
    const locMatch = thresholds.find(
      (t) =>
        t.reading_type_id === readingTypeId &&
        t.location_id === matchingLocationId,
    )
    if (locMatch) return locMatch
    const fallback = thresholds.find(
      (t) => t.reading_type_id === readingTypeId && t.location_id === null,
    )
    return fallback ?? null
  }

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

  type ExceedanceDetail = {
    label: string
    value: number
    unit: string
    alert_min: number | null
    alert_max: number | null
    severity: AirQualitySeverity
  }

  const rowsToInsert: RowToInsert[] = []
  const exceedanceDetails: ExceedanceDetail[] = []

  const rtById = new Map(readingTypes.map((rt) => [rt.id, rt]))

  for (const r of readings) {
    const rt = rtById.get(r.reading_type_id)
    if (!rt) continue
    const t = lookupThreshold(r.reading_type_id)

    let isExceedance = false
    let severity: AirQualitySeverity | null = null
    let thresholdId: string | null = null
    let complianceMin: number | null = null
    let complianceMax: number | null = null

    if (t) {
      thresholdId = t.id
      complianceMin = t.compliance_min
      complianceMax = t.compliance_max
      const minHit = t.alert_min !== null && r.value < t.alert_min
      const maxHit = t.alert_max !== null && r.value > t.alert_max
      if (minHit || maxHit) {
        isExceedance = true
        severity = VALID_SEVERITIES.has(t.severity as AirQualitySeverity)
          ? (t.severity as AirQualitySeverity)
          : "warn"
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
      threshold_id: thresholdId,
      is_exceedance: isExceedance,
      severity_at_submit: severity,
      compliance_min_at_submit: complianceMin,
      compliance_max_at_submit: complianceMax,
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
  let maxSeverity: AirQualitySeverity | null = null
  if (hasExceedance) {
    let topRank = 0
    for (const d of exceedanceDetails) {
      const rank = SEVERITY_RANK[d.severity]
      if (rank > topRank) {
        topRank = rank
        maxSeverity = d.severity
      }
    }
  }

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
      const lines = exceedanceDetails.slice(0, 5).map((d) => {
        const unit = d.unit ? ` ${d.unit}` : ""
        const bound =
          d.alert_min !== null && d.value < d.alert_min
            ? `(alert min ${d.alert_min}${unit})`
            : d.alert_max !== null && d.value >= d.alert_max
              ? `(alert max ${d.alert_max}${unit})`
              : ""
        return `${d.label}: ${d.value}${unit} ${bound}`.trim()
      })
      const remainder = exceedanceDetails.length - lines.length
      const bodyParts = [...lines]
      if (remainder > 0) bodyParts.push(`…and ${remainder} more`)

      // Best-effort. Failure does not roll back the report.
      await supabase.from("communication_alerts").insert({
        facility_id: facilityId,
        source_module: "air_quality",
        source_record_id: reportId,
        severity: maxSeverity,
        title: `Air Quality: exceedance at ${location.name}`,
        body: bodyParts.join("\n"),
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
