// Local types for the Ice Operations admin module.
// Row types come from generated Supabase types; we layer composite shapes here.

import { cToF } from "@/lib/units"
import type { Tables } from "@/types/database"

export type SettingsRow = Tables<"ice_operations_settings">
export type RinkRow = Tables<"ice_operations_rinks">
export type EquipmentRow = Tables<"ice_operations_equipment">
export type CircleCheckItemRow = Tables<"ice_operations_circle_check_items">
export type SubmissionRow = Tables<"ice_operations_submissions">
export type CircleCheckResultRow = Tables<"ice_operations_circle_check_results">
export type FollowupNoteRow = Tables<"ice_operations_followup_notes">

export type FuelTypeRow = Tables<"ice_operations_fuel_types">

export type CircleCheckTemplateRow = Tables<"ice_operations_circle_check_templates">

export type CircleCheckTemplateItemRow =
  Tables<"ice_operations_circle_check_template_items">

// App-level cap: at most four circle-check templates per facility.
export const CIRCLE_CHECK_TEMPLATE_CAP = 4

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

// 4 fixed operation types — cannot be added/removed.
export type OperationType =
  | "ice_make"
  | "circle_check"
  | "edging"
  | "blade_change"
export const OPERATION_TYPES: ReadonlyArray<{
  key: OperationType
  label: string
}> = [
  { key: "ice_make", label: "Ice Make" },
  { key: "circle_check", label: "Circle Check" },
  { key: "edging", label: "Edging" },
  { key: "blade_change", label: "Blade Change" },
]
export function isOperationType(v: string): v is OperationType {
  return (OPERATION_TYPES.map((o) => o.key) as readonly string[]).includes(v)
}
// Operation types that no longer have a tab/filter/settings entry but may
// exist as historical rows (propane briefly had its own tab before becoming
// the Ice Make form's toggle). Keeps their history rendering human-readable.
const LEGACY_OPERATION_LABELS: Record<string, string> = {
  propane_tank_change: "Propane Tank Change",
}
export function operationLabel(v: string): string {
  return (
    OPERATION_TYPES.find((o) => o.key === v)?.label ??
    LEGACY_OPERATION_LABELS[v] ??
    v
  )
}

// Fixed equipment types. "blade_set" is retired — a blade change is always
// performed on an ice resurfacer, so the staff form pulls resurfacers and
// there is nothing left for a blade-set row to feed. It stays in the DB CHECK
// (and the union) so historical rows remain valid, but it can no longer be
// picked when creating or editing equipment.
export type EquipmentType =
  | "ice_resurfacer"
  | "edger"
  | "blade_set"
  | "hand_edger"
  | "other"
export const EQUIPMENT_TYPES: ReadonlyArray<{
  key: EquipmentType
  label: string
}> = [
  { key: "ice_resurfacer", label: "Ice Resurfacer" },
  { key: "edger", label: "Edger" },
  { key: "hand_edger", label: "Hand Edger" },
  { key: "other", label: "Other" },
]
const LEGACY_EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  blade_set: "Blade Set (retired)",
}
export function isEquipmentType(v: string): v is EquipmentType {
  return (EQUIPMENT_TYPES.map((e) => e.key) as readonly string[]).includes(v)
}
export function equipmentTypeLabel(v: string): string {
  return (
    EQUIPMENT_TYPES.find((e) => e.key === v)?.label ??
    LEGACY_EQUIPMENT_TYPE_LABELS[v] ??
    v
  )
}

export type Severity = "warn" | "high" | "critical"
export const SEVERITIES: readonly Severity[] = ["warn", "high", "critical"]
export function isSeverity(v: string): v is Severity {
  return (SEVERITIES as readonly string[]).includes(v)
}

// Only used to render legacy temperature payloads (the ice-make form no
// longer collects temperatures); the settings UI no longer edits the unit.
export type TemperatureUnit = "F" | "C"

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

// Circle check item bulk add cap (UI-only).
export const CIRCLE_CHECK_BULK_CAP = 50

// ---- Setup tab composite ----

