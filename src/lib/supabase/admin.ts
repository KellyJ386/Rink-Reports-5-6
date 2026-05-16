import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database"

/**
 * Server-only Supabase client authenticated with the service-role key.
 * Use sparingly — bypasses RLS. Required for auth.admin.* operations
 * (e.g. inviting new users by email).
 *
 * Throws if SUPABASE_SERVICE_ROLE_KEY is not configured.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase service-role env not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    )
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
