import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/observability/log-server-error"
import type { Database } from "@/types/database"

export type SchedulingEmail = {
  facilityId: string
  employeeId: string
  subject: string
  /** Plain-text body. Must be non-empty — the outbox drain copies it into
   * communication_messages.body, which is NOT NULL. */
  body: string
  /** Rows sharing (facility, subject, sourceRecordId) are grouped into ONE
   * message with many recipients by drain_notification_outbox. */
  sourceRecordId?: string | null
}

/**
 * Best-effort: queue scheduling emails through the communications pipeline
 * (notification_outbox → drain cron → communication_messages → email cron).
 *
 * notification_outbox blocks authenticated INSERTs by RLS (migration 49), so
 * this uses the service-role admin client — the same pattern as the
 * communications admin's outbox retry action. Failures are logged and
 * swallowed: email is a courtesy layered on top of the in-app
 * schedule_notifications inbox, and must never fail the primary write.
 */
/**
 * "Sat, Mar 8, 9:00 AM – 5:00 PM" — plain-text shift window for email bodies.
 *
 * `timeZone` is REQUIRED and must be the facility's. This module is
 * server-only, so an absent zone formats in the server's — UTC in production —
 * which put every shift reminder and cancellation notice hours off, and named
 * the wrong day for evening shifts. Pass null only when the facility genuinely
 * has no timezone set (the helpers then fall back to the runtime zone, the
 * same contract as the rest of @/lib/timezone).
 */
export function formatShiftWindow(
  startsAt: string,
  endsAt: string,
  timeZone: string | null
): string {
  const s = new Date(startsAt)
  const e = new Date(endsAt)
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timeZone ?? undefined,
  }).format(s)
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timeZone ?? undefined,
  })
  return `${day}, ${time.format(s)} – ${time.format(e)}`
}

/**
 * Facility timezone lookup for the notification paths, cached per call-site
 * batch. `schedule_notifications` / outbox sweeps can span many facilities
 * (the cron runs across all of them), so callers resolve a whole set at once
 * rather than issuing one query per row.
 */
export async function facilityTimezones(
  supabase: SupabaseClient<Database>,
  facilityIds: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(facilityIds)]
  if (unique.length === 0) return new Map()
  const { data } = await supabase
    .from("facilities")
    .select("id, timezone")
    .in("id", unique)
    .returns<{ id: string; timezone: string | null }[]>()
  return new Map((data ?? []).map((f) => [f.id, f.timezone ?? null]))
}

export async function queueSchedulingEmails(
  rows: SchedulingEmail[]
): Promise<void> {
  if (rows.length === 0) return
  try {
    const admin = createAdminClient()
    const { error } = await admin.from("notification_outbox").insert(
      rows.map((r) => ({
        facility_id: r.facilityId,
        recipient_employee_id: r.employeeId,
        source_module: "scheduling",
        source_record_id: r.sourceRecordId ?? null,
        subject: r.subject,
        body: r.body,
      }))
    )
    if (error) throw error
  } catch (e) {
    logServerError("admin/scheduling/_lib/notify-email", e, {
      count: rows.length,
    })
  }
}
