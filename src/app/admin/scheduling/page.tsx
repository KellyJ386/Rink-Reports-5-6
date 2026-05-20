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

import { WeekDashboard, type WeekDashboardProps } from "./_components/week-dashboard"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scheduling | MFO / Rink Reports" }

const DEFAULT_DEPT_PALETTE = [
  "#003B6F",
  "#7C3AED",
  "#3DB800",
  "#0EA5E9",
  "#F97316",
  "#DB2777",
  "#0D9488",
  "#EAB308",
] as const

function startOfWeek(weekStartDay: number) {
  const now = new Date()
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  const dow = today.getUTCDay()
  const offset = ((dow - weekStartDay) + 7) % 7
  const start = new Date(today)
  start.setUTCDate(today.getUTCDate() - offset)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)
  return { start, end }
}

function weekDayIndex(d: Date, weekStart: Date) {
  const ms = d.getTime() - weekStart.getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

function fractionalHour(d: Date) {
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function hueFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

function fmtMonthDay(d: Date) {
  const m = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
  return `${m} ${d.getUTCDate()}`
}

export default async function SchedulingOverviewPage() {
  const current = await requireAdmin()
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Scheduling</h1>
          <p className="text-muted-foreground text-sm">
            Manage shifts, templates, and publishing for this facility.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before configuring scheduling.
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

  const [{ data: settings }, { data: facility }] = await Promise.all([
    supabase
      .from("schedule_settings")
      .select("week_start_day")
      .eq("facility_id", facilityId)
      .maybeSingle<{ week_start_day: number }>(),
    supabase
      .from("facilities")
      .select("name")
      .eq("id", facilityId)
      .maybeSingle<{ name: string }>(),
  ])

  const weekStartDay = settings?.week_start_day ?? 1 // Monday default
  const { start: weekStart, end: weekEnd } = startOfWeek(weekStartDay)

  const [
    shiftsRes,
    deptsRes,
    employeesRes,
    openShiftsRes,
    swapsRes,
    timeOffRes,
  ] = await Promise.all([
    supabase
      .from("schedule_shifts")
      .select(
        "id, department_id, employee_id, starts_at, ends_at, status, role_label"
      )
      .eq("facility_id", facilityId)
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("departments")
      .select("id, name, color, sort_order")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("employees")
      .select("id, first_name, last_name, is_active")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true }),
    supabase
      .from("schedule_open_shifts")
      .select("id, shift_id, claim_status")
      .eq("facility_id", facilityId)
      .eq("claim_status", "open"),
    supabase
      .from("schedule_swap_requests")
      .select(
        "id, requester_employee_id, requester_shift_id, target_employee_id, target_shift_id, status, decision_note, created_at"
      )
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("schedule_time_off_requests")
      .select("id, employee_id, starts_at, ends_at, status, reason")
      .eq("facility_id", facilityId)
      .order("starts_at", { ascending: true })
      .limit(10),
  ])

  type ShiftRowMini = {
    id: string
    department_id: string
    employee_id: string | null
    starts_at: string
    ends_at: string
    status: string
    role_label: string | null
  }
  type DeptRow = { id: string; name: string; color: string | null; sort_order: number | null }
  type EmpRow = {
    id: string
    first_name: string
    last_name: string
    is_active: boolean
  }

  const shifts = (shiftsRes.data ?? []) as ShiftRowMini[]
  const departments = (deptsRes.data ?? []) as DeptRow[]
  const employees = (employeesRes.data ?? []) as EmpRow[]
  const openShifts = (openShiftsRes.data ?? []) as {
    id: string
    shift_id: string
    claim_status: string
  }[]
  const swapsRaw = (swapsRes.data ?? []) as {
    id: string
    requester_employee_id: string
    requester_shift_id: string
    target_employee_id: string | null
    target_shift_id: string | null
    status: string
    decision_note: string | null
  }[]
  const timeOffRaw = (timeOffRes.data ?? []) as {
    id: string
    employee_id: string
    starts_at: string
    ends_at: string
    status: string
    reason: string | null
  }[]

  const deptById = new Map<string, DeptRow & { displayColor: string }>(
    departments.map((d, i) => [
      d.id,
      { ...d, displayColor: d.color ?? DEFAULT_DEPT_PALETTE[i % DEFAULT_DEPT_PALETTE.length]! },
    ])
  )
  const empById = new Map(employees.map((e) => [e.id, e]))

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setUTCDate(weekStart.getUTCDate() + i)
    return d.getUTCDate()
  })

  const now = new Date()
  const nowUtc = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes()
    )
  )
  const todayMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  const todayIdxRaw = weekDayIndex(todayMidnight, weekStart)
  const todayIndex =
    todayIdxRaw >= 0 && todayIdxRaw < 7 ? todayIdxRaw : null
  const nowFractionalHour = todayIndex != null ? fractionalHour(nowUtc) : null

  const shiftBlocks = shifts.map((s) => {
    const sd = new Date(s.starts_at)
    const ed = new Date(s.ends_at)
    const dayIdx = Math.max(0, Math.min(6, weekDayIndex(sd, weekStart)))
    const dept = deptById.get(s.department_id)
    const emp = s.employee_id ? empById.get(s.employee_id) : null
    const employeeName = emp ? `${emp.first_name} ${emp.last_name}` : null
    return {
      id: s.id,
      day: dayIdx,
      startHour: fractionalHour(sd),
      endHour: fractionalHour(ed),
      employeeId: s.employee_id,
      employeeName,
      employeeInitials: emp ? initialsOf(employeeName!) : null,
      employeeHue: emp ? hueFor(emp.id) : 200,
      departmentId: s.department_id,
      departmentName: dept?.name ?? "Department",
      departmentColor: dept?.displayColor ?? DEFAULT_DEPT_PALETTE[0]!,
      status: s.status,
      swapPending: swapsRaw.some(
        (sw) => sw.requester_shift_id === s.id && sw.status === "pending"
      ),
      roleLabel: s.role_label,
    }
  })

  const shiftById = new Map(shiftBlocks.map((s) => [s.id, s]))

  const totalScheduledHours = Math.round(
    shiftBlocks.reduce((a, s) => a + (s.endHour - s.startHour), 0)
  )
  const laborCostEstimate = totalScheduledHours * 26

  const crew = employees
    .map((e) => {
      const totalH = shiftBlocks
        .filter((s) => s.employeeId === e.id)
        .reduce((a, s) => a + (s.endHour - s.startHour), 0)
      const dept = shiftBlocks.find((s) => s.employeeId === e.id)
      return {
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        initials: initialsOf(`${e.first_name} ${e.last_name}`),
        hue: hueFor(e.id),
        departmentName: dept?.departmentName ?? "—",
        departmentColor: dept?.departmentColor ?? "#8A9194",
        hours: Math.round(totalH),
      }
    })
    .sort((a, b) => b.hours - a.hours)

  const openShiftBlocks = openShifts
    .map((o) => {
      const s = shiftById.get(o.shift_id)
      if (!s) return null
      return {
        id: o.id,
        day: s.day,
        startHour: s.startHour,
        endHour: s.endHour,
        departmentName: s.departmentName,
        departmentColor: s.departmentColor,
        note: s.roleLabel ?? "Needs coverage",
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const swaps = swapsRaw
    .map((sw) => {
      const fromEmp = empById.get(sw.requester_employee_id)
      const toEmp = sw.target_employee_id
        ? empById.get(sw.target_employee_id)
        : null
      const shift = shiftById.get(sw.requester_shift_id)
      if (!fromEmp || !shift) return null
      const fromName = `${fromEmp.first_name} ${fromEmp.last_name}`
      const toName = toEmp ? `${toEmp.first_name} ${toEmp.last_name}` : null
      return {
        id: sw.id,
        fromName,
        fromInitials: initialsOf(fromName),
        fromHue: hueFor(fromEmp.id),
        toName,
        toInitials: toName ? initialsOf(toName) : null,
        toHue: toEmp ? hueFor(toEmp.id) : 200,
        day: shift.day,
        startHour: shift.startHour,
        endHour: shift.endHour,
        status: sw.status,
        reason: sw.decision_note,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const timeOff = timeOffRaw
    .map((t) => {
      const emp = empById.get(t.employee_id)
      if (!emp) return null
      const name = `${emp.first_name} ${emp.last_name}`
      return {
        id: t.id,
        employeeName: name,
        employeeInitials: initialsOf(name),
        employeeHue: hueFor(emp.id),
        fromLabel: fmtMonthDay(new Date(t.starts_at)),
        toLabel: fmtMonthDay(new Date(t.ends_at)),
        reason: t.reason,
        status: t.status,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  // Pick first crew member with shifts for employee phone preview
  const previewEmp = crew.find((c) => c.hours > 0) ?? crew[0] ?? null
  const previewShifts = previewEmp
    ? shiftBlocks.filter((s) => s.employeeId === previewEmp.id)
    : []

  const weekLabel = `Week of ${fmtMonthDay(weekStart)} – ${fmtMonthDay(
    new Date(weekEnd.getTime() - 24 * 60 * 60 * 1000)
  )} · ${weekStart.getUTCFullYear()}`

  const dashboardProps: WeekDashboardProps = {
    weekLabel,
    weekDates,
    facilityName: facility?.name ?? "Facility",
    todayIndex,
    nowFractionalHour,
    shifts: shiftBlocks,
    openShifts: openShiftBlocks,
    swaps,
    timeOff,
    crew,
    totalScheduledHours,
    laborCostEstimate,
    employeeViewName: previewEmp?.name ?? null,
    employeeViewHue: previewEmp?.hue ?? 200,
    employeeViewRoleLabel: previewEmp?.departmentName ?? null,
    employeeViewShifts: previewShifts,
  }

  return <WeekDashboard {...dashboardProps} />
}
