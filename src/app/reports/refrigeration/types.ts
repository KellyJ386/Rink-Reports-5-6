import type { Tables } from "@/types/database"

export type RefrigerationSection = Tables<"refrigeration_sections">
export type RefrigerationEquipment = Tables<"refrigeration_equipment">
export type RefrigerationField = Tables<"refrigeration_fields">
export type RefrigerationThreshold = Tables<"refrigeration_thresholds">
export type RefrigerationSettings = Tables<"refrigeration_settings">
export type RefrigerationReport = Tables<"refrigeration_reports">
export type RefrigerationReportValue = Tables<"refrigeration_report_values">

export type RefrigerationFieldType =
  | "numeric"
  | "text"
  | "boolean"
  | "select"
  | "computed"

export type RefrigerationFieldOption = {
  key: string
  label: string
}

/**
 * Shape of each row in the hidden `values_json` field submitted by the form.
 * The server recomputes `is_out_of_range` and `threshold_id`; the client never
 * supplies those.
 */
export type SubmittedFieldValue = {
  field_id: string
  equipment_id: string | null
  label_snapshot: string
  equipment_name_snapshot: string
  field_type_snapshot: RefrigerationFieldType
  unit_snapshot: string | null
  value_text: string | null
  value_numeric: number | null
  value_boolean: boolean | null
}

export type SubmittedPayload = {
  notes?: string
  values: SubmittedFieldValue[]
}

/**
 * Severity values shared with `communication_alerts`. The threshold severity
 * passes through unchanged.
 */
export type ThresholdSeverity = "warn" | "high" | "critical"
