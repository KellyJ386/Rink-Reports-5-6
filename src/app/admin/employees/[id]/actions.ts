"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/auth"
import { resolveCertificationType } from "@/lib/certifications"
import { isAdminConsoleGrant } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

import {
  assertValidLevel,
  assertValidModuleKey,
} from "../../permissions/validators"

export type ActionResult = { ok: true } | { ok: false; error: string }

// Map a legacy permission_level to the set of user_permissions actions that
// should be enabled — the same explosion migration 77's backfill used.
const LEVEL_ACTIONS: Record<string, ReadonlyArray<"view" | "submit" | "edit" | "admin">> = {
  none: [],
  view: ["view"],
  submit: ["view", "submit"],
  edit_own: ["view", "submit", "edit"],
  edit_all: ["view", "submit", "edit"],
  approve: ["view", "submit", "edit", "admin"],
  publish: ["view", "submit", "edit", "admin"],
  manage_settings: ["view", "submit", "edit", "admin"],
  admin: ["view", "submit", "edit", "admin"],
}
const ALL_ACTIONS = ["view", "submit", "edit", "admin"] as const

/**
 * Set (or replace) the explicit per-employee override for a single module.
 * Writes to user_permissions (the source of truth since migration 77) by
 * exploding the chosen level into per-action rows.
 */
export async function setEmployeeModuleOverride(
  employeeId: string,
  moduleKey: string,
  level: string,
): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin()
    assertValidLevel(level)
    assertValidModuleKey(moduleKey)

    const enabledActions = new Set(LEVEL_ACTIONS[level] ?? [])

    // Escalation guard: a level like approve/publish/manage_settings/admin
    // explodes to include the `admin` action. On the `admin` module that is the
    // admin/admin cell requireAdmin() keys off — minting a peer facility admin.
    // Only a super admin may do that; RLS only fences by facility, not by cell.
    if (
      !profile?.is_super_admin &&
      isAdminConsoleGrant(moduleKey, "admin") &&
      enabledActions.has("admin")
    ) {
      return {
        ok: false,
        error: "Only a super admin can grant Admin Center access.",
      }
    }

    const supabase = await createClient()
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id, user_id")
      .eq("id", employeeId)
      .maybeSingle()
    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }
    if (!employee.user_id) {
      return { ok: false, error: "Employee has no linked user account" }
    }
    const userId = employee.user_id

    const rows = ALL_ACTIONS.map((action) => ({
      user_id: userId,
      facility_id: employee.facility_id,
      module_name: moduleKey,
      action,
      enabled: enabledActions.has(action),
      source: "manual_override",
    }))

    const { error } = await supabase
      .from("user_permissions")
      .upsert(rows, { onConflict: "user_id,facility_id,module_name,action" })
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    logServerError("admin/employees/[id]/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/**
 * Clear the explicit override by removing the employee's user_permissions rows
 * for the module. The new model has no runtime fallback chain, so this revokes
 * the module unless a later role-default re-seed grants it again.
 */
export async function clearEmployeeModuleOverride(
  employeeId: string,
  moduleKey: string,
): Promise<ActionResult> {
  try {
    await requireAdmin()
    assertValidModuleKey(moduleKey)

    const supabase = await createClient()
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id, user_id")
      .eq("id", employeeId)
      .maybeSingle()
    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }
    if (!employee.user_id) {
      return { ok: false, error: "Employee has no linked user account" }
    }

    const { error } = await supabase
      .from("user_permissions")
      .delete()
      .eq("user_id", employee.user_id)
      .eq("facility_id", employee.facility_id)
      .eq("module_name", moduleKey)
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    revalidatePath("/admin/permissions")
    return { ok: true }
  } catch (e) {
    logServerError("admin/employees/[id]/actions", e)
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
    logServerError("admin/employees/[id]/actions", e)
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
    logServerError("admin/employees/[id]/actions", e)
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

    // Link to the certification catalog (migration 169) so scheduling
    // enforcement matches by id, not by fragile name equality.
    const type = await resolveCertificationType(
      supabase,
      employee.facility_id,
      input.name
    )
    if (!type.ok) return { ok: false, error: type.error }

    const { error } = await supabase
      .from("employee_certifications")
      .insert({
        facility_id: employee.facility_id,
        employee_id: employeeId,
        name: input.name.trim(),
        certification_type_id: type.id,
        issuer: input.issuer?.trim() || null,
        issued_at: input.issued_at || null,
        expires_at: input.expires_at || null,
        notes: input.notes?.trim() || null,
      })
    if (error) return { ok: false, error: error.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true }
  } catch (e) {
    logServerError("admin/employees/[id]/actions", e)
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
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id")
      .eq("id", employeeId)
      .maybeSingle()
    if (empErr) return { ok: false, error: empErr.message }
    if (!employee) return { ok: false, error: "Employee not found" }

    // Re-link on rename so the catalog reference tracks the edited name.
    const type = await resolveCertificationType(
      supabase,
      employee.facility_id,
      input.name
    )
    if (!type.ok) return { ok: false, error: type.error }

    const { error } = await supabase
      .from("employee_certifications")
      .update({
        name: input.name.trim(),
        certification_type_id: type.id,
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
    logServerError("admin/employees/[id]/actions", e)
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
    logServerError("admin/employees/[id]/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}
