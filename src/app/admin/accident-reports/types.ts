// Local types for the Accident Reports admin module.
// Row types come from the generated Supabase types; we layer composite shapes
// for joined views on top.

import type { Tables } from "@/types/database"

export type AccidentDropdownRow = Tables<"accident_dropdowns">
export type AccidentReportRow = Tables<"accident_reports">
export type AccidentBodyPartSelectionRow =
  Tables<"accident_body_part_selections">
export type AccidentFollowupNoteRow = Tables<"accident_followup_notes">
export type AccidentChangeLogRow = Tables<"accident_change_log">
export type AccidentWorkersCompSettingsRow =
  Tables<"accident_workers_comp_settings">

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

// Location is intentionally NOT a category here: accident "location" now comes
// from the shared facility_spaces list (managed at /admin/spaces), not from
// accident_dropdowns. See migration 142.
export const DROPDOWN_CATEGORIES = [
  "injury_type",
  "body_part",
  "activity",
  "medical_attention",
  "severity",
] as const
export type DropdownCategory = (typeof DROPDOWN_CATEGORIES)[number]

export const DROPDOWN_CATEGORY_LABELS: Record<DropdownCategory, string> = {
  injury_type: "Injury Type",
  body_part: "Body Part",
  activity: "Activity",
  medical_attention: "Medical Attention",
  severity: "Severity",
}

export function isDropdownCategory(value: string): value is DropdownCategory {
  return (DROPDOWN_CATEGORIES as readonly string[]).includes(value)
}

export const BODY_PART_SIDES = ["front", "back", "both", "none"] as const
export type BodyPartSide = (typeof BODY_PART_SIDES)[number]

export function isBodyPartSide(value: string): value is BodyPartSide {
  return (BODY_PART_SIDES as readonly string[]).includes(value)
}

export type DropdownLite = Pick<
  AccidentDropdownRow,
  "id" | "key" | "display_name" | "color" | "category"
>

export type AccidentReportListItem = AccidentReportRow & {
  injury_type: DropdownLite | null
  location: DropdownLite | null
  activity: DropdownLite | null
  medical_attention: DropdownLite | null
  severity: DropdownLite | null
  employee: EmployeeLite | null
}

export type BodyPartSelectionWithDropdown = AccidentBodyPartSelectionRow & {
  body_part: DropdownLite | null
}

// accident_witnesses is added by migration 00000000000051 and not yet present
// in the generated Database types -- mirror the row shape locally.
export type AccidentWitnessRow = {
  id: string
  facility_id: string
  accident_id: string
  name: string
  contact: string | null
  statement: string | null
  sort_order: number
  created_at: string
  updated_at: string | null
}

// AccidentReportRow does not yet carry injured_person_age (added by migration
// 00000000000051). Layer it locally so admin components can render it.
export type AccidentReportWithAge = AccidentReportRow & {
  injured_person_age: number | null
}

export type AccidentReportDetail = {
  report: AccidentReportWithAge
  injury_type: DropdownLite | null
  location: DropdownLite | null
  activity: DropdownLite | null
  medical_attention: DropdownLite | null
  severity: DropdownLite | null
  employee: EmployeeLite | null
  body_parts: BodyPartSelectionWithDropdown[]
  witnesses: AccidentWitnessRow[]
  notes: Array<AccidentFollowupNoteRow & { author: EmployeeLite | null }>
  change_log: Array<AccidentChangeLogRow & { actor: EmployeeLite | null }>
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }

export type Tab = "history" | "dropdowns" | "workers-comp"

export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "history", label: "History" },
  { key: "dropdowns", label: "Dropdowns" },
  { key: "workers-comp", label: "Workers' Comp" },
]
