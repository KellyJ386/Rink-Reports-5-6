import { withCronRoute } from "@/lib/cron/with-cron-auth"
import { logServerError } from "@/lib/observability/log-server-error"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * On-demand recovery route: recomputes facility_daily_metrics for ONE
 * facility across a date range, via backfill_facility_daily_metrics
 * (migration 267). This is how a metric-definition bug gets fixed after the
 * fact, and how a facility's history is backfilled the first time.
 *
 * Query params: facility_id (uuid), from (YYYY-MM-DD), to (YYYY-MM-DD),
 * both inclusive. The 400-day cap is enforced again here, ahead of the RPC's
 * own cap, so a malformed request is rejected before any DB round trip.
 *
 * WHY THIS IS ON THE vercel.json SCHEDULE DESPITE BEING AN ON-DEMAND ROUTE.
 * scripts/check-cron-schedule.mjs (CI: cron-schedule-check.yml) enforces a
 * strict 1:1 mapping between every src/app/api/cron/<name>/route.ts and a
 * vercel.json entry — a route with no schedule 404s or is silently unreachable
 * in exactly the way that check exists to catch, with no exemption for
 * "deliberately on-demand." Rather than carve an exception into a repo-wide
 * safety net for one route, this one is scheduled WEEKLY (vercel.json) purely
 * as a canary that proves auth and the service-role client still work; a
 * scheduled hit carries no query params, and the missing-params case below is
 * therefore treated as a harmless no-op success (not a 400), so the weekly
 * canary never shows up as a false failure in cron_runs. A REAL backfill is
 * always an explicit, parameterized call — from the admin console (once one
 * exists) or curl with the CRON_SECRET bearer token — never the schedule.
 *
 * Auth, the service-role client, timing, and the cron_runs record are all
 * handled by withCronRoute.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 400
const DAY_MS = 24 * 60 * 60 * 1000

export const GET = withCronRoute("/api/cron/daily-metrics-backfill", async (supabase, request) => {
  const url = new URL(request.url)
  const facilityId = url.searchParams.get("facility_id")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  // No params at all -> the weekly schedule's canary ping. Success, no-op.
  // See the "WHY THIS IS ON THE vercel.json SCHEDULE" note above.
  if (!facilityId && !from && !to) {
    return { body: { ok: true, ran: false, reason: "no params (scheduled canary ping)" } }
  }

  if (!facilityId || !UUID_RE.test(facilityId)) {
    return { status: 400, body: { ok: false, error: "facility_id must be a valid UUID" }, error: "bad facility_id" }
  }
  if (!from || !DATE_ONLY_RE.test(from) || !to || !DATE_ONLY_RE.test(to)) {
    return {
      status: 400,
      body: { ok: false, error: "from and to are required, in YYYY-MM-DD format" },
      error: "bad date range",
    }
  }
  const fromMs = Date.parse(`${from}T00:00:00.000Z`)
  const toMs = Date.parse(`${to}T00:00:00.000Z`)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { status: 400, body: { ok: false, error: "invalid date range" }, error: "invalid date range" }
  }
  if (toMs < fromMs) {
    return {
      status: 400,
      body: { ok: false, error: "to must be on or after from" },
      error: "reversed date range",
    }
  }
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    return {
      status: 400,
      body: { ok: false, error: `date range exceeds the ${MAX_RANGE_DAYS}-day cap per invocation` },
      error: "range too large",
    }
  }

  const { data, error } = await supabase.rpc("backfill_facility_daily_metrics", {
    p_facility_id: facilityId,
    p_from: from,
    p_to: to,
  })

  if (error) {
    logServerError("cron/daily-metrics-backfill", error, { facilityId, from, to })
    return {
      status: 500,
      body: { ok: false, error: "backfill failed — see server logs" },
      error: error.message,
    }
  }

  const result = data as { facility_id: string; days: number; total_rows: number } | null
  const summary = {
    facility_id: facilityId,
    days: result?.days ?? 0,
    total_rows: result?.total_rows ?? 0,
  }

  return { body: { ok: true, ...summary }, summary }
})
