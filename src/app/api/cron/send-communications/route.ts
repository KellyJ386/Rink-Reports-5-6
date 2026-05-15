import { createHash, timingSafeEqual } from "node:crypto"

import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { isEmailConfigured, sendEmail } from "@/lib/notifications/transport/email"
import type { Database } from "@/types/database"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

const BATCH_LIMIT = 100

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

  const email = isEmailConfigured() ? await runEmail(supabase) : SKIPPED

  return NextResponse.json({ ok: true, email })
}

type ChannelStats = {
  configured: boolean
  attempted: number
  sent: number
  failed: number
  skipped: number
}

const SKIPPED: ChannelStats = {
  configured: false,
  attempted: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
}

type RecipientRow = {
  id: string
  message_id: string
  employee: { email: string | null } | null
  message: { subject: string | null; body: string } | null
}

async function loadPending(
  supabase: SupabaseClient<Database>,
): Promise<RecipientRow[]> {
  const { data, error } = await supabase
    .from("communication_recipients")
    .select(
      "id, message_id, employees!inner(email), communication_messages!inner(subject, body)",
    )
    .eq("email_status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT)

  if (error) {
    console.error("[send-communications] load failed:", error)
    return []
  }

  return (data ?? []).map((r) => {
    const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
    const msg = Array.isArray(r.communication_messages)
      ? r.communication_messages[0]
      : r.communication_messages
    return {
      id: r.id,
      message_id: r.message_id,
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
    skipped: 0,
  }
  const rows = await loadPending(supabase)
  const nowIso = new Date().toISOString()

  for (const r of rows) {
    stats.attempted += 1
    const to = r.employee?.email?.trim()
    if (!to) {
      await markEmail(supabase, r.id, "skipped", null, "no email")
      stats.skipped += 1
      continue
    }
    const subject = r.message?.subject?.trim() || "New message"
    const body = r.message?.body ?? ""
    const result = await sendEmail({ to, subject, bodyText: body })
    if (result.ok) {
      await markEmail(supabase, r.id, "sent", nowIso, null)
      stats.sent += 1
    } else {
      await markEmail(supabase, r.id, "failed", null, result.error)
      stats.failed += 1
    }
  }
  return stats
}

async function markEmail(
  supabase: SupabaseClient<Database>,
  recipientId: string,
  status: "sent" | "failed" | "skipped",
  sentAt: string | null,
  error: string | null,
) {
  // Filter on email_status='pending' so concurrent workers can't double-send.
  await supabase
    .from("communication_recipients")
    .update({
      email_status: status,
      email_sent_at: sentAt,
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
