import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "./get-current-user"
import type { AuthedUser } from "./types"

/**
 * Server-side guard: requires that the current user is either a global super
 * admin (users.is_super_admin), holds a `user_permissions` row granting the
 * `admin` action on the `admin` module within their facility, or is an active
 * employee with an admin-tier role.
 *
 * Redirects to /login when unauthenticated, or to /forbidden when
 * authenticated but lacking admin privileges.
 *
 * Wrapped in React `cache()` so layout + page calling this in the same
 * server render tree share a single DB round-trip.
 */
export const requireAdmin = cache(async (): Promise<AuthedUser> => {
  const current = await getCurrentUser()
  if (!current) {
    redirect("/login")
  }

  const { profile } = current

  // Check is_active before anything else so a deactivated account — including a
  // deactivated super admin — is always denied.
  if (!profile || !profile.is_active) {
    redirect("/forbidden")
  }

  if (profile.is_super_admin) {
    return current
  }

  const supabase = await createClient()

  // Primary check (new permission model): an enabled admin/admin row in the
  // user's facility.
  if (profile.facility_id) {
    const { data } = await supabase
      .from("user_permissions")
      .select("id")
      .eq("user_id", profile.id)
      .eq("facility_id", profile.facility_id)
      .eq("module_name", "admin")
      .eq("action", "admin")
      .eq("enabled", true)
      .limit(1)
      .maybeSingle()

    if (data) {
      return current
    }
  }

  // Fallback: an active employee row with an admin-tier role. Covers admins
  // provisioned purely via role assignment whose admin/admin user_permissions
  // row wasn't seeded (e.g. accounts that predate migration 77's backfill, or
  // admins not yet assigned a facility_id). Without this, deploying the new
  // permission model would lock those admins out of the console entirely.
  // ('gm' is intentionally absent — it is retired into 'admin', see
  // docs/permission-model-consolidation.md.)
  const { data: adminEmployee } = await supabase
    .from("employees")
    .select("id, roles!inner(key)")
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .in("roles.key", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle()

  if (adminEmployee) {
    return current
  }

  redirect("/forbidden")
})
