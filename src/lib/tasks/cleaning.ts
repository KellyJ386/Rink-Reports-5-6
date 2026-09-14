import "server-only"

import { createClient } from "@/lib/supabase/server"

export type CleaningTask = {
  id: string
  scheduled_for: string
  status: "scheduled" | "completed" | "cancelled"
  assignment_route: string | null
  facility_locker_rooms: { name: string; short_code: string } | null
}

/**
 * Loads only the current employee's locker-room work. The employee/facility
 * filters make the intended authorization visible here; database RLS remains
 * the enforcement boundary and applies the same facility + recipient checks.
 */
export async function getMyCleaningTasks(): Promise<CleaningTask[]> {
  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()
  if (!userResult.user) return []

  const { data: employee } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", userResult.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  if (!employee) return []

  const { data } = await supabase
    .from("locker_room_cleaning_tasks")
    .select(
      "id, scheduled_for, status, assignment_route, facility_locker_rooms(name, short_code)",
    )
    .eq("facility_id", employee.facility_id)
    .eq("assigned_employee_id", employee.id)
    .neq("status", "cancelled")
    .order("scheduled_for", { ascending: true })

  return (data ?? []) as CleaningTask[]
}
