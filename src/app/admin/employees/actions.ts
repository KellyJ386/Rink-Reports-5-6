"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { inviteEmployeeByEmail } from "@/lib/auth/invite-employee"
import { createClient } from "@/lib/supabase/server"

import type { ActionState, EmployeeFormInput } from "./types"

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
  }
  return err.message?.trim() || fallback
}

function nonEmpty(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function requireString(
  value: FormDataEntryValue | null,
  field: string
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `${field} is required.` }
  }
  return { ok: true, value: value.trim() }
}

function parseFormInput(
  formData: FormData
): { ok: true; value: EmployeeFormInput } | { ok: false; error: string } {
  const first = requireString(formData.get("first_name"), "First name")
  if (!first.ok) return first
  if (first.value.length > 100) return { ok: false, error: "First name is too long (max 100 chars)." }
  const last = requireString(formData.get("last_name"), "Last name")
  if (!last.ok) return last
  if (last.value.length > 100) return { ok: false, error: "Last name is too long (max 100 chars)." }
  const role = requireString(formData.get("role_id"), "Role")
  if (!role.ok) return role

  const emailRaw = nonEmpty(formData.get("email"))
  if (emailRaw && emailRaw.length > 254) return { ok: false, error: "Email is too long." }

  const phoneRaw = nonEmpty(formData.get("phone"))
  if (phoneRaw && phoneRaw.length > 30) return { ok: false, error: "Phone number is too long." }

  const isMinor = formData.get("is_minor") === "on"

  // Departments: multi-value field "department_ids"
  const department_ids = formData
    .getAll("department_ids")
    .filter((v): v is string => typeof v === "string")
  const primary_department_id = nonEmpty(formData.get("primary_department_id"))

  // Validate primary is included in selected departments
  if (
    primary_department_id &&
    !department_ids.includes(primary_department_id)
  ) {
    department_ids.push(primary_department_id)
  }

  const emergency_name = nonEmpty(formData.get("emergency_contact_name"))
  const emergency_phone = nonEmpty(formData.get("emergency_contact_phone"))

  // Per spec: emergency contact required UNLESS the employee is a minor.
  if (!isMinor) {
    if (!emergency_name) {
      return { ok: false, error: "Emergency contact name is required." }
    }
    if (!emergency_phone) {
      return { ok: false, error: "Emergency contact phone is required." }
    }
  }

  return {
    ok: true,
    value: {
      first_name: first.value,
      last_name: last.value,
      role_id: role.value,
      primary_department_id,
      department_ids,
      employee_code: nonEmpty(formData.get("employee_code")),
      email: nonEmpty(formData.get("email")),
      phone: nonEmpty(formData.get("phone")),
      is_minor: isMinor,
      emergency_contact_name: emergency_name,
      emergency_contact_phone: emergency_phone,
      hire_date: nonEmpty(formData.get("hire_date")),
    },
  }
}

type CustomFieldDefRow = {
  id: string
  key: string
  label: string
  field_type: "text" | "number" | "date" | "boolean"
  is_required: boolean
  is_active: boolean
}

/**
 * Read facility-scoped custom field definitions from the form and persist
 * the per-employee values. Inactive definitions are loaded too so existing
 * values aren't accidentally wiped just because the field was deactivated.
 *
 * Returns an error string on validation failure; null on success.
 */
