import "server-only"

import type { createClient } from "@/lib/supabase/server"
import type { ModuleName, UserAction } from "./actions"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * True iff the current user (resolved from the session) has `action` on
 * `moduleName` within their facility, per the `user_permissions` source of
 * truth introduced in migration 77. Super admins always pass. Fails closed
 * (returns false) on any error.
 *
 * Wraps the `current_user_has_permission` SQL function, which isn't in the
 * generated DB types yet — hence the cast (matches the project's `as any`
 * pattern for not-yet-typed schema, e.g. src/app/api/offline-sync/route.ts).
 */
export async function currentUserCan(
  supabase: ServerSupabase,
  moduleName: ModuleName,
  action: UserAction,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    "current_user_has_permission",
    { p_module_name: moduleName, p_action: action },
  )
  if (error) return false
  return data === true
}
