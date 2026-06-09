import { createHash, timingSafeEqual } from "node:crypto"

import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { mapWithConcurrency } from "@/lib/concurrency"
import { downloadPdf } from "@/lib/notifications/pdf/upload"
import { isEmailConfigured, sendEmail } from "@/lib/notifications/transport/email"
import type { Database } from "@/types/database"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

const BATCH_LIMIT = 100

// Send a handful of emails concurrently. Resend's default rate limit is
// ~10 req/s, so cap at 8 in-flight to stay comfortably under it while still
// collapsing the previously-sequential per-row Resend round-trips.
const EMAIL_CONCURRENCY = 8
// Stop STARTING new sends once we've burned this much of the maxDuration
// budget. Rows we don't reach stay 'pending' (untouched) and are picked up
// on the next tick.
const EMAIL_TIME_BUDGET_MS = 50_000

// Retry budget. The schedule below is total elapsed before the row is
// marked terminally 'failed':
//   attempt 1 fails  → next retry in 1m
//   attempt 2 fails  → next retry in 5m
//   attempt 3 fails  → next retry in 15m
//   attempt 4 fails  → next retry in 1h
//   attempt 5 fails  → terminal 'failed' (~7.3 hours total)
// Add new tiers to BACKOFF_MINUTES if more leniency is wanted; MAX_EMAIL_ATTEMPTS
// is implicitly its length + 1 (the +1 is the in-flight attempt before any wait).
const BACKOFF_MINUTES = [1, 5, 15, 60] as const
const MAX_EMAIL_ATTEMPTS = BACKOFF_MINUTES.length + 1

