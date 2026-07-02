import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { dayKeyInTz, weekWindowInTz } from "@/lib/timezone"

import { resolveOperatingHours } from "../_lib/operating-hours"
import type {
  EmployeeLite,
  JobAreaLite,
  ShiftRow,
  TemplateRow,
} from "../_lib/types"
import type { GridShiftDTO } from "../_lib/grid-actions"

import { WeekBoard } from "./_components/week-board"
import type {
  EmployeeOption,
  OpenShiftItem,
  PendingSwap,
  PendingTimeOff,
} from "../_components/hub-panels"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ date?: string }>

// How much shift history/future to preload around the anchor so week-nav has
// data to show without a round-trip (the board keeps events client-side).
// 42 covers the month view's whole-week grid (anchored on the 1st, a 31-day
// month plus trailing cells reaches ~+37 days).
const WINDOW_DAYS = 42

function parseAnchorDate(date: string | undefined): Date {
  if (date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
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
  const facilityId = current.profile?.facility_id ?? null
  const params = await searchParams

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <PageHeader title="Employee Scheduling" />
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

  const supabase = await createClient()

  const [
    employeesRes,
    jobAreasRes,
    departmentsRes,
    facilityRes,
    settingsRes,
    shiftsRes,
    templatesRes,
    openShiftsRes,
    pendingSwapsRes,
    pendingTimeOffRes,
    wagesRes,
  ] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, first_name, last_name, employee_code, is_minor, is_active, max_weekly_hours"
      )
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true }),
    supabase
      .from("employee_job_areas")
      .select("id, name, slug, is_active")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("departments")
      .select("id, name")
      .eq("facility_id", facilityId),
    supabase
      .from("facilities")
      .select("settings, timezone")
      .eq("id", facilityId)
      .maybeSingle<{ settings: unknown; timezone: string | null }>(),
    supabase
      .from("schedule_settings")
      .select("week_start_day, default_hourly_rate")
      .eq("facility_id", facilityId)
      .maybeSingle<{
        week_start_day: number
        default_hourly_rate: number | null
      }>(),
    supabase
      .from("schedule_shifts")
      .select("*")
      .eq("facility_id", facilityId)
      .gte("starts_at", windowStart.toISOString())
      .lt("starts_at", windowEnd.toISOString())
      .order("starts_at", { ascending: true })
      .limit(2000),
    supabase
      .from("schedule_templates")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("schedule_open_shifts")
      .select("id, shift_id, claim_status, claimed_by_employee_id")
      .eq("facility_id", facilityId)
      .in("claim_status", ["open", "claimed"]),
    supabase
      .from("schedule_swap_requests")
      .select(
        "id, requester_employee_id, requester_shift_id, target_employee_id, created_at"
      )
      .eq("facility_id", facilityId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("schedule_time_off_requests")
      .select("id, employee_id, starts_at, ends_at, reason, created_at")
      .eq("facility_id", facilityId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    // Admin-only table (migration 165): powers real labor-cost estimates.
    supabase
      .from("employee_wages")
      .select("employee_id, hourly_rate")
      .eq("facility_id", facilityId),
  ])

  const employees = (employeesRes.data ?? []) as (EmployeeLite & {
    employee_code: string | null
  })[]
  const jobAreas = (jobAreasRes.data ?? []) as JobAreaLite[]
  const operatingHours = resolveOperatingHours(facilityRes.data?.settings)
  const weekStartDay = settingsRes.data?.week_start_day ?? 0
  const defaultHourlyRate = settingsRes.data?.default_hourly_rate ?? null
  const wageByEmployee: Record<string, number> = {}
  for (const w of (wagesRes.data ?? []) as {
    employee_id: string
    hourly_rate: number
  }[]) {
    wageByEmployee[w.employee_id] = w.hourly_rate
  }

  const shifts: ShiftRow[] = shiftsRes.data ?? []
  const initialShifts: GridShiftDTO[] = shifts.map((s) => ({
    id: s.id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    employee_id: s.employee_id,
    job_area_id: s.job_area_id,
    department_id: s.department_id,
    status: s.status as GridShiftDTO["status"],
    break_minutes: s.break_minutes ?? 0,
    role_label: s.role_label,
    notes: s.notes,
  }))

  const templateRows = (templatesRes.data ?? []) as TemplateRow[]

  // ---- Right-rail DTOs (mirrors the scheduling hub's shaping) ----
  type DeptRow = { id: string; name: string }
  type OpenRow = {
    id: string
    shift_id: string
    claim_status: string
    claimed_by_employee_id: string | null
  }
  type SwapRow = {
    id: string
    requester_employee_id: string
    requester_shift_id: string
    target_employee_id: string | null
    created_at: string
  }
  type TimeOffRow = {
    id: string
    employee_id: string
    starts_at: string
    ends_at: string
    reason: string | null
    created_at: string
  }

  const departments = (departmentsRes.data ?? []) as DeptRow[]
  const openRows = (openShiftsRes.data ?? []) as OpenRow[]
  const swapRows = (pendingSwapsRes.data ?? []) as SwapRow[]
  const timeOffRows = (pendingTimeOffRes.data ?? []) as TimeOffRow[]

  const empById = new Map(employees.map((e) => [e.id, e]))
  const deptById = new Map(departments.map((d) => [d.id, d]))
  const shiftById = new Map(shifts.map((s) => [s.id, s]))

  const empName = (id: string | null | undefined) => {
    const e = id ? empById.get(id) : null
    return e ? `${e.first_name} ${e.last_name}` : null
  }

  const openShifts: OpenShiftItem[] = openRows
    .map((o) => {
      const s = shiftById.get(o.shift_id)
      if (!s) return null
      return {
        id: o.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        departmentName:
          (s.department_id ? deptById.get(s.department_id)?.name : null) ??
          "Department",
        roleLabel: s.role_label,
        claimStatus: o.claim_status,
        claimantName: empName(o.claimed_by_employee_id),
      }
    })
    .filter((x): x is OpenShiftItem => x !== null)

  const pendingSwaps: PendingSwap[] = swapRows.map((sw) => {
    const s = shiftById.get(sw.requester_shift_id)
    return {
      id: sw.id,
      requesterName: empName(sw.requester_employee_id) ?? "Unknown",
      targetName: empName(sw.target_employee_id),
      requesterShift: s ? { starts_at: s.starts_at, ends_at: s.ends_at } : null,
      createdAt: sw.created_at,
    }
  })

  const pendingTimeOff: PendingTimeOff[] = timeOffRows.map((t) => ({
    id: t.id,
    employeeName: empName(t.employee_id) ?? "Unknown",
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    reason: t.reason,
    createdAt: t.created_at,
  }))

  const employeeOptions: EmployeeOption[] = employees.map((e) => ({
    id: e.id,
    label: `${e.last_name}, ${e.first_name}${
      e.employee_code ? ` (${e.employee_code})` : ""
    }`,
  }))

  const swapShiftIds = swapRows.map((sw) => sw.requester_shift_id)

  // Visible week for the publish-request button + label, computed on the
  // facility-local calendar (half-open window in facility-midnight instants)
  // so the published range matches what the approve RPC re-validates.
  const tz = facilityRes.data?.timezone ?? null
  const anchorKey = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : dayKeyInTz(new Date(), tz)
  const week = weekWindowInTz(anchorKey, weekStartDay, tz)
  const weekLabel = `week of ${week.startKey}`

  const fmtKey = (key: string) => {
    const [y, m, d] = key.split("-").map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })
  }
  const eyebrow = `Week of ${fmtKey(week.startKey)} – ${fmtKey(
    week.dayKeys[6]
  )} · ${week.startKey.slice(0, 4)}`

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        variant="display"
        module="scheduling"
        eyebrow={eyebrow}
        title="Employee Scheduling"
        description="Drag in a day column to create a shift; drag a block to move it, or its edges to resize. Click a shift to assign, duplicate, or delete."
      />
      <WeekBoard
        key={anchor.toISOString()}
        initialShifts={initialShifts}
        employees={employees}
        jobAreas={jobAreas}
        templates={templateRows}
        operatingHours={operatingHours}
        weekStartDay={weekStartDay}
        defaultDateIso={anchor.toISOString()}
        weekStartsAtIso={week.startUtc.toISOString()}
        weekEndsAtIso={week.endUtc.toISOString()}
        weekLabel={weekLabel}
        weekStartKey={week.startKey}
        wageByEmployee={wageByEmployee}
        defaultHourlyRate={defaultHourlyRate}
        openShifts={openShifts}
        employeeOptions={employeeOptions}
        pendingSwaps={pendingSwaps}
        pendingTimeOff={pendingTimeOff}
        swapShiftIds={swapShiftIds}
      />
    </div>
  )
}
