import type { Tables } from "@/types/database"

export type IceOperationsSettings = Tables<"ice_operations_settings">
export type IceOperationsRink = Tables<"ice_operations_rinks">
export type IceOperationsEquipment = Tables<"ice_operations_equipment">
export type IceOperationsSubmission = Tables<"ice_operations_submissions">
export type IceOperationsCircleCheckItem =
  Tables<"ice_operations_circle_check_items">
export type IceOperationsCircleCheckResult =
  Tables<"ice_operations_circle_check_results">

export type OperationType =
  | "ice_make"
  | "circle_check"
  | "edging"
  | "blade_change"

export type EquipmentType =
  | "ice_resurfacer"
  | "edger"
  | "blade_set"
  | "hand_edger"
  | "other"

export type TemperatureUnit = "F" | "C"

export const OPERATION_TYPES: readonly OperationType[] = [
  "ice_make",
  "circle_check",
  "edging",
  "blade_change",
] as const

export const OPERATION_LABELS: Record<OperationType, string> = {
  ice_make: "Ice Make",
  circle_check: "Circle Check",
  edging: "Edging",
  blade_change: "Blade Change",
}

export const OPERATION_DESCRIPTIONS: Record<OperationType, string> = {
  ice_make: "Log a fresh ice resurface (water temps, pass count, time).",
  circle_check: "Walk the ice resurfacer checklist and flag any issues.",
  edging: "Record edging hours run on the edger.",
  blade_change: "Log a blade change with serial and hours.",
}

/**
 * The canonical equipment_type each operation pulls equipment from. UI uses
 * this to filter the equipment dropdown.
 */
export const OPERATION_EQUIPMENT_TYPE: Record<OperationType, EquipmentType> = {
  ice_make: "ice_resurfacer",
  circle_check: "ice_resurfacer",
  edging: "edger",
  blade_change: "blade_set",
}

export const OPERATION_REQUIRES_RINK: Record<OperationType, boolean> = {
  ice_make: true,
  circle_check: true,
  edging: false,
  blade_change: false,
}

export function isOperationType(value: string): value is OperationType {
  return (OPERATION_TYPES as readonly string[]).includes(value)
}

/**
 * Per-op-type jsonb payload shapes. Stored on
 * `ice_operations_submissions.payload`.
 */
export type IceMakePayload = {
  water_temp_c: number | null
  ice_temp_c: number | null
  time_in: string | null
  time_out: string | null
  water_used_gal: number | null
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

export type CirclePayload = Record<string, never>
