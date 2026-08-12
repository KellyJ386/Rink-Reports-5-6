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
  | "propane_tank_change"

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
  "propane_tank_change",
] as const

/**
 * Tab order shown in the Ice Maintenance Log module nav. Canonical order:
 * Ice Make, Circle Check, Edging, Blade Change.
 *
 * propane_tank_change is deliberately ABSENT: it briefly had its own tab, but
 * is now logged via the "Propane Tank Change" toggle on the Ice Make form
 * (payload.propane_tank_changed). The operation type itself stays valid so
 * offline submissions queued while the tab existed still replay, and any
 * historical rows still render.
 */
export const OPERATION_TAB_ORDER: readonly OperationType[] = [
  "ice_make",
  "circle_check",
  "edging",
  "blade_change",
] as const

/** Module shown when the user lands on Ice Operations without picking a tab. */
export const DEFAULT_OPERATION_TYPE: OperationType = OPERATION_TAB_ORDER[0]

export const OPERATION_LABELS: Record<OperationType, string> = {
  ice_make: "Ice Make",
  circle_check: "Circle Check",
  edging: "Edging",
  blade_change: "Blade Change",
  propane_tank_change: "Propane Tank Change",
}

export const OPERATION_DESCRIPTIONS: Record<OperationType, string> = {
  ice_make:
    "Log a resurfacing run — rink, machine, water used, machine hours, and snow taken. Flip the toggle if you changed the propane tank.",
  circle_check: "Run the digital circle check and flag any issues.",
  edging: "Record edging hours run on the edger.",
  blade_change:
    "Log a blade change on the ice resurfacer — machine hours and new blade ID.",
  propane_tank_change:
    "Log a propane tank change — machine and hours. The date is recorded automatically.",
}

/**
 * The equipment_types each operation pulls equipment from, in display-priority
 * order (the UI lists machines of the first type first). A blade change is
 * always performed on an ice resurfacer — the retired "blade_set" equipment
 * type is no longer offered anywhere (legacy rows are still accepted at
 * persist time; see _lib/submit.ts). Edging includes the resurfacer too, so a
 * facility that has only configured its resurfacer still gets a machine list.
 */
export const OPERATION_EQUIPMENT_TYPES: Record<
  OperationType,
  readonly EquipmentType[]
> = {
  ice_make: ["ice_resurfacer"],
  circle_check: ["ice_resurfacer"],
  edging: ["edger", "ice_resurfacer"],
  blade_change: ["ice_resurfacer"],
  propane_tank_change: ["ice_resurfacer"],
}

export const OPERATION_REQUIRES_RINK: Record<OperationType, boolean> = {
  ice_make: true,
  circle_check: false,
  edging: false,
  blade_change: false,
  propane_tank_change: false,
}

/** Operations that surface a rink picker in their form. */
export const OPERATION_SHOWS_RINK: Record<OperationType, boolean> = {
  ice_make: true,
  circle_check: false,
  edging: false,
  blade_change: false,
  propane_tank_change: false,
}

export function isOperationType(value: string): value is OperationType {
  return (OPERATION_TYPES as readonly string[]).includes(value)
}

/**
 * Resolve which operation types are enabled for a facility from the
 * `ice_operations_settings.enabled_operation_types` config. Fail-open: a null,
 * empty, or all-invalid value means every operation is enabled (prior behavior).
 * The result preserves the canonical OPERATION_TAB_ORDER — values that are
 * valid operation types but no longer have a tab (propane_tank_change) drop
 * out here, and a config left with ONLY such values fails open like empty.
 */
export function resolveEnabledOperationTypes(
  raw: readonly string[] | null | undefined,
): OperationType[] {
  const allowed = raw?.filter(isOperationType) ?? []
  if (allowed.length === 0) return [...OPERATION_TAB_ORDER]
  const set = new Set<OperationType>(allowed)
  const enabled = OPERATION_TAB_ORDER.filter((op) => set.has(op))
  return enabled.length > 0 ? enabled : [...OPERATION_TAB_ORDER]
}

/**
 * Per-op-type jsonb payload shapes. Stored on
 * `ice_operations_submissions.payload`.
 */
export type IceMakePayload = {
  water_used_gal: number | null
  machine_hours: number | null
  snow_taken_pct: number | null
  time_in: string | null
  time_out: string | null
  /** True when the reporter flipped the Propane Tank Change toggle. Optional
   * because rows predating the toggle don't carry it. */
  propane_tank_changed?: boolean
  // Retained so historical submissions still read; no longer collected.
  water_temp_c?: number | null
  ice_temp_c?: number | null
  surface_pass_count?: number | null
}

export type EdgingPayload = {
  hours_run: number | null
}

export type BladeChangePayload = {
  blade_serial: string | null
  hours_at_change: number | null
  replaced_by_employee_id: string | null
}

/** Legacy: written only while propane had its own tab (kept for replay/history). */
export type PropaneTankChangePayload = {
  hours_at_change: number | null
}

export type CirclePayload = Record<string, never>
