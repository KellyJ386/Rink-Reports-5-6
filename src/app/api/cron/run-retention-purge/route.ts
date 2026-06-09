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
    const { data, error } = await supabase.rpc(fn)
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

  // Sync queue rows are ephemeral system state, not user data, so they don't
  // belong in retention_settings (which is per-facility). Drop synced rows
  // older than 90 days inline. Pending/failed rows are kept so an admin can
  // still triage them.
  const syncCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { error: syncErr, count: syncDeleted } = await supabase
    .from("offline_sync_queue")
    .delete({ count: "exact" })
    .eq("sync_status", "synced")
    .lt("synced_at", syncCutoff)
  if (syncErr) {
    console.error(
      "[cron/run-retention-purge] offline_sync_queue purge failed:",
      syncErr,
    )
    anyFailed = true
  } else if (typeof syncDeleted === "number") {
    total += syncDeleted
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

  const offlineSyncDeleted = typeof syncDeleted === "number" ? syncDeleted : 0
  console.log(
    "[cron/run-retention-purge] run complete",
    JSON.stringify({
      route: "/api/cron/run-retention-purge",
      duration_ms: Date.now() - startedAt,
      total,
      results,
      offline_sync_deleted: offlineSyncDeleted,
      ok: !anyFailed,
    }),
  )

  return NextResponse.json(
    {
      ok: !anyFailed,
      total,
      results,
      offline_sync_deleted: offlineSyncDeleted,
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
