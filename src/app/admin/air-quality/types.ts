// Local types for the Air Quality admin module.
// Row types come from generated Supabase types; we layer composite shapes on
// top.

import type { Tables } from "@/types/database"

// Air Quality now uses the shared facility_spaces list (migration 143).
export type LocationRow = Tables<"facility_spaces">
export type EquipmentRow = Tables<"air_quality_equipment">
export type ReadingTypeRow = Tables<"air_quality_reading_types">
export type ThresholdRow = Tables<"air_quality_thresholds">
export type ComplianceRuleRow = Tables<"air_quality_compliance_rules">
export type ReportRow = Tables<"air_quality_reports">
export type ReadingRow = Tables<"air_quality_readings">
export type FollowupNoteRow = Tables<"air_quality_followup_notes">
export type SettingsRow = Tables<"air_quality_settings">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

export type Severity = "warn" | "high" | "critical"
export const SEVERITIES: readonly Severity[] = ["warn", "high", "critical"]
export function isSeverity(v: string): v is Severity {
  return (SEVERITIES as readonly string[]).includes(v)
}

export type Tab = "setup" | "compliance" | "history" | "settings"
export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "setup", label: "Setup" },
  { key: "compliance", label: "Compliance" },
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

export type LocationWithCounts = LocationRow & {
  equipment_count: number
}

export type LocationDetail = {
  location: LocationRow
  equipment: EquipmentRow[]
}

export type SetupData = {
  locations: LocationWithCounts[]
  facilityEquipment: EquipmentRow[]
  readingTypes: ReadingTypeRow[]
  thresholds: ThresholdRow[]
  detail: LocationDetail | null
  activeLocationId: string | null
  allLocations: LocationRow[]
}

// ---- Compliance tab composite ----

export type ComplianceData = {
  rules: ComplianceRuleRow[]
  jurisdictions: string[]
  defaultJurisdiction: string | null
}

// ---- History tab composite ----

export type ReportListItem = ReportRow & {
  location: LocationRow | null
  equipment: EquipmentRow | null
  employee: EmployeeLite | null
  reading_count: number
  exceedance_count: number
  notes_excerpt: string | null
}

export type ReportDetailData = {
  report: ReportRow
  location: LocationRow | null
  equipment: EquipmentRow | null
  employee: EmployeeLite | null
  readings: ReadingRow[]
  notes: Array<FollowupNoteRow & { author: EmployeeLite | null }>
}

// ---- Action plumbing ----

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }
