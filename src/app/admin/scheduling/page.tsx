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
import { StatCard } from "@/components/ui/stat-card"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  ModuleCard,
  OpenShiftsPanel,
  PendingSwapsPanel,
  PendingTimeOffPanel,
  type EmployeeOption,
  type OpenShiftItem,
  type PendingSwap,
  type PendingTimeOff,
} from "./_components/hub-panels"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scheduling | MFO / Rink Reports" }

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

function fmtMonthDay(d: Date) {
  const m = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
  return `${m} ${d.getUTCDate()}`
}

function shiftHours(starts_at: string, ends_at: string): number {
  const ms = new Date(ends_at).getTime() - new Date(starts_at).getTime()
  return Math.max(0, ms / 3_600_000)
}

export default async function SchedulingOverviewPage() {
  const current = await requireAdmin()
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header weekLabel={null} facilityName={null} />
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

  // Default 0 (Sunday) — must match the shifts grid's fallback so the hub's
  // "this week" agrees with the grid.
  const weekStartDay = settings?.week_start_day ?? 0
  const { start: weekStart, end: weekEnd } = startOfWeek(weekStartDay)

  const [
    shiftsRes,
    deptsRes,
    employeesRes,
    openShiftsRes,
    pendingSwapsRes,
    pendingTimeOffRes,
    templatesRes,
    publishRes,
  ] = await Promise.all([
    supabase
      .from("schedule_shifts")
      .select("id, department_id, employee_id, starts_at, ends_at, status, role_label, compliance_warnings")
      .eq("facility_id", facilityId)
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString()),
    supabase
      .from("departments")
      .select("id, name")
      .eq("facility_id", facilityId),
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true })
      .limit(500),
    supabase
      .from("schedule_open_shifts")
      .select(
        "id, shift_id, claim_status, approval_required, claimed_by_employee_id"
      )
      .eq("facility_id", facilityId)
      .in("claim_status", ["open", "claimed"]),
    supabase
      .from("schedule_swap_requests")
      .select(
        "id, requester_employee_id, requester_shift_id, target_employee_id, status, created_at"
      )
      .eq("facility_id", facilityId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("schedule_time_off_requests")
      .select("id, employee_id, starts_at, ends_at, status, reason, created_at")
      .eq("facility_id", facilityId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("schedule_templates")
      .select("id, is_active")
      .eq("facility_id", facilityId),
    supabase
      .from("schedule_publish_events")
      .select("id, created_at")
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: false })
      .limit(1),
  ])

  type ShiftRow = {
    id: string
    department_id: string
    employee_id: string | null
    starts_at: string
    ends_at: string
    status: string
    role_label: string | null
    compliance_warnings: unknown
  }
  type DeptRow = { id: string; name: string }
  type EmpRow = {
    id: string
    first_name: string
    last_name: string
    employee_code: string | null
  }
  type OpenShiftRowMini = {
    id: string
    shift_id: string
    claim_status: string
    approval_required: boolean
    claimed_by_employee_id: string | null
  }

  const shifts = (shiftsRes.data ?? []) as ShiftRow[]
  const departments = (deptsRes.data ?? []) as DeptRow[]
  const employees = (employeesRes.data ?? []) as EmpRow[]
  const openShiftRows = (openShiftsRes.data ?? []) as OpenShiftRowMini[]
  const pendingSwapsRaw = (pendingSwapsRes.data ?? []) as {
    id: string
    requester_employee_id: string
    requester_shift_id: string
    target_employee_id: string | null
    status: string
    created_at: string
  }[]
  const pendingTimeOffRaw = (pendingTimeOffRes.data ?? []) as {
    id: string
    employee_id: string
    starts_at: string
    ends_at: string
    status: string
    reason: string | null
    created_at: string
  }[]
  const templates = (templatesRes.data ?? []) as {
    id: string
    is_active: boolean
  }[]
  const lastPublish = (publishRes.data ?? [])[0] as
    | { id: string; created_at: string | null }
    | undefined

  const empById = new Map(employees.map((e) => [e.id, e]))
  const deptById = new Map(departments.map((d) => [d.id, d]))
  const shiftById = new Map(shifts.map((s) => [s.id, s]))

  // KPI computations (real data only).
  const totalShifts = shifts.length
  const publishedShifts = shifts.filter((s) => s.status === "published").length
  const draftShifts = shifts.filter((s) => s.status === "draft").length
  const totalScheduledHours = Math.round(
    shifts.reduce((a, s) => a + shiftHours(s.starts_at, s.ends_at), 0)
  )
  const complianceWarningCount = shifts.reduce((a, s) => {
    const w = Array.isArray(s.compliance_warnings) ? s.compliance_warnings : []
    return a + w.length
  }, 0)
  const openShiftCount = openShiftRows.length
  const unassignedNoListingCount = shifts.filter(
    (s) =>
      s.employee_id === null &&
      !openShiftRows.some((o) => o.shift_id === s.id)
  ).length

  // Per-day shift counts (for the at-a-glance row).
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setUTCDate(weekStart.getUTCDate() + i)
    const startMs = d.getTime()
    const endMs = startMs + 24 * 3_600_000
    const dayShifts = shifts.filter((s) => {
      const t = new Date(s.starts_at).getTime()
      return t >= startMs && t < endMs
    })
    return {
      label: d.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" }),
      date: d.getUTCDate(),
      count: dayShifts.length,
      hours: Math.round(
        dayShifts.reduce((a, s) => a + shiftHours(s.starts_at, s.ends_at), 0)
      ),
    }
  })

  // Pending swap rows for inline panel.
  const pendingSwaps: PendingSwap[] = pendingSwapsRaw.map((sw) => {
    const fromEmp = empById.get(sw.requester_employee_id)
    const toEmp = sw.target_employee_id
      ? empById.get(sw.target_employee_id)
      : null
    const shift = shiftById.get(sw.requester_shift_id)
    return {
      id: sw.id,
      requesterName: fromEmp
        ? `${fromEmp.first_name} ${fromEmp.last_name}`
        : "Unknown",
      targetName: toEmp ? `${toEmp.first_name} ${toEmp.last_name}` : null,
      requesterShift: shift
        ? { starts_at: shift.starts_at, ends_at: shift.ends_at }
        : null,
      createdAt: sw.created_at,
    }
  })

  const pendingTimeOff: PendingTimeOff[] = pendingTimeOffRaw.map((t) => {
    const emp = empById.get(t.employee_id)
    return {
      id: t.id,
      employeeName: emp ? `${emp.first_name} ${emp.last_name}` : "Unknown",
      starts_at: t.starts_at,
      ends_at: t.ends_at,
      reason: t.reason,
      createdAt: t.created_at,
    }
  })

  const openShiftsList: OpenShiftItem[] = openShiftRows
    .map((o) => {
      const s = shiftById.get(o.shift_id)
      if (!s) return null
      const dept = deptById.get(s.department_id)
      const claimant = o.claimed_by_employee_id
        ? empById.get(o.claimed_by_employee_id)
        : null
      return {
        id: o.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        departmentName: dept?.name ?? "Department",
        roleLabel: s.role_label,
        claimStatus: o.claim_status,
        claimantName: claimant
          ? `${claimant.first_name} ${claimant.last_name}`
          : null,
      }
    })
    .filter((x): x is OpenShiftItem => x !== null)

  const employeeOptions: EmployeeOption[] = employees.map((e) => ({
    id: e.id,
    label: `${e.last_name}, ${e.first_name}${
      e.employee_code ? ` (${e.employee_code})` : ""
    }`,
  }))

  const weekLabel = `Week of ${fmtMonthDay(weekStart)} – ${fmtMonthDay(
    new Date(weekEnd.getTime() - 24 * 60 * 60 * 1000)
  )} · ${weekStart.getUTCFullYear()}`

  const activeTemplateCount = templates.filter((t) => t.is_active).length
  const lastPublishedLabel = lastPublish?.created_at
    ? new Date(lastPublish.created_at).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Never"

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header weekLabel={weekLabel} facilityName={facility?.name ?? null} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Scheduled hours"
          value={`${totalScheduledHours}h`}
          delta={`${publishedShifts} published · ${draftShifts} draft`}
        />
        <StatCard
          label="Shifts this week"
          value={totalShifts}
          delta={`${employees.length} active employees`}
        />
        <StatCard
          label="Open shifts"
          value={openShiftCount}
          delta={
            unassignedNoListingCount > 0
              ? `${unassignedNoListingCount} unassigned (no listing)`
              : "—"
          }
          deltaTone={unassignedNoListingCount > 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="Pending requests"
          value={pendingSwaps.length + pendingTimeOff.length}
          delta={`${pendingSwaps.length} swap · ${pendingTimeOff.length} time-off`}
          deltaTone={
            pendingSwaps.length + pendingTimeOff.length > 0
              ? "negative"
              : "neutral"
          }
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Pending swaps</CardTitle>
              <Link
                href="/admin/scheduling/swaps"
                className="text-primary text-xs font-medium hover:underline"
              >
                View all →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <PendingSwapsPanel rows={pendingSwaps.slice(0, 5)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Pending time-off</CardTitle>
              <Link
                href="/admin/scheduling/time-off"
                className="text-primary text-xs font-medium hover:underline"
              >
                View all →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <PendingTimeOffPanel rows={pendingTimeOff.slice(0, 5)} />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Open shifts this week</CardTitle>
            <Link
              href="/admin/scheduling/shifts"
              className="text-primary text-xs font-medium hover:underline"
            >
              Manage shifts →
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <OpenShiftsPanel
            rows={openShiftsList.slice(0, 8)}
            employeeOptions={employeeOptions}
          />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          This week at a glance
        </h2>
        <div className="bg-card border-border/60 grid grid-cols-7 gap-px overflow-hidden rounded-lg border shadow-[var(--shadow-elev-1)]">
          {weekDays.map((d) => (
            <div
              key={`${d.label}-${d.date}`}
              className="bg-card flex flex-col items-center gap-1 px-2 py-3 text-center"
            >
              <div className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                {d.label}
              </div>
              <div className="text-xl font-semibold tabular-nums">{d.date}</div>
              <div className="text-muted-foreground text-[11px]">
                {d.count} shift{d.count === 1 ? "" : "s"}
              </div>
              <div className="text-muted-foreground/80 text-[10px] tabular-nums">
                {d.hours}h
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          Modules
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ModuleCard
            title="Shifts"
            description="Create, edit, and assign individual shifts. Filter by department, status, and date."
            href="/admin/scheduling/shifts"
            count={totalShifts}
            cta="Manage shifts"
          />
          <ModuleCard
            title="Templates"
            description="Recurring weekly patterns you can apply to any week."
            href="/admin/scheduling/templates"
            count={`${activeTemplateCount} active`}
            cta="View templates"
          />
          <ModuleCard
            title="Publish history"
            description={`Last published: ${lastPublishedLabel}`}
            href="/admin/scheduling/publish"
            cta="View history"
          />
          <ModuleCard
            title="Publish requests"
            description="Approve or reject staff-initiated publish requests."
            href="/admin/scheduling/publish/requests"
            cta="Review requests"
          />
          <ModuleCard
            title="Time-off"
            description="Approve, deny, or cancel employee time-off requests."
            href="/admin/scheduling/time-off"
            count={pendingTimeOff.length}
            cta="Open queue"
          />
          <ModuleCard
            title="Swaps"
            description="Review shift swap requests and assign targets."
            href="/admin/scheduling/swaps"
            count={pendingSwaps.length}
            cta="Open queue"
          />
          <ModuleCard
            title="Compliance"
            description={
              complianceWarningCount > 0
                ? `${complianceWarningCount} warning${complianceWarningCount === 1 ? "" : "s"} on this week's shifts`
                : "No warnings on this week's shifts."
            }
            href="/admin/scheduling/compliance"
            cta="View rules"
          />
          <ModuleCard
            title="Settings"
            description="Week start, publish horizon, swap & open-shift policy."
            href="/admin/scheduling/settings"
            cta="Configure"
          />
          <ModuleCard
            title="Notifications"
            description="Audit log of schedule notifications sent to employees."
            href="/admin/scheduling/notifications"
            cta="View log"
          />
        </div>
      </section>
    </div>
  )
}

function Header({
  weekLabel,
  facilityName,
}: {
  weekLabel: string | null
  facilityName: string | null
}) {
  return (
    <PageHeader
      title="Scheduling overview"
      description={
        weekLabel
          ? `${weekLabel}${facilityName ? ` · ${facilityName}` : ""}`
          : "Manage shifts, templates, and publishing for this facility."
      }
    />
  )
}
