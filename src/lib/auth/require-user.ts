import "server-only"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "./get-current-user"
import type { AuthedUser } from "./types"

/**
 * Server-side guard for staff routes (/reports, /dashboard).
 *
 * Requires:
 *  1. An active Supabase auth session.
 *  2. A public.users profile that is is_active = true (or is_super_admin).
 *  3. An active employee row (is_active = true) linked to the user.
 *
 * Super admins bypass the employee check (they may have no employee row).
 *
 * Returns AuthedUser with `employee` populated so downstream pages
 * don't need to re-query the employee table.
 */
export async function requireUser(): Promise<AuthedUser> {
  const current = await getCurrentUser()
  if (!current) {
    redirect("/login")
  }

  const { profile } = current

  // Inactive or missing profile
  if (!profile || !profile.is_active) {
    redirect("/forbidden")
  }

  // Super admins may access staff routes without an employee row
  if (profile.is_super_admin) {
    return { ...current, employee: null }
  }

  // Must have a facility assigned
  if (!profile.facility_id) {
    redirect("/forbidden")
  }

  const supabase = await createClient()

  const { data: employee } = await supabase
    .from("employees")
    .select("id, facility_id, roles!inner(key)")
    .eq("user_id", profile.id)
    .eq("facility_id", profile.facility_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employee) {
    redirect("/forbidden")
  }

  const roleKey = (employee.roles as unknown as { key: string }).key

  return {
    ...current,
    employee: {
      id: employee.id,
      facility_id: employee.facility_id,
      role_key: roleKey,
    },
  }
}
