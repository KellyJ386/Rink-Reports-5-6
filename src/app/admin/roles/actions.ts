"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import {
  MODULE_NAMES,
  USER_ACTIONS,
  isAdminConsoleGrant,
  type ModuleName,
  type UserAction,
} from "@/lib/permissions"
import { callerHierarchyFloor } from "@/lib/permissions/role-assignment"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

function isModuleName(value: string): value is ModuleName {
  return (MODULE_NAMES as readonly string[]).includes(value)
}

function isUserAction(value: string): value is UserAction {
  return (USER_ACTIONS as readonly string[]).includes(value)
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
// Set one per-cell role default action (view/submit/edit/admin) for a module.
// Writes role_permission_defaults (the live model) then re-applies the role's
// defaults to its current active employees so the change takes effect for them
// (apply_role_permission_defaults preserves manual_override rows).
// -----------------------------------------------------------------------------
export async function setRoleModuleAction(
  roleId: string,
  moduleName: string,
  action: string,
  enabled: boolean,
): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin()
    if (!isModuleName(moduleName)) return err(`Invalid module: ${moduleName}`)
    if (!isUserAction(action)) return err(`Invalid action: ${action}`)

    // Escalation guard: this default is re-applied onto every employee holding
    // the role, so enabling the admin/admin cell would mint peer facility
    // admins. Only a super admin may do that (RLS only fences by facility).
    if (
      !profile?.is_super_admin &&
      enabled &&
      isAdminConsoleGrant(moduleName, action)
    ) {
      return err("Only a super admin can grant Admin Center access.")
    }

    const supabase = await createClient()

    const { data: role, error: roleErr } = await supabase
      .from("roles")
      .select("id, facility_id")
      .eq("id", roleId)
      .maybeSingle()

    if (roleErr) return err(roleErr.message)
    if (!role) return err("Role not found")

    const { error: upErr } = await supabase
      .from("role_permission_defaults")
      .upsert(
        {
          facility_id: role.facility_id,
          role_id: roleId,
          module_name: moduleName,
          action,
          enabled,
        },
        { onConflict: "facility_id,role_id,module_name,action" },
      )

    if (upErr) return err(upErr.message)

    // Propagate to current staff on this role (no-op if none).
    const { error: reapplyErr } = await supabase.rpc(
      "reapply_role_defaults_for_role",
      { p_facility_id: role.facility_id, p_role_id: roleId },
    )
    if (reapplyErr) return err(reapplyErr.message)

    revalidate()
    return { ok: true }
  } catch (e) {
    logServerError("admin/roles/actions", e)
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}

// `callerHierarchyFloor` (the rank floor that gates createRole /
// setRoleHierarchy and now employee role assignment) lives in
// @/lib/permissions/role-assignment so the employee + permission paths share
// the exact same privilege-escalation guard.

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
    logServerError("admin/roles/actions", e)
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
    logServerError("admin/roles/actions", e)
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
    logServerError("admin/roles/actions", e)
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
    logServerError("admin/roles/actions", e)
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
    logServerError("admin/roles/actions", e)
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

    // Resolve + verify both roles live in the same facility (RLS also scopes
    // the rows to the caller's facility).
    const { data: rolePair, error: roleErr } = await supabase
      .from("roles")
      .select("id, facility_id")
      .in("id", [sourceRoleId, targetRoleId])
    if (roleErr) return err(roleErr.message)
    const src = rolePair?.find((r) => r.id === sourceRoleId)
    const tgt = rolePair?.find((r) => r.id === targetRoleId)
    if (!src || !tgt) return err("Source or target role not found")
    if (src.facility_id !== tgt.facility_id) {
      return err("Cannot copy defaults across facilities")
    }

    // Copy the source role's action grid onto the target (role_permission_defaults).
    const { data: srcRows, error: srcErr } = await supabase
      .from("role_permission_defaults")
      .select("module_name, action, enabled")
      .eq("role_id", sourceRoleId)
    if (srcErr) return err(srcErr.message)

    const rows = (srcRows ?? []).map((r) => ({
      facility_id: tgt.facility_id,
      role_id: targetRoleId,
      module_name: r.module_name,
      action: r.action,
      enabled: r.enabled,
    }))

    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from("role_permission_defaults")
        .upsert(rows, { onConflict: "facility_id,role_id,module_name,action" })
      if (upErr) return err(upErr.message)
    }

    // Propagate the copied defaults to the target role's current staff.
    const { error: reapplyErr } = await supabase.rpc(
      "reapply_role_defaults_for_role",
      { p_facility_id: tgt.facility_id, p_role_id: targetRoleId },
    )
    if (reapplyErr) return err(reapplyErr.message)

    revalidate()
    return { ok: true, value: { copied: rows.length } }
  } catch (e) {
    logServerError("admin/roles/actions", e)
    return err(e instanceof Error ? e.message : "Unknown error")
  }
}
