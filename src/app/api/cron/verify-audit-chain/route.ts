import { createHash, timingSafeEqual } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import type { Database } from "@/types/database"
import { logServerError } from "@/lib/observability/log-server-error"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

type ChainBreak = {
  facility_id: string
  first_break_seq: number | null
  reason: string
}
type VerifyResult = {
  ok: boolean
  checked_facilities: number
  total_rows_checked: number
  broken: ChainBreak[]
}

/**
 * Periodic tamper check for the append-only audit log. Runs
 * verify_all_audit_chains() (migration 218), which recomputes every audit
 * row's hash and walks the per-facility linkage, bridging retention-destroyed
 * spans via the batches' archived anchors. A break means an audit row was
 * altered, removed, or reordered outside the governed destruction flow.
 *
 * On a detected break the route logs an error and returns 500, so Vercel's
 * cron monitoring surfaces it loudly — the whole point of tamper-EVIDENCE is
 * that someone is told. Authenticated by the same CRON_SECRET as the others.
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
  const { data, error } = await supabase.rpc("verify_all_audit_chains")
  if (error) {
    // Full error goes to server logs only; the response body stays opaque so
    // schema/constraint text never leaves the server (matches the sibling
    // cron routes' counts-only contract).
    logServerError("cron/verify-audit-chain", error)
    return NextResponse.json(
      { ok: false, error: "verification failed — see server logs" },
      { status: 500 },
    )
  }

  const result = (data ?? {
    ok: true,
    checked_facilities: 0,
    total_rows_checked: 0,
    broken: [],
  }) as VerifyResult

  const summary = {
    route: "/api/cron/verify-audit-chain",
    duration_ms: Date.now() - startedAt,
    checked_facilities: result.checked_facilities,
    total_rows_checked: result.total_rows_checked,
    broken_count: result.broken?.length ?? 0,
  }

  if (!result.ok) {
    // Tamper detected — make it impossible to miss.
    logServerError(
      "cron/verify-audit-chain",
      new Error(
        `Audit chain verification FAILED for ${result.broken.length} facility(ies): ` +
          JSON.stringify(result.broken),
      ),
    )
    console.error("[cron/verify-audit-chain] TAMPER DETECTED", JSON.stringify(summary))
    return NextResponse.json(result, { status: 500 })
  }

  console.log("[cron/verify-audit-chain] run complete", JSON.stringify(summary))
  return NextResponse.json(result)
}

function authorize(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const a = createHash("sha256").update(header).digest()
  const b = createHash("sha256").update(expected).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}
