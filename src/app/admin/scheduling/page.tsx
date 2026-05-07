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

export const dynamic = "force-dynamic"

function startOfWeekIso(weekStartDay: number): { start: string; end: string } {
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
  return { start: start.toISOString(), end: end.toISOString() }
}

export default async function SchedulingOverviewPage() {
  const current = await requireAdmin()
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
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

  const { data: settings } = await supabase
    .from("schedule_settings")
    .select("week_start_day")
    .eq("facility_id", facilityId)
    .maybeSingle<{ week_start_day: number }>()

  const weekStartDay = settings?.week_start_day ?? 0
  const { start, end } = startOfWeekIso(weekStartDay)

  const [
    weekShiftsRes,
    draftCountRes,
    openShiftCountRes,
    templateCountRes,
  ] = await Promise.all([
    supabase
      .from("schedule_shifts")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId)
      .gte("starts_at", start)
      .lt("starts_at", end),
    supabase
      .from("schedule_shifts")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId)
      .eq("status", "draft"),
    supabase
      .from("schedule_open_shifts")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId)
      .eq("claim_status", "open"),
    supabase
      .from("schedule_templates")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId),
  ])

  const weekShifts = weekShiftsRes.count ?? 0
  const draftCount = draftCountRes.count ?? 0
  const openShifts = openShiftCountRes.count ?? 0
  const templateCount = templateCountRes.count ?? 0

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CountCard
          title="Shifts this week"
          value={weekShifts}
          description="All statuses, current week"
          href="/admin/scheduling/shifts"
        />
        <CountCard
          title="Pending publish"
          value={draftCount}
          description="Draft shifts awaiting publish"
          href="/admin/scheduling/shifts?status=draft"
        />
        <CountCard
          title="Open shifts"
          value={openShifts}
          description="Unassigned and claimable"
          href="/admin/scheduling/shifts?status=draft"
        />
        <CountCard
          title="Templates"
          value={templateCount}
          description="Recurring schedule templates"
          href="/admin/scheduling/templates"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
          <CardDescription>
            Jump straight into the scheduling tasks you do most often.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/admin/scheduling/shifts">View shifts</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/scheduling/templates">Manage templates</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/scheduling/publish">Publish history</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/scheduling/time-off">Time-off requests</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/scheduling/swaps">Swap requests</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Scheduling</h1>
      <p className="text-muted-foreground text-sm">
        Manage shifts, templates, and publishing for this facility.
      </p>
    </div>
  )
}

function CountCard({
  title,
  value,
  description,
  href,
}: {
  title: string
  value: number
  description: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="bg-card hover:bg-accent group rounded-xl border p-4 shadow-sm transition-colors"
    >
      <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {title}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground mt-1 text-xs">{description}</div>
    </Link>
  )
}
