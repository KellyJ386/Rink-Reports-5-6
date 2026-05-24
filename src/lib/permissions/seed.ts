import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export type SeedResult = { ok: true } | { ok: false; error: string }

/**
 * Apply a role's default permission matrix to one user's user_permissions rows.
 *
 * Goes through the service-role client because apply_role_permission_defaults is
 * an internal worker that is NOT granted to the authenticated role (prevents a
 * logged-in user from self-seeding). Callers MUST authorize first (requireAdmin).
 *
 * The DB function is idempotent: it never clobbers manual_override rows and
 * disables (not deletes) rows the new role no longer grants. No-op for super_admin.
 */
export async function seedRolePermissionDefaults(params: {
  userId: string
  facilityId: string
  roleId: string
}): Promise<SeedResult> {
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown configuration error"
    return { ok: false, error: `Permission seeding unavailable: ${detail}` }
  }

  const { error } = await admin.rpc(
    // Not in generated types yet; cast follows the project pattern.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "apply_role_permission_defaults" as any,
    {
      p_user_id: params.userId,
      p_facility_id: params.facilityId,
      p_role_id: params.roleId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
