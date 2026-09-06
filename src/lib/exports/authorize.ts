import "server-only"

import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import type { ModuleName } from "@/lib/permissions/actions"

import { isExportableModule } from "./module-config"

export type AuthorizeExportResult =
  | { ok: true; facilityId: string }
  | { ok: false; error: string; status: number }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 * stay within their tenant. The one exception is `requestedFacilityId`
 * (the `?facility=` switcher): honored ONLY for super admins — who can read
 * every facility by design — and rejected outright for anyone else, so a
 * facility-scoped admin can never widen their export past their own tenant.
 */
export async function authorizeExport(args: {
  module: string
  facilityId: string | null
  isSuperAdmin: boolean
  /** Optional facility override from `?facility=`; super-admin only. */
  requestedFacilityId?: string | null
}): Promise<AuthorizeExportResult> {
  const { module, isSuperAdmin } = args
  const requested = args.requestedFacilityId ?? null

  if (requested && !isSuperAdmin && requested !== args.facilityId) {
    return { ok: false, error: "You can only export your own facility.", status: 403 }
  }
  if (requested && !UUID_RE.test(requested)) {
    return { ok: false, error: "Invalid facility id.", status: 400 }
  }

  const facilityId = isSuperAdmin && requested ? requested : args.facilityId

  if (!facilityId) {
    return {
      ok: false,
      error: isSuperAdmin
        ? "Pick a facility first (choose one on the Exports page)."
        : "No facility assigned to this account.",
      status: 400,
    }
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
