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
import { type PermissionLevel } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { PermissionsClient } from "./_components/permissions-client"
import {
  MODULE_KEYS,
  type Employee,
  type ModuleKey,
  type ModulePermissionMap,
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
  permission_level: PermissionLevel
}

type RoleDefaultRow = {
  role_id: string
  module_key: string
  permission_level: PermissionLevel
}

export const dynamic = "force-dynamic"

export const metadata = { title: "Permissions | MFO / Rink Reports" }

export default async function PermissionsPage() {
  await requireAdmin()
  const supabase = await createClient()

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

  const [
    { data: rolesRaw },
    { data: edRaw },
    { data: permsRaw },
    { data: roleDefaultsRaw },
  ] = await Promise.all([
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
      .select("employee_id, module_key, permission_level")
      .in(
        "employee_id",
        employeeIds.length
          ? employeeIds
          : ["00000000-0000-0000-0000-000000000000"],
      ),
    supabase
      .from("role_module_permission_defaults")
      .select("role_id, module_key, permission_level")
      .in(
        "role_id",
        roleIds.length ? roleIds : ["00000000-0000-0000-0000-000000000000"],
      ),
  ])

  const roles = (rolesRaw ?? []) as RoleRow[]
  const employeeDepartments = (edRaw ?? []) as EmployeeDepartmentRow[]
  const perms = (permsRaw ?? []) as ModulePermissionRow[]
  const roleDefaults = (roleDefaultsRaw ?? []) as RoleDefaultRow[]

  const roleDefaultsByRole = new Map<
    string,
    Partial<Record<ModuleKey, PermissionLevel>>
  >()
  for (const r of roleDefaults) {
    if (!(MODULE_KEYS as readonly string[]).includes(r.module_key)) continue
    const key = r.module_key as ModuleKey
    const bag = roleDefaultsByRole.get(r.role_id) ?? {}
    bag[key] = r.permission_level
    roleDefaultsByRole.set(r.role_id, bag)
  }

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

  const permissionMap: ModulePermissionMap = {}
  for (const p of perms) {
    if (!(MODULE_KEYS as readonly string[]).includes(p.module_key)) continue
    const key = p.module_key as ModuleKey
    const existing = permissionMap[p.employee_id] ?? {}
    existing[key] = p.permission_level
    permissionMap[p.employee_id] = existing
  }

  // Auto-populate from the employee's role: if there is no per-employee
  // override for a module, fall back to the role's default (or "none").
  for (const e of employees) {
    if (!permissionMap[e.id]) permissionMap[e.id] = {}
    const roleBag = roleDefaultsByRole.get(e.role_id) ?? {}
    for (const k of MODULE_KEYS) {
      if (!permissionMap[e.id]![k]) {
        permissionMap[e.id]![k] = roleBag[k] ?? "none"
      }
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
        Levels are auto-populated from each employee&apos;s role. Change a
        cell to override that role&apos;s default for one employee. Levels
        are cumulative: each higher level includes everything below it.{" "}
        <Link
          href="/admin/roles"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Edit role defaults
        </Link>
        .
      </p>
    </div>
  )
}
