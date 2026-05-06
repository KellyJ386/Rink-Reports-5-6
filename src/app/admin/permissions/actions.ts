"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { MODULE_KEYS, type ModuleKey, type PermissionField } from "./types"

const VALID_FIELDS: readonly PermissionField[] = [
  "can_view",
  "can_submit",
  "can_admin",
]

function assertValidField(field: string): asserts field is PermissionField {
  if (!VALID_FIELDS.includes(field as PermissionField)) {
    throw new Error(`Invalid permission field: ${field}`)
  }
}

function assertValidModuleKey(key: string): asserts key is ModuleKey {
  if (!(MODULE_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Invalid module key: ${key}`)
  }
}

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string }

export async function setModulePermission(
  employeeId: string,
  moduleKey: string,
  field: string,
  value: boolean,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    assertValidField(field)
    assertValidModuleKey(moduleKey)

    const supabase = await createClient()

    // Look up the employee's facility — we need it for the upsert and we want
    // a defensive read so RLS rejects callers from other tenants.
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .eq("id", employeeId)
      .maybeSingle()

    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }

    const { data: existing, error: selErr } = await supabase
      .from("module_permissions")
      .select("id, can_view, can_submit, can_admin")
      .eq("employee_id", employeeId)
      .eq("module_key", moduleKey)
      .maybeSingle()

    if (selErr) return { ok: false, error: selErr.message }

    if (existing) {
      const patch: Partial<Record<PermissionField, boolean>> = {
        [field]: value,
      }
      const { error: updErr } = await supabase
        .from("module_permissions")
        .update(patch)
        .eq("id", existing.id)

      if (updErr) return { ok: false, error: updErr.message }
    } else {
      const row: {
        facility_id: string
        employee_id: string
        module_key: ModuleKey
        can_view: boolean
        can_submit: boolean
        can_admin: boolean
      } = {
        facility_id: employee.facility_id,
        employee_id: employeeId,
        module_key: moduleKey,
        can_view: false,
        can_submit: false,
        can_admin: false,
      }
      row[field] = value
      const { error: insErr } = await supabase
        .from("module_permissions")
        .insert(row)

      if (insErr) return { ok: false, error: insErr.message }
    }

    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return { ok: false, error: msg }
  }
}

export async function bulkSetModuleForEmployee(
  employeeId: string,
  perms: Array<{
    module_key: string
    can_view: boolean
    can_submit: boolean
    can_admin: boolean
  }>,
): Promise<ActionResult> {
  try {
    await requireAdmin()

    for (const p of perms) assertValidModuleKey(p.module_key)

    const supabase = await createClient()

    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .eq("id", employeeId)
      .maybeSingle()

    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }

    const rows = perms.map((p) => ({
      facility_id: employee.facility_id,
      employee_id: employeeId,
      module_key: p.module_key,
      can_view: p.can_view,
      can_submit: p.can_submit,
      can_admin: p.can_admin,
    }))

    const { error: upErr } = await supabase
      .from("module_permissions")
      .upsert(rows, { onConflict: "employee_id,module_key" })

    if (upErr) return { ok: false, error: upErr.message }

    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return { ok: false, error: msg }
  }
}
