import { withCronRoute } from "@/lib/cron/with-cron-auth"
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
 * that someone is told. Auth, the service-role client, timing, and the
 * cron_runs record are handled by withCronRoute.
 */
export const GET = withCronRoute("/api/cron/verify-audit-chain", async (supabase) => {
  const { data, error } = await supabase.rpc("verify_all_audit_chains")
  if (error) {
    // Full error goes to server logs + the cron_runs record only; the
    // response body stays opaque so schema/constraint text never leaves the
    // server (matches the sibling cron routes' counts-only contract).
    logServerError("cron/verify-audit-chain", error)
    return {
      status: 500,
      body: { ok: false, error: "verification failed — see server logs" },
      error: error.message,
    }
  }

  const result = (data ?? {
    ok: true,
    checked_facilities: 0,
    total_rows_checked: 0,
    broken: [],
  }) as VerifyResult

  const summary = {
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
    return {
      status: 500,
      body: result as unknown as Record<string, unknown>,
      summary,
      error: `audit chain broken for ${result.broken.length} facility(ies)`,
    }
  }

  return { body: result as unknown as Record<string, unknown>, summary }
})
