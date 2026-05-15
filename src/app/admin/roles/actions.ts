"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import {
  assertValidLevel,
  assertValidModuleKey,
} from "../permissions/validators"

const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/

function assertValidRoleKey(key: string): void {
  if (!KEY_RE.test(key)) {
    throw new Error(
      "Role key must be lowercase letters, digits, or underscores (2–41 chars, starts with a letter).",
    )
  }
}

export type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string }

function err(message: string): { ok: false; error: string } {
  return { ok: false, error: message }
}

function revalidate() {
  revalidatePath("/admin/roles")
  revalidatePath("/admin/permissions")
  revalidatePath("/admin/employees")
}

// -----------------------------------------------------------------------------
// Existing: set per-cell role default level (kept as-is for the matrix).
// -----------------------------------------------------------------------------
export async function setRoleModulePermissionLevel(
  roleId: string,
  moduleKey: string,
  level: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    assertValidLevel(level)
    assertValidModuleKey(moduleKey)

    const supabase = await createClient()

    const { data: role, error: roleErr } = await supabase
      .from("roles")
      .select("id, facility_id")
      .eq("id", roleId)
      .maybeSingle()

    if (roleErr) return err(roleErr.message)
    if (!role) return err("Role not found")

    const { error: upErr } = await supabase
      .from("role_module_permission_defaults")
      .upsert(
        {
          facility_id: role.facility_id,
          role_id: roleId,
          module_key: moduleKey,
          permission_level: level,
        },
        { onConflict: "role_id,module_key" },
      )

    if (upErr) return err(upErr.message)

    revalidate()
    return { ok: true }
  } catch (e) {
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}

/**
 * Returns the caller's effective role hierarchy_level **inside the given
 * facility** (the lowest one across their active employee rows there), or
 * null when the caller is a platform super admin / has no employee row in
 * that facility.
 *
 * Scoping by facility is important: a user can hold legitimate employee
 * rows in multiple facilities at different ranks. The floor that gates
 * createRole / setRoleHierarchy must reflect the caller's rank in the
 * facility the action is targeting, NOT the highest-ranked role they
 * hold anywhere. Otherwise a low-rank admin in facility A who happens
 * to be a manager in facility B could mint a role in A below their A-rank.
 *
 * Convention in this codebase: LOWER number = HIGHER rank. So a caller
 * with level 100 must not create or re-rank a role to anything below 100.
 */
async function callerHierarchyFloor(
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

  const lvl = (data as { roles: { hierarchy_level: number } | null } | null)?.roles?.hierarchy_level
  return typeof lvl === "number" ? lvl : null
}

// -----------------------------------------------------------------------------
// Create a new (custom) role within a facility.
// -----------------------------------------------------------------------------
export async function createRole(input: {
  facilityId: string
  key: string
  displayName: string
  hierarchyLevel: number
  description?: string
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { profile } = await requireAdmin()
    if (!profile?.is_super_admin && profile?.facility_id !== input.facilityId) {
      return err("Cannot create a role outside your facility")
    }

    const trimmedKey = input.key.trim().toLowerCase()
    const trimmedName = input.displayName.trim()
    assertValidRoleKey(trimmedKey)
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      return err("Display name must be between 2 and 80 characters")
    }
    const level = Number(input.hierarchyLevel)
    if (!Number.isFinite(level) || level < 0 || level > 1000) {
      return err("Hierarchy level must be between 0 and 1000")
    }

    // Privilege guard: a non-super-admin caller may not mint a role that
    // outranks their own (LOWER number = HIGHER rank in this codebase).
    // Floor is computed against the TARGET facility so multi-facility
    // employees can't use a secondary-facility rank to outrank themselves
    // in their primary one.
    const floor = await callerHierarchyFloor(input.facilityId)
    if (floor !== null && level < floor) {
      return err(
        `Hierarchy level must be >= ${floor} (your own role's level in this facility).`,
      )
    }

    const supabase = await createClient()
    const insertRow = {
      facility_id: input.facilityId,
      key: trimmedKey,
      display_name: trimmedName,
      hierarchy_level: level,
      is_system: false,
      description: input.description ? input.description.trim() : undefined,
    }

    const { data, error } = await supabase
      .from("roles")
      .insert(insertRow)
      .select("id")
      .single()

    if (error) {
      if (error.code === "23505") return err("A role with that key already exists in this facility")
      return err(error.message)
    }

    revalidate()
    return { ok: true, value: { id: data!.id } }
  } catch (e) {
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}

