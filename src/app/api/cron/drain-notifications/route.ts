import { createHash, timingSafeEqual } from "node:crypto"

import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { renderPdfForModule } from "@/lib/notifications/pdf/render"
import { uploadSubmissionPdf } from "@/lib/notifications/pdf/upload"
import type { Database } from "@/types/database"

// Force dynamic; service-role env vars must not be evaluated at build.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// Cap CPU exposure for unauthorised callers and PDF render heavy batches.
export const maxDuration = 60

/**
 * Drains notification_outbox by invoking drain_notification_outbox().
 *
 * Before draining, picks any due outbox rows with attach_pdf=true /
 * pdf_url IS NULL, deduplicates by (facility_id, source_record_id),
 * renders + uploads the PDF, and writes the storage path back onto the
 * outbox rows. The SQL drain then copies pdf_url onto the resulting
 * communication_messages row.
 *
 * PDF rendering failures don't block the drain. We do enforce that the
 * fetched snapshot's facility_id matches the outbox row's facility_id —
 * the snapshot fetcher runs with service-role credentials so RLS is
 * bypassed; without this check, a malformed outbox row could cause the
 * cron worker to render and stash a foreign tenant's record into the
 * current tenant's storage folder.
 *
 * Expected to be called by an external scheduler (Vercel Cron, GitHub
 * Actions, supabase scheduled function, ...). The scheduler must send
 * `Authorization: Bearer ${CRON_SECRET}`; the compare is timing-safe.
 *
 * On any failure the response body is intentionally opaque. Detailed
 * errors are written to server logs only — UUIDs and Supabase error
 * strings could span tenants and would leak through this route, which
 * is authenticated by a single static secret with no per-tenant binding.
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

  const pdfResult = await renderDuePdfs(supabase)

  const { data, error } = await supabase.rpc("drain_notification_outbox", {
    p_max_rows: 500,
  })

  if (error) {
    console.error("[cron/drain-notifications] drain failed:", error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  const row = Array.isArray(data) ? data[0] : data
  // Return counts only — never UUIDs or error strings.
  return NextResponse.json({
    ok: true,
    sent: row?.sent_count ?? 0,
    failed: row?.failed_count ?? 0,
    messages: row?.message_count ?? 0,
    pdf: {
      attempted: pdfResult.attempted,
      rendered: pdfResult.rendered,
      failed: pdfResult.failed,
    },
  })
}

/**
 * Constant-time bearer-token comparison. Hashes both sides so length
 * differences don't leak via Buffer length checks.
 */
function authorize(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const a = createHash("sha256").update(header).digest()
  const b = createHash("sha256").update(expected).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}

type PdfStats = {
  attempted: number
  rendered: number
  failed: number
}

async function renderDuePdfs(
  supabase: SupabaseClient<Database>,
): Promise<PdfStats> {
  const stats: PdfStats = { attempted: 0, rendered: 0, failed: 0 }

  const { data: rowsRaw, error: selErr } = await supabase
    .from("notification_outbox")
    .select("facility_id, source_module, source_record_id")
    .eq("status", "pending")
    .eq("attach_pdf", true)
    .is("pdf_url", null)
    .lte("scheduled_for", new Date().toISOString())
    .limit(200)

  if (selErr) {
    console.error("[cron/drain-notifications] outbox query failed:", selErr)
    return stats
  }

  const rows = (rowsRaw ?? []) as Array<{
    facility_id: string
    source_module: string
    source_record_id: string | null
  }>

  const seen = new Set<string>()
  const unique: Array<{
    facility_id: string
    source_module: string
    source_record_id: string
  }> = []
  for (const r of rows) {
    if (!r.source_record_id) continue
    const key = `${r.facility_id}/${r.source_module}/${r.source_record_id}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({
      facility_id: r.facility_id,
      source_module: r.source_module,
      source_record_id: r.source_record_id,
    })
  }

  for (const u of unique) {
    stats.attempted += 1
    try {
      const rendered = await renderPdfForModule(
        supabase,
        u.source_module,
        u.source_record_id,
      )
      if (!rendered) continue

      // Defence-in-depth: renderPdfForModule reads the source row with the
      // service-role client (RLS bypassed). A malformed outbox row
      // (attacker-controlled facility_id paired with a foreign
      // source_record_id) would otherwise let us render and upload the
      // foreign record into the outbox row's facility folder.
      if (rendered.facility_id !== u.facility_id) {
        console.warn(
          "[cron/drain-notifications] facility mismatch for outbox source",
          { outbox_facility: u.facility_id, snapshot_facility: rendered.facility_id },
        )
        stats.failed += 1
        continue
      }

      const path = await uploadSubmissionPdf(
        supabase,
        u.facility_id,
        u.source_module,
        u.source_record_id,
        rendered.buffer,
      )
      const { error: upErr } = await supabase
        .from("notification_outbox")
        .update({ pdf_url: path })
        .eq("facility_id", u.facility_id)
        .eq("source_module", u.source_module)
        .eq("source_record_id", u.source_record_id)
        .is("pdf_url", null)
      if (upErr) {
        stats.failed += 1
        console.error(
          "[cron/drain-notifications] outbox update failed:",
          upErr,
        )
        continue
      }
      stats.rendered += 1
    } catch (e) {
      stats.failed += 1
      console.error(
        "[cron/drain-notifications] render failed:",
        u.source_module,
        u.source_record_id,
        e,
      )
    }
  }

  return stats
}
