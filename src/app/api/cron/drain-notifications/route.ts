import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { renderSubmissionPdf } from "@/lib/notifications/pdf/render"
import { fetchSubmissionSnapshot } from "@/lib/notifications/pdf/snapshot"
import { uploadSubmissionPdf } from "@/lib/notifications/pdf/upload"
import type { Database } from "@/types/database"

// Force dynamic; service-role env vars must not be evaluated at build.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Drains notification_outbox by invoking drain_notification_outbox().
 *
 * Before draining, picks any due outbox rows with attach_pdf=true /
 * pdf_url IS NULL, deduplicates by (facility_id, source_record_id),
 * renders + uploads the PDF, and writes the storage path back onto the
 * outbox rows. The SQL drain then copies pdf_url onto the resulting
 * communication_messages row.
 *
 * PDF rendering failures don't block the drain: the row keeps pdf_url
 * NULL, the message goes out without an attachment, and an error is
 * logged. This keeps the in-app notification arriving on time even
 * when a single source record is malformed.
 *
 * Expected to be called by an external scheduler (Vercel Cron, GitHub
 * Actions, supabase scheduled function, ...). The scheduler must send
 * `Authorization: Bearer ${CRON_SECRET}`. Service-role key is required.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 503 },
    )
  }

  const authHeader = request.headers.get("authorization") ?? ""
  if (authHeader !== `Bearer ${secret}`) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    "drain_notification_outbox",
    { p_max_rows: 500 },
  )

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message, pdf: pdfResult },
      { status: 500 },
    )
  }

  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    ok: true,
    sent: row?.sent_count ?? 0,
    failed: row?.failed_count ?? 0,
    messages: row?.message_count ?? 0,
    pdf: pdfResult,
  })
}

type PdfStats = {
  attempted: number
  rendered: number
  failed: number
  errors: string[]
}

async function renderDuePdfs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<PdfStats> {
  const stats: PdfStats = { attempted: 0, rendered: 0, failed: 0, errors: [] }

  // Pull due rows that still need a PDF. Limit aggressively — heavy
  // batches risk exceeding the cron route's serverless timeout.
  const { data: rowsRaw, error: selErr } = await supabase
    .from("notification_outbox")
    .select("facility_id, source_module, source_record_id")
    .eq("status", "pending")
    .eq("attach_pdf", true)
    .is("pdf_url", null)
    .lte("scheduled_for", new Date().toISOString())
    .limit(200)

  if (selErr) {
    stats.errors.push(`outbox query: ${selErr.message}`)
    return stats
  }

  const rows = (rowsRaw ?? []) as Array<{
    facility_id: string
    source_module: string
    source_record_id: string | null
  }>

  // Dedupe by (facility, source_record) — one PDF per source event even
  // when many recipients are queued for it.
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
      const snapshot = await fetchSubmissionSnapshot(
        supabase,
        u.source_module,
        u.source_record_id,
      )
      if (!snapshot) {
        // No fetcher / record deleted — leave pdf_url null. Don't count
        // as an error; the message still sends without an attachment.
        continue
      }
      const buffer = await renderSubmissionPdf(snapshot)
      const path = await uploadSubmissionPdf(
        supabase,
        u.facility_id,
        u.source_module,
        u.source_record_id,
        buffer,
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
        stats.errors.push(`update ${u.source_record_id}: ${upErr.message}`)
        continue
      }
      stats.rendered += 1
    } catch (e) {
      stats.failed += 1
      const msg = e instanceof Error ? e.message : String(e)
      stats.errors.push(`${u.source_module}/${u.source_record_id}: ${msg}`)
      console.error(
        `[notifications/pdf] render failed for ${u.source_module}/${u.source_record_id}:`,
        e,
      )
    }
  }

  return stats
}
