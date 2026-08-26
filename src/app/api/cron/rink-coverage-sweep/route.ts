import { withCronRoute } from "@/lib/cron/with-cron-auth"
import { runCoverageSweep } from "@/lib/rink-scheduling/coverage-sweep"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Drains the Rink Scheduling coverage queue.
 *
 * Bookings are flagged when they fall outside operating hours or when no
 * published shift covers them. The queue is filled by booking writes, by
 * operating-hours edits, and by a trigger on schedule_shifts — so publishing a
 * week of shifts re-checks every future booking without this module ever
 * writing to a scheduling table.
 *
 * Running on a schedule as well as on demand is deliberate: the enqueue path
 * swallows its own failures rather than risk breaking a publish, so a periodic
 * pass is what makes a dropped enqueue self-healing.
 *
 * Auth, the service-role client, timing and the cron_runs record are handled
 * by withCronRoute.
 */
export const GET = withCronRoute("/api/cron/rink-coverage-sweep", async (supabase) => {
  const result = await runCoverageSweep(supabase)

  const summary = {
    facilities: result.facilities,
    evaluated: result.evaluated,
    changed: result.changed,
    alerts_opened: result.alertsOpened,
    alerts_resolved: result.alertsResolved,
  }

  // Counts only in the body, matching the sibling cron routes' contract.
  return { body: { ok: true, ...summary }, summary }
})