// -----------------------------------------------------------------------------
// Rename / set description.
// -----------------------------------------------------------------------------
export async function renameRole(
  roleId: string,
  displayName: string,
  description?: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    const trimmed = displayName.trim()
    if (trimmed.length < 2 || trimmed.length > 80) {
      return err("Display name must be between 2 and 80 characters")
    }

    const supabase = await createClient()
    const update = {
      display_name: trimmed,
      ...(description !== undefined ? { description: description.trim() || null } : {}),
    }

    const { error } = await supabase
      .from("roles")
      .update(update)
      .eq("id", roleId)

    if (error) return err(error.message)
    revalidate()
    return { ok: true }
  } catch (e) {
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}

// -----------------------------------------------------------------------------
// Set hierarchy level.
// -----------------------------------------------------------------------------
export async function setRoleHierarchy(
  roleId: string,
  hierarchyLevel: number,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    const level = Number(hierarchyLevel)
    if (!Number.isFinite(level) || level < 0 || level > 1000) {
      return err("Hierarchy level must be between 0 and 1000")
    }

    const supabase = await createClient()

    // Resolve the target role's facility first so the floor reflects the
    // caller's rank inside that facility specifically. RLS on roles also
    // ensures cross-facility admins can't load the row at all.
    const { data: existing } = await supabase
      .from("roles")
      .select("facility_id, hierarchy_level")
      .eq("id", roleId)
      .maybeSingle()
    if (!existing) return err("Role not found")

    const floor = await callerHierarchyFloor(existing.facility_id)
    if (floor !== null && level < floor) {
      return err(
        `Hierarchy level must be >= ${floor} (your own role's level in this facility).`,
      )
    }

    // Also block changing an existing role that already outranks the caller.
    // Without this, a caller could change a role they already outrank into
    // one that outranks them.
    if (floor !== null && existing.hierarchy_level < floor) {
      return err("Cannot modify a role that already outranks you.")
    }

    const { error } = await supabase
      .from("roles")
      .update({ hierarchy_level: level })
      .eq("id", roleId)

    if (error) return err(error.message)
    revalidate()
    return { ok: true }
  } catch (e) {
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}

// -----------------------------------------------------------------------------
// Deactivate role.
// -----------------------------------------------------------------------------
export async function deactivateRole(
  roleId: string,
  force: boolean = false,
): Promise<ActionResult<{ employeeCount: number; message: string }>> {
  try {
    await requireAdmin()
    const supabase = await createClient()

    const { data, error } = await supabase.rpc("deactivate_role", {
      p_role_id: roleId,
      p_force: force,
    })
    if (error) return err(error.message)

    const row = Array.isArray(data) ? data[0] : data
    if (!row?.ok) {
      return err(row?.message ?? "Could not deactivate role")
    }
    revalidate()
    return {
      ok: true,
      value: {
        employeeCount: row.employee_count ?? 0,
        message: row.message ?? "Role deactivated",
      },
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}

export async function reactivateRole(roleId: string): Promise<ActionResult> {
  try {
    await requireAdmin()
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("reactivate_role", {
      p_role_id: roleId,
    })
    if (error) return err(error.message)
    if (data !== true) return err("Could not reactivate role")
    revalidate()
    return { ok: true }
  } catch (e) {
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}

// -----------------------------------------------------------------------------
// Copy permission defaults from one role to another (same facility).
// -----------------------------------------------------------------------------
export async function copyRolePermissionDefaults(
  sourceRoleId: string,
  targetRoleId: string,
): Promise<ActionResult<{ copied: number }>> {
  try {
    await requireAdmin()
    if (sourceRoleId === targetRoleId) return err("Source and target must differ")

    const supabase = await createClient()
    const { data, error } = await supabase.rpc(
      "copy_role_permission_defaults",
      { p_source_role_id: sourceRoleId, p_target_role_id: targetRoleId },
    )
    if (error) return err(error.message)
    revalidate()
    return { ok: true, value: { copied: Number(data ?? 0) } }
  } catch (e) {
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}
