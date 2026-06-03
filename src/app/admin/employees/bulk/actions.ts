"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { inviteEmployeeByEmail } from "@/lib/auth/invite-employee"
import { seedRolePermissionDefaults } from "@/lib/permissions/seed"
import { createClient } from "@/lib/supabase/server"

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

type SupabaseError = { code?: string; message?: string } | null

function dbError(err: SupabaseError, fallback: string): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "Duplicate — that email or employee code already exists."
  }
  return err.message?.trim() || fallback
}

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
      supabase.from("roles").select("id, key, display_name").eq("facility_id", facilityId),
      supabase.from("employees").select("email").eq("facility_id", facilityId),
    ])

    const roleIds = new Set((rolesRaw ?? []).map((r) => r.id as string))
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
    }))
    const batchEmailCounts = buildBatchEmailCounts(asBulkRows)

    const current = await getCurrentUser()
    const createdBy = current?.profile?.id ?? null

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
        results.push({
          index: i,
          ok: false,
          name,
          error: `${firstField}: ${errors[firstField]}`,
        })
        continue
      }

      const hireDate = normalizeHireDate(row.hireDate)

      // Atomic insert via the same RPC the single-add flow uses. RLS +
      // SECURITY DEFINER authz inside the function enforce facility isolation.
      const { data: employeeId, error: rpcErr } = await supabase.rpc(
        "create_employee_complete",
        {
          p_facility_id: facilityId,
          p_role_id: row.roleId,
          p_first_name: row.firstName.trim(),
          p_last_name: row.lastName.trim(),
          p_email: row.email.trim(),
          p_hire_date: hireDate ?? undefined,
          p_created_by: createdBy ?? undefined,
        }
      )

      if (rpcErr || !employeeId) {
        results.push({
          index: i,
          ok: false,
          name,
          error: dbError(rpcErr, "Failed to create employee."),
        })
        continue
      }

      // Reserve this email so a later duplicate row in the SAME batch is
      // rejected rather than hitting a DB unique-violation.
      existingEmails.add(row.email.trim().toLowerCase())

      // Optionally provision a login + seed the role's default permissions.
      // Mirrors createEmployee: invite/seed failures are soft warnings, never
      // a rollback of the created employee.
      let warning: string | undefined
      if (args.sendInvites) {
        const invite = await inviteEmployeeByEmail({
          employeeId: employeeId as string,
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

      results.push({ index: i, ok: true, name, warning })
    }

    revalidatePath("/admin/employees")
    return { ok: true, results }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
