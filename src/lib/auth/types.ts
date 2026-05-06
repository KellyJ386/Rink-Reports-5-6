import type { User } from "@supabase/supabase-js"

export type UserProfile = {
  id: string
  facility_id: string | null
  email: string
  full_name: string | null
  is_super_admin: boolean
  is_active: boolean
}

export type AuthedUser = {
  authUser: User
  profile: UserProfile | null
}
