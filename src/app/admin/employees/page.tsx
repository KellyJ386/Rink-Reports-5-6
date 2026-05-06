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

import { EmployeesClient } from "./_components/employees-client"
import { SeedRolesButton } from "./_components/seed-roles-button"
import type {
  DepartmentRow,
  EmployeeListItem,
  EmployeeRow,
  RoleRow,
} from "./types"

export const dynamic = "force-dynamic"

type EmployeeDeptJoinRow = {
  employee_id: string
  department_id: string
  is_primary: boolean
}

type SearchParams = Promise<{ facility?: string }>

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const profile = current.profile
  const params = await searchParams

  const facilityId = profile?.is_super_admin
    ? (params?.facility ?? null)
    : (profile?.facility_id ?? null)

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>
              {profile?.is_super_admin
                ? "Choose a facility"
                : "No facility yet"}
            </CardTitle>
            <CardDescription>
              {profile?.is_super_admin
                ? "Pick a facility to manage employees. Super admins can switch facilities from the facilities list."
                : "Create a facility before adding employees."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const supabase = await createClient()

  const [
    { data: rolesRaw },
    { data: deptsRaw },
    { data: employeesRaw },
  ] = await Promise.all([
    supabase
      .from("roles")
      .select("id, facility_id, key, display_name, hierarchy_level, is_system")
      .eq("facility_id", facilityId)
      .order("hierarchy_level", { ascending: true }),
    supabase
      .from("departments")
      .select("id, facility_id, name, slug, color, sort_order, is_active")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("employees")
      .select(
        "id, facility_id, user_id, role_id, employee_code, first_name, last_name, email, phone, is_minor, emergency_contact_name, emergency_contact_phone, hire_date, is_active, deactivated_at, created_at"
      )
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true })
      .limit(500),
  ])

  const roles = (rolesRaw ?? []) as RoleRow[]
  const departments = (deptsRaw ?? []) as DepartmentRow[]
  const employees = (employeesRaw ?? []) as EmployeeRow[]

  // No roles? Show seed prompt.
  if (roles.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No roles yet</CardTitle>
            <CardDescription>
              Seed the canonical role set (Super Admin, Administrator, GM,
              Manager, Supervisor, Staff) to start adding employees.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeedRolesButton facilityId={facilityId} />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Stitch employee_departments for the listed employees.
  const employeeIds = employees.map((e) => e.id)
  let edRows: EmployeeDeptJoinRow[] = []
  if (employeeIds.length > 0) {
    const { data: edRaw } = await supabase
      .from("employee_departments")
      .select("employee_id, department_id, is_primary")
      .in("employee_id", employeeIds)
    edRows = (edRaw ?? []) as EmployeeDeptJoinRow[]
  }

  const roleById = new Map(roles.map((r) => [r.id, r]))
  const deptById = new Map(departments.map((d) => [d.id, d]))

  const deptsByEmployee = new Map<
    string,
    { ids: string[]; primary: DepartmentRow | null }
  >()
  for (const row of edRows) {
    const bucket = deptsByEmployee.get(row.employee_id) ?? {
      ids: [],
      primary: null as DepartmentRow | null,
    }
    bucket.ids.push(row.department_id)
    if (row.is_primary) {
      bucket.primary = deptById.get(row.department_id) ?? null
    }
    deptsByEmployee.set(row.employee_id, bucket)
  }

  const list: EmployeeListItem[] = employees.map((e) => {
    const role = roleById.get(e.role_id) ?? null
    const bucket = deptsByEmployee.get(e.id)
    return {
      ...e,
      role: role
        ? { id: role.id, key: role.key, display_name: role.display_name }
        : null,
      primary_department: bucket?.primary
        ? {
            id: bucket.primary.id,
            name: bucket.primary.name,
            color: bucket.primary.color,
          }
        : null,
      department_ids: bucket?.ids ?? [],
    }
  })

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <EmployeesClient
        facilityId={facilityId}
        employees={list}
        roles={roles}
        departments={departments}
        canDelete={profile?.is_super_admin === true}
      />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Employee / User Setup
      </h1>
      <p className="text-muted-foreground text-sm">
        Add staff, assign roles and departments, manage activation.
      </p>
    </div>
  )
}
