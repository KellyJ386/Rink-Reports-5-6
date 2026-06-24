import { createHash, timingSafeEqual } from "node:crypto"

import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

import { nextRunAfter } from "@/lib/cron/cron-schedule"
import type { Database } from "@/types/database"
import { logServerError } from "@/lib/observability/log-server-error"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

const BATCH_LIMIT = 200

/**
 * Recurring-communications scheduler.
 *
 * Each tick: load active reminders whose next_run_at is due (or uninitialized),
 * and for each one fire the template to its target (group or role) by creating
 * a communication_messages row + pending communication_recipients rows — the
 * SAME pipeline a manual broadcast uses, so /api/cron/send-communications emails
 * them and they appear in the in-app inbox. Then advance next_run_at via the
 * cron expression (evaluated in the facility's timezone).
 *
 * Authenticated by CRON_SECRET (Authorization: Bearer <secret>), like the other
 * cron routes. Double-fire safe: next_run_at is claimed with a conditional
 * UPDATE before dispatch, so an overlapping tick that lost the race dispatches
 * nothing.
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
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
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
  const stats = await runReminders(supabase)

  console.log(
    "[cron/run-reminders] run complete",
    JSON.stringify({
      route: "/api/cron/run-reminders",
      duration_ms: Date.now() - startedAt,
      ...stats,
    }),
  )

  return NextResponse.json({ ok: true, ...stats })
}

type Stats = {
  considered: number
  initialized: number
  fired: number
  recipients: number
  skipped: number
}

type ReminderRow = {
  id: string
  facility_id: string
  schedule_cron: string
  template_id: string
  target_group_id: string | null
  target_role_key: string | null
  next_run_at: string | null
  facilities: { timezone: string | null } | { timezone: string | null }[] | null
}

async function runReminders(supabase: SupabaseClient<Database>): Promise<Stats> {
  const stats: Stats = {
    considered: 0,
    initialized: 0,
    fired: 0,
    recipients: 0,
    skipped: 0,
  }
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from("communication_recurring_reminders")
    .select(
      "id, facility_id, schedule_cron, template_id, target_group_id, target_role_key, next_run_at, facilities!inner(timezone)",
    )
    .eq("is_active", true)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT)

  if (error) {
    logServerError("cron/run-reminders", error, { step: "load" })
    return stats
  }

  for (const raw of (data ?? []) as ReminderRow[]) {
    stats.considered += 1
    const tz =
      (Array.isArray(raw.facilities) ? raw.facilities[0] : raw.facilities)
        ?.timezone || "UTC"
    const now = new Date()
    const nextRun = nextRunAfter(raw.schedule_cron, now, tz)

    // Uninitialized reminder (or broken cron): set its next slot and don't fire
    // this tick. A malformed cron yields null next_run_at and never fires.
    if (raw.next_run_at === null) {
      await supabase
        .from("communication_recurring_reminders")
        .update({ next_run_at: nextRun ? nextRun.toISOString() : null })
        .eq("id", raw.id)
        .is("next_run_at", null)
      if (nextRun) stats.initialized += 1
      else stats.skipped += 1
      continue
    }

    // Claim the run: advance next_run_at conditionally on its current value so
    // an overlapping tick can't double-fire. Only the winner proceeds.
    const { data: claimed } = await supabase
      .from("communication_recurring_reminders")
      .update({
        last_run_at: now.toISOString(),
        next_run_at: nextRun ? nextRun.toISOString() : null,
      })
      .eq("id", raw.id)
      .eq("next_run_at", raw.next_run_at)
      .select("id")
      .maybeSingle()

    if (!claimed) {
      stats.skipped += 1
      continue
    }

    const fanned = await dispatchReminder(supabase, raw)
    if (fanned > 0) {
      stats.fired += 1
      stats.recipients += fanned
    } else {
      stats.skipped += 1
    }
  }

  return stats
}

async function resolveRecipientIds(
  supabase: SupabaseClient<Database>,
  reminder: ReminderRow,
): Promise<string[]> {
  if (reminder.target_group_id) {
    const { data } = await supabase
      .from("communication_group_members")
      .select("employee_id")
      .eq("group_id", reminder.target_group_id)
    return [...new Set((data ?? []).map((r) => r.employee_id))]
  }
  if (reminder.target_role_key) {
    const { data: roleRows } = await supabase
      .from("roles")
      .select("id")
      .eq("facility_id", reminder.facility_id)
      .eq("key", reminder.target_role_key)
    const roleIds = (roleRows ?? []).map((r) => r.id)
    if (roleIds.length === 0) return []
    const { data: emps } = await supabase
      .from("employees")
      .select("id")
      .eq("facility_id", reminder.facility_id)
      .eq("is_active", true)
      .in("role_id", roleIds)
    return [...new Set((emps ?? []).map((e) => e.id))]
  }
  return []
}

/** Returns the number of recipients fanned out (0 = nothing sent). */
async function dispatchReminder(
  supabase: SupabaseClient<Database>,
  reminder: ReminderRow,
): Promise<number> {
  const { data: template } = await supabase
    .from("communication_templates")
    .select("subject, body, requires_acknowledgement")
    .eq("id", reminder.template_id)
    .eq("facility_id", reminder.facility_id)
    .maybeSingle()
  if (!template) return 0

  const employeeIds = await resolveRecipientIds(supabase, reminder)
  if (employeeIds.length === 0) return 0

  const { data: message, error: msgErr } = await supabase
    .from("communication_messages")
    .insert({
      facility_id: reminder.facility_id,
      sender_employee_id: null,
      template_id: reminder.template_id,
      subject: template.subject,
      body: template.body,
      requires_acknowledgement: template.requires_acknowledgement ?? false,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (msgErr || !message) {
    logServerError("cron/run-reminders", msgErr, {
      step: "insert_message",
      reminder_id: reminder.id,
    })
    return 0
  }

  const recipientRows = employeeIds.map((employee_id) => ({
    facility_id: reminder.facility_id,
    message_id: message.id,
    employee_id,
    email_status: "pending",
  }))
  const { error: recErr } = await supabase
    .from("communication_recipients")
    .insert(recipientRows)
  if (recErr) {
    // Roll back the now-orphaned message shell (best-effort).
    await supabase.from("communication_messages").delete().eq("id", message.id)
    logServerError("cron/run-reminders", recErr, {
      step: "insert_recipients",
      reminder_id: reminder.id,
    })
    return 0
  }

  return recipientRows.length
}

function authorize(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = `Bearer ${secret}`
  const a = createHash("sha256").update(header).digest()
  const b = createHash("sha256").update(expected).digest()
  return a.length === b.length && timingSafeEqual(a, b)
}
