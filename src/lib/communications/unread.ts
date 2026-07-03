import "server-only"

import { createClient } from "@/lib/supabase/server"

/**
 * Unread communications count for the CURRENT session user in a facility:
 * unread message deliveries (communication_recipients.read_at is null) plus
 * unresolved ack-required alerts the user hasn't acknowledged yet.
 *
 * `facilityId` must be server-resolved. Fails to 0 — a badge is decoration,
 * never worth an error page. Every query is additionally RLS-scoped.
 */
export async function getCommunicationsUnreadCount(
  facilityId: string | null | undefined,
): Promise<number> {
  if (!facilityId) return 0
  try {
    const supabase = await createClient()

    const { data: userRes } = await supabase.auth.getUser()
    const userId = userRes?.user?.id
    if (!userId) return 0

    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", userId)
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle()
    if (!employee) return 0

    const [{ count: unreadMessages }, alertsRes] = await Promise.all([
      supabase
        .from("communication_recipients")
        .select("id", { count: "exact", head: true })
        .eq("facility_id", facilityId)
        .eq("employee_id", employee.id)
        .is("read_at", null),
      supabase
        .from("communication_alerts")
        .select("id")
        .eq("facility_id", facilityId)
        .eq("requires_acknowledgement", true)
        .is("resolved_at", null)
        .limit(200),
    ])

    const alertIds = (alertsRes.data ?? []).map((a) => a.id)
    let unackedAlerts = 0
    if (alertIds.length > 0) {
      const { data: acks } = await supabase
        .from("communication_acknowledgements")
        .select("alert_id")
        .eq("employee_id", employee.id)
        .in("alert_id", alertIds)
      const acked = new Set((acks ?? []).map((a) => a.alert_id))
      unackedAlerts = alertIds.filter((id) => !acked.has(id)).length
    }

    return (unreadMessages ?? 0) + unackedAlerts
  } catch {
    return 0
  }
}
