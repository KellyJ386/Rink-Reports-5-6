import { createHash, timingSafeEqual } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import type { Database } from "@/types/database"
import { logServerError } from "@/lib/observability/log-server-error"
import { sendDueShiftReminders } from "@/app/admin/scheduling/_lib/shift-reminders"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/** Shift reminders go out this far before a published shift starts. */
const REMINDER_WINDOW_HOURS = 24

/**
 * Scheduling housekeeping on a short cadence (vercel.json schedules it every
 * 10 minutes, offset from the other crons):
 *   - scheduling_expire_stale_swaps  — pending/accepted swap requests whose
 *     expiry window has passed (migration 139), notifying both parties.
 *   - scheduling_expire_open_claims  — open-shift listings whose claim window
 *     has passed (migration 137 expires_at + migration 139 sweeper).
 *   - sendDueShiftReminders — automated shift reminders (in-app + email) for
 *     published shifts starting within REMINDER_WINDOW_HOURS, across all
 *     facilities. Deduped per shift, so the 10-minute cadence never
 *     double-reminds; the manual admin button shares the same sweep.
 *
 * Both RPCs are SECURITY DEFINER, batched, and FOR UPDATE SKIP LOCKED, so a
 * single short batch per invocation is sufficient and safe under overlap.
 * Authenticated by the same CRON_SECRET as the other cron routes.
 */
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
  let anyFailed = false

  let expiredSwaps: number | "error" = 0
  const swapRes = await supabase.rpc("scheduling_expire_stale_swaps")
  if (swapRes.error) {
    logServerError("cron/expire-scheduling", swapRes.error, {
      fn: "scheduling_expire_stale_swaps",
    })
    expiredSwaps = "error"
    anyFailed = true
  } else {
    expiredSwaps = typeof swapRes.data === "number" ? swapRes.data : 0
  }

  let expiredClaims: number | "error" = 0
  const claimRes = await supabase.rpc("scheduling_expire_open_claims")
  if (claimRes.error) {
    logServerError("cron/expire-scheduling", claimRes.error, {
      fn: "scheduling_expire_open_claims",
    })
    expiredClaims = "error"
    anyFailed = true
  } else {
    expiredClaims = typeof claimRes.data === "number" ? claimRes.data : 0
  }

  let remindersSent: number | "error" = 0
  const remindRes = await sendDueShiftReminders(supabase, {
    windowHours: REMINDER_WINDOW_HOURS,
  })
  if (!remindRes.ok) {
    logServerError("cron/expire-scheduling", new Error(remindRes.error), {
      fn: "sendDueShiftReminders",
    })
    remindersSent = "error"
    anyFailed = true
  } else {
    remindersSent = remindRes.sent
  }

  console.log(
    "[cron/expire-scheduling] run complete",
    JSON.stringify({
      route: "/api/cron/expire-scheduling",
      duration_ms: Date.now() - startedAt,
      expiredSwaps,
      expiredClaims,
      remindersSent,
      ok: !anyFailed,
    }),
  )

  return NextResponse.json(
    {
      ok: !anyFailed,
      expiredSwaps,
      expiredClaims,
      remindersSent,
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
