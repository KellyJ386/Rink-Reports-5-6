import { withCronRoute } from "@/lib/cron/with-cron-auth"
import { runOverdueReminders } from "@/lib/rink-scheduling/overdue-reminders"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Daily overdue-invoice reminders for Rink Scheduling & Billing.
 *
 * For every facility that has `overdue_reminders_enabled`, emails the
 * customer's billing contact about each open invoice past its due date — the
 * invoice PDF attached, the facility's identity on the message — at most once
 * per `reminder_cadence_days`. Selection logic is pure and unit-tested in
 * overdue.ts; per-run volume is capped so a backlog drains across days
 * instead of blowing the time budget.
 *
 * Auth, the service-role client, timing and the cron_runs record are handled
 * by withCronRoute.
 */
export const GET = withCronRoute("/api/cron/rink-overdue-reminders", async (supabase) => {
  const result = await runOverdueReminders(supabase)

  const summary = {
    facilities: result.facilities,
    considered: result.considered,
    sent: result.sent,
    skipped_no_email: result.skippedNoEmail,
    failures: result.failures,
    buckets: result.buckets,
    ...(result.skipped ? { skipped: result.skipped } : {}),
  }

  return {
    status: result.failures > 0 ? 500 : 200,
    body: { ok: result.failures === 0, ...summary },
    summary,
    ...(result.failures > 0 ? { error: `${result.failures} reminder(s) failed` } : {}),
  }
})
