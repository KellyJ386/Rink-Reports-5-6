import { createHash, timingSafeEqual } from "node:crypto"

import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { mapWithConcurrency } from "@/lib/concurrency"
import { renderPdfForModule } from "@/lib/notifications/pdf/render"
import { uploadSubmissionPdf } from "@/lib/notifications/pdf/upload"
import { logServerError } from "@/lib/observability/log-server-error"
import type { Database } from "@/types/database"

// Force dynamic; service-role env vars must not be evaluated at build.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// Cap CPU exposure for unauthorised callers and PDF render heavy batches.
export const maxDuration = 60

// @react-pdf renderToBuffer is CPU-bound. Render a few at a time so a burst
// finishes faster than the strict sequential loop, but keep the pool small so
// we don't starve the event loop / exhaust memory on the serverless box.
const PDF_CONCURRENCY = 4
// Stop STARTING new renders once we've burned this much of the maxDuration
// budget. Anything left with pdf_url IS NULL is simply picked up next tick.
const PDF_TIME_BUDGET_MS = 50_000
// Sentinel prefix recorded in notification_outbox.error for poison-pill rows
// that can never succeed (e.g. facility mismatch). Such rows are skipped on
// subsequent runs instead of being retried forever.
const PERMANENT_ERROR_PREFIX = "PERMANENT:"

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

  const startedAt = Date.now()
  const pdfResult = await renderDuePdfs(supabase, startedAt)

  const { data, error } = await supabase.rpc("drain_notification_outbox", {
    p_max_rows: 500,
  })

  if (error) {
    logServerError("cron/drain-notifications", error, { step: "drain" })
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  const row = Array.isArray(data) ? data[0] : data
  const summary = {
    route: "/api/cron/drain-notifications",
    duration_ms: Date.now() - startedAt,
    sent: row?.sent_count ?? 0,
    failed: row?.failed_count ?? 0,
    messages: row?.message_count ?? 0,
    pdf_attempted: pdfResult.attempted,
    pdf_rendered: pdfResult.rendered,
    pdf_failed: pdfResult.failed,
    pdf_skipped: pdfResult.skipped,
    pdf_budget_exhausted: pdfResult.budgetExhausted,
  }
  console.log("[cron/drain-notifications] run complete", JSON.stringify(summary))
  // Return counts only — never UUIDs or error strings.
  return NextResponse.json({
    ok: true,
    sent: summary.sent,
    failed: summary.failed,
    messages: summary.messages,
    pdf: {
      attempted: pdfResult.attempted,
      rendered: pdfResult.rendered,
      failed: pdfResult.failed,
      skipped: pdfResult.skipped,
      budget_exhausted: pdfResult.budgetExhausted,
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
  // Poison-pill rows skipped because a prior run recorded a permanent error.
  skipped: number
  // True if we stopped starting renders because the time budget was hit;
  // the leftover rows (still pdf_url IS NULL) get picked up next tick.
  budgetExhausted: boolean
}

type OutboxPdfRow = {
  facility_id: string
  source_module: string
  source_record_id: string | null
  error: string | null
}

type UniquePdfTarget = {
  facility_id: string
  source_module: string
  source_record_id: string
}

async function renderDuePdfs(
  supabase: SupabaseClient<Database>,
  startedAt: number,
): Promise<PdfStats> {
  const stats: PdfStats = {
    attempted: 0,
    rendered: 0,
    failed: 0,
    skipped: 0,
    budgetExhausted: false,
  }

  const { data: rowsRaw, error: selErr } = await supabase
    .from("notification_outbox")
    .select("facility_id, source_module, source_record_id, error")
    .eq("status", "pending")
    .eq("attach_pdf", true)
    .is("pdf_url", null)
    .lte("scheduled_for", new Date().toISOString())
    .limit(200)

  if (selErr) {
    logServerError("cron/drain-notifications", selErr, { step: "outbox query" })
    return stats
  }

  const rows = (rowsRaw ?? []) as OutboxPdfRow[]

  const seen = new Set<string>()
  const unique: UniquePdfTarget[] = []
  for (const r of rows) {
    if (!r.source_record_id) continue
    // Poison-pill: a prior run flagged this (facility/module/record) as
    // permanently un-renderable (e.g. facility mismatch). Skip it instead of
    // retrying forever and burning the time budget.
    if (r.error?.startsWith(PERMANENT_ERROR_PREFIX)) {
      stats.skipped += 1
      continue
    }
    const key = `${r.facility_id}/${r.source_module}/${r.source_record_id}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({
      facility_id: r.facility_id,
      source_module: r.source_module,
      source_record_id: r.source_record_id,
    })
  }

  // Render with bounded concurrency. Each task self-checks the elapsed-time
  // budget before STARTING a render; once the budget is hit, remaining tasks
  // short-circuit so the run returns cleanly and leftover rows are retried
  // next tick. Settle-all semantics (mapWithConcurrency) mean one failing
  // record can't abort the batch.
  await mapWithConcurrency(unique, PDF_CONCURRENCY, async (u) => {
    if (Date.now() - startedAt > PDF_TIME_BUDGET_MS) {
      stats.budgetExhausted = true
      return
    }
    stats.attempted += 1
    await renderAndStampOne(supabase, u, stats)
  })

  return stats
}

async function renderAndStampOne(
  supabase: SupabaseClient<Database>,
  u: UniquePdfTarget,
  stats: PdfStats,
): Promise<void> {
  try {
    const rendered = await renderPdfForModule(
      supabase,
      u.source_module,
      u.source_record_id,
    )
    if (!rendered) return

    // Defence-in-depth: renderPdfForModule reads the source row with the
    // service-role client (RLS bypassed). A malformed outbox row
    // (attacker-controlled facility_id paired with a foreign
    // source_record_id) would otherwise let us render and upload the
    // foreign record into the outbox row's facility folder. A mismatch can
    // never succeed, so record it as a PERMANENT poison-pill error.
    if (rendered.facility_id !== u.facility_id) {
      console.warn(
        "[cron/drain-notifications] facility mismatch for outbox source",
        { outbox_facility: u.facility_id, snapshot_facility: rendered.facility_id },
      )
      stats.failed += 1
      await recordOutboxError(
        supabase,
        u,
        `${PERMANENT_ERROR_PREFIX} facility mismatch`,
      )
      return
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
      logServerError("cron/drain-notifications", upErr, { step: "outbox update" })
      return
    }
    stats.rendered += 1
  } catch (e) {
    // Transient (or unknown) failure: record the message but leave the row
    // pending so it retries next run. Do NOT mark it permanent.
    stats.failed += 1
    logServerError("cron/drain-notifications", e, {
      step: "render",
      source_module: u.source_module,
      source_record_id: u.source_record_id,
    })
    await recordOutboxError(
      supabase,
      u,
      e instanceof Error ? e.message : "render failed",
    )
  }
}

/**
 * Records the last error onto the matching pending outbox rows. Best-effort:
 * a failure here only loses diagnostics, the row is still retried next run
 * (unless `message` carries the PERMANENT_ERROR_PREFIX). Scoped to pdf_url
 * IS NULL so we never clobber a row another worker just succeeded on.
 */
async function recordOutboxError(
  supabase: SupabaseClient<Database>,
  u: UniquePdfTarget,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from("notification_outbox")
    .update({ error: message.slice(0, 500) })
    .eq("facility_id", u.facility_id)
    .eq("source_module", u.source_module)
    .eq("source_record_id", u.source_record_id)
    .is("pdf_url", null)
  if (error) {
    logServerError("cron/drain-notifications", error, {
      step: "record outbox error",
    })
  }
}
