import { headers } from "next/headers"
import Link from "next/link"

import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { cn } from "@/lib/utils"

import { CalendarSyncCard } from "../_components/calendar-sync-card"
import { WeekCalendar } from "../_components/week-calendar"
import { formatDateRange } from "../_components/format-utils"
import { NotAvailable } from "../_components/not-available"
import { shiftStatusTone } from "../_components/status-tones"
import { startOfWeek, type ShiftStatus } from "../types"

export const dynamic = "force-dynamic"

const NOT_AVAILABLE_SEGMENTS = [
  { label: "Scheduling", href: "/reports/scheduling" },
  { label: "My schedule" },
]

function statusLabel(status: string): string {
  const map: Record<ShiftStatus, string> = {
    draft: "Draft",
    published: "Published",
    cancelled: "Cancelled",
  }
  return map[status as ShiftStatus] ?? status
}

function parseDateInput(raw: string | undefined): Date | null {
  if (!raw) return null
  // Accept YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type SearchParams = Promise<{
  from?: string
  to?: string
  status?: string
  view?: string
  weekOf?: string
}>

export default async function MySchedulePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireUser()
  const supabase = await createClient()
  const params = await searchParams

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <NotAvailable
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
        segments={NOT_AVAILABLE_SEGMENTS}
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "scheduling", "view"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have access to scheduling yet."
        segments={NOT_AVAILABLE_SEGMENTS}
      />
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const defaultTo = new Date(today)
  defaultTo.setDate(defaultTo.getDate() + 30)

  const fromDate = parseDateInput(params.from) ?? today
  const toDate = parseDateInput(params.to) ?? defaultTo
  const statusFilter =
    params.status === "all" ? "all" : "published"

  const currentView = params.view === "week" ? "week" : "list"

  function toLocalDate(iso: string): Date {
    const [y, m, day] = iso.split("-").map(Number)
    return new Date(y, m - 1, day)
  }

  // Facility work-week start (migration 117) — honor it like the availability
  // page and admin grid instead of hardcoding Sunday.
  const { data: settingsRow } = await supabase
    .from("schedule_settings")
    .select("week_start_day")
    .eq("facility_id", employeeRow.facility_id)
    .maybeSingle()
  const weekStartDay: number =
    typeof settingsRow?.week_start_day === "number"
      ? settingsRow.week_start_day
      : 0

  const weekStart = startOfWeek(
    params.weekOf ? toLocalDate(params.weekOf) : new Date(),
    weekStartDay,
  )

  const weekStartIso = (() => {
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`
  })()

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", employeeRow.facility_id)
    .maybeSingle()
  const tz = facility?.timezone ?? null

  let query = supabase
    .from("schedule_shifts")
    .select(
      "id, starts_at, ends_at, role_label, status, department_id, departments(name)"
    )
    .eq("employee_id", employeeRow.id)
    .order("starts_at", { ascending: true })

  // DRAFT shifts are NEVER shown to staff: the schedule isn't real until the
  // two-person publish flow runs, and RLS does not filter by status (the
  // SELECT policy is facility+module scoped), so this query-side filter is
  // the enforcement point. "All" in the status picker means published +
  // cancelled — cancelled is the employee's own useful signal; draft is a
  // leak of an unapproved schedule.
  const visibleStatuses =
    statusFilter === "all" ? ["published", "cancelled"] : ["published"]

  if (currentView === "week") {
    // Week view date range
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    query = query
      .in("status", visibleStatuses)
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString())
  } else {
    query = query
      .in("status", visibleStatuses)
      .gte("starts_at", fromDate.toISOString())
      .lte("starts_at", toDate.toISOString())
  }

  const { data: shiftsRaw } = await query

  // Calendar-sync state (owner-only RLS) + the absolute feed origin for the
  // subscription URL shown to the employee.
  const { data: icsRow } = await supabase
    .from("schedule_ics_tokens")
    .select("token")
    .eq("employee_id", employeeRow.id)
    .maybeSingle<{ token: string }>()
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? "https"
  const feedBase = `${proto}://${host}/api/schedule-ics`

  type ShiftRow = {
    id: string
    starts_at: string
    ends_at: string
    role_label: string | null
    status: string
    department_id: string
    departments: { name: string } | null
  }
  const shifts = (shiftsRaw ?? []) as unknown as ShiftRow[]

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="scheduling"
        band
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Scheduling", href: "/reports/scheduling" },
              { label: "My schedule" },
            ]}
          />
        }
        title="My Schedule"
        description={
          <Link
            href="/offline-schedule"
            className="font-semibold text-primary hover:underline"
          >
            Available offline →
          </Link>
        }
      />

      {/* View toggle */}
      <div className="flex w-fit gap-1 rounded-md border border-border bg-card p-1">
        {(["list", "week"] as const).map((v) => (
          <Link
            key={v}
            href={`/reports/scheduling/my-schedule?view=${v}`}
            className={cn(
              "rounded-sm px-4 py-1.5 text-xs font-bold uppercase tracking-[0.04em] no-underline",
              currentView === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {v}
          </Link>
        ))}
      </div>

      {currentView === "week" ? (
        <WeekCalendar
          shifts={shifts}
          weekStartIso={weekStartIso}
          timezone={tz}
        />
      ) : (
        <>
          {/* Date filter */}
          <form
            method="get"
            className="flex flex-wrap items-end gap-2.5 rounded-[14px] border border-l-4 border-border border-l-module-scheduling bg-card px-4 py-3.5"
          >
            {[
              { id: "from", label: "From", defaultValue: toDateInput(fromDate), type: "date" },
              { id: "to", label: "To", defaultValue: toDateInput(toDate), type: "date" },
            ].map((f) => (
              <div key={f.id} className="flex flex-[1_1_130px] flex-col gap-1">
                <label
                  htmlFor={f.id}
                  className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {f.label}
                </label>
                <input
                  id={f.id}
                  name={f.id}
                  type={f.type}
                  defaultValue={f.defaultValue}
                  className="h-10 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/40"
                />
              </div>
            ))}
            <div className="flex flex-[1_1_130px] flex-col gap-1">
              <label
                htmlFor="status"
                className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground"
              >
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={statusFilter}
                className="h-10 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/40"
              >
                <option value="published">Published</option>
                <option value="all">All</option>
              </select>
            </div>
            <Button type="submit" size="sm" className="h-10 shrink-0 px-5">
              Apply
            </Button>
          </form>

          {shifts.length === 0 ? (
            <div className="rounded-[14px] border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
              No shifts in this range
            </div>
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[var(--shadow-elev-1)]">
              {shifts.map((s) => {
                const tone = shiftStatusTone(s.status)
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-3 border-b border-border border-l-[3px] px-3.5 py-3 last:border-b-0",
                      tone.borderL
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold text-foreground">
                        {formatDateRange(s.starts_at, s.ends_at, tz)}
                      </div>
                      <div className="mt-[3px] flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] text-muted-foreground">
                          {s.departments?.name ?? "—"}
                        </span>
                        {s.role_label ? (
                          <span className="text-[11.5px] text-muted-foreground">
                            · {s.role_label}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
                        tone.pill
                      )}
                    >
                      {statusLabel(s.status)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <CalendarSyncCard initialToken={icsRow?.token ?? null} feedBase={feedBase} />
    </div>
  )
}
