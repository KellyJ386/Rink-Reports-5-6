import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"
import type { ModuleName } from "@/lib/permissions/actions"
import { requireUser } from "./require-user"
import type { AuthedUser } from "./types"

/**
 * Server-side guard: requires the `admin` action on a specific module in the
 * caller's facility, resolved through `user_permissions` — the SAME source of
 * truth the RLS helpers (`has_module_admin_access`) read. Super admins pass
 * via `current_user_has_permission`'s built-in bypass.
 *
 * Use this ALONGSIDE `requireAdmin()` on module admin consoles whose RLS
 * write policies gate on `has_module_admin_access('<module>')`. requireAdmin
 * alone is not enough: it accepts the global `admin`/`admin` grant and an
 * employee-role fallback, neither of which implies the module-scoped grant
 * RLS checks — without this guard those accounts render the console but
 * every write dies at the RLS layer with an opaque error.
 *
 * Redirects to /login when unauthenticated, /forbidden when lacking the
 * grant. Wrapped in React `cache()` (keyed per module argument) so layout +
 * page share one round-trip.
 */
export const requireModuleAdmin = cache(
  async (moduleName: ModuleName): Promise<AuthedUser> => {
    const current = await requireUser()

    const supabase = await createClient()
    const allowed = await currentUserCan(supabase, moduleName, "admin")
    if (!allowed) {
      redirect("/forbidden")
    }

    return current
  },
)
