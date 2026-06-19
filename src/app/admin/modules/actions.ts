"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { TOGGLEABLE_MODULE_KEYS } from "@/lib/modules/module-keys"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

export type ActionResult = { ok: true } | { ok: false; error: string }

// facility_id is resolved server-side from the session — never from the client.
// RLS additionally requires is_facility_admin(facility_id) on the write.
async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }
  if (!profile.facility_id) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  return { ok: true, facilityId: profile.facility_id }
}

/**
 * Enable or disable a module for the admin's own facility. This is a nav/feature
 * toggle only — per-user access stays governed by user_permissions and the
 * page/RLS guards. Upserts the facility_modules row (one per facility+module).
 */
export async function setFacilityModuleEnabled(
  moduleKey: string,
  enabled: boolean,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    if (!(TOGGLEABLE_MODULE_KEYS as readonly string[]).includes(moduleKey)) {
      return { ok: false, error: `Unknown module: ${moduleKey}` }
    }

    const facility = await resolveFacility()
    if (!facility.ok) return facility

    const supabase = await createClient()
    const { error } = await supabase
      .from("facility_modules")
      .upsert(
        {
          facility_id: facility.facilityId,
          module_key: moduleKey,
          enabled,
        },
        { onConflict: "facility_id,module_key" },
      )

    if (error) return { ok: false, error: error.message }

    revalidatePath("/admin/modules")
    // The staff shells read enabled modules in their layouts — refresh those
    // roots so a toggle takes effect on the next navigation without re-login.
    revalidatePath("/dashboard", "layout")
    revalidatePath("/reports", "layout")
    revalidatePath("/account", "layout")
    return { ok: true }
  } catch (e) {
    logServerError("admin/modules/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}
