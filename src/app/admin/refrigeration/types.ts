// Local types for the Refrigeration admin module.
// Row types come from the generated Supabase types; we layer composite shapes
// on top.

import type { Tables } from "@/types/database"

export type SectionRow = Tables<"refrigeration_sections">
export type EquipmentRow = Tables<"refrigeration_equipment">
export type FieldRow = Tables<"refrigeration_fields">
export type ThresholdRow = Tables<"refrigeration_thresholds">
export type ReportRow = Tables<"refrigeration_reports">
export type ReportValueRow = Tables<"refrigeration_report_values">
export type FollowupNoteRow = Tables<"refrigeration_followup_notes">
export type SettingsRow = Tables<"refrigeration_settings">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

export type FieldType = "numeric" | "text" | "boolean" | "select" | "computed"
export const FIELD_TYPES: readonly FieldType[] = [
  "numeric",
  "text",
  "boolean",
  "select",
  "computed",
] as const
export function isFieldType(v: string): v is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(v)
}

export type Severity = "warn" | "high" | "critical"
export const SEVERITIES: readonly Severity[] = ["warn", "high", "critical"]
export function isSeverity(v: string): v is Severity {
  return (SEVERITIES as readonly string[]).includes(v)
}

export type SelectOption = { key: string; label: string }

export type Tab = "setup" | "history" | "settings"
export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "setup", label: "Setup" },
  { key: "history", label: "History" },
  { key: "settings", label: "Settings" },
]

export function asTab(value: string | undefined): Tab {
  const allowed = TABS.map((t) => t.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as Tab)
    : "setup"
}

// ---- Setup tab composite ----

export type SectionWithCounts = SectionRow & {
  equipment_count: number
  field_count: number
}

export type SectionDetail = {
  section: SectionRow
  equipment: EquipmentRow[]
  fields: FieldRow[]
  thresholds: ThresholdRow[]
}

// ---- History tab composite ----

export type ReportListItem = ReportRow & {
  employee: EmployeeLite | null
  value_count: number
  out_of_range_count: number
  notes_excerpt: string | null
}

export type ReportDetailData = {
  report: ReportRow
  employee: EmployeeLite | null
  values: ReportValueRow[]
  notes: Array<FollowupNoteRow & { author: EmployeeLite | null }>
}

// ---- Action plumbing ----

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }
