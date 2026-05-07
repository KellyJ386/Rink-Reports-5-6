import type { Tables } from "@/types/database"

export type AirQualityLocation = Tables<"air_quality_locations">
export type AirQualityEquipment = Tables<"air_quality_equipment">
export type AirQualityReadingType = Tables<"air_quality_reading_types">
export type AirQualityThreshold = Tables<"air_quality_thresholds">
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

export type ThresholdForForm = {
  id: string
  reading_type_id: string
  location_id: string | null
  warn_min: number | null
  warn_max: number | null
  alert_min: number | null
  alert_max: number | null
  compliance_min: number | null
  compliance_max: number | null
  severity: AirQualitySeverity
}

export type EquipmentForForm = {
  id: string
  name: string
}

export type ComplianceRuleForForm = {
  id: string
  rule_name: string
  rule_body: string
}

/**
 * Hidden `readings_json` payload shape submitted from the form.
 * Server recomputes thresholds, exceedance, and severity.
 */
export type SubmittedReading = {
  reading_type_id: string
  value: number
}
