import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { AuthedUser } from "./types"

const ADMIN_ROLE_KEYS = ["admin", "super_admin"] as const

/**
 * Returns true if the user counts as an admin, using the SAME sources as
 * `requireAdmin` (require-admin.ts): the `is_super_admin` flag, an enabled
 * `user_permissions` admin/admin row in the user's facility (the primary
 * permission-model check), or an active employee with an admin-tier role
 * (fallback for accounts not yet backfilled). Kept in sync so a matrix-granted
 * admin who passes `requireAdmin` also sees the Admin nav link / admin-gated
 * paths (C-15).
 */
export async function getIsAdmin(current: AuthedUser): Promise<boolean> {
  const { profile } = current

  if (!profile || !profile.is_active) return false
  if (profile.is_super_admin) return true

  const supabase = await createClient()

  // Primary check (new permission model): an enabled admin/admin row in the
  // user's facility.
  if (profile.facility_id) {
    const { data: adminPerm } = await supabase
      .from("user_permissions")
      .select("id")
      .eq("user_id", profile.id)
      .eq("facility_id", profile.facility_id)
      .eq("module_name", "admin")
      .eq("action", "admin")
      .eq("enabled", true)
      .limit(1)
      .maybeSingle()

    if (adminPerm) return true
  }

  // Fallback: an active employee with an admin-tier role.
  let query = supabase
    .from("employees")
    .select("id, roles!inner(key)")
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .in("roles.key", ADMIN_ROLE_KEYS as unknown as string[])
    .limit(1)

  if (profile.facility_id) {
    query = query.eq("facility_id", profile.facility_id)
  }

  const { data } = await query.maybeSingle()
  return data !== null
}
