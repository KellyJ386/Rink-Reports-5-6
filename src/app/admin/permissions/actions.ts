"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { type PermissionLevel } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { MODULE_KEYS } from "./types"
import { assertValidLevel, assertValidModuleKey } from "./validators"

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function setModulePermissionLevel(
  employeeId: string,
  moduleKey: string,
  level: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    assertValidLevel(level)
    assertValidModuleKey(moduleKey)

    const supabase = await createClient()

    // Defensive read so RLS rejects callers from other tenants.
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .eq("id", employeeId)
      .maybeSingle()

    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }

    const { data: existing, error: selErr } = await supabase
      .from("module_permissions")
      .select("id")
      .eq("employee_id", employeeId)
      .eq("module_key", moduleKey)
      .maybeSingle()

    if (selErr) return { ok: false, error: selErr.message }

    if (existing) {
      const { error: updErr } = await supabase
        .from("module_permissions")
        .update({ permission_level: level })
        .eq("id", existing.id)
        .eq("facility_id", employee.facility_id)

      if (updErr) return { ok: false, error: updErr.message }
    } else {
      const { error: insErr } = await supabase.from("module_permissions").insert({
        facility_id: employee.facility_id,
        employee_id: employeeId,
        module_key: moduleKey,
        permission_level: level,
      })

      if (insErr) return { ok: false, error: insErr.message }
    }

    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return { ok: false, error: msg }
  }
}

/**
 * Wipe per-employee overrides so the employee falls back to their role's
 * defaults (managed in /admin/roles).
 */
export async function applyRoleDefaultsToEmployee(
  employeeId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    const supabase = await createClient()

    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .eq("id", employeeId)
      .maybeSingle()

    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }

    const { error: delErr } = await supabase
      .from("module_permissions")
      .delete()
      .eq("employee_id", employeeId)
      .eq("facility_id", employee.facility_id)

    if (delErr) return { ok: false, error: delErr.message }

    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }
  }
}

/**
 * Make `target` match `source` exactly: for every module the source has an
 * explicit override on, upsert the same level onto the target; for every
 * module the source has no override on, delete the target's override (so
 * the target also falls back to role default).
 */
export async function copyPermissionsBetweenEmployees(
  targetId: string,
  sourceId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    if (!targetId || !sourceId) {
      return { ok: false, error: "Both employees required." }
    }
    if (targetId === sourceId) {
      return { ok: false, error: "Source and target must differ." }
    }

    const supabase = await createClient()

    const { data: emps, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .in("id", [targetId, sourceId])

    if (empErr) return { ok: false, error: empErr.message }
    if (!emps || emps.length !== 2) {
      return { ok: false, error: "Employee not found." }
    }
    const target = emps.find((e) => e.id === targetId)
    const source = emps.find((e) => e.id === sourceId)
    if (!target || !source) {
      return { ok: false, error: "Employee not found." }
    }
    if (target.facility_id !== source.facility_id) {
      return { ok: false, error: "Employees are in different facilities." }
    }

    const { data: sourceRowsRaw, error: srcErr } = await supabase
      .from("module_permissions")
      .select("module_key, permission_level")
      .eq("employee_id", sourceId)
      .eq("facility_id", source.facility_id)

    if (srcErr) return { ok: false, error: srcErr.message }
    const sourceRows = (sourceRowsRaw ?? []) as Array<{
      module_key: string
      permission_level: PermissionLevel
    }>

    const sourceModules = new Set(sourceRows.map((r) => r.module_key))

    // Upsert source rows onto the target.
    if (sourceRows.length > 0) {
      const upsertRows = sourceRows.map((r) => ({
        facility_id: target.facility_id,
        employee_id: targetId,
        module_key: r.module_key,
        permission_level: r.permission_level,
      }))
      const { error: upErr } = await supabase
        .from("module_permissions")
        .upsert(upsertRows, { onConflict: "employee_id,module_key" })
      if (upErr) return { ok: false, error: upErr.message }
    }

    // Delete target rows for modules the source does NOT override.
    const modulesToDelete = (MODULE_KEYS as readonly string[]).filter(
      (m) => !sourceModules.has(m),
    )
    if (modulesToDelete.length > 0) {
      const { error: delErr } = await supabase
        .from("module_permissions")
        .delete()
        .eq("employee_id", targetId)
        .eq("facility_id", target.facility_id)
        .in("module_key", modulesToDelete)
      if (delErr) return { ok: false, error: delErr.message }
    }

    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }
  }
}