async function persistCustomFieldValues(
  employeeId: string,
  facilityId: string,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient()
  const { data: defsRaw, error: defsErr } = await supabase
    .from("employee_custom_fields")
    .select("id, key, label, field_type, is_required, is_active")
    .eq("facility_id", facilityId)
  if (defsErr) return defsErr.message
  const defs = (defsRaw ?? []) as CustomFieldDefRow[]
  if (defs.length === 0) return null

  const toUpsert: Array<{
    facility_id: string
    employee_id: string
    field_id: string
    value: string
  }> = []
  const toDelete: string[] = []

  for (const def of defs) {
    const name = `cf_${def.id}`
    const raw = formData.get(name)

    let value: string | null
    if (def.field_type === "boolean") {
      value = raw === "on" || raw === "true" ? "true" : "false"
    } else if (typeof raw === "string" && raw.trim() !== "") {
      value = raw.trim()
    } else {
      value = null
    }

    // Only require ACTIVE fields. A deactivated required field shouldn't
    // block edits to the rest of the employee record.
    if (def.is_active && def.is_required && def.field_type !== "boolean") {
      if (!value) {
        return `${def.label} is required.`
      }
    }

    if (def.field_type === "number" && value !== null) {
      if (!Number.isFinite(Number(value))) {
        return `${def.label} must be a number.`
      }
    }
    if (def.field_type === "date" && value !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return `${def.label} must be a YYYY-MM-DD date.`
      }
    }

    if (value === null) {
      toDelete.push(def.id)
    } else {
      toUpsert.push({
        facility_id: facilityId,
        employee_id: employeeId,
        field_id: def.id,
        value,
      })
    }
  }

  if (toUpsert.length > 0) {
    const { error: upErr } = await supabase
      .from("employee_custom_field_values")
      .upsert(toUpsert, { onConflict: "employee_id,field_id" })
    if (upErr) return upErr.message
  }
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("employee_custom_field_values")
      .delete()
      .eq("employee_id", employeeId)
      .in("field_id", toDelete)
    if (delErr) return delErr.message
  }

  return null
}

async function resolveFacilityIdFromForm(
  formData: FormData
): Promise<{ ok: true; facilityId: string } | { ok: false; error: string }> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }

  // Non-super-admins: ALWAYS use their profile facility, ignoring any
  // form-provided value (defense-in-depth — the form is attacker-controlled).
  if (!profile.is_super_admin) {
    if (!profile.facility_id) {
      return { ok: false, error: "No facility assigned to your account." }
    }
    return { ok: true, facilityId: profile.facility_id }
  }

  // Super admin: accept the form value, but verify the facility exists.
  const fromForm = nonEmpty(formData.get("facility_id"))
  if (!fromForm) {
    return { ok: false, error: "Super admin requires explicit facility id." }
  }

  const supabase = await createClient()
  const { data: facilityRow, error: facilityErr } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", fromForm)
    .maybeSingle()

  if (facilityErr || !facilityRow) {
    return { ok: false, error: "Invalid facility id." }
  }

  return { ok: true, facilityId: fromForm }
}

