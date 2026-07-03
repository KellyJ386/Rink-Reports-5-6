import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/observability/log-server-error"

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
/** "Sat, Mar 8, 9:00 AM – 5:00 PM" — plain-text shift window for email bodies. */
export function formatShiftWindow(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt)
  const e = new Date(endsAt)
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(s)
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  return `${day}, ${time.format(s)} – ${time.format(e)}`
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
