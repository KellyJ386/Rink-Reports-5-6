"use server"

import { revalidatePath } from "next/cache"

import { createClient as createServiceClient } from "@supabase/supabase-js"

import { requireAdmin } from "@/lib/auth"
import { PERMISSION_LEVELS, type PermissionLevel } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database"

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

    const { error } = await supabase
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

/**
 * Send a Supabase Auth invitation to the employee's email address and link the
 * resulting auth user to the employee row.
 *
 * Two scenarios are handled:
 *   A) The email is NOT already registered → inviteUserByEmail sends the invite
 *      email, we pre-create the public.users profile and set employees.user_id.
 *   B) The email IS already registered (user exists in public.users) → skip the
 *      invite, just link employees.user_id to the existing user.
 *
 * Returns { ok: true, invited: true }  — invite email sent
 *         { ok: true, invited: false } — existing user linked (no email sent)
 */
export async function inviteEmployee(
  employeeId: string,
): Promise<ActionResult & { invited?: boolean }> {
  try {
    await requireAdmin()

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return { ok: false, error: "Server configuration error: missing service role key." }
    }

    const supabase = await createClient()

    // Load the employee — scoped by RLS to the caller's facility.
    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id, first_name, last_name, email, user_id")
      .eq("id", employeeId)
      .maybeSingle()

    if (empErr) return { ok: false, error: empErr.message }
    if (!emp) return { ok: false, error: "Employee not found." }
    if (!emp.email) return { ok: false, error: "Employee has no email address set." }
    if (emp.user_id) return { ok: false, error: "Employee is already linked to a user account." }

    // Service-role client bypasses RLS for auth admin operations and profile upserts.
    const adminClient = createServiceClient<Database>(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Scenario B: check if a public.users profile already exists for this email.
    const { data: existingUsers } = await adminClient
      .from("users")
      .select("id, email")
      .eq("email", emp.email)
      .limit(1)

    const existingUser = existingUsers?.[0] ?? null

    if (existingUser) {
      // Link the existing user to the employee without sending a new invite.
      const { error: linkErr } = await supabase
        .from("employees")
        .update({ user_id: existingUser.id })
        .eq("id", employeeId)
      if (linkErr) return { ok: false, error: linkErr.message }

      revalidatePath(`/admin/employees/${employeeId}`)
      return { ok: true, invited: false }
    }

    // Scenario A: send the invite email and pre-create the profile.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ""
    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      emp.email,
      {
        redirectTo: `${siteUrl}/login`,
        data: { full_name: `${emp.first_name} ${emp.last_name}` },
      },
    )

    if (inviteErr) return { ok: false, error: inviteErr.message }

    const newUserId = inviteData.user?.id
    if (!newUserId) return { ok: false, error: "Invite succeeded but returned no user id." }

    // Pre-create the public.users profile so the invited user can sign in
    // without hitting the signup form (the invite link bypasses it).
    await adminClient.from("users").upsert(
      {
        id: newUserId,
        email: emp.email,
        full_name: `${emp.first_name} ${emp.last_name}`,
        facility_id: emp.facility_id,
      },
      { onConflict: "id" },
    )

    // Link the employee to the new auth user.
    const { error: linkErr } = await supabase
      .from("employees")
      .update({ user_id: newUserId })
      .eq("id", employeeId)
    if (linkErr) return { ok: false, error: linkErr.message }

    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true, invited: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}
