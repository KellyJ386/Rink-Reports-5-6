// Pure, dependency-free role-assignment guard logic. Kept separate from
// role-assignment.ts (which is `server-only` and pulls in @/lib/auth + the
// Supabase server client) so it can be unit-tested under vitest's plain-Node
// environment — same split as check-core.ts / check.ts.

// Role hierarchy convention in this codebase: LOWER number = HIGHER rank.
// Canonical seed: super_admin=0, admin=1, manager=2, staff=3 (see
// CANONICAL_ROLES in admin/employees/actions.ts). The admin tier is the floor
// we fall back to when a non-super caller's rank can't be resolved from an
// employee row (e.g. an admin granted purely via a user_permissions admin/admin
// row), so they still can't mint an admin/super_admin.
export const ADMIN_TIER_LEVEL = 1

/**
 * Pure predicate: may a caller (with the given facility floor / super-admin
 * status) assign a role at `targetLevel`?
 *
 * Non-super callers are blocked from assigning a role that is equal to OR
 * outranks them — which is what would let a facility admin mint another
 * facility admin (or a super admin). Assignment is deliberately stricter than
 * createRole's role-*definition* guard (`level < floor`, equal allowed):
 * assigning the admin role grants live Admin Center access (its role defaults
 * seed an admin/admin user_permissions row on invite), so we require a super
 * admin for it.
 *
 * An unknown target level (null) is treated as top-rank (deny for non-super).
 */
export function canAssignRoleLevel(
  targetLevel: number | null,
  floor: number | null,
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true
  const effectiveFloor = floor ?? ADMIN_TIER_LEVEL
  const level = targetLevel ?? 0
  return level > effectiveFloor
}