/**
 * Sends queued communication_recipients rows via Resend.
 *
 * Authenticated by the same CRON_SECRET as /api/cron/drain-notifications.
 * The drain worker should run first (promote outbox → recipients), then
 * this worker picks up the pending rows.
 *
 * Idempotency: email_status is only ever advanced from 'pending'. A re-run
 * won't double-send because the UPDATE filters on `email_status='pending'`,
 * and on conflict the second writer simply matches zero rows.
 *
 * If Resend is unconfigured (RESEND_API_KEY / RESEND_FROM missing) the
 * worker skips entirely — pending rows stay pending so they retry once
 * secrets are provisioned. We do NOT mark 'skipped' on missing config,
 * only on missing email address, so adding the API key later still
 * flushes the backlog.
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
  const email = isEmailConfigured() ? await runEmail(supabase) : SKIPPED

  console.log(
    "[cron/send-communications] run complete",
    JSON.stringify({
      route: "/api/cron/send-communications",
      duration_ms: Date.now() - startedAt,
      configured: email.configured,
      attempted: email.attempted,
      sent: email.sent,
      failed: email.failed,
      retried: email.retried,
      skipped: email.skipped,
    }),
  )

  return NextResponse.json({ ok: true, email })
}

type ChannelStats = {
  configured: boolean
  attempted: number
  sent: number
  failed: number   // terminal failures (max attempts exceeded)
  retried: number  // transient failures scheduled for a later attempt
  skipped: number
}

const SKIPPED: ChannelStats = {
  configured: false,
  attempted: 0,
  sent: 0,
  failed: 0,
  retried: 0,
  skipped: 0,
}

type RecipientRow = {
  id: string
  message_id: string
  attempts: number
  employee: { email: string | null } | null
  message: {
    subject: string | null
    body: string
    pdf_url: string | null
  } | null
}

async function loadPending(
  supabase: SupabaseClient<Database>,
): Promise<RecipientRow[]> {
  const nowIso = new Date().toISOString()
  // email_attempts / email_next_attempt_at are added in migration 62 and
  // not yet in generated DB types — cast to bypass typing for those columns.
  const { data, error } = await supabase
    .from("communication_recipients")
    .select(
      "id, message_id, email_attempts, employees!inner(email), communication_messages!inner(subject, body, pdf_url)",
    )
    .eq("email_status", "pending")
    .or(`email_next_attempt_at.is.null,email_next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT)

  if (error) {
    console.error("[send-communications] load failed:", error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
    const msg = Array.isArray(r.communication_messages)
      ? r.communication_messages[0]
      : r.communication_messages
    return {
      id: r.id,
      message_id: r.message_id,
      attempts: typeof r.email_attempts === "number" ? r.email_attempts : 0,
      employee: emp ?? null,
      message: msg ?? null,
    }
  })
}

async function runEmail(
  supabase: SupabaseClient<Database>,
): Promise<ChannelStats> {
  const stats: ChannelStats = {
    configured: true,
    attempted: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
  }
  const rows = await loadPending(supabase)
  const startedAt = Date.now()

  // A single message often fans out to many recipients; cache PDF bytes
  // per storage path so we don't redownload N times in one batch. We cache
  // the in-flight *promise* (not the resolved buffer) so concurrent rows
  // sharing a pdf_url coalesce onto a single download. A resolved value of
  // `null` means "we tried and the object wasn't reachable".
  const pdfCache = new Map<string, Promise<Buffer | null>>()
  const loadPdf = (pdfPath: string): Promise<Buffer | null> => {
    const cached = pdfCache.get(pdfPath)
    if (cached) return cached
    const p = downloadPdf(supabase, pdfPath).then((buf) => {
      if (!buf) {
        // Log once per path — falling through to a text-only send is
        // better than blocking the whole run on a single missing PDF.
        console.warn(
          "[send-communications] PDF download failed; sending text-only",
          { pdf_url: pdfPath },
        )
      }
      return buf
    })
    pdfCache.set(pdfPath, p)
    return p
  }

  // Send with bounded concurrency. Each task self-checks the elapsed-time
  // budget before STARTING; once the budget is hit the remaining tasks
  // short-circuit, leaving their rows untouched ('pending') for the next
  // tick. Settle-all semantics keep one failing row from aborting the batch;
  // per-row outcome handling (sent / retry-with-backoff / terminal-failure)
  // and the email_status='pending' double-send guard are preserved exactly.
  await mapWithConcurrency(rows, EMAIL_CONCURRENCY, async (r) => {
    if (Date.now() - startedAt > EMAIL_TIME_BUDGET_MS) return
    await sendOne(supabase, r, loadPdf, stats)
  })

  return stats
}

async function sendOne(
  supabase: SupabaseClient<Database>,
  r: RecipientRow,
  loadPdf: (pdfPath: string) => Promise<Buffer | null>,
  stats: ChannelStats,
): Promise<void> {
  stats.attempted += 1
  const to = r.employee?.email?.trim()
  if (!to) {
    await markEmailSkipped(supabase, r.id, "no email")
    stats.skipped += 1
    return
  }
  const subject = r.message?.subject?.trim() || "New message"
  const body = r.message?.body ?? ""

  const pdfPath = r.message?.pdf_url ?? null
  const pdfBuffer = pdfPath ? await loadPdf(pdfPath) : null

  const attachments = pdfBuffer
    ? [{ filename: "rink-report.pdf", content: pdfBuffer, contentType: "application/pdf" }]
    : undefined

  // sendEmail() never throws: it returns { ok:false, error } for any
  // failure including Resend 429/5xx and network errors. All non-ok results
  // are treated as transient and pushed through the existing backoff ladder
  // until MAX_EMAIL_ATTEMPTS, at which point the row is marked terminally
  // failed. This preserves the original error-handling behaviour.
  const result = await sendEmail({ to, subject, bodyText: body, attachments })
  const nextAttempts = r.attempts + 1
  if (result.ok) {
    await markEmailSent(supabase, r.id, new Date().toISOString(), nextAttempts)
    stats.sent += 1
  } else if (nextAttempts >= MAX_EMAIL_ATTEMPTS) {
    await markEmailTerminalFailure(supabase, r.id, nextAttempts, result.error)
    stats.failed += 1
  } else {
    const backoffMin = BACKOFF_MINUTES[nextAttempts - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]
    const nextAttemptAt = new Date(Date.now() + backoffMin * 60_000).toISOString()
    await markEmailRetry(
      supabase,
      r.id,
      nextAttempts,
      nextAttemptAt,
      result.error,
    )
    stats.retried += 1
  }
}

async function markEmailSent(
  supabase: SupabaseClient<Database>,
  recipientId: string,
  sentAt: string,
  attempts: number,
) {
  // Filter on email_status='pending' so concurrent workers can't double-send.
  await supabase
    .from("communication_recipients")
    .update({
      email_status: "sent",
      email_sent_at: sentAt,
      email_error: null,
      email_attempts: attempts,
      email_next_attempt_at: null,
    })
    .eq("id", recipientId)
    .eq("email_status", "pending")
}

async function markEmailSkipped(
  supabase: SupabaseClient<Database>,
  recipientId: string,
  error: string,
) {
  await supabase
    .from("communication_recipients")
    .update({
      email_status: "skipped",
      email_sent_at: null,
      email_error: error,
    })
    .eq("id", recipientId)
    .eq("email_status", "pending")
}

async function markEmailRetry(
  supabase: SupabaseClient<Database>,
  recipientId: string,
  attempts: number,
  nextAttemptAt: string,
  error: string,
) {
  await supabase
    .from("communication_recipients")
    .update({
      email_status: "pending",
      email_attempts: attempts,
      email_next_attempt_at: nextAttemptAt,
      email_error: error,
    })
    .eq("id", recipientId)
    .eq("email_status", "pending")
}

async function markEmailTerminalFailure(
  supabase: SupabaseClient<Database>,
  recipientId: string,
  attempts: number,
  error: string,
) {
  await supabase
    .from("communication_recipients")
    .update({
      email_status: "failed",
      email_attempts: attempts,
      email_next_attempt_at: null,
      email_error: error,
    })
    .eq("id", recipientId)
    .eq("email_status", "pending")
}

function authorize(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const a = createHash("sha256").update(header).digest()
  const b = createHash("sha256").update(expected).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}
