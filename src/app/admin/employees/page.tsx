import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import {
  emptyMatrix,
  type ModuleName,
  type UserAction,
} from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { EmployeesClient } from "./_components/employees-client"
import { SeedRolesButton } from "./_components/seed-roles-button"
import type {
  DepartmentRow,
  EmployeeListItem,
  EmployeeRow,
  RoleDefaultsMap,
  RoleRow,
} from "./types"

export const dynamic = "force-dynamic"

type EmployeeDeptJoinRow = {
  employee_id: string
  department_id: string
  is_primary: boolean
}

type FacilityOption = {
  id: string
  name: string
  slug: string
  is_active: boolean
}

type SearchParams = Promise<{ facility?: string }>

export const metadata = { title: "Employees | MFO / Rink Reports" }

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

  if (!facilityId && profile?.is_super_admin) {
    const supabase = await createClient()
    const { data: facilitiesRaw } = await supabase
      .from("facilities")
      .select("id, name, slug, is_active")
      .order("created_at", { ascending: true })

    const facilities = (facilitiesRaw ?? []) as FacilityOption[]

    if (facilities.length === 1) {
      redirect(`/admin/employees?facility=${facilities[0].id}`)
    }

    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>
              {facilities.length === 0
                ? "No facilities yet"
                : "Choose a facility"}
            </CardTitle>
            <CardDescription>
              {facilities.length === 0
                ? "Create a facility before adding employees."
                : "Pick a facility to manage its employees."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {facilities.length === 0 ? (
              <Button asChild>
                <Link href="/admin/facility">Go to Facility Settings</Link>
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                {facilities.map((f) => (
                  <Button
                    key={f.id}
                    asChild
                    variant="outline"
                    className="justify-between"
                  >
                    <Link href={`/admin/employees?facility=${f.id}`}>
                      <span>
                        {f.name}
                        {!f.is_active && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            (Inactive)
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {f.slug}
                      </span>
                    </Link>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Your account isn&apos;t linked to a facility yet. Ask a super
              admin to assign you.
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
    { data: edRaw },
    { data: roleDefaultsRaw },
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
    supabase
      .from("employee_departments")
      .select("employee_id, department_id, is_primary")
      .eq("facility_id", facilityId),
    supabase
      .from("role_permission_defaults")
      .select("role_id, module_name, action, enabled")
      .eq("facility_id", facilityId),
  ])

  const roles = (rolesRaw ?? []) as RoleRow[]
  const departments = (deptsRaw ?? []) as DepartmentRow[]
  const employees = (employeesRaw ?? []) as EmployeeRow[]

  // Build roleId -> default permission matrix for the form preview.
  const roleDefaultRows = (roleDefaultsRaw ?? []) as unknown as Array<{
    role_id: string
    module_name: ModuleName
    action: UserAction
    enabled: boolean
  }>
  const roleDefaults: RoleDefaultsMap = {}
  for (const row of roleDefaultRows) {
    const matrix = (roleDefaults[row.role_id] ??= emptyMatrix())
    if (matrix[row.module_name]) {
      matrix[row.module_name][row.action] = row.enabled
    }
  }

  // No roles? Show seed prompt.
  if (roles.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No roles yet</CardTitle>
            <CardDescription>
              Seed the canonical role set (Super Admin, Administrator,
              Manager, Staff) to start adding employees.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeedRolesButton facilityId={facilityId} />
          </CardContent>
        </Card>
      </div>
    )
  }

  const edRows = (edRaw ?? []) as EmployeeDeptJoinRow[]

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
        roleDefaults={roleDefaults}
        canDelete={profile?.is_super_admin === true}
      />
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Employee / User Setup"
      description="Add staff, assign roles and departments, manage activation."
    />
  )
}
