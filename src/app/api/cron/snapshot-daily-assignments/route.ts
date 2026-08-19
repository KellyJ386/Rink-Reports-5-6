import { withCronRoute } from "@/lib/cron/with-cron-auth"
import { logServerError } from "@/lib/observability/log-server-error"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Freezes daily-report assignment snapshots for closed facility-local days
 * (snapshot_closed_daily_assignment_days, migration 185). Console/board loads
 * already do this opportunistically per facility; this cron is the backstop
 * for facilities nobody opens after midnight. Hourly, because "midnight"
 * happens at a different UTC hour per facility timezone.
 *
 * Auth, the service-role client, timing, and the cron_runs record are all
 * handled by withCronRoute.
 */
export const GET = withCronRoute(
  "/api/cron/snapshot-daily-assignments",
  async (supabase) => {
    const { data, error } = await supabase.rpc(
      "snapshot_closed_daily_assignment_days",
    )
    if (error) {
      logServerError("cron/snapshot-daily-assignments", error)
      return {
        status: 500,
        body: { ok: false, error: error.message },
        error: error.message,
      }
    }

    const frozen = typeof data === "number" ? data : 0
    return { body: { ok: true, frozen }, summary: { frozen } }
  },
)
