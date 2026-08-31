// Per-user-per-module-per-action permission model. Replaces the
// 9-level `module_permission_level` enum that lived alongside the
// dropped `module_permissions` / `role_module_permission_defaults`
// tables (see migration 77).

export const USER_ACTIONS = ["view", "submit", "edit", "admin"] as const

export type UserAction = (typeof USER_ACTIONS)[number]

export const USER_ACTION_LABELS: Record<UserAction, string> = {
  view: "View",
  submit: "Submit",
  edit: "Edit",
  admin: "Admin",
}

export const USER_ACTION_DESCRIPTIONS: Record<UserAction, string> = {
  view: "Can see the module interface.",
  submit: "Can create and submit entries.",
  edit: "Can modify their own or facility submissions.",
  admin: "Can change, approve, or configure reports and module settings.",
}

export const MODULE_NAMES = [
  "daily_reports",
  "ice_depth",
  "ice_operations",
  "incident_reports",
  "accident_reports",
  "refrigeration",
  "air_quality",
  "scheduling",
  "communications",
  "dasher_boards",
  "facility_paperwork",
  "rink_scheduling",
  "reports",
  "admin",
] as const

export type ModuleName = (typeof MODULE_NAMES)[number]

export const MODULE_LABELS: Record<ModuleName, string> = {
  daily_reports: "Daily Reports",
  ice_depth: "Ice Depth",
  ice_operations: "Ice Operations",
  incident_reports: "Incident Reporting",
  accident_reports: "Accident Reporting",
  refrigeration: "Refrigeration",
  air_quality: "Air Quality",
  scheduling: "Employee Scheduling",
  communications: "Communications",
  dasher_boards: "Dasher Boards",
  facility_paperwork: "Facility Paperwork",
  // "Rink Scheduling", not "Scheduling": `scheduling` above is EMPLOYEE
  // scheduling (module 7). These two are adjacent in the permissions grid and
  // an ambiguous label there grants the wrong thing.
  rink_scheduling: "Rink Scheduling",
  // The reporting layer (daily / weekly / monthly / annual compliance reports
  // aggregated across every other module) — NOT the staff report-submission
  // forms under /reports, which are gated per submitting module above. Staff
  // deliberately hold nothing here.
  reports: "Reports & Analytics",
  admin: "Admin",
}

export type UserPermissionRow = {
  user_id: string
  facility_id: string
  module_name: ModuleName
  action: UserAction
  enabled: boolean
}

export type PermissionMatrix = Record<ModuleName, Record<UserAction, boolean>>

/**
 * The `admin`/`admin` cell is exactly what `requireAdmin()` keys off, so
 * enabling it grants Admin Center access (i.e. mints another facility admin).
 * Only super admins may turn it on — RLS only blocks cross-facility writes, so
 * this intra-facility privilege escalation must be caught in app code at EVERY
 * write path into `user_permissions` / `role_permission_defaults`. Granting the
 * `admin` action on a *report* module (configure that module) is normal
 * delegation and stays allowed.
 */
export function isAdminConsoleGrant(moduleName: string, action: string): boolean {
  return moduleName === "admin" && action === "admin"
}

export function emptyMatrix(): PermissionMatrix {
  const matrix = {} as PermissionMatrix
  for (const m of MODULE_NAMES) {
    matrix[m] = { view: false, submit: false, edit: false, admin: false }
  }
  return matrix
}

export function matrixFromRows(rows: UserPermissionRow[]): PermissionMatrix {
  const matrix = emptyMatrix()
  for (const r of rows) {
    if (!matrix[r.module_name]) continue
    matrix[r.module_name][r.action] = r.enabled
  }
  return matrix
}

export type Preset = "full_access" | "submitter_only" | "viewer_only" | "no_access"

/**
 * Elevated modules the *staff-shaped* presets must never auto-grant. `reports`
 * is the cross-module compliance reporting layer (migration 268: "staff and
 * driver are absent by design… a front desk employee cannot pull the facility's
 * annual incident summary"), and `admin` is the Admin Center module. A blanket
 * `submitter_only` / `viewer_only` preset would otherwise silently hand a
 * front-desk account `reports/view` (which passes `has_module_access('reports')`
 * and `currentUserCan("reports","view")`), bypassing the role-default ceiling.
 * These modules are granted deliberately via role defaults / explicit edits, not
 * by a staff bulk preset. `full_access` is the elevated preset and is left
 * intact — its dangerous `admin/admin` console cell is separately gated to super
 * admins in `applyPresetToUser` via `isAdminConsoleGrant`.
 */
const PRESET_ELEVATED_MODULES: readonly ModuleName[] = ["reports", "admin"]

export function presetMatrix(preset: Preset): PermissionMatrix {
  const matrix = emptyMatrix()
  if (preset === "no_access") return matrix
  for (const m of MODULE_NAMES) {
    if (preset === "full_access") {
      matrix[m] = { view: true, submit: true, edit: true, admin: true }
    } else if (PRESET_ELEVATED_MODULES.includes(m)) {
      // Staff presets never reach the elevated modules — leave them all-false.
      continue
    } else if (preset === "submitter_only") {
      matrix[m] = { view: true, submit: true, edit: false, admin: false }
    } else if (preset === "viewer_only") {
      matrix[m] = { view: true, submit: false, edit: false, admin: false }
    }
  }
  return matrix
}
