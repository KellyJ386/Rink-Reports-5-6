import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Shared job-area assignment logic for the Employee Scheduling module.
 *
 * One source of truth for the three write paths (single add, single edit, bulk
 * add) so the rules can't diverge:
 *   - `resolveJobAreaAssignments` — validates + normalizes a desired set of
 *     job-area ids (facility ownership, 4-area cap, single primary).
 *   - `createEmployeeComplete`     — atomic employee + department + job-area
 *     insert via the create_employee_complete RPC (one DB transaction).
 *   - `reconcileJobAreaAssignments`— diff-applies a desired set to an existing
 *     employee (edit path).
 *
 * NOTE on typing: employee_job_areas / employee_job_area_assignments and the
 * 16-arg create_employee_complete signature are not yet in the generated
 * `src/types/database.ts`. Per the repo convention (see the offline_sync_queue
 * usage in src/app/api/offline-sync/route.ts) we cast through `any` at the
 * Supabase call sites until types are regenerated.
 */

// Hard cap, mirrored by the DB constraint trigger trg_employee_job_area_assignments_cap.
export const MAX_JOB_AREAS = 4

/** A validated, ready-to-write assignment. */
export type ResolvedJobAreaAssignment = { jobAreaId: string; isPrimary: boolean }

/** Machine-readable failure code so callers can render clean, specific copy. */
export type JobAreaErrorCode =
  | "OVER_CAP" // more than MAX_JOB_AREAS distinct areas requested
  | "FOREIGN_AREA" // an id doesn't belong to the target facility
  | "DUPLICATE" // unique-violation (e.g. email/employee_code) on create
  | "DB_ERROR" // anything else from the database

export type JobAreaError = { code: JobAreaErrorCode; error: string }

export type ResolveResult =
  | { ok: true; assignments: ResolvedJobAreaAssignment[] }
  | ({ ok: false } & JobAreaError)

type SupabaseLike = SupabaseClient

type DbError = { code?: string; message?: string } | null

function mapDbError(err: DbError, fallback: string): JobAreaError {
  if (err?.code === "23505") {
    return { code: "DUPLICATE", error: "Duplicate — that email or employee code already exists." }
  }
  // The constraint trigger raises check_violation (23514) when the cap is
  // exceeded; surface it as the clean OVER_CAP message rather than raw SQL.
  if (err?.code === "23514" && /job area/i.test(err?.message ?? "")) {
    return { code: "OVER_CAP", error: `An employee can be assigned at most ${MAX_JOB_AREAS} job areas.` }
  }
  return { code: "DB_ERROR", error: err?.message?.trim() || fallback }
}

/**
 * Validate and normalize a desired set of job-area ids for one employee.
 *
 * Semantics are REPLACE: `jobAreaIds` is the complete desired set, so the cap
 * check is simply `set size <= MAX_JOB_AREAS` (correct for both create — where
 * the employee starts with none — and edit — where this set replaces the old).
 *
 * Security: every id is verified to belong to `facilityId` via an explicit
 * facility-scoped query BEFORE any write. If ANY id is foreign the whole set
 * is rejected. We never trust client ids and never rely on RLS alone — the
 * explicit `.eq("facility_id", …)` scopes the check even for super admins
 * (whose RLS is bypassed) and the create RPC re-checks as defense in depth.
 *
 * Primary: at most one primary. The requested primary is honored only if it's
 * present in the set; otherwise all rows are left non-primary (mirrors the
 * optional-primary convention of employee_departments — we do NOT auto-promote
 * the first area).
 */
