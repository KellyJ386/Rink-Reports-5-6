import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import { addDaysToKey, dayKeyInTz, dayPartsInTz } from "@/lib/timezone"

import { ClaimOpenShiftButton } from "./_components/claim-open-shift-button"
import { formatDateRange, formatDateTime } from "./_components/format-utils"

export const dynamic = "force-dynamic"

const DISPLAY_FONT =
  "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"
const NAVY = "#003B6F"
const NAVY_DARK = "#001A3A"
const GREEN = "#4DFF00"
const GREEN_DARK = "#3DB800"
const RED = "#F42A2A"
// Theme-responsive via CSS custom properties
const SURFACE = "var(--card)"
const ELEVATED = "var(--secondary)"
const BORDER = "var(--border)"
const SECONDARY = "var(--muted-foreground)"
const FOREGROUND = "var(--foreground)"

function NotAvailable({
  title,
  description,
  showSignOut = false,
}: {
  title: string
  description: string
  showSignOut?: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Scheduling
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignOut ? (
          <CardContent>
            <SignOutButton />
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}

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
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "scheduling", "view"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have access to scheduling yet. Talk to your supervisor."
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
        "id, approval_required, claim_status, schedule_shifts(id, starts_at, ends_at, role_label, department_id, departments(name))"
      )
      .eq("facility_id", employeeRow.facility_id)
      .eq("claim_status", "open"),
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
      if (!shift) return false
      const startTs = new Date(shift.starts_at).getTime()
      return startTs >= now.getTime() && startTs <= in14.getTime()
    })
    .sort(
      (a, b) =>
        new Date(a.schedule_shifts!.starts_at).getTime() -
        new Date(b.schedule_shifts!.starts_at).getTime()
    )
    .slice(0, 5)

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
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        padding: "24px 16px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {/* Breadcrumb */}
      <p style={{ fontSize: 12, color: SECONDARY, marginBottom: 16 }}>
        <Link href="/reports" style={{ color: SECONDARY, textDecoration: "none" }}>
          Reports
        </Link>
        {" / Scheduling"}
      </p>

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "clamp(32px, 8vw, 48px)",
            lineHeight: 1,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            color: FOREGROUND,
            margin: "6px 0 0",
          }}
        >
          Scheduling
        </h1>
      </div>

      {/* Next shift hero */}
      {nextShift ? (
        <div
          style={{
            background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
            borderRadius: 20,
            padding: "20px 20px 18px",
            color: "#fff",
            position: "relative",
            overflow: "hidden",
            marginBottom: 16,
          }}
        >
          {/* Green radial glow */}
          <div
            style={{
              position: "absolute",
              top: -40,
              right: -40,
              width: 160,
              height: 160,
              borderRadius: 9999,
              background:
                "radial-gradient(circle, rgba(77,255,0,.22), transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: ".16em",
              color: GREEN,
              textTransform: "uppercase",
            }}
          >
            {`NEXT SHIFT · ${formatNextShiftLabel(nextShift)}`}
          </div>
          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: "clamp(38px, 10vw, 52px)",
              lineHeight: 0.95,
              letterSpacing: "-.01em",
              color: "#fff",
              marginTop: 8,
            }}
          >
            {formatNextShiftHero(nextShift)}
          </div>
          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: 26,
              color: GREEN,
              lineHeight: 1,
              marginTop: 8,
              letterSpacing: ".01em",
            }}
          >
            {formatShiftTime(nextShift).toUpperCase()}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,.72)",
              marginTop: 6,
            }}
          >
            {nextShift.departments?.name ?? "—"}
            {nextShift.role_label ? ` · ${nextShift.role_label}` : ""}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 16,
            }}
          >
            <Link
              href="/reports/scheduling/swaps"
              style={{
                flex: 1,
                height: 40,
                borderRadius: 9,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(255,255,255,.08)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textDecoration: "none",
              }}
            >
              Request swap
            </Link>
            <Link
              href="/reports/scheduling/my-schedule"
              style={{
                flex: 1,
                height: 40,
                borderRadius: 9,
                border: 0,
                background: `linear-gradient(180deg,${GREEN_DARK},${GREEN_DARK})`,
                color: NAVY_DARK,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textDecoration: "none",
                boxShadow: "0 2px 0 0 #2E9900",
              }}
            >
              Full schedule
            </Link>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
            borderRadius: 20,
            padding: "20px 20px 18px",
            color: "#fff",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: ".16em",
              color: GREEN,
            }}
          >
            NEXT SHIFT
          </div>
          <div
            style={{
              fontSize: 16,
              color: "rgba(255,255,255,.6)",
              marginTop: 10,
            }}
          >
            No upcoming shifts scheduled
          </div>
        </div>
      )}

      {/* Week strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          marginBottom: 24,
        }}
      >
        {weekDays.map((d) => (
          <div
            key={d.iso}
            style={{
              padding: "8px 2px 6px",
              textAlign: "center",
              borderRadius: 10,
              background: d.isNext ? GREEN : d.hasShift ? ELEVATED : "transparent",
              border: `1px solid ${d.isNext ? GREEN : d.hasShift ? BORDER : BORDER}`,
              color: d.isNext ? NAVY_DARK : FOREGROUND,
            }}
          >
            <div
              style={{
                fontSize: 8.5,
                fontWeight: 800,
                letterSpacing: ".08em",
                textTransform: "uppercase",
              }}
            >
              {d.label}
            </div>
            <div
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 18,
                lineHeight: 1.15,
              }}
            >
              {d.dayOfMonth}
            </div>
            <div
              style={{
                width: 4,
                height: 4,
                borderRadius: 9999,
                margin: "3px auto 0",
                background: d.isNext ? NAVY_DARK : d.hasShift ? GREEN : BORDER,
              }}
            />
          </div>
        ))}
      </div>

      {/* Upcoming shifts */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: ".16em",
              color: SECONDARY,
              textTransform: "uppercase",
            }}
          >
            Upcoming
          </div>
          <Link
            href="/reports/scheduling/my-schedule"
            style={{ fontSize: 12, color: GREEN, textDecoration: "none" }}
          >
            View all →
          </Link>
        </div>

        {upcomingShifts.length === 0 ? (
          <div
            style={{
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 14,
              padding: "20px 16px",
              textAlign: "center",
              color: SECONDARY,
              fontSize: 13,
            }}
          >
            No upcoming shifts
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcomingShifts.map((s) => {
              const { day, date } = formatShiftDay(s)
              return (
                <div
                  key={s.id}
                  style={{
                    background: SURFACE,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 14,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 48,
                      borderRadius: 9,
                      background: NAVY,
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 8.5,
                        fontWeight: 800,
                        color: GREEN,
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                      }}
                    >
                      {day}
                    </div>
                    <div
                      style={{
                        fontFamily: DISPLAY_FONT,
                        fontSize: 20,
                        lineHeight: 1,
                      }}
                    >
                      {date}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ fontSize: 13, fontWeight: 700, color: FOREGROUND }}
                    >
                      {formatShiftTime(s)}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: SECONDARY,
                        marginTop: 2,
                      }}
                    >
                      {s.departments?.name ?? "—"}
                      {s.role_label ? ` · ${s.role_label}` : ""}
                    </div>
                  </div>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={SECONDARY}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Open shifts */}
      {openShifts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: ".16em",
              color: SECONDARY,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Open · Pick up
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {openShifts.map((row) => {
              const shift = row.schedule_shifts
              if (!shift) return null
              const dayParts = dayPartsInTz(shift.starts_at, tz)
              return (
                <div
                  key={row.id}
                  style={{
                    background: "rgba(77,255,0,.06)",
                    border: `1px solid rgba(77,255,0,.30)`,
                    borderRadius: 14,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 48,
                      borderRadius: 9,
                      background: ELEVATED,
                      border: `1px solid ${BORDER}`,
                      color: FOREGROUND,
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 8.5,
                        fontWeight: 800,
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        color: SECONDARY,
                      }}
                    >
                      {DAY_LABELS[dayParts.dayOfWeek]}
                    </div>
                    <div
                      style={{
                        fontFamily: DISPLAY_FONT,
                        fontSize: 20,
                        lineHeight: 1,
                        color: FOREGROUND,
                      }}
                    >
                      {dayParts.dayOfMonth}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ fontSize: 13, fontWeight: 700, color: FOREGROUND }}
                    >
                      {formatDateTime(shift.starts_at, tz)}
                    </div>
                    <div style={{ fontSize: 11.5, color: SECONDARY, marginTop: 2 }}>
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
        </div>
      )}

      {/* Quick links */}
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: ".16em",
            color: SECONDARY,
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Quick links
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
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
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  background: SURFACE,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 14,
                  padding: "14px 14px",
                  position: "relative",
                }}
              >
                {link.badge ? (
                  <div
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      minWidth: 18,
                      height: 18,
                      padding: "0 5px",
                      borderRadius: 9999,
                      background: RED,
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {link.badge}
                  </div>
                ) : null}
                <div
                  style={{
                    fontFamily: DISPLAY_FONT,
                    fontSize: 15,
                    color: FOREGROUND,
                    textTransform: "uppercase",
                    letterSpacing: ".02em",
                    marginBottom: 2,
                  }}
                >
                  {link.label}
                </div>
                <div style={{ fontSize: 11.5, color: SECONDARY }}>{link.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
