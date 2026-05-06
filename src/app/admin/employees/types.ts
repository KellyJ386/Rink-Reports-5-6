// Local types for the Employee/User Setup admin module.
// We intentionally avoid the generated Supabase types here.

export type RoleRow = {
  id: string
  facility_id: string
  key: string
  display_name: string
  hierarchy_level: number
  is_system: boolean
}

export type DepartmentRow = {
  id: string
  facility_id: string
  name: string
  slug: string
  color: string | null
  sort_order: number
  is_active: boolean
}

export type EmployeeDepartmentRow = {
  id: string
  facility_id: string
  employee_id: string
  department_id: string
  is_primary: boolean
}

export type EmployeeRow = {
  id: string
  facility_id: string
  user_id: string | null
  role_id: string
  employee_code: string | null
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  is_minor: boolean
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  hire_date: string | null
  is_active: boolean
  deactivated_at: string | null
  created_at: string
}

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
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }
