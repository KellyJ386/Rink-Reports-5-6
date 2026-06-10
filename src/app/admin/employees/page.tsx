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

import { LoadMoreLink } from "@/components/admin/load-more-link"
import { clampShow, nextShow } from "@/lib/pagination"

import { EmployeesClient } from "./_components/employees-client"
import { SeedRolesButton } from "./_components/seed-roles-button"
import type {
  EmployeeListItem,
  EmployeeRow,
  JobAreaOption,
  RoleDefaultsMap,
  RoleRow,
} from "./types"

export const dynamic = "force-dynamic"

type EmployeeJobAreaJoinRow = {
  employee_id: string
  job_area_id: string
  is_primary: boolean
}

type JobAreaRow = { id: string; name: string; is_active: boolean; sort_order: number }

type FacilityOption = {
  id: string
  name: string
  slug: string
  is_active: boolean
}

type SearchParams = Promise<{ facility?: string; show?: string }>

export const metadata = { title: "Employees | MFO / Rink Reports" }

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const profile = current.profile
  const params = await searchParams
  const show = clampShow(params.show, { initial: 500 })

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
    { data: employeesRaw },
    { data: roleDefaultsRaw },
    { data: jobAreasRaw },
    { data: ejaRaw },
  ] = await Promise.all([
    supabase
      .from("roles")
      .select("id, facility_id, key, display_name, hierarchy_level, is_system")
      .eq("facility_id", facilityId)
      .order("hierarchy_level", { ascending: true }),
    supabase
      .from("employees")
      .select(
        "id, facility_id, user_id, role_id, employee_code, first_name, last_name, email, phone, is_minor, emergency_contact_name, emergency_contact_phone, hire_date, is_active, deactivated_at, created_at"
      )
      .eq("facility_id", facilityId)
      .order("last_name", { ascending: true })
      // One extra row to learn whether a "Load more" link is needed.
      .range(0, show),
    supabase
      .from("role_permission_defaults")
      .select("role_id, module_name, action, enabled")
      .eq("facility_id", facilityId),
    supabase
      .from("employee_job_areas")
      .select("id, name, is_active, sort_order")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("employee_job_area_assignments")
      .select("employee_id, job_area_id, is_primary")
      .eq("facility_id", facilityId),
  ])

  const roles = (rolesRaw ?? []) as RoleRow[]
  const overfetched = (employeesRaw ?? []) as EmployeeRow[]
  const hasMore = overfetched.length > show
  const employees = hasMore ? overfetched.slice(0, show) : overfetched

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

  // Job areas: selectable list (active only) + a name lookup over ALL areas so
  // an assignment to a later-deactivated area still renders its name.
  const allJobAreas = (jobAreasRaw ?? []) as JobAreaRow[]
  const jobAreas: JobAreaOption[] = allJobAreas
    .filter((a) => a.is_active)
    .map((a) => ({ id: a.id, name: a.name }))
  const jobAreaNameById = new Map(allJobAreas.map((a) => [a.id, a.name]))
  const ejaRows = (ejaRaw ?? []) as EmployeeJobAreaJoinRow[]

  const jobAreasByEmployee = new Map<
    string,
    { areas: JobAreaOption[]; ids: string[]; primary: JobAreaOption | null }
  >()
  for (const row of ejaRows) {
    const bucket = jobAreasByEmployee.get(row.employee_id) ?? {
      areas: [] as JobAreaOption[],
      ids: [] as string[],
      primary: null as JobAreaOption | null,
    }
    const option = {
      id: row.job_area_id,
      name: jobAreaNameById.get(row.job_area_id) ?? "Unknown area",
    }
    bucket.areas.push(option)
    bucket.ids.push(row.job_area_id)
    if (row.is_primary) bucket.primary = option
    jobAreasByEmployee.set(row.employee_id, bucket)
  }

  const roleById = new Map(roles.map((r) => [r.id, r]))

  const list: EmployeeListItem[] = employees.map((e) => {
    const role = roleById.get(e.role_id) ?? null
    const areaBucket = jobAreasByEmployee.get(e.id)
    return {
      ...e,
      role: role
        ? { id: role.id, key: role.key, display_name: role.display_name }
        : null,
      job_areas: areaBucket?.areas ?? [],
      job_area_ids: areaBucket?.ids ?? [],
      primary_job_area: areaBucket?.primary ?? null,
    }
  })

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <EmployeesClient
        facilityId={facilityId}
        employees={list}
        roles={roles}
        jobAreas={jobAreas}
        roleDefaults={roleDefaults}
        canDelete={profile?.is_super_admin === true}
      />
      {hasMore && nextShow(show, { initial: 500 }) ? (
        <LoadMoreLink
          href={employeesMoreHref(params.facility, nextShow(show, { initial: 500 }))}
          shown={list.length}
        />
      ) : null}
    </div>
  )
}

function employeesMoreHref(
  facility: string | undefined,
  show: number | null,
): string {
  const sp = new URLSearchParams()
  if (facility) sp.set("facility", facility)
  if (show) sp.set("show", String(show))
  return `/admin/employees?${sp.toString()}`
}

function Header() {
  return (
    <PageHeader
      title="Employee / User Setup"
      description="Add staff, assign roles and job areas, manage activation."
    />
  )
}
