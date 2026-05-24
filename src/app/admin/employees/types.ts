// Local types for the Employee/User Setup admin module.
// 1:1 row types are re-exported from the generated Supabase types.

import type { PermissionMatrix } from "@/lib/permissions"
import type { Tables } from "@/types/database"

export type RoleRow = Tables<"roles">

// roleId -> the role's default permission matrix (from role_permission_defaults).
// Used to preview "what this role can do" in the add/edit employee form.
export type RoleDefaultsMap = Record<string, PermissionMatrix>

export type DepartmentRow = Tables<"departments">

export type EmployeeDepartmentRow = Tables<"employee_departments">

export type EmployeeRow = Tables<"employees">

export type EmployeeListItem = EmployeeRow & {
  role: Pick<RoleRow, "id" | "key" | "display_name"> | null
  primary_department: Pick<DepartmentRow, "id" | "name" | "color"> | null
  department_ids: string[]
}

export type EmployeeFormInput = {
  first_name: string
  last_name: string
  role_id: string
  primary_department_id: string | null
  department_ids: string[]
  employee_code: string | null
  email: string | null
  phone: string | null
  is_minor: boolean
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  hire_date: string | null
  // When true (create flow only), provision a login + seed role-default
  // permissions. Unchecked = schedule-only employee (role, no user_permissions).
  needs_login: boolean
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

