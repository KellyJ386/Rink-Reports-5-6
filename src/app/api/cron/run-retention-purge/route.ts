import { createHash, timingSafeEqual } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import type { Database } from "@/types/database"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Invokes the per-module purge_old_* functions defined in migration 24.
 * Each function self-discovers facilities whose retention_settings row has
 * auto_purge = true and deletes records older than keep_days.
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
  "purge_old_audit_logs",
] as const

type PurgeFn = (typeof PURGE_FUNCTIONS)[number]

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 503 },
    )
  }
  if (!authorize(request.headers.get("authorization"), secret)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "Supabase service-role env not configured" },
      { status: 503 },
    )
  }

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const startedAt = Date.now()
  const results: Record<PurgeFn, number | "error"> = Object.fromEntries(
    PURGE_FUNCTIONS.map((fn) => [fn, 0 as number | "error"]),
  ) as Record<PurgeFn, number | "error">

  let total = 0
  let anyFailed = false

  for (const fn of PURGE_FUNCTIONS) {
    // purge_old_* functions are not in generated types (service-role only).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(fn)
    if (error) {
      console.error(`[cron/run-retention-purge] ${fn} failed:`, error)
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
    console.error(
      "[cron/run-retention-purge] last_purged_at stamp failed:",
      stampErr,
    )
  }

  console.log(
    "[cron/run-retention-purge] run complete",
    JSON.stringify({
      route: "/api/cron/run-retention-purge",
      duration_ms: Date.now() - startedAt,
      total,
      results,
      ok: !anyFailed,
    }),
  )

  return NextResponse.json(
    {
      ok: !anyFailed,
      total,
      results,
      stamped_at: stampedAt,
    },
    { status: anyFailed ? 500 : 200 },
  )
}

function authorize(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const a = createHash("sha256").update(header).digest()
  const b = createHash("sha256").update(expected).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}
