import "server-only"

import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import type { ModuleName } from "@/lib/permissions/actions"

import { isExportableModule } from "./module-config"

export type AuthorizeExportResult =
  | { ok: true; facilityId: string }
  | { ok: false; error: string; status: number }

/**
 * Authorize an export request for the current admin user against `module`.
 *
 * Layered, fail-closed:
 *  1. `requireAdmin()` (called by the route/action wrapper) guarantees the
 *     session is an admin — this helper assumes that has run and is handed the
 *     resolved profile (`facilityId` + `isSuperAdmin`).
 *  2. Module must be exportable.
 *  3. The user must hold the `view` action on the module per the
 *     `user_permissions` source of truth (via `current_user_has_permission`).
 *     Super admins bypass. Any RPC error degrades to deny (currentUserCan
 *     returns false on error).
 *
 * `facilityId` comes from the caller's own profile, so all downstream queries
 * stay within their tenant.
 */
export async function authorizeExport(args: {
  module: string
  facilityId: string | null
  isSuperAdmin: boolean
}): Promise<AuthorizeExportResult> {
  const { module, facilityId, isSuperAdmin } = args

  if (!facilityId) {
    return { ok: false, error: "No facility assigned to this account.", status: 400 }
  }
  if (!isExportableModule(module)) {
    return { ok: false, error: "Unknown or non-exportable module.", status: 400 }
  }

  if (isSuperAdmin) {
    return { ok: true, facilityId }
  }

  // Per-module permission for the current user. Requires the `view` action;
  // fails closed on any resolution error (currentUserCan returns false).
  const canView = await currentUserCan(
    await createClient(),
    module as ModuleName,
    "view",
  )
  if (!canView) {
    return { ok: false, error: "You do not have access to export this module.", status: 403 }
  }

  return { ok: true, facilityId }
}
