import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { AuthedUser } from "./types"

const ADMIN_ROLE_KEYS = ["admin", "gm", "super_admin"] as const

/** Returns true if the user has super-admin flag or an active admin-level role. */
export async function getIsAdmin(current: AuthedUser): Promise<boolean> {
  const { profile } = current

  if (!profile || !profile.is_active) return false
  if (profile.is_super_admin) return true

  const supabase = await createClient()

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
