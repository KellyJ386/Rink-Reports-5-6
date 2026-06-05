import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import type {
  DepartmentLite,
  EmployeeLite,
  JobAreaLite,
  ShiftRow,
  ShiftStatus,
  ShiftWithRefs,
  TemplateRow,
} from "../_lib/types"
import { isShiftStatus } from "../_lib/types"

import { ShiftsClient } from "./_components/shifts-client"

export const dynamic = "force-dynamic"

// employee_job_areas + schedule_shifts.job_area_id aren't in the generated DB
// types yet (see CLAUDE.md); cast through `any` at those read sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

type SearchParams = Promise<{
  dept?: string
  status?: string
  date?: string
  shift?: string
}>

const WINDOW_DAYS = 14

function parseAnchorDate(date: string | undefined): Date {
  if (date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (m) {
      const d = new Date(
        Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      )
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
}

export const metadata = { title: "Shift Management | MFO / Rink Reports" }

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null
  const params = await searchParams

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before scheduling shifts.
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

  const anchor = parseAnchorDate(params.date)
  const windowStart = new Date(anchor)
  windowStart.setUTCDate(anchor.getUTCDate() - WINDOW_DAYS)
  const windowEnd = new Date(anchor)
  windowEnd.setUTCDate(anchor.getUTCDate() + WINDOW_DAYS)

  const status: ShiftStatus | null =
    params.status && isShiftStatus(params.status) ? params.status : null
  const deptFilter = params.dept ?? null

  const supabase = await createClient()

  const [deptsRes, employeesRes, templatesRes, jobAreasRes] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name, slug, color, is_active")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("employees")
      .select("id, first_name, last_name, is_minor, is_active")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true }),
    supabase
      .from("schedule_templates")
      .select("id, facility_id, name, slug, description, is_active, created_at, updated_at")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    (supabase as AnySupabase)
      .from("employee_job_areas")
      .select("id, name, slug, is_active")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ])

  const departments = (deptsRes.data ?? []) as DepartmentLite[]
  const employees = (employeesRes.data ?? []) as EmployeeLite[]
  const templates = (templatesRes.data ?? []) as TemplateRow[]
  const jobAreas = (jobAreasRes.data ?? []) as JobAreaLite[]
  const jobAreaById = new Map(jobAreas.map((j) => [j.id, j]))

  let shiftQuery = supabase
    .from("schedule_shifts")
    .select("*")
    .eq("facility_id", facilityId)
    .gte("starts_at", windowStart.toISOString())
    .lt("starts_at", windowEnd.toISOString())
    .order("starts_at", { ascending: true })
    .limit(500)

  if (deptFilter) shiftQuery = shiftQuery.eq("department_id", deptFilter)
  if (status) shiftQuery = shiftQuery.eq("status", status)

  const { data: shiftsRaw } = await shiftQuery
  const shifts = (shiftsRaw ?? []) as ShiftRow[]

  const empById = new Map(employees.map((e) => [e.id, e]))
  // Build the display lookup from ALL departments so shifts that reference a
  // since-deactivated department still render its name. Only *active*
  // departments are offered for filtering / new assignment (below).
  const deptById = new Map(departments.map((d) => [d.id, d]))
  const activeDepartments = departments.filter((d) => d.is_active)

  // If the selected shift isn't in the window, fetch it directly so the panel
  // can display detail.
  let selected: ShiftWithRefs | null = null
  if (params.shift) {
    let row: ShiftRow | undefined = shifts.find((s) => s.id === params.shift)
    if (!row) {
      const { data: directRaw } = await supabase
        .from("schedule_shifts")
        .select("*")
        .eq("facility_id", facilityId)
        .eq("id", params.shift)
        .maybeSingle()
      row = (directRaw ?? undefined) as ShiftRow | undefined
    }
    if (row) {
      const jobAreaId = (row as { job_area_id?: string | null }).job_area_id ?? null
      selected = {
        ...row,
        job_area_id: jobAreaId,
        employee: row.employee_id ? (empById.get(row.employee_id) ?? null) : null,
        department: deptById.get(row.department_id) ?? null,
        job_area: jobAreaId ? (jobAreaById.get(jobAreaId) ?? null) : null,
      }
    }
  }

  const list: ShiftWithRefs[] = shifts.map((s) => {
    const jobAreaId = (s as { job_area_id?: string | null }).job_area_id ?? null
    return {
      ...s,
      job_area_id: jobAreaId,
      employee: s.employee_id ? (empById.get(s.employee_id) ?? null) : null,
      department: deptById.get(s.department_id) ?? null,
      job_area: jobAreaId ? (jobAreaById.get(jobAreaId) ?? null) : null,
    }
  })

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      <ShiftsClient
        facilityId={facilityId}
        shifts={list}
        departments={activeDepartments}
        employees={employees}
        jobAreas={jobAreas}
        templates={templates}
        selectedShift={selected}
        windowStartIso={windowStart.toISOString()}
        windowEndIso={windowEnd.toISOString()}
        anchorIsoDate={anchor.toISOString().slice(0, 10)}
        filters={{
          dept: deptFilter,
          status,
        }}
      />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
      <p className="text-muted-foreground text-sm">
        List of scheduled shifts in a 28-day window around the selected date.
      </p>
    </div>
  )
}
