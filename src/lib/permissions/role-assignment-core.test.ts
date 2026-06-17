import { describe, expect, it } from "vitest"

import { ADMIN_TIER_LEVEL, canAssignRoleLevel } from "./role-assignment-core"

// Canonical tiers (lower = higher rank): super_admin=0, admin=1, manager=2, staff=3.
const SUPER_ADMIN = 0
const ADMIN = 1
const MANAGER = 2
const STAFF = 3

describe("canAssignRoleLevel", () => {
  it("lets a super admin assign any role, including super_admin", () => {
    for (const level of [SUPER_ADMIN, ADMIN, MANAGER, STAFF, null]) {
      expect(canAssignRoleLevel(level, null, true)).toBe(true)
    }
  })

  it("blocks a facility admin (floor=1) from minting an admin or super_admin", () => {
    expect(canAssignRoleLevel(SUPER_ADMIN, ADMIN, false)).toBe(false)
    expect(canAssignRoleLevel(ADMIN, ADMIN, false)).toBe(false)
  })

  it("lets a facility admin (floor=1) assign manager/staff (ranks below them)", () => {
    expect(canAssignRoleLevel(MANAGER, ADMIN, false)).toBe(true)
    expect(canAssignRoleLevel(STAFF, ADMIN, false)).toBe(true)
  })

  it("falls back to the admin tier when a non-super caller's floor is unknown", () => {
    // floor=null + non-super → effective floor is ADMIN_TIER_LEVEL (1), so
    // admin/super_admin are still blocked but manager/staff are allowed.
    expect(canAssignRoleLevel(SUPER_ADMIN, null, false)).toBe(false)
    expect(canAssignRoleLevel(ADMIN, null, false)).toBe(false)
    expect(canAssignRoleLevel(MANAGER, null, false)).toBe(true)
    expect(ADMIN_TIER_LEVEL).toBe(1)
  })

  it("treats an unknown target level as top-rank (deny for non-super)", () => {
    expect(canAssignRoleLevel(null, ADMIN, false)).toBe(false)
    expect(canAssignRoleLevel(null, STAFF, false)).toBe(false)
  })

  it("blocks assigning a role that outranks a lower-ranked caller", () => {
    // A manager-level caller (floor=2) cannot assign manager or above.
    expect(canAssignRoleLevel(MANAGER, MANAGER, false)).toBe(false)
    expect(canAssignRoleLevel(STAFF, MANAGER, false)).toBe(true)
  })
})
