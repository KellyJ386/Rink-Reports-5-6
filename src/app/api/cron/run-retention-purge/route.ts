import { withCronRoute } from "@/lib/cron/with-cron-auth"
import { logServerError } from "@/lib/observability/log-server-error"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Invokes the per-module purge_old_* functions defined in migration 24,
 * plus the fixed-interval system-state purges from migration 134
 * (notification_outbox and offline_sync_queue terminal rows).
 * Each retention_settings-aware function self-discovers facilities whose
 * retention_settings row has auto_purge = true and deletes records older
 * than keep_days.
 *
 * Authenticated by the same CRON_SECRET as the other cron routes; expected
 * to be invoked daily (vercel.json schedules it once per day off-peak).
 */
const PURGE_FUNCTIONS = [
  "purge_old_daily_reports",
  "purge_old_communications",
  "purge_old_accident_reports",
  "purge_old_incident_reports",
  "purge_old_refrigeration_reports",
  "purge_old_air_quality_reports",
  "purge_old_ice_operations_submissions",
  "purge_old_ice_depth_sessions",
  "purge_old_dasher_boards_inspections",
  // Rink Scheduling & Billing (migration 251). The retention UI offers this
  // module an Auto-purge toggle, but the nightly worker never invoked its purge
  // function, so enabling it was a silent no-op. Financial records: the function
  // itself clamps the cutoff to a 7-year floor regardless of configured keep_days.
  "purge_old_rink_scheduling_records",
  "purge_old_audit_logs",
  "purge_old_notification_outbox",
  "purge_old_offline_sync_queue",
  "purge_old_cron_runs",
] as const

type PurgeFn = (typeof PURGE_FUNCTIONS)[number]

export const GET = withCronRoute("/api/cron/run-retention-purge", async (supabase) => {
  const results: Record<PurgeFn, number | "error"> = Object.fromEntries(
    PURGE_FUNCTIONS.map((fn) => [fn, 0 as number | "error"]),
  ) as Record<PurgeFn, number | "error">

  let total = 0
  let anyFailed = false

  for (const fn of PURGE_FUNCTIONS) {
    const { data, error } = await supabase.rpc(fn)
    if (error) {
      logServerError("cron/run-retention-purge", error, { fn })
      results[fn] = "error"
      anyFailed = true
      continue
    }
    const deleted = typeof data === "number" ? data : 0
    results[fn] = deleted
    total += deleted
  }

  // Stamp last_purged_at on every auto_purge row so the admin UI reflects
  // the run. We don't attribute per-facility counts here (the SQL functions
  // aggregate across facilities); operators wanting precise counts use the
  // manual purge button.
  const stampedAt = new Date().toISOString()
  const { error: stampErr } = await supabase
    .from("retention_settings")
    .update({ last_purged_at: stampedAt })
    .eq("auto_purge", true)
  if (stampErr) {
    logServerError("cron/run-retention-purge", stampErr, {
      step: "last_purged_at stamp",
    })
  }

  return {
    status: anyFailed ? 500 : 200,
    body: { ok: !anyFailed, total, results, stamped_at: stampedAt },
    summary: { total, results },
    error: anyFailed ? "one or more purge functions failed" : undefined,
  }
})
