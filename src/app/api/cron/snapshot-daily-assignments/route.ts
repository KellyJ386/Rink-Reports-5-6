import { createHash, timingSafeEqual } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import type { Database } from "@/types/database"
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
  const { data, error } = await supabase.rpc(
    "snapshot_closed_daily_assignment_days",
  )
  if (error) {
    logServerError("cron/snapshot-daily-assignments", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const frozen = typeof data === "number" ? data : 0
  console.log(
    "[cron/snapshot-daily-assignments] run complete",
    JSON.stringify({
      route: "/api/cron/snapshot-daily-assignments",
      duration_ms: Date.now() - startedAt,
      frozen,
    }),
  )

  return NextResponse.json({ ok: true, frozen })
}

function authorize(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const a = createHash("sha256").update(header).digest()
  const b = createHash("sha256").update(expected).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}