export type SetupData = {
  rinks: RinkRow[]
  equipment: EquipmentRow[]
  circleCheckItems: CircleCheckItemRow[]
  fuelTypes: FuelTypeRow[]
  templates: CircleCheckTemplateRow[]
  templateItems: CircleCheckTemplateItemRow[]
}

// ---- History tab composite ----

export type SubmissionListItem = SubmissionRow & {
  rink: RinkRow | null
  equipment: EquipmentRow | null
  employee: EmployeeLite | null
}

export type SubmissionDetailData = {
  submission: SubmissionRow
  rink: RinkRow | null
  equipment: EquipmentRow | null
  employee: EmployeeLite | null
  results: CircleCheckResultRow[]
  notes: Array<FollowupNoteRow & { author: EmployeeLite | null }>
  // For blade_change payload lookup of replacing employee
  replacedByEmployee: EmployeeLite | null
}

// ---- Action plumbing ----

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }

// ---- Payload shapes (per operation_type) ----
// Stored in submissions.payload jsonb. Temperatures stored in Celsius.

export type IceMakePayload = {
  water_used_gal: number | null
  machine_hours: number | null
  snow_taken_pct: number | null
  time_in: string | null
  time_out: string | null
  // The Ice Make form's Propane Tank Change toggle (false for older rows).
  propane_tank_changed: boolean
  // Legacy fields kept so historical submissions still display.
  water_temp_c: number | null
  ice_temp_c: number | null
  surface_pass_count: number | null
}

export type EdgingPayload = {
  hours_run: number | null
}

export type BladeChangePayload = {
  blade_serial: string | null
  hours_at_change: number | null
  replaced_by_employee_id: string | null
}

// Legacy payload from propane's brief run as its own operation type; kept so
// any historical rows still render in history/detail.
export type PropaneTankChangePayload = {
  hours_at_change: number | null
}

export function readIceMakePayload(p: unknown): IceMakePayload {
  const o = (p ?? {}) as Record<string, unknown>
  return {
    water_used_gal:
      typeof o.water_used_gal === "number" ? o.water_used_gal : null,
    machine_hours:
      typeof o.machine_hours === "number" ? o.machine_hours : null,
    snow_taken_pct:
      typeof o.snow_taken_pct === "number" ? o.snow_taken_pct : null,
    time_in: typeof o.time_in === "string" ? o.time_in : null,
    time_out: typeof o.time_out === "string" ? o.time_out : null,
    propane_tank_changed: o.propane_tank_changed === true,
    water_temp_c: typeof o.water_temp_c === "number" ? o.water_temp_c : null,
    ice_temp_c: typeof o.ice_temp_c === "number" ? o.ice_temp_c : null,
    surface_pass_count:
      typeof o.surface_pass_count === "number" ? o.surface_pass_count : null,
  }
}

export function readEdgingPayload(p: unknown): EdgingPayload {
  const o = (p ?? {}) as Record<string, unknown>
  return {
    hours_run: typeof o.hours_run === "number" ? o.hours_run : null,
  }
}

export function readPropaneTankChangePayload(
  p: unknown,
): PropaneTankChangePayload {
  const o = (p ?? {}) as Record<string, unknown>
  return {
    hours_at_change:
      typeof o.hours_at_change === "number" ? o.hours_at_change : null,
  }
}

export function readBladeChangePayload(p: unknown): BladeChangePayload {
  const o = (p ?? {}) as Record<string, unknown>
  return {
    blade_serial:
      typeof o.blade_serial === "string" ? o.blade_serial : null,
    hours_at_change:
      typeof o.hours_at_change === "number" ? o.hours_at_change : null,
    replaced_by_employee_id:
      typeof o.replaced_by_employee_id === "string"
        ? o.replaced_by_employee_id
        : null,
  }
}

// Celsius ↔ display conversion. Storage is always Celsius.
export function formatTemp(
  celsius: number | null,
  unit: TemperatureUnit,
): string {
  if (celsius === null) return "—"
  if (unit === "C") return `${celsius.toFixed(1)} °C`
  return `${cToF(celsius).toFixed(1)} °F`
}
