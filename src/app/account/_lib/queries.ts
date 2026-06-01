import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { AccountProfile } from "./types"

const PROFILE_COLUMNS =
  "id, facility_id, email, full_name, phone, address_line1, address_line2, city, state_province, postal_code, country, emergency_contact_name, emergency_contact_phone, sms_opt_in"

/**
 * Load a user's full profile for the account page. RLS guarantees the caller
 * can only read their own row or rows in their facility; the caller is still
 * responsible for the edit-permission check before rendering a form.
 */
export async function loadAccountProfile(
  userId: string,
): Promise<AccountProfile | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("users")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle<AccountProfile>()

  if (error || !data) return null
  return data
}

/** Whether the current user may edit the given target user's profile. */
export async function canEditProfile(targetUserId: string): Promise<boolean> {
  const supabase = await createClient()
  // can_edit_user_profile lands in migration 00000000000100 and isn't in the
  // generated types yet; cast to call it (matches the repo's untyped-RPC pattern).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("can_edit_user_profile", {
    p_target_user_id: targetUserId,
  })
  if (error) return false
  return data === true
}

/** Display label for a profile (full name falling back to email). */
export function profileDisplayName(profile: {
  full_name: string | null
  email: string
}): string {
  return profile.full_name?.trim() || profile.email
}
