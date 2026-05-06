import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { AuthedUser, UserProfile } from "./types"

/**
 * Read the current authenticated user from Supabase auth and join with our
 * `public.users` profile row. Returns `null` when there is no session.
 */
export async function getCurrentUser(): Promise<AuthedUser | null> {
  const supabase = await createClient()

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()

  if (!authUser) {
    return null
  }

  const { data: profile } = await supabase
    .from("users")
    .select(
      "id, facility_id, email, full_name, is_super_admin, is_active"
    )
    .eq("id", authUser.id)
    .maybeSingle<UserProfile>()

  return { authUser, profile: profile ?? null }
}
