import { NextResponse } from "next/server"
import { type SupabaseClient, createClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database"
import { logServerError } from "@/lib/observability/log-server-error"

import { authorizeCronRequest } from "./authorize"

/**
 * What a cron handler returns. `body` is the JSON sent to the caller; `summary`
 * is the structured record logged and written to cron_runs. They are separate
 * because a route's response shape is a contract with Vercel's scheduler, while
 * the summary is free-form operational telemetry.
 */
export type CronOutcome = {
  /** Defaults to 200. A handler that fails its own work returns 500 here. */
  status?: number
  body: Record<string, unknown>
  /** Row counts, per-step tallies — whatever makes the run diagnosable. */
  summary?: Record<string, unknown>
  /** Set when the run did not fully succeed; recorded on the cron_runs row. */
  error?: string
}

export type CronHandler = (
  supabase: SupabaseClient<Database>,
  request: Request,
) => Promise<CronOutcome>

/**
 * The shared shell around every cron route: authorize, build a service-role
 * client, time the run, then record it.
 *
 * Before this existed, all seven routes carried a verbatim copy of the same
 * authorize() function and env-check prologue, and each recorded its run as a
 * console.log that only ever reached Vercel's ephemeral function logs — so a
 * cron that silently stopped running was indistinguishable from one with
 * nothing to do.
 *
 * `route` is the public path (e.g. "/api/cron/drain-notifications"); it is the
 * cron_runs key and the log prefix, so it must match vercel.json.
 */
export function withCronRoute(route: string, handler: CronHandler) {
  return async function GET(request: Request): Promise<NextResponse> {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      // 503 not 401: this is our misconfiguration, not the caller's.
      return NextResponse.json(
        { ok: false, error: "CRON_SECRET not configured" },
        { status: 503 },
      )
    }
    if (!authorizeCronRequest(request.headers.get("authorization"), secret)) {
      // Deliberately opaque — never confirm whether the secret merely differs.
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }

    // Built inline rather than via createAdminClient(): that helper is
    // `server-only`, which does not resolve under vitest's plain-Node
    // environment, and the send-communications route has a unit test that
    // imports its module. Same client shape the routes constructed before.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return NextResponse.json(
        { ok: false, error: "Supabase service-role env not configured" },
        { status: 503 },
      )
    }
    const supabase: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const startedAtMs = Date.now()
    const startedAtIso = new Date(startedAtMs).toISOString()

    let outcome: CronOutcome
    try {
      outcome = await handler(supabase, request)
    } catch (err) {
      // An unhandled throw is still a run that happened, and it is the most
      // important kind to have on the record.
      logServerError(`cron${route}`, err)
      const message = err instanceof Error ? err.message : String(err)
      await recordRun(supabase, {
        route,
        startedAtIso,
        durationMs: Date.now() - startedAtMs,
        ok: false,
        summary: {},
        error: message,
      })
      return NextResponse.json({ ok: false, error: "run failed" }, { status: 500 })
    }

    const status = outcome.status ?? 200
    const ok = status < 400 && outcome.error === undefined
    const summary = outcome.summary ?? {}
    const durationMs = Date.now() - startedAtMs

    console.log(
      `[cron${route}] run complete`,
      JSON.stringify({ route, duration_ms: durationMs, ok, ...summary }),
    )

    await recordRun(supabase, {
      route,
      startedAtIso,
      durationMs,
      ok,
      summary,
      error: outcome.error ?? null,
    })

    return NextResponse.json(outcome.body, { status })
  }
}

/**
 * Append the run to cron_runs. Best-effort by design: the audit trail must
 * never be the reason a cron reports failure, or adding observability would
 * make the system less reliable than it was without it.
 */
async function recordRun(
  supabase: SupabaseClient<Database>,
  run: {
    route: string
    startedAtIso: string
    durationMs: number
    ok: boolean
    summary: Record<string, unknown>
    error?: string | null
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("cron_runs").insert({
      route: run.route,
      started_at: run.startedAtIso,
      duration_ms: run.durationMs,
      ok: run.ok,
      summary: run.summary as never,
      error: run.error ?? null,
    })
    if (error) logServerError(`cron${run.route}/record`, error)
  } catch (err) {
    logServerError(`cron${run.route}/record`, err)
  }
}
