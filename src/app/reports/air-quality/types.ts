import type { Tables } from "@/types/database"

// Air Quality now uses the shared facility_spaces list (migration 143).
export type AirQualityLocation = Tables<"facility_spaces">
export type AirQualityEquipment = Tables<"air_quality_equipment">
export type AirQualityReadingType = Tables<"air_quality_reading_types">
export type AirQualityComplianceRule = Tables<"air_quality_compliance_rules">
export type AirQualitySettings = Tables<"air_quality_settings">
export type AirQualityReport = Tables<"air_quality_reports">
export type AirQualityReading = Tables<"air_quality_readings">

export type AirQualitySeverity = "warn" | "high" | "critical"

export type ReadingTypeForm = {
  id: string
  key: string
  label: string
  unit: string
  decimals: number
  is_required: boolean
  sort_order: number
}

export type EquipmentForForm = {
  id: string
  name: string
  /** Facility space this monitor lives at; null = facility-wide / handheld. */
  location_id: string | null
}

/** A facility space offered in the location dropdown (shared facility_spaces list). */
export type LocationOption = {
  id: string
  name: string
}

/** What the reading was taken in response to (drives frequency tracking). */
export type AirQualityReadingKind =
  | "routine"
  | "post_resurfacing"
  | "post_edging"

export const READING_KIND_OPTIONS: ReadonlyArray<{
  value: AirQualityReadingKind
  label: string
}> = [
  { value: "routine", label: "Routine" },
  { value: "post_resurfacing", label: "Post-resurfacing" },
  { value: "post_edging", label: "Post-edging" },
]

export function isReadingKind(v: string): v is AirQualityReadingKind {
  return (
    v === "routine" || v === "post_resurfacing" || v === "post_edging"
  )
}

/**
 * Engine result persisted into air_quality_reports.form_data.compliance. Uses
 * plain string unions (not the engine's AlertLevel) to keep types.ts free of a
 * runtime import cycle with compliance.ts.
 */
export type ComplianceSnapshot = {
  profile_jurisdiction: string | null
  reading_kind: AirQualityReadingKind
  overall_alert_level: string
  corrective_action_notes: string | null
  metric_alerts: Array<{
    metric_key: string
    value: number
    alert_level: string
  }>
}

/**
 * Hidden `readings_json` payload shape submitted from the form.
 * Server recomputes thresholds, exceedance, and severity.
 */
export type SubmittedReading = {
  reading_type_id: string
  value: number
}

// ---------------------------------------------------------------------------
// Extended monitoring-log payload (stored optionally in
// air_quality_reports.form_data). All fields optional; supplementary to the
// threshold-checked readings above.
// ---------------------------------------------------------------------------

export const FUEL_TYPE_OPTIONS = [
  { value: "electric", label: "Electric" },
  { value: "natural_gas", label: "Natural gas" },
  { value: "propane", label: "Propane" },
  { value: "gasoline", label: "Gasoline" },
  { value: "diesel", label: "Diesel" },
  { value: "other", label: "Other" },
] as const

export const ARENA_STATUS_OPTIONS = [
  { value: "operating", label: "Operating" },
  { value: "limited", label: "Limited operation" },
  { value: "closed", label: "Closed" },
] as const

export const VENTILATION_STATUS_OPTIONS = [
  { value: "operational", label: "Operational" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "offline", label: "Offline" },
] as const

export const ELECTRIC_EQUIPMENT_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "considering", label: "Considering" },
] as const

export type AirQualityFuelType =
  | "electric"
  | "natural_gas"
  | "propane"
  | "gasoline"
  | "diesel"
  | "other"

export type MonitorInfo = {
  type: string | null
  model: string | null
  calibration_date: string | null
}

export type ResurfacerEntry = {
  make_model: string | null
  fuel_type: AirQualityFuelType | null
}

export type OtherEquipmentEntry = {
  name: string | null
  fuel_type: AirQualityFuelType | null
}

export type AirQualityMeasurement = {
  location: string | null
  time: string | null
  co: number | null
  no2: number | null
  temperature: number | null
  note: string | null
}

export type AirQualityFormData = {
  tester_certification: string | null
  date_of_test: string | null
  equipment: {
    co_monitor: MonitorInfo
    no2_monitor: MonitorInfo
    ventilation_last_inspection: string | null
  }
  section1: {
    arena_status: string | null
    resurfacers: ResurfacerEntry[]
    other_equipment: OtherEquipmentEntry[]
    ventilation_status: string | null
    maintenance: {
      resurfacers: string | null
      ventilation: string | null
      other: string | null
    }
  }
  section2: {
    routine: AirQualityMeasurement[]
    post_edging: AirQualityMeasurement[]
  }
  section4: {
    electric_equipment_consideration: string | null
    staff_trained: boolean
    public_signage: boolean
    unusual_observations: string | null
  }
  /** Jurisdiction-aware engine result; server-authored (recomputed on submit). */
  compliance: ComplianceSnapshot | null
}

export function emptyMeasurement(): AirQualityMeasurement {
  return {
    location: null,
    time: null,
    co: null,
    no2: null,
    temperature: null,
    note: null,
  }
}

export function emptyAirQualityFormData(): AirQualityFormData {
  return {
    tester_certification: null,
    date_of_test: null,
    equipment: {
      co_monitor: { type: null, model: null, calibration_date: null },
      no2_monitor: { type: null, model: null, calibration_date: null },
      ventilation_last_inspection: null,
    },
    section1: {
      arena_status: null,
      resurfacers: [],
      other_equipment: [],
      ventilation_status: null,
      maintenance: { resurfacers: null, ventilation: null, other: null },
    },
    section2: { routine: [], post_edging: [] },
    section4: {
      electric_equipment_consideration: null,
      staff_trained: false,
      public_signage: false,
      unusual_observations: null,
    },
    compliance: null,
  }
}
