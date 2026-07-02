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
import { dayKeyInTz, weekWindowInTz } from "@/lib/timezone"

import { PrintButton } from "./print-button"

export const dynamic = "force-dynamic"
export const metadata = { title: "Print Schedule | MFO / Rink Reports" }

type SearchParams = Promise<{ date?: string }>

type ShiftRow = {
  id: string
  employee_id: string | null
  job_area_id: string | null
  starts_at: string
  ends_at: string
  break_minutes: number | null
  status: string
  role_label: string | null
}

type EmployeeRow = {
  id: string
  first_name: string
  last_name: string
  employee_code: string | null
}

function fmtKeyHeading(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

function shiftHours(s: ShiftRow): number {
  const ms = new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()
  return Math.max(0, ms / 3_600_000 - (s.break_minutes ?? 0) / 60)
}

export default async function SchedulePrintPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null
  const params = await searchParams

  if (!facilityId) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before printing schedules.
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

  const [{ data: facility }, { data: settings }] = await Promise.all([
    supabase
      .from("facilities")
      .select("name, timezone")
      .eq("id", facilityId)
      .maybeSingle<{ name: string; timezone: string | null }>(),
    supabase
      .from("schedule_settings")
      .select("week_start_day")
      .eq("facility_id", facilityId)
      .maybeSingle<{ week_start_day: number }>(),
  ])

  const tz = facility?.timezone ?? null
  const weekStartDay = settings?.week_start_day ?? 0
  const anchorKey =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : dayKeyInTz(new Date(), tz)
  const week = weekWindowInTz(anchorKey, weekStartDay, tz)

  const [{ data: shiftsRaw }, { data: employeesRaw }, { data: jobAreasRaw }] =
    await Promise.all([
      supabase
        .from("schedule_shifts")
        .select(
          "id, employee_id, job_area_id, starts_at, ends_at, break_minutes, status, role_label"
        )
        .eq("facility_id", facilityId)
        .in("status", ["draft", "published"])
        .gte("starts_at", week.startUtc.toISOString())
        .lt("starts_at", week.endUtc.toISOString())
        .order("starts_at", { ascending: true })
        .limit(2000),
      supabase
        .from("employees")
        .select("id, first_name, last_name, employee_code")
        .eq("facility_id", facilityId)
        .order("last_name", { ascending: true })
        .limit(500),
      supabase
        .from("employee_job_areas")
        .select("id, name")
        .eq("facility_id", facilityId),
    ])

  const shifts = (shiftsRaw ?? []) as ShiftRow[]
  const employees = (employeesRaw ?? []) as EmployeeRow[]
  const jobAreaNameById = new Map(
    ((jobAreasRaw ?? []) as { id: string; name: string }[]).map((j) => [
      j.id,
      j.name,
    ])
  )
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz ?? undefined,
  })

  // Bucket shifts by (employee | open) × facility-local day.
  const OPEN = "__open__"
  const byRowAndDay = new Map<string, Map<string, ShiftRow[]>>()
  for (const s of shifts) {
    const rowKey = s.employee_id ?? OPEN
    const dayKey = dayKeyInTz(s.starts_at, tz)
    const days = byRowAndDay.get(rowKey) ?? new Map<string, ShiftRow[]>()
    const list = days.get(dayKey) ?? []
    list.push(s)
    days.set(dayKey, list)
    byRowAndDay.set(rowKey, days)
  }

  const scheduledEmployees = employees.filter((e) => byRowAndDay.has(e.id))
  const hasOpen = byRowAndDay.has(OPEN)
  const draftCount = shifts.filter((s) => s.status === "draft").length

  const dayTotals = week.dayKeys.map((key) =>
    shifts
      .filter((s) => dayKeyInTz(s.starts_at, tz) === key)
      .reduce((a, s) => a + shiftHours(s), 0)
  )
  const weekTotal = dayTotals.reduce((a, h) => a + h, 0)

  const weekTitle = `${fmtKeyHeading(week.startKey)} – ${fmtKeyHeading(week.dayKeys[6])}`

  const renderCell = (rowKey: string, dayKey: string) => {
    const blocks = byRowAndDay.get(rowKey)?.get(dayKey) ?? []
    if (blocks.length === 0) {
      return <span className="text-muted-foreground/50">—</span>
    }
    return (
      <div className="flex flex-col gap-1">
        {blocks.map((s) => (
          <div key={s.id} className="leading-snug">
            <span className="font-medium">
              {timeFmt.format(new Date(s.starts_at))}–
              {timeFmt.format(new Date(s.ends_at))}
            </span>
            {s.job_area_id && jobAreaNameById.has(s.job_area_id) ? (
              <span className="text-muted-foreground">
                {" "}
                · {jobAreaNameById.get(s.job_area_id)}
              </span>
            ) : s.role_label ? (
              <span className="text-muted-foreground"> · {s.role_label}</span>
            ) : null}
            {s.status === "draft" ? (
              <span className="text-muted-foreground"> (draft)</span>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
      {/* Hide app chrome (sidebar/header/scheduling nav) and toolbars when
          printing; landscape letter fits the 7-day table. */}
      <style>{`@media print {
        aside, header, nav, footer { display: none !important; }
        #main-content { padding: 0 !important; }
        #main-content, #main-content * { box-shadow: none !important; }
        .no-print { display: none !important; }
        @page { size: landscape; margin: 12mm; }
      }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/scheduling/shifts?date=${week.startKey}`}>
            ← Back to the board
          </Link>
        </Button>
        <PrintButton />
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {facility?.name ?? "Facility"} — Schedule
        </h1>
        <p className="text-muted-foreground text-sm">
          Week of {weekTitle}
          {draftCount > 0
            ? ` · includes ${draftCount} unpublished draft shift${draftCount === 1 ? "" : "s"}`
            : ""}
        </p>
      </div>

      {shifts.length === 0 ? (
        <div className="bg-card rounded-md border p-8 text-center">
          <h3 className="text-lg font-medium">No shifts this week</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Nothing scheduled between {weekTitle}.
          </p>
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-left">
              <th className="border px-2 py-1.5 font-medium">Employee</th>
              {week.dayKeys.map((key) => (
                <th key={key} className="border px-2 py-1.5 font-medium">
                  {fmtKeyHeading(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scheduledEmployees.map((emp) => (
              <tr key={emp.id} className="align-top">
                <td className="border px-2 py-1.5 font-medium whitespace-nowrap">
                  {emp.last_name}, {emp.first_name}
                  {emp.employee_code ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({emp.employee_code})
                    </span>
                  ) : null}
                </td>
                {week.dayKeys.map((key) => (
                  <td key={key} className="border px-2 py-1.5">
                    {renderCell(emp.id, key)}
                  </td>
                ))}
              </tr>
            ))}
            {hasOpen ? (
              <tr className="align-top">
                <td className="border px-2 py-1.5 font-medium italic">
                  Open / unassigned
                </td>
                {week.dayKeys.map((key) => (
                  <td key={key} className="border px-2 py-1.5">
                    {renderCell(OPEN, key)}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40">
              <td className="border px-2 py-1.5 font-medium">
                Hours ({Math.round(weekTotal * 10) / 10} total)
              </td>
              {dayTotals.map((h, i) => (
                <td
                  key={week.dayKeys[i]}
                  className="border px-2 py-1.5 tabular-nums"
                >
                  {Math.round(h * 10) / 10}h
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      )}

      <p className="text-muted-foreground text-xs">
        Times shown in the facility&apos;s local time
        {tz ? ` (${tz})` : ""}. Unknown employees are omitted; open shifts are
        listed on their own row.
      </p>
    </div>
  )
}