export async function resolveJobAreaAssignments(
  supabase: SupabaseLike,
  facilityId: string,
  jobAreaIds: string[] | null | undefined,
  primaryJobAreaId?: string | null
): Promise<ResolveResult> {
  // Dedupe, drop blanks.
  const ids = Array.from(
    new Set(
      (jobAreaIds ?? [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0)
    )
  )

  if (ids.length === 0) return { ok: true, assignments: [] }

  if (ids.length > MAX_JOB_AREAS) {
    return {
      ok: false,
      code: "OVER_CAP",
      error: `An employee can be assigned at most ${MAX_JOB_AREAS} job areas (got ${ids.length}).`,
    }
  }

  // Facility ownership — fetch only ids that belong to THIS facility.
  const { data, error } = await supabase
    .from("employee_job_areas")
    .select("id")
    .eq("facility_id", facilityId)
    .in("id", ids)

  if (error) return { ok: false, ...mapDbError(error, "Failed to validate job areas.") }

  const found = new Set<string>(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
  const foreign = ids.filter((id) => !found.has(id))
  if (foreign.length > 0) {
    return {
      ok: false,
      code: "FOREIGN_AREA",
      error: `${foreign.length} job area${foreign.length === 1 ? "" : "s"} not found in this facility.`,
    }
  }

  const primary = primaryJobAreaId?.trim() || null
  const primaryValid = primary && ids.includes(primary) ? primary : null

  return {
    ok: true,
    assignments: ids.map((id) => ({ jobAreaId: id, isPrimary: id === primaryValid })),
  }
}

/** Arguments for the atomic create path (single-add + bulk-add share this). */
export type CreateEmployeeArgs = {
  facilityId: string
  roleId: string
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  employeeCode?: string | null
  isMinor?: boolean
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  hireDate?: string | null
  createdBy?: string | null
  departmentIds?: string[]
  primaryDepartmentId?: string | null
  jobAreaIds?: string[]
  primaryJobAreaId?: string | null
}

export type CreateEmployeeResult =
  | { ok: true; employeeId: string }
  | ({ ok: false } & JobAreaError)

/**
 * Atomically create an employee with department + job-area links.
 *
 * Resolves/validates the job areas in app code FIRST (clean error codes), then
 * delegates the insert to create_employee_complete so the employee row and ALL
 * its link rows live in one transaction — a failed area assignment rolls back
 * the whole employee rather than leaving a half-created record.
 */
export async function createEmployeeComplete(
  supabase: SupabaseLike,
  args: CreateEmployeeArgs
): Promise<CreateEmployeeResult> {
  const resolved = await resolveJobAreaAssignments(
    supabase,
    args.facilityId,
    args.jobAreaIds,
    args.primaryJobAreaId
  )
  if (!resolved.ok) return resolved

  const areaIds = resolved.assignments.map((a) => a.jobAreaId)
  const primaryArea = resolved.assignments.find((a) => a.isPrimary)?.jobAreaId ?? null

  const { data, error } = await supabase.rpc("create_employee_complete", {
    p_facility_id: args.facilityId,
    p_role_id: args.roleId,
    p_first_name: args.firstName,
    p_last_name: args.lastName,
    p_email: args.email ?? undefined,
    p_phone: args.phone ?? undefined,
    p_employee_code: args.employeeCode ?? undefined,
    p_is_minor: args.isMinor ?? false,
    p_emergency_contact_name: args.emergencyContactName ?? undefined,
    p_emergency_contact_phone: args.emergencyContactPhone ?? undefined,
    p_hire_date: args.hireDate ?? undefined,
    p_created_by: args.createdBy ?? undefined,
    p_department_ids: args.departmentIds && args.departmentIds.length > 0 ? args.departmentIds : undefined,
    p_primary_department_id: args.primaryDepartmentId ?? undefined,
    p_job_area_ids: areaIds.length > 0 ? areaIds : undefined,
    p_primary_job_area_id: primaryArea ?? undefined,
  })

  if (error || !data) {
    return { ok: false, ...mapDbError(error, "Failed to create employee.") }
  }
  return { ok: true, employeeId: data as string }
}

export type ReconcileResult = { ok: true } | ({ ok: false } & JobAreaError)

/**
 * Diff-apply `assignments` (the complete desired set, already resolved) onto an
 * existing employee. Used by the single edit path.
 *
 * Order matters: remove dropped areas FIRST so the per-row cap trigger never
 * sees a transient count above MAX_JOB_AREAS, then upsert the desired set
 * (insert new + refresh is_primary on existing) keyed on the unique
 * (employee_id, job_area_id).
 */
export async function reconcileJobAreaAssignments(
  supabase: SupabaseLike,
  employeeId: string,
  facilityId: string,
  assignments: ResolvedJobAreaAssignment[]
): Promise<ReconcileResult> {
  const sb = supabase

  const { data: existingRaw, error: selErr } = await sb
    .from("employee_job_area_assignments")
    .select("id, job_area_id")
    .eq("employee_id", employeeId)
  if (selErr) return { ok: false, ...mapDbError(selErr, "Failed to load job areas.") }

  const existing = (existingRaw ?? []) as Array<{ id: string; job_area_id: string }>
  const desired = new Set(assignments.map((a) => a.jobAreaId))

  const toDelete = existing.filter((r) => !desired.has(r.job_area_id)).map((r) => r.id)
  if (toDelete.length > 0) {
    const { error: delErr } = await sb
      .from("employee_job_area_assignments")
      .delete()
      .in("id", toDelete)
    if (delErr) return { ok: false, ...mapDbError(delErr, "Failed to remove job areas.") }
  }

  if (assignments.length > 0) {
    const rows = assignments.map((a) => ({
      facility_id: facilityId,
      employee_id: employeeId,
      job_area_id: a.jobAreaId,
      is_primary: a.isPrimary,
    }))
    const { error: upErr } = await sb
      .from("employee_job_area_assignments")
      .upsert(rows, { onConflict: "employee_id,job_area_id" })
    if (upErr) return { ok: false, ...mapDbError(upErr, "Failed to assign job areas.") }
  }

  return { ok: true }
}
