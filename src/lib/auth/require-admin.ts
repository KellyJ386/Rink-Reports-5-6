import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "./get-current-user"
import type { AuthedUser } from "./types"

/**
 * Server-side guard: requires that the current user is either a global super
 * admin (users.is_super_admin) or has a `user_permissions` row granting the
 * `admin` action on the `admin` module within their facility.
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

  if (profile?.is_super_admin) {
    return current
  }

  if (!profile || !profile.is_active || !profile.facility_id) {
    redirect("/forbidden")
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    // user_permissions isn't in generated types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("user_permissions" as any)
    .select("id")
    .eq("user_id", profile.id)
    .eq("facility_id", profile.facility_id)
    .eq("module_name", "admin")
    .eq("action", "admin")
    .eq("enabled", true)
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    redirect("/forbidden")
  }

  return current
})
