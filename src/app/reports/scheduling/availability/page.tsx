import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { SignOutButton } from "@/components/staff/sign-out-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

import {
  SHORT_DAY_NAMES,
  addDays,
  parseDateParam,
  startOfWeek,
  toDateParam,
  weekDates,
} from "../types"

export const dynamic = "force-dynamic"

type SearchParams = { week?: string }

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
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          / Availability
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

function monthRange(dates: Date[]): string {
  const first = dates[0]!
  const last = dates[dates.length - 1]!
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    })
  return `${fmt(first, first.getFullYear() !== last.getFullYear())} – ${fmt(last, true)}`
}

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const current = await requireUser()
  const supabase = await createClient()
  const { week } = await searchParams

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
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "scheduling", "view"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have access to scheduling yet."
      />
    )
  }

  // Facility work-week start (migration 117).
  const { data: settingsRow } = await supabase
    .from("schedule_settings")
    .select("week_start_day")
    .eq("facility_id", employeeRow.facility_id)
    .maybeSingle()
  const weekStartDay: number =
    typeof settingsRow?.week_start_day === "number"
      ? settingsRow.week_start_day
      : 0

  const anchor = (week ? parseDateParam(week) : null) ?? new Date()
  const weekStart = startOfWeek(anchor, weekStartDay)
  const dates = weekDates(weekStart)
  const todayParam = toDateParam(new Date())

  const { data: rowsRaw } = await supabase
    .from("schedule_availability")
    .select("id, day_of_week, start_time, end_time, availability_type")
    .eq("employee_id", employeeRow.id)
    .order("start_time", { ascending: true })

  const rows = rowsRaw ?? []
  const byDay = new Map<number, typeof rows>()
  for (const row of rows) {
    const list = byDay.get(row.day_of_week) ?? []
    list.push(row)
    byDay.set(row.day_of_week, list)
  }

  const prevWeek = toDateParam(addDays(weekStart, -7))
  const nextWeek = toDateParam(addDays(weekStart, 7))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/scheduling" className="hover:underline">
            Scheduling
          </Link>{" "}
          / Availability
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Availability
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a day to set when you can work and the area you want to work.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/reports/scheduling/availability?week=${prevWeek}`}>
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Previous</span>
          </Link>
        </Button>
        <span className="text-sm font-medium">{monthRange(dates)}</span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/reports/scheduling/availability?week=${nextWeek}`}>
            <span className="sr-only sm:not-sr-only">Next</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {dates.map((date) => {
          const dow = date.getDay()
          const dayRows = byDay.get(dow) ?? []
          const param = toDateParam(date)
          const isToday = param === todayParam
          return (
            <Link
              key={param}
              href={`/reports/scheduling/availability/${param}`}
              className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold tracking-tight">
                  {SHORT_DAY_NAMES[dow]}{" "}
                  <span className="text-muted-foreground">
                    {date.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </span>
                {isToday ? <Badge variant="info">Today</Badge> : null}
              </div>
              {dayRows.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  Tap to set availability
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {dayRows.length}{" "}
                  {dayRows.length === 1 ? "block" : "blocks"} set
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
