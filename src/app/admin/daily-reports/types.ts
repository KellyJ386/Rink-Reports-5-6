// Local types for the Daily Reports admin module.
// 1:1 row types are re-exported from the generated Supabase types.

import type { Tables } from "@/types/database"

// Maximum number of ACTIVE daily-report areas a facility may have. This MUST
// stay in sync with the DB-side cap enforced by the `enforce_daily_report_areas_cap`
// trigger (migration 00000000000007_daily_reports_schema.sql, `v_count >= 30`).
// The trigger is the source of truth; this constant drives the admin UI's
// at-cap state and copy so the limit lives in one place on the client.
export const MAX_ACTIVE_DAILY_AREAS = 30

export type AreaRow = Tables<"daily_report_areas">
export type TemplateRow = Tables<"daily_report_templates">
export type ChecklistItemRow = Tables<"daily_report_checklist_items">
export type SubmissionRow = Tables<"daily_report_submissions">
export type SubmissionItemRow = Tables<"daily_report_submission_items">
export type NoteRow = Tables<"daily_report_notes">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

export type SubmissionListItem = SubmissionRow & {
  area: Pick<AreaRow, "id" | "name" | "color"> | null
  template: Pick<TemplateRow, "id" | "name"> | null
  employee: EmployeeLite | null
  item_count: number
  checked_count: number
  note_count: number
}

export type SubmissionDetail = {
  submission: SubmissionRow
  area: Pick<AreaRow, "id" | "name" | "color" | "slug"> | null
  template: Pick<TemplateRow, "id" | "name" | "description"> | null
  employee: EmployeeLite | null
  items: SubmissionItemRow[]
  notes: Array<NoteRow & { author: EmployeeLite | null }>
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }

export type Tab = "areas" | "templates" | "items" | "submissions" | "access"

export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "areas", label: "Areas" },
  { key: "templates", label: "Templates" },
  { key: "items", label: "Checklist Items" },
  { key: "access", label: "Area Access" },
  { key: "submissions", label: "Submissions" },
]
