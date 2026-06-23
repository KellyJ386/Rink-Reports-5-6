// Pure air-quality submission helpers: payload/form parsing, the extended
// monitoring-log sanitizer, and the threshold/severity engine (threshold
// lookup, exceedance evaluation, severity rollup, alert lines). NO server-only
// imports live here, so this module is safe to unit-test in isolation (see
// compute.test.ts) and is re-used by the server-only `submit.ts` (which adds
// the Supabase + notification I/O).

import { emptyAirQualityFormData, isReadingKind } from "../types"
import type {
  AirQualityFormData,
  AirQualityFuelType,
  AirQualityMeasurement,
  AirQualityReadingKind,
  AirQualitySeverity,
  ComplianceSnapshot,
  SubmittedReading,
} from "../types"

export const VALID_SEVERITIES = new Set<AirQualitySeverity>([
  "warn",
  "high",
  "critical",
])

export const SEVERITY_RANK: Record<AirQualitySeverity, number> = {
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
  /** What the reading responded to (drives frequency tracking). */
  reading_kind: AirQualityReadingKind
  /** Operator-entered corrective steps; required server-side when over tier. */
  corrective_action_notes: string | null
}

function readingKindOf(v: unknown): AirQualityReadingKind {
  return typeof v === "string" && isReadingKind(v) ? v : "routine"
}

// ---------------------------------------------------------------------------
// Parsers / sanitizers
// ---------------------------------------------------------------------------

export function parseReadings(raw: string): SubmittedReading[] | null {
  try {
    return readingsFromUnknown(JSON.parse(raw))
  } catch {
    return null
  }
}

export function readingsFromUnknown(parsed: unknown): SubmittedReading[] | null {
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
export function formDataFromUnknown(parsed: unknown): AirQualityFormData | null {
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

  fd.compliance = complianceFromUnknown(src.compliance)

  return fd
}

function complianceFromUnknown(v: unknown): ComplianceSnapshot | null {
  if (!v || typeof v !== "object") return null
  const o = asObj(v)
  const metricAlerts = Array.isArray(o.metric_alerts)
    ? o.metric_alerts.slice(0, MAX_ROWS).flatMap((item) => {
        const r = asObj(item)
        const key = jstr(r.metric_key)
        const value = jnum(r.value)
        if (key === null || value === null) return []
        return [
          {
            metric_key: key,
            value,
            alert_level: jstr(r.alert_level) ?? "within",
          },
        ]
      })
    : []
  return {
    profile_jurisdiction: jstr(o.profile_jurisdiction),
    reading_kind: readingKindOf(o.reading_kind),
    overall_alert_level: jstr(o.overall_alert_level) ?? "within",
    corrective_action_notes: jstr(o.corrective_action_notes),
    metric_alerts: metricAlerts,
  }
}

export function parseFormData(raw: string): AirQualityFormData | null {
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

  const reading_kind = readingKindOf(formData.get("reading_type"))
  const correctiveRaw = formData.get("corrective_action_notes")
  const corrective_action_notes =
    typeof correctiveRaw === "string" && correctiveRaw.trim().length > 0
      ? correctiveRaw.trim()
      : null

  return {
    location_id,
    equipment_id,
    notes,
    readings,
    form_data,
    reading_kind,
    corrective_action_notes,
  }
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

  const reading_kind = readingKindOf(
    payload.reading_kind ?? payload.reading_type,
  )
  const corrective_action_notes =
    typeof payload.corrective_action_notes === "string" &&
    payload.corrective_action_notes.trim().length > 0
      ? payload.corrective_action_notes.trim()
      : null

  return {
    location_id,
    equipment_id,
    notes,
    readings,
    form_data,
    reading_kind,
    corrective_action_notes,
  }
}

// ---------------------------------------------------------------------------
// Threshold / severity engine (pure; submit.ts feeds it DB rows)
// ---------------------------------------------------------------------------

export type ThresholdRow = {
  id: string
  reading_type_id: string
  location_id: string | null
  alert_min: number | null
  alert_max: number | null
  compliance_min: number | null
  compliance_max: number | null
  severity: string
}

/**
 * Resolve the threshold for a reading type at a location: a location-specific
 * threshold wins over the facility-wide (`location_id = null`) fallback.
 */
export function lookupThreshold(
  thresholds: ThresholdRow[],
  readingTypeId: string,
  locationId: string,
): ThresholdRow | null {
  const locMatch = thresholds.find(
    (t) => t.reading_type_id === readingTypeId && t.location_id === locationId,
  )
  if (locMatch) return locMatch
  const fallback = thresholds.find(
    (t) => t.reading_type_id === readingTypeId && t.location_id === null,
  )
  return fallback ?? null
}

export type ReadingEvaluation = {
  isExceedance: boolean
  /** Set only when the reading is an exceedance; unknown DB severities → warn. */
  severity: AirQualitySeverity | null
}

/** Evaluate one value against a threshold's alert bounds (null bound = open). */
export function evaluateReading(
  value: number,
  threshold: ThresholdRow,
): ReadingEvaluation {
  const minHit = threshold.alert_min !== null && value < threshold.alert_min
  const maxHit = threshold.alert_max !== null && value > threshold.alert_max
  if (!minHit && !maxHit) return { isExceedance: false, severity: null }
  const severity = VALID_SEVERITIES.has(threshold.severity as AirQualitySeverity)
    ? (threshold.severity as AirQualitySeverity)
    : "warn"
  return { isExceedance: true, severity }
}

/** Highest-ranked severity in the list, or null when the list is empty. */
export function maxSeverityOf(
  severities: AirQualitySeverity[],
): AirQualitySeverity | null {
  let top: AirQualitySeverity | null = null
  let topRank = 0
  for (const s of severities) {
    const rank = SEVERITY_RANK[s]
    if (rank > topRank) {
      topRank = rank
      top = s
    }
  }
  return top
}

export type ExceedanceDetail = {
  label: string
  value: number
  unit: string
  alert_min: number | null
  alert_max: number | null
  severity: AirQualitySeverity
}

/**
 * Human-readable alert body lines: the first 5 exceedances, each annotated
 * with the bound it crossed, plus an "…and N more" trailer when truncated.
 */
export function buildAlertLines(details: ExceedanceDetail[]): string[] {
  const lines = details.slice(0, 5).map((d) => {
    const unit = d.unit ? ` ${d.unit}` : ""
    const bound =
      d.alert_min !== null && d.value < d.alert_min
        ? `(alert min ${d.alert_min}${unit})`
        : d.alert_max !== null && d.value >= d.alert_max
          ? `(alert max ${d.alert_max}${unit})`
          : ""
    return `${d.label}: ${d.value}${unit} ${bound}`.trim()
  })
  const remainder = details.length - lines.length
  const out = [...lines]
  if (remainder > 0) out.push(`…and ${remainder} more`)
  return out
}
