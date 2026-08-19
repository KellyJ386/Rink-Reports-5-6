import "server-only"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LocalDateTime } from "@/components/app/local-datetime"
import { nextRunAfter } from "@/lib/cron/cron-schedule"
import { createClient } from "@/lib/supabase/server"

import vercelConfig from "../../../../../vercel.json"

// The cron_runs audit trail (migration 240) made every cron invocation a row;
// this card makes those rows visible, because the failure it exists to catch —
// a silently dead cron — is precisely the one nothing else surfaces. An empty
// notification outbox looks identical whether the drain ran with nothing to do
// or hasn't run in three weeks.
//
// Schedules come straight from vercel.json so this card can never disagree
// with what is actually deployed; the check-cron-schedule CI guard already
// pins vercel.json to the route directories.

/** A run is late once now is past its next expected fire plus this grace. */
const GRACE_MS = 10 * 60 * 1000

type CronRunRow = {
  route: string
  started_at: string
  duration_ms: number
  ok: boolean
  error: string | null
}

type RouteHealth = {
  route: string
  schedule: string
  lastRun: CronRunRow | null
  stale: boolean
}

function scheduleMap(): Array<{ route: string; schedule: string }> {
  return (vercelConfig.crons ?? []).map((c) => ({
    route: c.path,
    schedule: c.schedule,
  }))
}

function isStale(schedule: string, lastStartedAt: string, now: Date): boolean {
  const last = new Date(lastStartedAt)
  if (Number.isNaN(last.getTime())) return false
  // Vercel evaluates cron expressions in UTC.
  const nextExpected = nextRunAfter(schedule, last, "UTC")
  if (!nextExpected) return false
  return now.getTime() > nextExpected.getTime() + GRACE_MS
}

export async function CronHealthCard() {
  const supabase = await createClient()

  // Newest-first window; 100 rows comfortably covers the latest run of all
  // seven routes even when one is firing every 5 minutes.
  const { data, error } = await supabase
    .from("cron_runs")
    .select("route, started_at, duration_ms, ok, error")
    .order("started_at", { ascending: false })
    .limit(100)

  // The table lands with migration 240 — until that is applied in this
  // environment the query fails, and the card must degrade, not crash the
  // whole super-admin console.
  if (error) {
    return (
      <Shell>
        <p className="text-muted-foreground text-sm">
          The cron audit trail isn&apos;t available yet — migration 240
          (cron_runs) hasn&apos;t been applied to this database.
        </p>
      </Shell>
    )
  }

  const rows = (data ?? []) as CronRunRow[]
  const latestByRoute = new Map<string, CronRunRow>()
  for (const row of rows) {
    if (!latestByRoute.has(row.route)) latestByRoute.set(row.route, row)
  }

  const now = new Date()
  const health: RouteHealth[] = scheduleMap().map(({ route, schedule }) => {
    const lastRun = latestByRoute.get(route) ?? null
    return {
      route,
      schedule,
      lastRun,
      stale: lastRun ? isStale(schedule, lastRun.started_at, now) : false,
    }
  })

  // Problems first: failures, then stale, then never-ran, then healthy.
  health.sort((a, b) => rank(a) - rank(b))

  return (
    <Shell>
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="border-b px-3 py-2 text-left font-medium">Route</th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Schedule
              </th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Last run
              </th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Duration
              </th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.route}>
                <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                  {h.route.replace("/api/cron/", "")}
                </td>
                <td className="text-muted-foreground border-b px-3 py-2 align-middle font-mono text-xs">
                  {h.schedule}
                </td>
                <td className="border-b px-3 py-2 align-middle whitespace-nowrap">
                  {h.lastRun ? (
                    <LocalDateTime iso={h.lastRun.started_at} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="text-muted-foreground border-b px-3 py-2 align-middle whitespace-nowrap">
                  {h.lastRun ? `${h.lastRun.duration_ms} ms` : "—"}
                </td>
                <td className="border-b px-3 py-2 align-middle">
                  <StatusBadge h={h} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FailureDetail health={health} />
    </Shell>
  )
}

function rank(h: RouteHealth): number {
  if (h.lastRun && !h.lastRun.ok) return 0
  if (h.stale) return 1
  if (!h.lastRun) return 2
  return 3
}

function StatusBadge({ h }: { h: RouteHealth }) {
  if (h.lastRun && !h.lastRun.ok) return <Badge variant="error">Failed</Badge>
  if (h.stale) return <Badge variant="warning">Overdue</Badge>
  if (!h.lastRun) return <Badge variant="secondary">No runs recorded</Badge>
  return <Badge variant="success">OK</Badge>
}

/** Last error text for any failed route, so triage doesn't need the logs. */
function FailureDetail({ health }: { health: RouteHealth[] }) {
  const failed = health.filter((h) => h.lastRun && !h.lastRun.ok)
  if (failed.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {failed.map((h) => (
        <p key={h.route} className="text-destructive text-xs">
          <span className="font-mono">{h.route.replace("/api/cron/", "")}</span>
          : {h.lastRun?.error ?? "failed without an error message"}
        </p>
      ))}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cron health</CardTitle>
        <CardDescription>
          Last recorded run of each scheduled job, from the cron_runs audit
          trail. A route is Overdue when it has missed its next expected fire
          by more than ten minutes — the state that used to be invisible.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}
