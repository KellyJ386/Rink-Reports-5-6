"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { PERMISSION_LEVELS, type PermissionLevel } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { MODULE_KEYS, type ModuleKey } from "../permissions/types"

function assertValidLevel(level: string): asserts level is PermissionLevel {
  if (!(PERMISSION_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`Invalid permission level: ${level}`)
  }
}

function assertValidModuleKey(key: string): asserts key is ModuleKey {
  if (!(MODULE_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Invalid module key: ${key}`)
  }
}

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { error: upErr } = await sb
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

    const supabase = await createClient()
    const insertRow: Record<string, unknown> = {
      facility_id: input.facilityId,
      key: trimmedKey,
      display_name: trimmedName,
      hierarchy_level: level,
      is_system: false,
    }
    if (input.description) insertRow.description = input.description.trim()

    const { data, error } = await supabase
      .from("roles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(insertRow as any)
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
    const update: Record<string, unknown> = { display_name: trimmed }
    if (description !== undefined) update.description = description.trim() || null

    const { error } = await supabase
      .from("roles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(update as any)
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("deactivate_role", {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("reactivate_role", {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
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
