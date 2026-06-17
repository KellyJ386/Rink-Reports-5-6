"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { inviteEmployeeByEmail } from "@/lib/auth/invite-employee"
import {
  callerHierarchyFloor,
  canAssignRoleLevel,
} from "@/lib/permissions/role-assignment"
import { seedRolePermissionDefaults } from "@/lib/permissions/seed"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"

import { createEmployeeComplete } from "../_lib/job-areas"
import {
  buildBatchEmailCounts,
  normalizeHireDate,
  validateRow,
} from "./_lib/validation"
import type {
  BulkCreateResult,
  BulkEmployeeInput,
  BulkRow,
  BulkRowResult,
} from "./types"

// Hard cap so a runaway paste can't fan out into hundreds of invite emails /
// DB round-trips in one request.
const MAX_ROWS = 100

/**
 * Resolve the facility the bulk insert targets.
 *
 * Non-super-admins ALWAYS use their own profile facility, ignoring the
 * client-supplied id (the payload is attacker-controlled). Super admins must
 * pass an explicit, existing facility id. Mirrors `resolveFacilityIdFromForm`
 * in the single-employee actions.
 */
async function resolveFacilityId(
  facilityIdFromClient: string | null
): Promise<{ ok: true; facilityId: string } | { ok: false; error: string }> {
  const current = await getCurrentUser()
  const profile = current?.profile
  if (!profile) return { ok: false, error: "Not signed in." }

  if (!profile.is_super_admin) {
    if (!profile.facility_id) {
      return { ok: false, error: "No facility assigned to your account." }
    }
    return { ok: true, facilityId: profile.facility_id }
  }

  const fromClient = facilityIdFromClient?.trim()
  if (!fromClient) {
    return { ok: false, error: "Super admin requires an explicit facility." }
  }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", fromClient)
    .maybeSingle()
  if (error || !data) return { ok: false, error: "Invalid facility id." }
  return { ok: true, facilityId: fromClient }
}

function displayName(row: BulkEmployeeInput): string {
  return `${row.firstName} ${row.lastName}`.trim() || "(unnamed)"
}

