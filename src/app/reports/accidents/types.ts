import type { Tables } from "@/types/database"

export type AccidentDropdown = Tables<"accident_dropdowns">
export type AccidentReport = Tables<"accident_reports">
export type AccidentBodyPartSelection = Tables<"accident_body_part_selections">
export type AccidentWorkersCompSettings =
  Tables<"accident_workers_comp_settings">

export type AccidentDropdownCategory =
  | "injury_type"
  | "body_part"
  | "location"
  | "activity"
  | "medical_attention"
  | "severity"

/**
 * Lightweight dropdown shape passed to client forms.
 */
export type DropdownOption = {
  id: string
  key: string
  display_name: string
  color: string | null
  triggersAlert?: boolean
}

/**
 * Body parts (category='body_part') include their canonical key so the form
 * can reconcile selections with the SVG diagram.
 */
export type BodyPartOption = {
  id: string
  key: string
  display_name: string
}

/**
 * Wire-format payload for body part selections submitted via hidden input.
 *
 * One row is emitted per (region, view-side, laterality) leaf state. Paired
 * regions (arms, legs, shoulders, …) always carry a non-null laterality; for
 * "both left and right" the form emits two rows. Midline regions (head, neck,
 * torso, …) carry laterality=null.
 */
export type BodyPartsPayloadEntry = {
  body_part_dropdown_id: string
  side: "front" | "back" | "both" | "none"
  laterality: "left" | "right" | null
}

/**
 * Wire-format payload for witnesses submitted via hidden input.
 */
export type WitnessPayloadEntry = {
  name: string
  contact: string | null
  statement: string | null
}

/**
 * Snapshot of an accident_reports row written into accident_change_log.after.
 */
export type AccidentReportSnapshot = {
  id: string
  facility_id: string
  employee_id: string | null
  injured_person_name: string
  injured_person_contact: string
  injured_person_age: number | null
  description: string
  occurred_at: string
  submitted_at: string
  edit_window_ends_at: string
  workers_comp: boolean
  workers_comp_acknowledged_at: string | null
  location_dropdown_id: string | null
  activity_dropdown_id: string | null
  severity_dropdown_id: string | null
  medical_attention_dropdown_id: string | null
  primary_injury_type_dropdown_id: string | null
  body_parts: BodyPartsPayloadEntry[]
  witnesses: WitnessPayloadEntry[]
}
