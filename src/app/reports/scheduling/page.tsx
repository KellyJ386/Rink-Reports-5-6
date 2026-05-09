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

import { ClaimOpenShiftButton } from "./_components/claim-open-shift-button"
import { formatDateRange, formatDateTime } from "./_components/format-utils"

export const dynamic = "force-dynamic"

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

const QUICK_LINKS: { href: string; title: string; description: string }[] = [
  {
    href: "/reports/scheduling/my-schedule",
    title: "My schedule",
    description: "All your upcoming shifts.",
  },
  {
    href: "/reports/scheduling/time-off",
    title: "Time off",
    description: "Request and track time-off.",
  },
  {
    href: "/reports/scheduling/availability",
    title: "Availability",
    description: "Set the hours you can work.",
  },
  {
    href: "/reports/scheduling/swaps",
    title: "Shift swaps",
    description: "Trade shifts with coworkers.",
  },
  {
    href: "/reports/scheduling/notifications",
    title: "Notifications",
    description: "Schedule alerts and updates.",
  },
]

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

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_view")
    .eq("module_key", "scheduling")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_view) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have access to scheduling yet. Talk to your supervisor."
      />
    )
  }

  const now = new Date()
  const in7 = new Date(now)
  in7.setDate(in7.getDate() + 7)
  const in14 = new Date(now)
  in14.setDate(in14.getDate() + 14)

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
      .lte("starts_at", in7.toISOString())
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

  type ShiftRow = {
    id: string
    starts_at: string
    ends_at: string
    role_label: string | null
    department_id: string
    status: string
    departments: { name: string } | null
  }
  const myShifts = (myShiftsRaw ?? []) as unknown as ShiftRow[]

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
  const openShiftsAll = (openShiftsRaw ?? []) as unknown as OpenShiftRow[]
  const openShifts = openShiftsAll.filter((row) => {
    const shift = row.schedule_shifts
    if (!shift) return false
    const startTs = new Date(shift.starts_at).getTime()
    return startTs >= now.getTime() && startTs <= in14.getTime()
  })

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Scheduling
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Scheduling
          {employeeRow.first_name ? `, ${employeeRow.first_name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your shifts, time off, and swaps in one place.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            My next 7 days
          </h2>
          <Link
            href="/reports/scheduling/my-schedule"
            className="text-sm text-muted-foreground hover:underline"
          >
            View all
          </Link>
        </div>
        {myShifts.length === 0 ? (
          <Card>
            <CardHeader>
              <CardDescription>No upcoming shifts</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
            {myShifts.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {formatDateRange(s.starts_at, s.ends_at, tz)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.departments?.name ?? "—"}
                  </span>
                </div>
                {s.role_label ? (
                  <span className="text-xs text-muted-foreground">
                    {s.role_label}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Open shifts</h2>
        <p className="text-xs text-muted-foreground">
          Unfilled shifts in your facility, next 14 days.
        </p>
        {openShifts.length === 0 ? (
          <Card>
            <CardHeader>
              <CardDescription>No open shifts available</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card">
            {openShifts.map((row) => {
              const shift = row.schedule_shifts
              if (!shift) return null
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {formatDateTime(shift.starts_at, tz)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {shift.departments?.name ?? "—"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      until {formatDateTime(shift.ends_at, tz)}
                    </span>
                    {shift.role_label ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {shift.role_label}
                      </span>
                    ) : null}
                    {row.approval_required ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                        Approval required
                      </span>
                    ) : null}
                  </div>
                  <ClaimOpenShiftButton openShiftId={row.id} />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Quick links</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-colors group-hover:bg-accent/30">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-base">{link.title}</CardTitle>
                    <CardDescription className="text-xs">
                      {link.description}
                    </CardDescription>
                  </div>
                  {link.href.endsWith("/notifications") &&
                  unreadCount &&
                  unreadCount > 0 ? (
                    <span
                      className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                      aria-label={`${unreadCount} unread notifications`}
                    >
                      {unreadCount}
                    </span>
                  ) : null}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
