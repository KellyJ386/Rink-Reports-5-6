import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"
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
import { addDaysToKey, dayKeyInTz, weekdayOfKey, weekWindowInTz } from "@/lib/timezone"

export const dynamic = "force-dynamic"
export const metadata = { title: "Availability | MFO / Rink Reports" }

type SearchParams = Promise<{ date?: string }>

type AvailabilityRow = {
  id: string
  employee_id: string
  day_of_week: number
  start_time: string
  end_time: string
  availability_type: string
  effective_from: string | null
  effective_to: string | null
  job_area_id: string | null
  notes: string | null
}

type EmployeeRow = {
  id: string
  first_name: string
  last_name: string
  employee_code: string | null
}

/** Staff palette (availability-row.tsx): preferred=green, unavailable=red. */
function typeBadgeVariant(type: string): BadgeProps["variant"] {
  switch (type) {
    case "preferred":
      return "success"
    case "unavailable":
      return "error"
    default:
      return "info"
  }
}

/** "09:00:00" → "9:00 AM" (wall-clock; no zone math needed). */
function fmtTime(t: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(t)
  if (!m) return t
  const h = Number(m[1])
  const suffix = h < 12 ? "AM" : "PM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${suffix}`
}

function fmtKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d, 12))
  return probe.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/** A block applies on a given facility-local date if the effective window
 * (inclusive, NULL = unbounded) contains it — same semantics the enforcement
 * engine uses (migration 137). Keys compare lexicographically. */
function appliesOn(row: AvailabilityRow, dateKey: string): boolean {
  if (row.effective_from && row.effective_from > dateKey) return false
  if (row.effective_to && row.effective_to < dateKey) return false
  return true
}

export default async function SchedulingAvailabilityPage({
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
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before reviewing availability.
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
    { data: settingsRow },
    { data: facilityRow },
    { data: employeesRaw },
    { data: availabilityRaw },
    { data: jobAreasRaw },
  ] = await Promise.all([
    supabase
      .from("schedule_settings")
      .select("week_start_day")
      .eq("facility_id", facilityId)
      .maybeSingle<{ week_start_day: number }>(),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", facilityId)
      .maybeSingle<{ timezone: string | null }>(),
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true })
      .limit(500),
    supabase
      .from("schedule_availability")
      .select(
        "id, employee_id, day_of_week, start_time, end_time, availability_type, effective_from, effective_to, job_area_id, notes"
      )
      .eq("facility_id", facilityId)
      .order("start_time", { ascending: true })
      .limit(2000),
    supabase
      .from("employee_job_areas")
      .select("id, name")
      .eq("facility_id", facilityId),
  ])

  const weekStartDay = settingsRow?.week_start_day ?? 0
  const tz = facilityRow?.timezone ?? null
  const employees = (employeesRaw ?? []) as EmployeeRow[]
  const availability = (availabilityRaw ?? []) as AvailabilityRow[]
  const jobAreaNameById = new Map(
    ((jobAreasRaw ?? []) as { id: string; name: string }[]).map((j) => [
      j.id,
      j.name,
    ])
  )

  const anchorKey =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : dayKeyInTz(new Date(), tz)
  const week = weekWindowInTz(anchorKey, weekStartDay, tz)
  const todayKey = dayKeyInTz(new Date(), tz)

  const rowsByEmployee = new Map<string, AvailabilityRow[]>()
  for (const row of availability) {
    const list = rowsByEmployee.get(row.employee_id)
    if (list) list.push(row)
    else rowsByEmployee.set(row.employee_id, [row])
  }

  const withAvailability = employees.filter((e) => rowsByEmployee.has(e.id))
  const withoutAvailability = employees.filter((e) => !rowsByEmployee.has(e.id))

  const weekTitle = `${fmtKey(week.startKey)} – ${fmtKey(week.dayKeys[6])}`

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/admin/scheduling/availability?date=${addDaysToKey(week.startKey, -7)}`}
          >
            ← Previous week
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/scheduling/availability">This week</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/admin/scheduling/availability?date=${addDaysToKey(week.startKey, 7)}`}
          >
            Next week →
          </Link>
        </Button>
        <span className="text-sm font-medium">{weekTitle}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="info">Available</Badge>
          <Badge variant="success">Preferred</Badge>
          <Badge variant="error">Unavailable</Badge>
        </div>
      </div>

      {withAvailability.length === 0 ? (
        <div className="bg-card rounded-md border p-8 text-center">
          <h3 className="text-lg font-medium">No availability submitted yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Staff submit weekly availability from the scheduling app
            (Reports → Scheduling → Availability).
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left">
                <th className="border-b px-3 py-2 font-medium">Employee</th>
                {week.dayKeys.map((key) => (
                  <th
                    key={key}
                    className={`border-b px-3 py-2 font-medium ${
                      key === todayKey ? "text-primary" : ""
                    }`}
                  >
                    {fmtKey(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {withAvailability.map((emp) => {
                const rows = rowsByEmployee.get(emp.id) ?? []
                return (
                  <tr key={emp.id} className="align-top">
                    <td className="border-b px-3 py-2 font-medium whitespace-nowrap">
                      {emp.last_name}, {emp.first_name}
                      {emp.employee_code ? (
                        <span className="text-muted-foreground">
                          {" "}
                          ({emp.employee_code})
                        </span>
                      ) : null}
                    </td>
                    {week.dayKeys.map((key) => {
                      const dow = weekdayOfKey(key)
                      const blocks = rows.filter(
                        (r) => r.day_of_week === dow && appliesOn(r, key)
                      )
                      return (
                        <td key={key} className="border-b px-3 py-2">
                          {blocks.length === 0 ? (
                            <span className="text-muted-foreground/60">—</span>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {blocks.map((b) => (
                                <div key={b.id} className="flex flex-col gap-0.5">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge
                                      variant={typeBadgeVariant(
                                        b.availability_type
                                      )}
                                    >
                                      {fmtTime(b.start_time)}–{fmtTime(b.end_time)}
                                    </Badge>
                                  </div>
                                  {b.job_area_id &&
                                  jobAreaNameById.has(b.job_area_id) ? (
                                    <span className="text-muted-foreground text-xs">
                                      {jobAreaNameById.get(b.job_area_id)}
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {withoutAvailability.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              No availability submitted ({withoutAvailability.length})
            </CardTitle>
            <CardDescription>
              Active employees who haven&apos;t submitted any weekly
              availability. Shifts assigned to them are never blocked by
              availability rules.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {withoutAvailability.map((e) => (
                <Badge key={e.id} variant="secondary">
                  {e.last_name}, {e.first_name}
                  {e.employee_code ? ` (${e.employee_code})` : ""}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Only <span className="font-medium">Unavailable</span> blocks affect
        scheduling enforcement (they warn when a shift overlaps one).
        &ldquo;Available&rdquo; and &ldquo;Preferred&rdquo; are informational
        for planning. Blocks with an effective date window only show in weeks
        they cover.
      </p>
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Staff availability
      </h1>
      <p className="text-muted-foreground text-sm">
        Weekly availability submitted by staff, laid onto the facility-local
        calendar week.
      </p>
    </div>
  )
}
