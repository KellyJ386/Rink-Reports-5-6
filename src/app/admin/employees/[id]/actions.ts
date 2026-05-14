"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { PERMISSION_LEVELS, type PermissionLevel } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

import { MODULE_KEYS, type ModuleKey } from "../../permissions/types"

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

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Set (or replace) the explicit per-employee override for a single module.
 * Wraps the same upsert path used by /admin/permissions but scoped to a
 * single (employee, module).
 */
export async function setEmployeeModuleOverride(
  employeeId: string,
  moduleKey: string,
  level: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    assertValidLevel(level)
    assertValidModuleKey(moduleKey)

    const supabase = await createClient()
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .eq("id", employeeId)
      .maybeSingle()
    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { error } = await sb
      .from("module_permissions")
      .upsert(
        {
          facility_id: employee.facility_id,
          employee_id: employeeId,
          module_key: moduleKey,
          permission_level: level,
        },
        { onConflict: "employee_id,module_key" },
      )
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Clear the explicit override so the employee falls back through the chain
 * (role -> department -> facility -> none).
 */
export async function clearEmployeeModuleOverride(
  employeeId: string,
  moduleKey: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    assertValidModuleKey(moduleKey)

    const supabase = await createClient()
    const { error } = await supabase
      .from("module_permissions")
      .delete()
      .eq("employee_id", employeeId)
      .eq("module_key", moduleKey)
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Add the employee to a communication group.
 */
export async function addEmployeeToGroup(
  employeeId: string,
  groupId: string,
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

    // Verify the target group is in the same facility as the employee.
    // The group_id FK doesn't enforce this, and the table's RLS only checks
    // the row's own facility_id (which we set from the employee). Without
    // this check, a facility admin could add their employee into a foreign
    // facility's group.
    const { data: group, error: grpErr } = await supabase
      .from("communication_groups")
      .select("id, facility_id")
      .eq("id", groupId)
      .maybeSingle()
    if (grpErr) return { ok: false, error: grpErr.message }
    if (!group) return { ok: false, error: "Group not found" }
    if (group.facility_id !== employee.facility_id) {
      return { ok: false, error: "Group is in a different facility" }
    }

    const { error } = await supabase
      .from("communication_group_members")
      .insert({
        facility_id: employee.facility_id,
        group_id: groupId,
        employee_id: employeeId,
      })
    if (error) {
      if (error.code === "23505") return { ok: false, error: "Already a member" }
      return { ok: false, error: error.message }
    }

    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

export async function removeEmployeeFromGroup(
  employeeId: string,
  memberRowId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    const supabase = await createClient()
    const { error } = await supabase
      .from("communication_group_members")
      .delete()
      .eq("id", memberRowId)
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

// ---------------------------------------------------------------------------
// Employee certifications (CPR, refrigeration operator, first aid, etc.)
// ---------------------------------------------------------------------------

export type CertificationInput = {
  name: string
  issuer: string | null
  issued_at: string | null
  expires_at: string | null
  notes: string | null
}

function parseCertificationInput(input: CertificationInput): string | null {
  const name = input.name?.trim()
  if (!name) return "Certification name is required."
  if (name.length > 200) return "Certification name is too long."
  if (input.issuer && input.issuer.length > 200) return "Issuer is too long."
  for (const [field, value] of [
    ["issued_at", input.issued_at],
    ["expires_at", input.expires_at],
  ] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `${field} must be a YYYY-MM-DD date.`
    }
  }
  return null
}

export async function addEmployeeCertification(
  employeeId: string,
  input: CertificationInput,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    const err = parseCertificationInput(input)
    if (err) return { ok: false, error: err }

    const supabase = await createClient()
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .eq("id", employeeId)
      .maybeSingle()
    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }

    const { error } = await supabase
      .from("employee_certifications")
      .insert({
        facility_id: employee.facility_id,
        employee_id: employeeId,
        name: input.name.trim(),
        issuer: input.issuer?.trim() || null,
        issued_at: input.issued_at || null,
        expires_at: input.expires_at || null,
        notes: input.notes?.trim() || null,
      })
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

export async function updateEmployeeCertification(
  employeeId: string,
  certificationId: string,
  input: CertificationInput,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    const err = parseCertificationInput(input)
    if (err) return { ok: false, error: err }

    const supabase = await createClient()
    const { error } = await supabase
      .from("employee_certifications")
      .update({
        name: input.name.trim(),
        issuer: input.issuer?.trim() || null,
        issued_at: input.issued_at || null,
        expires_at: input.expires_at || null,
        notes: input.notes?.trim() || null,
      })
      .eq("id", certificationId)
      .eq("employee_id", employeeId)
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

export async function deleteEmployeeCertification(
  employeeId: string,
  certificationId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    const supabase = await createClient()
    const { error } = await supabase
      .from("employee_certifications")
      .delete()
      .eq("id", certificationId)
      .eq("employee_id", employeeId)
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}
