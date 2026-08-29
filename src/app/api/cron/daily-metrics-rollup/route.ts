import { withCronRoute } from "@/lib/cron/with-cron-auth"
import { logServerError } from "@/lib/observability/log-server-error"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Nightly reporting rollup: for every facility, computes and upserts
 * facility_daily_metrics for YESTERDAY in that facility's OWN timezone
 * (migration 267's run_daily_metrics_rollup_for_yesterday), covering the nine
 * modules that have a compute_daily_metrics_* function.
 *
 * A single RPC call does the per-facility loop and the "yesterday" resolution
 * server-side — this route is a thin wrapper, matching the
 * snapshot_closed_daily_assignment_days / snapshot-daily-assignments pattern.
 * Idempotent: a re-run (e.g. after a retry) just re-upserts the same rows.
 *
 * Scheduled at 08:23 UTC (vercel.json) — safely after local midnight for every
 * US timezone this app currently serves (04:23 EDT / 03:23 EST), and offset
 * from :00 to avoid colliding with the other daily crons.
 *
 * Auth, the service-role client, timing, and the cron_runs record are all
 * handled by withCronRoute.
 */
export const GET = withCronRoute("/api/cron/daily-metrics-rollup", async (supabase) => {
  const { data, error } = await supabase.rpc("run_daily_metrics_rollup_for_yesterday")

  if (error) {
    // Full error goes to server logs + the cron_runs record only; the response
    // body stays opaque, matching the sibling cron routes' contract.
    logServerError("cron/daily-metrics-rollup", error)
    return {
      status: 500,
      body: { ok: false, error: "rollup failed — see server logs" },
      error: error.message,
    }
  }

  const result = data as { facilities: number; total_rows: number; per_facility: unknown } | null
  const summary = {
    facilities: result?.facilities ?? 0,
    total_rows: result?.total_rows ?? 0,
  }

  return { body: { ok: true, ...summary }, summary }
})
