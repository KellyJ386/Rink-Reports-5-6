import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { cn } from "@/lib/utils"
import { addDaysToKey, dayKeyInTz, dayPartsInTz } from "@/lib/timezone"

import { ClaimOpenShiftButton } from "./_components/claim-open-shift-button"
import { formatDateRange, formatDateTime } from "./_components/format-utils"
import { NotAvailable } from "./_components/not-available"

export const dynamic = "force-dynamic"

const NOT_AVAILABLE_SEGMENTS = [
  { label: "Reports", href: "/reports" },
  { label: "Scheduling" },
]

type ShiftRow = {
  id: string
  starts_at: string
  ends_at: string
  role_label: string | null
  department_id: string
  status: string
  departments: { name: string } | null
}

type OpenShiftRow = {
  id: string
  approval_required: boolean
  claim_status: string
  claimed_by_employee_id: string | null
  schedule_shifts: {
    id: string
    starts_at: string
    ends_at: string
    role_label: string | null
    department_id: string
    departments: { name: string } | null
  } | null
}

const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

export default async function SchedulingDashboardPage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id, first_name")
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
        description="You don't have access to scheduling yet. Talk to your supervisor."
        segments={NOT_AVAILABLE_SEGMENTS}
      />
    )
  }

  const now = new Date()
  const in14 = new Date(now)
  in14.setDate(in14.getDate() + 14)
  const in28 = new Date(now)
  in28.setDate(in28.getDate() + 28)

  const [
    { data: myShiftsRaw },
    { data: openShiftsRaw },
    { data: facility },
    { count: unreadCount },
  ] = await Promise.all([
    supabase
      .from("schedule_shifts")
      .select(
        "id, starts_at, ends_at, role_label, department_id, status, departments(name)"
      )
      .eq("employee_id", employeeRow.id)
      .eq("status", "published")
      .gte("starts_at", now.toISOString())
      .lte("starts_at", in28.toISOString())
      .order("starts_at", { ascending: true }),
    supabase
      .from("schedule_open_shifts")
      .select(
        "id, approval_required, claim_status, claimed_by_employee_id, schedule_shifts(id, starts_at, ends_at, role_label, department_id, departments(name))"
      )
      .eq("facility_id", employeeRow.facility_id)
      .in("claim_status", ["open", "claimed"]),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", employeeRow.facility_id)
      .maybeSingle(),
    supabase
      .from("schedule_notifications")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employeeRow.id)
      .is("read_at", null),
  ])

  const tz = facility?.timezone ?? null
  const myShifts = (myShiftsRaw ?? []) as unknown as ShiftRow[]
  const openShiftsAll = (openShiftsRaw ?? []) as unknown as OpenShiftRow[]
  const openShifts = openShiftsAll
    .filter((row) => {
      const shift = row.schedule_shifts
      if (!shift || row.claim_status !== "open") return false
      const startTs = new Date(shift.starts_at).getTime()
      return startTs >= now.getTime() && startTs <= in14.getTime()
    })
    .sort(
      (a, b) =>
        new Date(a.schedule_shifts!.starts_at).getTime() -
        new Date(b.schedule_shifts!.starts_at).getTime()
    )
    .slice(0, 5)

  // My claims that still need an admin's approval — otherwise a claimed
  // shift just vanishes from the open list with no trace for the claimant.
  const myPendingClaims = openShiftsAll.filter(
    (row) =>
      row.claim_status === "claimed" &&
      row.claimed_by_employee_id === employeeRow.id &&
      row.schedule_shifts !== null
  )

  const nextShift = myShifts[0] ?? null
  const upcomingShifts = myShifts.slice(0, 8)

  // Build 7-day week strip (today + 6 days) on the FACILITY's calendar, so a
  // late-evening shift doesn't land under the wrong day when the server (or
  // viewer) sits in another timezone.
  const todayKey = dayKeyInTz(now, tz)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysToKey(todayKey, i)
    const probe = new Date(`${iso}T12:00:00Z`)
    const hasShift = myShifts.some((s) => dayKeyInTz(s.starts_at, tz) === iso)
    const isNext =
      nextShift !== null && dayKeyInTz(nextShift.starts_at, tz) === iso
    return {
      iso,
      hasShift,
      isNext,
      label: DAY_LABELS[probe.getUTCDay()],
      dayOfMonth: probe.getUTCDate(),
    }
  })

  function formatShiftTime(shift: ShiftRow): string {
    try {
      const start = new Date(shift.starts_at).toLocaleTimeString("en-US", {
        timeZone: tz || undefined,
        hour: "numeric",
        minute: "2-digit",
      })
      const end = new Date(shift.ends_at).toLocaleTimeString("en-US", {
        timeZone: tz || undefined,
        hour: "numeric",
        minute: "2-digit",
      })
      return `${start} – ${end}`
    } catch {
      return formatDateRange(shift.starts_at, shift.ends_at, tz)
    }
  }

  function formatShiftDay(shift: ShiftRow): { day: string; date: number } {
    const p = dayPartsInTz(shift.starts_at, tz)
    return {
      day: DAY_LABELS[p.dayOfWeek],
      date: p.dayOfMonth,
    }
  }

  function formatNextShiftLabel(shift: ShiftRow): string {
    try {
      const d = new Date(shift.starts_at)
      const diffMs = d.getTime() - now.getTime()
      const diffH = Math.round(diffMs / 3_600_000)
      if (diffH < 24) return `IN ${diffH}H`
      const diffD = Math.round(diffH / 24)
      return `IN ${diffD}D`
    } catch {
      return ""
    }
  }

  function formatNextShiftHero(shift: ShiftRow): string {
    const p = dayPartsInTz(shift.starts_at, tz)
    return `${DAY_LABELS[p.dayOfWeek]} ${p.dayOfMonth}`
  }

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
              { label: "Scheduling" },
            ]}
          />
        }
        title="Scheduling"
      />

      {/* Next shift hero — brand-constant navy in both themes, like the sidebar */}
      {nextShift ? (
        <div
          className="relative overflow-hidden rounded-2xl p-5 pb-[18px] text-sidebar-foreground"
          style={{
            backgroundImage:
              "linear-gradient(135deg, var(--navy-500) 0%, var(--rr-navy-dark) 100%)",
          }}
        >
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
            style={{
              background:
                "radial-gradient(circle, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)",
            }}
          />
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary">
            {`NEXT SHIFT · ${formatNextShiftLabel(nextShift)}`}
          </p>
          <p className="mt-2 font-display text-[clamp(38px,10vw,52px)] leading-[0.95] tracking-[-0.01em] uppercase">
            {formatNextShiftHero(nextShift)}
          </p>
          <p className="mt-2 font-display text-[26px] leading-none tracking-[0.01em] text-primary">
            {formatShiftTime(nextShift).toUpperCase()}
          </p>
          <p className="mt-1.5 text-xs text-sidebar-foreground-muted">
            {nextShift.departments?.name ?? "—"}
            {nextShift.role_label ? ` · ${nextShift.role_label}` : ""}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              asChild
              variant="outline"
              className="h-10 flex-1 border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Link href="/reports/scheduling/swaps">Request swap</Link>
            </Button>
            <Button asChild className="h-10 flex-1">
              <Link href="/reports/scheduling/my-schedule">Full schedule</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl p-5 pb-[18px] text-sidebar-foreground"
          style={{
            backgroundImage:
              "linear-gradient(135deg, var(--navy-500) 0%, var(--rr-navy-dark) 100%)",
          }}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary">
            NEXT SHIFT
          </p>
          <p className="mt-2.5 text-base text-sidebar-foreground-muted">
            No upcoming shifts scheduled
          </p>
        </div>
      )}

      {/* Week strip */}
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((d) => (
          <div
            key={d.iso}
            className={cn(
              "rounded-[10px] border px-0.5 pb-1.5 pt-2 text-center",
              d.isNext
                ? "border-primary bg-primary text-primary-foreground"
                : d.hasShift
                  ? "border-border bg-secondary text-foreground"
                  : "border-border bg-transparent text-foreground"
            )}
          >
            <div className="text-[9px] font-extrabold uppercase tracking-[0.08em]">
              {d.label}
            </div>
            <div className="font-display text-lg leading-[1.15]">
              {d.dayOfMonth}
            </div>
            <div
              className={cn(
                "mx-auto mt-[3px] h-1 w-1 rounded-full",
                d.isNext
                  ? "bg-primary-foreground"
                  : d.hasShift
                    ? "bg-primary"
                    : "bg-border"
              )}
            />
          </div>
        ))}
      </div>

      {/* Upcoming shifts */}
      <section>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Upcoming
          </h2>
          <Link
            href="/reports/scheduling/my-schedule"
            className="text-xs text-primary no-underline hover:underline"
          >
            View all →
          </Link>
        </div>

        {upcomingShifts.length === 0 ? (
          <div className="rounded-[14px] border border-border bg-card px-4 py-5 text-center text-[13px] text-muted-foreground">
            No upcoming shifts
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {upcomingShifts.map((s) => {
              const { day, date } = formatShiftDay(s)
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3"
                >
                  <div className="grid h-12 w-11 shrink-0 place-items-center rounded-[10px] bg-sidebar text-center text-sidebar-foreground">
                    <div className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-primary">
                      {day}
                    </div>
                    <div className="font-display text-xl leading-none">
                      {date}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-foreground">
                      {formatShiftTime(s)}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {s.departments?.name ?? "—"}
                      {s.role_label ? ` · ${s.role_label}` : ""}
                    </div>
                  </div>
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Open shifts */}
      {openShifts.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Open · Pick up
          </h2>
          <div className="flex flex-col gap-2">
            {openShifts.map((row) => {
              const shift = row.schedule_shifts
              if (!shift) return null
              const dayParts = dayPartsInTz(shift.starts_at, tz)
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-[14px] border border-primary/30 bg-primary/5 px-3.5 py-3"
                >
                  <div className="grid h-12 w-11 shrink-0 place-items-center rounded-[10px] border border-border bg-secondary text-center text-foreground">
                    <div className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
                      {DAY_LABELS[dayParts.dayOfWeek]}
                    </div>
                    <div className="font-display text-xl leading-none">
                      {dayParts.dayOfMonth}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-foreground">
                      {formatDateTime(shift.starts_at, tz)}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {shift.departments?.name ?? "—"}
                      {shift.role_label ? ` · ${shift.role_label}` : ""}
                      {row.approval_required ? " · Approval req." : ""}
                    </div>
                  </div>
                  <ClaimOpenShiftButton openShiftId={row.id} />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* My pending claims (awaiting admin approval) */}
      {myPendingClaims.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Your claims · Awaiting approval
          </h2>
          <div className="flex flex-col gap-2">
            {myPendingClaims.map((row) => {
              const shift = row.schedule_shifts
              if (!shift) return null
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-[14px] border border-dashed border-border bg-card px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-foreground">
                      {formatDateTime(shift.starts_at, tz)}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {shift.departments?.name ?? "—"}
                      {shift.role_label ? ` · ${shift.role_label}` : ""}
                      {" · You claimed this shift — a manager needs to approve it."}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Quick links */}
      <section>
        <h2 className="mb-2.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
          Quick links
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            { href: "/reports/scheduling/my-schedule", label: "My schedule", desc: "All upcoming shifts" },
            { href: "/reports/scheduling/time-off", label: "Time off", desc: "Request & track" },
            { href: "/reports/scheduling/availability", label: "Availability", desc: "Set working hours" },
            {
              href: "/reports/scheduling/swaps",
              label: "Shift swaps",
              desc: "Trade with coworkers",
            },
            {
              href: "/reports/scheduling/notifications",
              label: "Notifications",
              desc: unreadCount && unreadCount > 0
                ? `${unreadCount} unread`
                : "Schedule alerts",
              badge: unreadCount && unreadCount > 0 ? unreadCount : null,
            },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="no-underline"
            >
              <div className="relative rounded-[14px] border border-border bg-card p-3.5">
                {link.badge ? (
                  <div className="absolute right-2.5 top-2.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-[5px] text-[10px] font-bold text-destructive-foreground">
                    {link.badge}
                  </div>
                ) : null}
                <div className="mb-0.5 font-display text-[15px] uppercase tracking-[0.02em] text-foreground">
                  {link.label}
                </div>
                <div className="text-[11.5px] text-muted-foreground">{link.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
