// Shared shift-reminder sweep, used by BOTH:
//  - the manual "Send shift reminders" admin action (RLS-scoped client,
//    facility-filtered), and
//  - the scheduling cron route (service-role client, all facilities),
// so the window/dedup semantics can't drift between the two.
//
// Plain module (not "use server"): callers pass their own Supabase client.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database"

import { formatShiftWindow, queueSchedulingEmails } from "./notify-email"

type AnyClient = SupabaseClient<Database>

export type ReminderSweepResult =
  | { ok: true; sent: number }
  | { ok: false; error: string }

/**
 * Send an in-app reminder (+ best-effort email) to every employee with a
 * published shift starting within the next `windowHours`. De-duplicated per
 * shift via the existing `shift_reminder` rows in schedule_notifications, so
 * repeated sweeps (cron every 10 minutes) never double-remind.
 */
export async function sendDueShiftReminders(
  supabase: AnyClient,
  opts: { facilityId?: string; windowHours?: number } = {}
): Promise<ReminderSweepResult> {
  const hours =
    Number.isFinite(opts.windowHours) && (opts.windowHours ?? 0) >= 1
      ? Math.min(opts.windowHours as number, 168)
      : 24

  const now = new Date()
  const cutoff = new Date(now.getTime() + hours * 60 * 60 * 1000)

  let shiftQuery = supabase
    .from("schedule_shifts")
    .select("id, facility_id, employee_id, starts_at, ends_at")
    .eq("status", "published")
    .not("employee_id", "is", null)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", cutoff.toISOString())
  if (opts.facilityId) {
    shiftQuery = shiftQuery.eq("facility_id", opts.facilityId)
  }
  const { data: shiftsRaw, error: shiftErr } = await shiftQuery
  if (shiftErr) {
    return { ok: false, error: shiftErr.message ?? "Failed to load shifts." }
  }

  const shifts = (shiftsRaw ?? []) as Array<{
    id: string
    facility_id: string
    employee_id: string
    starts_at: string
    ends_at: string
  }>
  if (shifts.length === 0) return { ok: true, sent: 0 }

  const shiftIds = shifts.map((s) => s.id)
  const { data: existingRaw, error: existErr } = await supabase
    .from("schedule_notifications")
    .select("shift_id")
    .eq("notification_type", "shift_reminder")
    .in("shift_id", shiftIds)
  if (existErr) {
    return {
      ok: false,
      error: existErr.message ?? "Failed to load prior reminders.",
    }
  }
  const alreadySent = new Set(
    ((existingRaw ?? []) as Array<{ shift_id: string | null }>)
      .map((r) => r.shift_id)
      .filter((x): x is string => !!x)
  )

  const toSend = shifts.filter((s) => !alreadySent.has(s.id))
  if (toSend.length === 0) return { ok: true, sent: 0 }

  const { error: insErr } = await supabase.from("schedule_notifications").insert(
    toSend.map((s) => ({
      facility_id: s.facility_id,
      employee_id: s.employee_id,
      notification_type: "shift_reminder" as const,
      shift_id: s.id,
      payload: {
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        message: `Reminder: your shift starts soon.`,
      },
    }))
  )
  if (insErr) {
    return { ok: false, error: insErr.message ?? "Failed to send reminders." }
  }

  await queueSchedulingEmails(
    toSend.map((s) => ({
      facilityId: s.facility_id,
      employeeId: s.employee_id,
      subject: "Shift reminder",
      body: `Reminder: you have a shift on ${formatShiftWindow(s.starts_at, s.ends_at)}.`,
      sourceRecordId: s.id,
    }))
  )

  return { ok: true, sent: toSend.length }
}
