import "server-only"

import { createClient } from "@/lib/supabase/server"
import {
  OPEN_SHIFT_WINDOW_DAYS,
  selectClaimableOpenShifts,
  type OpenShiftRow,
} from "@/app/reports/scheduling/_lib/open-shifts"

/**
 * "Something waiting for you in scheduling" count for the CURRENT session user:
 * unread schedule_notifications (schedule published, time-off decided, swap
 * approved, a shift drop decided, …) plus shifts open for them to pick up.
 *
 * Both halves are things a person would want to act on, and both are what the
 * badge is promising when it draws attention to the tile. The open-shift half
 * uses the SAME window and filter as the lists on the scheduling hub and My
 * Schedule (src/app/reports/scheduling/_lib/open-shifts.ts), so the number on
 * the tile always matches what you find when you tap it.
 *
 * `facilityId` must be server-resolved. Fails to 0 — a badge is decoration,
 * never worth an error page. No explicit permission check is needed: both
 * reads are RLS-scoped and schedule_open_shifts_select already requires
 * has_module_access('scheduling'), so a user without access counts nothing.
 */
export async function getSchedulingBadgeCount(
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

    const [{ count: unreadNotifications }, openRes] = await Promise.all([
      supabase
        .from("schedule_notifications")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", employee.id)
        .is("read_at", null),
      supabase
        .from("schedule_open_shifts")
        .select(
          "id, approval_required, claim_status, claimed_by_employee_id, " +
            "schedule_shifts(id, starts_at, ends_at, role_label, department_id, departments(name))",
        )
        .eq("facility_id", facilityId)
        .eq("claim_status", "open"),
    ])

    const now = Date.now()
    // No cap here: the badge should say how many shifts are actually going
    // spare, even when the list itself only renders the first few.
    const claimable = selectClaimableOpenShifts(
      (openRes.data ?? []) as unknown as OpenShiftRow[],
      {
        nowMs: now,
        windowEndMs: now + OPEN_SHIFT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        limit: Number.MAX_SAFE_INTEGER,
      },
    )

    return (unreadNotifications ?? 0) + claimable.length
  } catch {
    return 0
  }
}
