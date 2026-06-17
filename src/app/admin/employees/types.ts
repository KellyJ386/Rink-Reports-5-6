// Local types for the Employee/User Setup admin module.
// 1:1 row types are re-exported from the generated Supabase types.

import type { PermissionMatrix } from "@/lib/permissions"
import type { Tables } from "@/types/database"

export type RoleRow = Tables<"roles">

// roleId -> the role's default permission matrix (from role_permission_defaults).
// Used to preview "what this role can do" in the add/edit employee form.
export type RoleDefaultsMap = Record<string, PermissionMatrix>

export type DepartmentRow = Tables<"departments">

export type EmployeeRow = Tables<"employees">

/** A selectable job area (employee_job_areas) for the assignment control. */
export type JobAreaOption = { id: string; name: string }

export type EmployeeListItem = EmployeeRow & {
  role: Pick<RoleRow, "id" | "key" | "display_name"> | null
  /** Currently-assigned job areas (with names; may include inactive ones so
   *  editing never silently drops them). */
  job_areas: JobAreaOption[]
  job_area_ids: string[]
  primary_job_area: JobAreaOption | null
}

export type EmployeeFormInput = {
  first_name: string
  last_name: string
  role_id: string
  employee_code: string | null
  email: string | null
  phone: string | null
  is_minor: boolean
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  hire_date: string | null
  // Per-employee weekly scheduled-hours cap (whole hours, 1..168). NULL = no
  // individual cap; the scheduling grid's weekly-hours warning then falls back
  // to the facility-level schedule_settings thresholds. (employees.max_weekly_hours)
  max_weekly_hours: number | null
  // Job-area assignments (Employee Scheduling). Complete desired set (max 4);
  // primary must be one of job_area_ids or it's ignored. Empty when the form
  // doesn't submit areas yet.
  job_area_ids: string[]
  primary_job_area_id: string | null
  // True only when the form actually rendered/submitted the job-area control
  // (hidden marker "job_areas_present"). Guards the edit path from wiping
  // existing assignments when the field is absent (e.g. UI not wired yet).
  job_areas_submitted: boolean
  // When true (create flow only), provision a login + seed role-default
  // permissions. Unchecked = schedule-only employee (role, no user_permissions).
  needs_login: boolean
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

