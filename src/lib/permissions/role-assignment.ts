import "server-only"

import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { canAssignRoleLevel } from "./role-assignment-core"

export { ADMIN_TIER_LEVEL, canAssignRoleLevel } from "./role-assignment-core"

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Returns the caller's effective role hierarchy_level **inside the given
 * facility** (the lowest one across their active employee rows there), or
 * null when the caller is a platform super admin / has no employee row in
 * that facility.
 *
 * Scoping by facility is important: a user can hold legitimate employee rows
 * in multiple facilities at different ranks. The floor that gates role
 * creation/assignment must reflect the caller's rank in the facility the
 * action targets, NOT the highest-ranked role they hold anywhere.
 */
export async function callerHierarchyFloor(
  facilityId: string,
): Promise<number | null> {
  const { profile } = await requireAdmin()
  if (profile?.is_super_admin) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from("employees")
    .select("roles!inner(hierarchy_level)")
    .eq("user_id", profile!.id)
    .eq("facility_id", facilityId)
    .eq("is_active", true)
    .order("roles(hierarchy_level)", { ascending: true })
    .limit(1)
    .maybeSingle()

  const lvl = (data as { roles: { hierarchy_level: number } | null } | null)
    ?.roles?.hierarchy_level
  return typeof lvl === "number" ? lvl : null
}

/**
 * Convenience guard for the single-employee create/update paths: verifies the
 * role exists in the target facility and that the caller may assign its tier.
 * Bulk paths should resolve the floor + role levels once and use
 * {@link canAssignRoleLevel} per row instead of calling this in a loop.
 */
export async function assertCanAssignRole(
  supabase: ServerClient,
  facilityId: string,
  roleId: string,
  isSuperAdmin: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isSuperAdmin) return { ok: true }

  const { data: role, error } = await supabase
    .from("roles")
    .select("hierarchy_level")
    .eq("id", roleId)
    .eq("facility_id", facilityId)
    .maybeSingle()

  if (error) return { ok: false, error: "Could not verify the selected role." }
  if (!role) {
    return { ok: false, error: "Selected role does not belong to this facility." }
  }

  const floor = await callerHierarchyFloor(facilityId)
  if (!canAssignRoleLevel(role.hierarchy_level, floor, false)) {
    return {
      ok: false,
      error: "Only a super admin can assign an admin-tier role.",
    }
  }
  return { ok: true }
}
