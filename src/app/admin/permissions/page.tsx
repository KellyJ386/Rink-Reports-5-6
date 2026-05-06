import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { PermissionsClient } from "./_components/permissions-client"
import {
  EMPTY_FLAGS,
  MODULE_KEYS,
  type Employee,
  type ModuleKey,
  type PermissionFlags,
  type PermissionMap,
} from "./types"

type EmployeeRow = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  facility_id: string
  role_id: string
}

type RoleRow = {
  id: string
  key: string
  display_name: string
}

type DepartmentRow = {
  id: string
  name: string
}

type EmployeeDepartmentRow = {
  employee_id: string
  department_id: string
}

type ModulePermissionRow = {
  employee_id: string
  module_key: string
  can_view: boolean
  can_submit: boolean
  can_admin: boolean
}

export const dynamic = "force-dynamic"

export default async function PermissionsPage() {
  await requireAdmin()
  const supabase = await createClient()

  // Bias toward simple separate queries (per the spec) and stitch in memory.
  // RLS scopes everything to the caller's facility.
  const { data: employeesRaw } = await supabase
    .from("employees")
    .select("id, first_name, last_name, email, facility_id, role_id")
    .eq("is_active", true)
    .order("last_name", { ascending: true })
    .limit(200)

  const employees = (employeesRaw ?? []) as EmployeeRow[]

  if (employees.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No employees yet</CardTitle>
            <CardDescription>
              Add employees before configuring per-module access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/employees">Go to Employees</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const roleIds = Array.from(new Set(employees.map((e) => e.role_id)))
  const employeeIds = employees.map((e) => e.id)

  const [{ data: rolesRaw }, { data: edRaw }, { data: permsRaw }] =
    await Promise.all([
      supabase
        .from("roles")
        .select("id, key, display_name")
        .in("id", roleIds.length ? roleIds : ["00000000-0000-0000-0000-000000000000"]),
      supabase
        .from("employee_departments")
        .select("employee_id, department_id")
        .in(
          "employee_id",
          employeeIds.length
            ? employeeIds
            : ["00000000-0000-0000-0000-000000000000"],
        ),
      supabase
        .from("module_permissions")
        .select("employee_id, module_key, can_view, can_submit, can_admin")
        .in(
          "employee_id",
          employeeIds.length
            ? employeeIds
            : ["00000000-0000-0000-0000-000000000000"],
        ),
    ])

  const roles = (rolesRaw ?? []) as RoleRow[]
  const employeeDepartments = (edRaw ?? []) as EmployeeDepartmentRow[]
  const perms = (permsRaw ?? []) as ModulePermissionRow[]

  const departmentIds = Array.from(
    new Set(employeeDepartments.map((r) => r.department_id)),
  )
  const { data: deptsRaw } = departmentIds.length
    ? await supabase
        .from("departments")
        .select("id, name")
        .in("id", departmentIds)
    : { data: [] as DepartmentRow[] }

  const departments = (deptsRaw ?? []) as DepartmentRow[]
  const deptById = new Map(departments.map((d) => [d.id, d.name]))
  const roleById = new Map(roles.map((r) => [r.id, r]))

  const deptsByEmployee = new Map<string, string[]>()
  for (const ed of employeeDepartments) {
    const name = deptById.get(ed.department_id)
    if (!name) continue
    const arr = deptsByEmployee.get(ed.employee_id) ?? []
    arr.push(name)
    deptsByEmployee.set(ed.employee_id, arr)
  }

  const employeeList: Employee[] = employees.map((e) => {
    const role = roleById.get(e.role_id) ?? null
    const fullName = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim()
    return {
      id: e.id,
      full_name: fullName || (e.email ?? "Unnamed"),
      email: e.email,
      role_key: role?.key ?? null,
      role_display_name: role?.display_name ?? null,
      departments: deptsByEmployee.get(e.id) ?? [],
    }
  })

  const permissionMap: PermissionMap = {}
  for (const p of perms) {
    if (!(MODULE_KEYS as readonly string[]).includes(p.module_key)) continue
    const key = p.module_key as ModuleKey
    const flags: PermissionFlags = {
      can_view: p.can_view,
      can_submit: p.can_submit,
      can_admin: p.can_admin,
    }
    const existing = permissionMap[p.employee_id] ?? {}
    existing[key] = flags
    permissionMap[p.employee_id] = existing
  }

  // Ensure every employee has at least an empty bag so the client doesn't
  // have to handle undefined.
  for (const e of employeeList) {
    if (!permissionMap[e.id]) permissionMap[e.id] = {}
    for (const k of MODULE_KEYS) {
      if (!permissionMap[e.id]![k]) permissionMap[e.id]![k] = { ...EMPTY_FLAGS }
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <Header />
      <PermissionsClient
        employees={employeeList}
        permissions={permissionMap}
      />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Module Access Control
      </h1>
      <p className="text-muted-foreground text-sm">
        Toggle per-employee access to each module. V = View, S = Submit, A =
        Admin.
      </p>
    </div>
  )
}
