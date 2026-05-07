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

export const DROPDOWN_CATEGORIES = [
  "injury_type",
  "body_part",
  "location",
  "activity",
  "medical_attention",
  "severity",
] as const
export type DropdownCategory = (typeof DROPDOWN_CATEGORIES)[number]

export const DROPDOWN_CATEGORY_LABELS: Record<DropdownCategory, string> = {
  injury_type: "Injury Type",
  body_part: "Body Part",
  location: "Location",
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

export type AccidentReportDetail = {
  report: AccidentReportRow
  injury_type: DropdownLite | null
  location: DropdownLite | null
  activity: DropdownLite | null
  medical_attention: DropdownLite | null
  severity: DropdownLite | null
  employee: EmployeeLite | null
  body_parts: BodyPartSelectionWithDropdown[]
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