export async function bulkCreateEmployees(args: {
  facilityId: string | null
  sendInvites: boolean
  rows: BulkEmployeeInput[]
}): Promise<BulkCreateResult> {
  try {
    await requireAdmin()

    const facility = await resolveFacilityId(args.facilityId)
    if (!facility.ok) return { ok: false, error: facility.error }
    const facilityId = facility.facilityId

    const rows = Array.isArray(args.rows) ? args.rows : []
    if (rows.length === 0) {
      return { ok: false, error: "No employees to add." }
    }
    if (rows.length > MAX_ROWS) {
      return {
        ok: false,
        error: `Too many rows (${rows.length}). Add at most ${MAX_ROWS} at a time.`,
      }
    }

    const supabase = await createClient()

    // Load the facility's roles and existing employee emails so server-side
    // validation matches the client's (and catches anything tampered with).
    const [{ data: rolesRaw }, { data: empEmailsRaw }] = await Promise.all([
      supabase
        .from("roles")
        .select("id, key, display_name, hierarchy_level")
        .eq("facility_id", facilityId),
      supabase.from("employees").select("email").eq("facility_id", facilityId),
    ])

    const roleIds = new Set((rolesRaw ?? []).map((r) => r.id as string))
    // Tier of each role, for the privilege-escalation guard below.
    const roleLevels = new Map(
      (rolesRaw ?? []).map((r) => [r.id as string, r.hierarchy_level as number | null]),
    )
    const existingEmails = new Set(
      (empEmailsRaw ?? [])
        .map((r) => (r.email as string | null)?.trim().toLowerCase())
        .filter((e): e is string => !!e)
    )

    // Re-validate using the SAME pure rules as the client. Build a BulkRow[]
    // shim (the validators key off the BulkRow shape).
    const asBulkRows: BulkRow[] = rows.map((r, i) => ({
      id: String(i),
      firstName: r.firstName ?? "",
      lastName: r.lastName ?? "",
      email: r.email ?? "",
      hireDate: r.hireDate ?? "",
      roleId: r.roleId ?? "",
      // The server receives already-resolved ids; name-based unmatched/duplicate
      // checks are client-only. Job-area facility ownership + the 4-area cap are
      // re-enforced authoritatively in createEmployeeComplete / the DB trigger.
      jobAreaIds: r.jobAreaIds ?? [],
    }))
    const batchEmailCounts = buildBatchEmailCounts(asBulkRows)

    const current = await getCurrentUser()
    const createdBy = current?.profile?.id ?? null

    // Privilege guard inputs (computed once, applied per row): a non-super-admin
    // must not bulk-assign an admin-tier role and mint another facility admin.
    const isSuperAdmin = current?.profile?.is_super_admin ?? false
    const callerFloor = isSuperAdmin ? null : await callerHierarchyFloor(facilityId)

    const results: BulkRowResult[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const name = displayName(row)

      const errors = validateRow(asBulkRows[i], {
        roleIds,
        existingEmails,
        batchEmailCounts,
      })
      if (Object.keys(errors).length > 0) {
        const firstField = Object.keys(errors)[0] as keyof typeof errors
        const message = `${firstField}: ${errors[firstField]}`
        results.push({
          index: i,
          name,
          status: "failed",
          reason: { code: "VALIDATION", message },
          ok: false,
          error: message,
        })
        continue
      }

      // Block non-super-admins from assigning an admin-tier (or higher) role.
      if (!canAssignRoleLevel(roleLevels.get(row.roleId) ?? null, callerFloor, isSuperAdmin)) {
        const message = "roleId: Only a super admin can assign an admin-tier role."
        results.push({
          index: i,
          name,
          status: "failed",
          reason: { code: "VALIDATION", message },
          ok: false,
          error: message,
        })
        continue
      }

      const hireDate = normalizeHireDate(row.hireDate)

      // Atomic insert (employee row + job-area links in one transaction) via
      // the shared helper the single-add flow also uses. Job-area facility
      // ownership + the 4-area cap are validated in app code first, so a bad
      // area set fails this row cleanly without leaving a half-created
      // employee. RLS + SECURITY DEFINER authz enforce facility isolation.
      const created = await createEmployeeComplete(supabase, {
        facilityId,
        roleId: row.roleId,
        firstName: row.firstName.trim(),
        lastName: row.lastName.trim(),
        email: row.email.trim(),
        hireDate: hireDate ?? undefined,
        createdBy: createdBy ?? undefined,
        jobAreaIds: row.jobAreaIds,
        primaryJobAreaId: row.primaryJobAreaId ?? undefined,
      })

      if (!created.ok) {
        results.push({
          index: i,
          name,
          status: "failed",
          reason: { code: created.code, message: created.error },
          ok: false,
          error: created.error,
        })
        continue
      }

      // Reserve this email so a later duplicate row in the SAME batch is
      // rejected rather than hitting a DB unique-violation.
      existingEmails.add(row.email.trim().toLowerCase())

      // Optionally provision a login + seed the role's default permissions.
      // Mirrors createEmployee: invite/seed failures are soft (the employee +
      // areas ARE created) -> reported as a `partial` row, never a rollback.
      let warning: string | undefined
      if (args.sendInvites) {
        const invite = await inviteEmployeeByEmail({
          employeeId: created.employeeId,
          facilityId,
          email: row.email.trim(),
          fullName: name,
        })
        if (!invite.ok) {
          warning = invite.error
        } else {
          const seed = await seedRolePermissionDefaults({
            userId: invite.userId,
            facilityId,
            roleId: row.roleId,
          })
          if (!seed.ok) {
            warning = `Login created, but permissions weren't applied: ${seed.error}`
          }
        }
      }

      if (warning) {
        results.push({
          index: i,
          name,
          status: "partial",
          reason: { code: "INVITE", message: warning },
          ok: true,
          warning,
        })
      } else {
        results.push({ index: i, name, status: "succeeded", ok: true })
      }
    }

    revalidatePath("/admin/employees")
    return { ok: true, results }
  } catch (e) {
    logServerError("admin/employees/bulk/actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