export async function createEmployee(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdmin()
    const facility = await resolveFacilityIdFromForm(formData)
    if (!facility.ok) return { ok: false, error: facility.error }

    const parsed = parseFormInput(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const input = parsed.value

    const supabase = await createClient()
    const current = await getCurrentUser()
    const createdBy = current?.profile?.id ?? null

    // Atomically creates the employee row and department links in one DB
    // transaction, eliminating the previous best-effort rollback pattern.
    const { data: employeeId, error: rpcErr } = await supabase.rpc(
      "create_employee_complete",
      {
        p_facility_id: facility.facilityId,
        p_role_id: input.role_id,
        p_first_name: input.first_name,
        p_last_name: input.last_name,
        p_email: input.email ?? null,
        p_phone: input.phone ?? null,
        p_employee_code: input.employee_code ?? null,
        p_is_minor: input.is_minor,
        p_emergency_contact_name: input.emergency_contact_name ?? null,
        p_emergency_contact_phone: input.emergency_contact_phone ?? null,
        p_hire_date: input.hire_date ?? null,
        p_created_by: createdBy,
        p_department_ids: input.department_ids.length > 0 ? input.department_ids : null,
        p_primary_department_id: input.primary_department_id ?? null,
      },
    )

    if (rpcErr || !employeeId) {
      return {
        ok: false,
        error: dbError(rpcErr, "Failed to create employee."),
      }
    }

    const cfErr = await persistCustomFieldValues(
      employeeId,
      facility.facilityId,
      formData,
    )
    if (cfErr) return { ok: false, error: cfErr }

    // Send the welcome / set-password invite. Failure here does NOT roll back
    // the employee record — the admin can re-send later via the row action.
    let inviteWarning: string | null = null
    if (input.email) {
      const invite = await inviteEmployeeByEmail({
        employeeId: employeeId as string,
        facilityId: facility.facilityId,
        email: input.email,
        fullName: `${input.first_name} ${input.last_name}`.trim(),
      })
      if (!invite.ok) {
        inviteWarning = invite.error
      }
    }

    revalidatePath("/admin/employees")
    return {
      ok: true,
      message: inviteWarning
        ? `Employee created. Invite email failed: ${inviteWarning}`
        : input.email
          ? "Employee created. Invite email sent — they'll set their password from the link."
          : "Employee created. Add an email to send them an access invite.",
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function updateEmployee(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireAdmin()
    const id = nonEmpty(formData.get("id"))
    if (!id) return { ok: false, error: "Missing employee id." }

    const facility = await resolveFacilityIdFromForm(formData)
    if (!facility.ok) return { ok: false, error: facility.error }

    const parsed = parseFormInput(formData)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const input = parsed.value

    const supabase = await createClient()

    const { error: updErr } = await supabase
      .from("employees")
      .update({
        role_id: input.role_id,
        employee_code: input.employee_code,
        first_name: input.first_name,
        last_name: input.last_name,
        email: input.email,
        phone: input.phone,
        is_minor: input.is_minor,
        emergency_contact_name: input.emergency_contact_name,
        emergency_contact_phone: input.emergency_contact_phone,
        hire_date: input.hire_date,
      })
      .eq("id", id)
      .eq("facility_id", facility.facilityId)

    if (updErr) {
      return { ok: false, error: dbError(updErr, "Failed to update employee.") }
    }

    // Reconcile employee_departments.
    const { data: existingRaw, error: selErr } = await supabase
      .from("employee_departments")
      .select("id, department_id, is_primary")
      .eq("employee_id", id)

    if (selErr) {
      return { ok: false, error: dbError(selErr, "Failed to load departments.") }
    }

    const existing = (existingRaw ?? []) as Array<{
      id: string
      department_id: string
      is_primary: boolean
    }>

    const desired = new Set(input.department_ids)
    const existingMap = new Map(existing.map((r) => [r.department_id, r]))

    const toDelete = existing
      .filter((r) => !desired.has(r.department_id))
      .map((r) => r.id)

    const toInsert = input.department_ids
      .filter((d) => !existingMap.has(d))
      .map((deptId) => ({
        facility_id: facility.facilityId,
        employee_id: id,
        department_id: deptId,
        is_primary: deptId === input.primary_department_id,
      }))

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from("employee_departments")
        .delete()
        .in("id", toDelete)
      if (delErr) {
        return {
          ok: false,
          error: dbError(delErr, "Failed to remove departments."),
        }
      }
    }

    // Clear is_primary on rows that should no longer be primary, BEFORE we
    // set the new primary — the partial unique index forbids two primaries.
    const rowsToUnsetPrimary = existing
      .filter(
        (r) =>
          desired.has(r.department_id) &&
          r.is_primary &&
          r.department_id !== input.primary_department_id
      )
      .map((r) => r.id)

    if (rowsToUnsetPrimary.length > 0) {
      const { error: unsetErr } = await supabase
        .from("employee_departments")
        .update({ is_primary: false })
        .in("id", rowsToUnsetPrimary)
      if (unsetErr) {
        return {
          ok: false,
          error: dbError(unsetErr, "Failed to update primary department."),
        }
      }
    }

    if (toInsert.length > 0) {
      const { error: insErr } = await supabase
        .from("employee_departments")
        .insert(toInsert)
      if (insErr) {
        return {
          ok: false,
          error: dbError(insErr, "Failed to assign departments."),
        }
      }
    }

    // Set is_primary on the chosen primary if it's an existing row that wasn't primary.
    if (input.primary_department_id) {
      const existingRow = existingMap.get(input.primary_department_id)
      if (existingRow && !existingRow.is_primary) {
        const { error: setErr } = await supabase
          .from("employee_departments")
          .update({ is_primary: true })
          .eq("id", existingRow.id)
        if (setErr) {
          return {
            ok: false,
            error: dbError(setErr, "Failed to set primary department."),
          }
        }
      }
    }

    const cfErr = await persistCustomFieldValues(id, facility.facilityId, formData)
    if (cfErr) return { ok: false, error: cfErr }

    revalidatePath("/admin/employees")
    return { ok: true, message: "Employee updated." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deactivateEmployee(id: string): Promise<ActionState> {
  try {
    const current = await requireAdmin()
    if (!id) return { ok: false, error: "Missing employee id." }
    const supabase = await createClient()
    const callerFacilityId = current.profile?.facility_id ?? null
    // For super-admins with no assigned facility, look up the employee's
    // facility_id so the update is always scoped to the correct facility.
    const facilityId =
      callerFacilityId ??
      (await (async () => {
        const { data } = await supabase
          .from("employees")
          .select("facility_id")
          .eq("id", id)
          .maybeSingle()
        return data?.facility_id ?? null
      })())
    if (!facilityId) return { ok: false, error: "Could not resolve facility." }
    const { error } = await supabase
      .from("employees")
      .update({ is_active: false, deactivated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("facility_id", facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to deactivate.") }
    }
    revalidatePath("/admin/employees")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function reactivateEmployee(id: string): Promise<ActionState> {
  try {
    const current = await requireAdmin()
    if (!id) return { ok: false, error: "Missing employee id." }
    const supabase = await createClient()
    const callerFacilityId = current.profile?.facility_id ?? null
    const facilityId =
      callerFacilityId ??
      (await (async () => {
        const { data } = await supabase
          .from("employees")
          .select("facility_id")
          .eq("id", id)
          .maybeSingle()
        return data?.facility_id ?? null
      })())
    if (!facilityId) return { ok: false, error: "Could not resolve facility." }
    const { error } = await supabase
      .from("employees")
      .update({ is_active: true, deactivated_at: null })
      .eq("id", id)
      .eq("facility_id", facilityId)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to reactivate.") }
    }
    revalidatePath("/admin/employees")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

export async function deleteEmployee(id: string): Promise<ActionState> {
  try {
    if (!id) return { ok: false, error: "Missing employee id." }
    const current = await requireAdmin()
    if (!current.profile?.is_super_admin) {
      return { ok: false, error: "Only super admins can delete employees." }
    }
    const supabase = await createClient()
    const { error } = await supabase.from("employees").delete().eq("id", id)
    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete.") }
    }
    revalidatePath("/admin/employees")
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}

// Canonical roles to seed when a facility has none.
// We do NOT call seed_default_roles_for_facility() because that RPC is granted
// to service_role only. Instead we upsert directly — RLS allows admin/gm/
// super_admin to insert into roles for their own facility.
const CANONICAL_ROLES = [
  { key: "super_admin", display_name: "Super Admin", hierarchy_level: 0 },
  { key: "admin", display_name: "Administrator", hierarchy_level: 1 },
  { key: "gm", display_name: "General Manager", hierarchy_level: 2 },
  { key: "manager", display_name: "Manager", hierarchy_level: 3 },
  { key: "supervisor", display_name: "Supervisor", hierarchy_level: 4 },
  { key: "staff", display_name: "Staff", hierarchy_level: 5 },
] as const

export async function seedRolesForCurrentFacility(
  facilityId: string
): Promise<ActionState> {
  try {
    await requireAdmin()
    if (!facilityId) {
      return { ok: false, error: "Missing facility id." }
    }
    const supabase = await createClient()
    const rows = CANONICAL_ROLES.map((r) => ({
      facility_id: facilityId,
      key: r.key,
      display_name: r.display_name,
      hierarchy_level: r.hierarchy_level,
      is_system: true,
    }))
    const { error } = await supabase
      .from("roles")
      .upsert(rows, { onConflict: "facility_id,key" })
    if (error) {
      return { ok: false, error: dbError(error, "Failed to seed roles.") }
    }
    revalidatePath("/admin/employees")
    return { ok: true, message: "Default roles created." }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error.",
    }
  }
}
