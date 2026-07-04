// Local types for the Incident Reports admin module.
// Row types come from the generated Supabase types; we layer composite shapes
// for joined views on top.

import type { Tables } from "@/types/database"

export type IncidentTypeRow = Tables<"incident_types">
export type SeverityRow = Tables<"incident_severity_levels">
export type ActivityRow = Tables<"incident_activities">
export type FacilitySpaceRow = Tables<"facility_spaces">
export type IncidentReportRow = Tables<"incident_reports">
export type FollowupNoteRow = Tables<"incident_followup_notes">
export type WitnessRow = Tables<"incident_witnesses">
export type ChangeLogRow = Tables<"incident_change_log">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

export type IncidentStatus = "submitted" | "in_review" | "resolved" | "archived"

export const STATUSES: readonly IncidentStatus[] = [
  "submitted",
  "in_review",
  "resolved",
  "archived",
] as const

export function isIncidentStatus(value: string): value is IncidentStatus {
  return (STATUSES as readonly string[]).includes(value)
}

export type IncidentReportListItem = IncidentReportRow & {
  type: Pick<IncidentTypeRow, "id" | "name" | "color"> | null
  severity: Pick<SeverityRow, "id" | "key" | "display_name" | "color"> | null
  employee: EmployeeLite | null
  /** Linked space names + "Other" text (falls back to the legacy `location`). */
  locationLabel: string | null
}

export type IncidentReportDetail = {
  report: IncidentReportRow
  type: Pick<IncidentTypeRow, "id" | "name" | "color" | "slug"> | null
  severity: Pick<SeverityRow, "id" | "key" | "display_name" | "color"> | null
  activity: Pick<ActivityRow, "id" | "display_name" | "color"> | null
  spaces: Array<Pick<FacilitySpaceRow, "id" | "name">>
  witnesses: WitnessRow[]
  employee: EmployeeLite | null
  notes: Array<FollowupNoteRow & { author: EmployeeLite | null }>
  changeLog: Array<ChangeLogRow & { author: EmployeeLite | null }>
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }

export type BulkImportResult =
  | { ok: true; inserted: number; skipped: number; errors: string[] }
  | { ok: false; error: string }

export type Tab = "history" | "types" | "severities" | "activities"

export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "history", label: "History" },
  { key: "types", label: "Incident Types" },
  { key: "severities", label: "Severity Levels" },
  { key: "activities", label: "Activities" },
]
