"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { inviteEmployeeByEmail } from "@/lib/auth/invite-employee"
import { seedRolePermissionDefaults } from "@/lib/permissions/seed"
import { createAdminClient } from "@/lib/supabase/admin"
import { checkSiteUrlEnv } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import {
  createEmployeeComplete,
  reconcileJobAreaAssignments,
  resolveJobAreaAssignments,
} from "./_lib/job-areas"
import type { ActionState, EmployeeFormInput } from "./types"

type ActionResult = { ok: true } | { ok: false; error: string }

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
  }
  return err.message?.trim() || fallback
}

// Maps GoTrue / Supabase Auth admin error messages to user-friendly copy.
// In particular, hides the raw "This endpoint requires a valid Bearer token"
// (signals a misconfigured/rotated SUPABASE_SERVICE_ROLE_KEY) from admins.
function friendlyInviteError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim()
  if (!msg) return "Failed to send the invitation email."
  if (/bearer\s+token/i.test(msg) || /not\s*authoriz/i.test(msg)) {
    return "Email invitations aren't available right now — service-role credentials are missing or invalid. Contact your administrator."
  }
  return msg
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
  const needsLogin = formData.get("needs_login") === "on"

  // A login can only be provisioned against an email address.
  if (needsLogin && !emailRaw) {
    return { ok: false, error: "An email is required to create a login for this employee." }
  }

  // Job areas: multi-value field "job_area_ids" (+ optional primary). Dedupe
  // and cap here so the form gets a clean error; the shared helper + DB trigger
  // are the authoritative backstops.
  const job_area_ids = Array.from(
    new Set(
      formData
        .getAll("job_area_ids")
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    )
  )
  if (job_area_ids.length > 4) {
    return { ok: false, error: "An employee can be assigned at most 4 job areas." }
  }
  let primary_job_area_id = nonEmpty(formData.get("primary_job_area_id"))
  if (primary_job_area_id && !job_area_ids.includes(primary_job_area_id)) {
    primary_job_area_id = null
  }
  // Hidden marker the job-area control emits so the edit path can tell an
  // intentional empty set apart from "the form didn't include this field".
  const job_areas_submitted = formData.has("job_areas_present")

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
      employee_code: nonEmpty(formData.get("employee_code")),
      email: nonEmpty(formData.get("email")),
      phone: nonEmpty(formData.get("phone")),
      is_minor: isMinor,
      emergency_contact_name: emergency_name,
      emergency_contact_phone: emergency_phone,
      hire_date: nonEmpty(formData.get("hire_date")),
      job_area_ids,
      primary_job_area_id,
      job_areas_submitted,
      needs_login: needsLogin,
    },
  }
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

    // Atomically creates the employee row + department links + job-area links
    // in one DB transaction (shared with the bulk-add path), eliminating the
    // previous best-effort rollback pattern. Job areas are validated in app
    // code first so a foreign id / over-cap set yields a clean error.
    const created = await createEmployeeComplete(supabase, {
      facilityId: facility.facilityId,
      roleId: input.role_id,
      firstName: input.first_name,
      lastName: input.last_name,
      email: input.email ?? undefined,
      phone: input.phone ?? undefined,
      employeeCode: input.employee_code ?? undefined,
      isMinor: input.is_minor,
      emergencyContactName: input.emergency_contact_name ?? undefined,
      emergencyContactPhone: input.emergency_contact_phone ?? undefined,
      hireDate: input.hire_date ?? undefined,
      createdBy: createdBy ?? undefined,
      jobAreaIds: input.job_area_ids,
      primaryJobAreaId: input.primary_job_area_id ?? undefined,
    })

    if (!created.ok) {
      return { ok: false, error: created.error }
    }
    const employeeId = created.employeeId

    // Provision a login only when the admin opted in ("Needs system login").
    // On success we link employees.user_id and seed this role's default
    // permissions. Failures here do NOT roll back the employee record — the
    // admin can retry later via the row "Invite" action, which also seeds.
    let inviteWarning: string | null = null
    let provisioned = false
    if (input.needs_login && input.email) {
      const invite = await inviteEmployeeByEmail({
        employeeId: employeeId as string,
        facilityId: facility.facilityId,
        email: input.email,
        fullName: `${input.first_name} ${input.last_name}`.trim(),
      })
      if (!invite.ok) {
        inviteWarning = invite.error
      } else {
        provisioned = true
        const seed = await seedRolePermissionDefaults({
          userId: invite.userId,
          facilityId: facility.facilityId,
          roleId: input.role_id,
        })
        if (!seed.ok) {
          inviteWarning = `Login created, but permissions weren't applied: ${seed.error}`
        }
      }
    }

    revalidatePath("/admin/employees")
    return {
      ok: true,
      message: inviteWarning
        ? `Employee created. ${inviteWarning}`
        : provisioned
          ? "Employee created. Invite sent and role permissions applied — they'll set their password from the link."
          : "Employee created (schedule-only — no login). Use “Invite” later to grant access.",
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

    // Capture the pre-update role + login link so we can re-seed permissions
    // when (and only when) the role actually changes for a provisioned user.
    const { data: before } = await supabase
      .from("employees")
      .select("user_id, role_id")
      .eq("id", id)
      .eq("facility_id", facility.facilityId)
      .maybeSingle()

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

    // Reconcile job-area assignments (Employee Scheduling) — but ONLY when the
    // form actually submitted the control, so an edit from a form that doesn't
    // render job areas doesn't silently wipe existing assignments. Validate the
    // desired set in app code (facility ownership + 4-area cap) BEFORE writing,
    // then diff-apply via the shared helper so this path can't diverge from
    // create/bulk.
    if (input.job_areas_submitted) {
      const resolvedAreas = await resolveJobAreaAssignments(
        supabase,
        facility.facilityId,
        input.job_area_ids,
        input.primary_job_area_id
      )
      if (!resolvedAreas.ok) {
        return { ok: false, error: resolvedAreas.error }
      }
      const reconciled = await reconcileJobAreaAssignments(
        supabase,
        id,
        facility.facilityId,
        resolvedAreas.assignments
      )
      if (!reconciled.ok) {
        return { ok: false, error: reconciled.error }
      }
    }

    // Role change → re-seed role-default permissions for the linked login.
    // Manual overrides are preserved; rows the new role drops are disabled.
    let roleWarning: string | null = null
    const beforeRow = before as { user_id: string | null; role_id: string } | null
    if (beforeRow?.user_id && beforeRow.role_id !== input.role_id) {
      const seed = await seedRolePermissionDefaults({
        userId: beforeRow.user_id,
        facilityId: facility.facilityId,
        roleId: input.role_id,
      })
      if (!seed.ok) {
        roleWarning = `Role updated, but permissions weren't re-applied: ${seed.error}`
      }
    }

    revalidatePath("/admin/employees")
    return {
      ok: true,
      message: roleWarning ?? "Employee updated.",
    }
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
// to service_role only. Instead we upsert directly — RLS allows admin/
// super_admin to insert into roles for their own facility.
const CANONICAL_ROLES = [
  { key: "super_admin", display_name: "Super Admin", hierarchy_level: 0 },
  { key: "admin", display_name: "Administrator", hierarchy_level: 1 },
  { key: "manager", display_name: "Manager", hierarchy_level: 2 },
  { key: "staff", display_name: "Staff", hierarchy_level: 3 },
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

    // Single source of truth for the service-role client. Throws with a
    // specific reason if the env is missing/placeholder/malformed — surfaced
    // to the admin so they can fix it without diving into logs.
    let adminClient: ReturnType<typeof createAdminClient>
    try {
      adminClient = createAdminClient()
    } catch (e) {
      const detail = e instanceof Error ? e.message : "unknown configuration error"
      return {
        ok: false,
        error: `Email invitations aren't available: ${detail}`,
      }
    }

    const supabase = await createClient()

    // Load the employee — scoped by RLS to the caller's facility.
    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id, facility_id, role_id, first_name, last_name, email, user_id")
      .eq("id", employeeId)
      .maybeSingle()

    if (empErr) return { ok: false, error: empErr.message }
    if (!emp) return { ok: false, error: "Employee not found." }
    if (!emp.email) return { ok: false, error: "Employee has no email address set." }
    if (emp.user_id) return { ok: false, error: "Employee is already linked to a user account." }

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

      // Seed this role's default permissions now that a login is linked.
      await seedRolePermissionDefaults({
        userId: existingUser.id,
        facilityId: emp.facility_id,
        roleId: emp.role_id,
      })

      revalidatePath("/admin/employees")
      revalidatePath(`/admin/employees/${employeeId}`)
      return { ok: true, invited: false }
    }

    // Scenario A: send the invite email and pre-create the profile.
    const site = checkSiteUrlEnv()
    if (!site.ok) return { ok: false, error: site.error.message }
    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      emp.email,
      {
        redirectTo: `${site.siteUrl}/login`,
        data: { full_name: `${emp.first_name} ${emp.last_name}` },
      },
    )

    if (inviteErr) return { ok: false, error: friendlyInviteError(inviteErr.message) }

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

    // Seed this role's default permissions now that a login is linked.
    await seedRolePermissionDefaults({
      userId: newUserId,
      facilityId: emp.facility_id,
      roleId: emp.role_id,
    })

    revalidatePath("/admin/employees")
    revalidatePath(`/admin/employees/${employeeId}`)
    return { ok: true, invited: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}
