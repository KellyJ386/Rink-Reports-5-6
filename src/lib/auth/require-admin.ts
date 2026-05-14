import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "./get-current-user"
import type { AuthedUser } from "./types"

const ADMIN_ROLE_KEYS = ["admin", "super_admin"] as const

/**
 * Server-side guard: requires that the current user is either a global super
 * admin (users.is_super_admin) or has an active employee row whose role.key is
 * one of admin/super_admin for the user's current facility.
 *
 * Redirects to /login when unauthenticated, or to /forbidden when
 * authenticated but lacking admin privileges. Splitting the two cases lets
 * users see a useful message instead of a confusing login bounce.
 *
 * Wrapped in React `cache()` so that layout + page calling this in the same
 * server render tree share a single DB round-trip for the role check.
 */
export const requireAdmin = cache(async (): Promise<AuthedUser> => {
  const current = await getCurrentUser()
  if (!current) {
    redirect("/login")
  }

  const { profile } = current

  if (profile?.is_super_admin) {
    return current
  }

  if (!profile || !profile.is_active) {
    redirect("/forbidden")
  }

  const supabase = await createClient()

  // Look up an active employee row for this user with an admin-level role.
  // If the user has a facility_id set on their profile, scope to it; otherwise
  // accept any facility (matches the case where assignment hasn't happened).
  let query = supabase
    .from("employees")
    .select("id, is_active, roles!inner(key)")
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .in("roles.key", ADMIN_ROLE_KEYS as unknown as string[])
    .limit(1)

  if (profile.facility_id) {
    query = query.eq("facility_id", profile.facility_id)
  }

  const { data: employee, error } = await query.maybeSingle()

  if (error || !employee) {
    redirect("/forbidden")
  }

  return current
})
