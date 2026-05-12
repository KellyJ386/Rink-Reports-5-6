// Local types for the Employee/User Setup admin module.
// 1:1 row types are re-exported from the generated Supabase types.

import type { Tables } from "@/types/database"

export type RoleRow = Tables<"roles">

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
}

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type CustomFieldType = "text" | "number" | "date" | "boolean"

export type CustomFieldDef = {
  id: string
  facility_id: string
  key: string
  label: string
  field_type: CustomFieldType
  is_required: boolean
  sort_order: number
  is_active: boolean
}

/** Map of field_id -> stored string value. NULL/missing means "not set". */
export type CustomFieldValueMap = Record<string, string | null>
