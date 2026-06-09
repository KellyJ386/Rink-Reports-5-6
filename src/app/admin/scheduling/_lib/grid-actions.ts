"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { collectShiftWarnings } from "./grid-warnings"

// schedule_shifts.job_area_id and employee_job_areas aren't in the generated DB
// types yet (see CLAUDE.md); cast through `any` at those write sites, matching
// the convention in admin-core-actions.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

// ---------------------------------------------------------------------------
// Result + DTO shapes (typed so the grid can reconcile optimistic state)
// ---------------------------------------------------------------------------

export type GridShiftDTO = {
  id: string
  starts_at: string
  ends_at: string
  employee_id: string | null
  job_area_id: string | null
  department_id: string | null
  status: "draft" | "published" | "cancelled"
  break_minutes: number
  role_label: string | null
  notes: string | null
}

export type GridResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const SHIFT_SELECT =
  "id, starts_at, ends_at, employee_id, job_area_id, department_id, status, break_minutes, role_label, notes"

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isoDateTime = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid timestamp")

const nullableUuid = z.string().uuid().nullable().optional()

const createSchema = z
  .object({
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    employee_id: nullableUuid,
    job_area_id: nullableUuid,
    department_id: nullableUuid,
    break_minutes: z.number().int().min(0).max(1440).nullable().optional(),
    role_label: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(["draft", "published", "cancelled"]).optional(),
  })
  .refine(
    (v) => new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime(),
    { message: "End must be after start.", path: ["ends_at"] }
  )

const updateSchema = z
  .object({
    id: z.string().uuid(),
    starts_at: isoDateTime.optional(),
    ends_at: isoDateTime.optional(),
    employee_id: nullableUuid,
    job_area_id: nullableUuid,
    department_id: nullableUuid,
    break_minutes: z.number().int().min(0).max(1440).nullable().optional(),
    role_label: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(["draft", "published", "cancelled"]).optional(),
  })
  .refine(
    (v) =>
      v.starts_at == null ||
      v.ends_at == null ||
      new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime(),
    { message: "End must be after start.", path: ["ends_at"] }
  )

const previewSchema = z.object({
  employee_id: z.string().uuid().nullable(),
  job_area_id: z.string().uuid().nullable(),
  starts_at: isoDateTime,
  ends_at: isoDateTime,
  break_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  exclude_shift_id: z.string().uuid().nullable().optional(),
})

export type CreateGridShiftInput = z.input<typeof createSchema>
export type UpdateGridShiftInput = z.input<typeof updateSchema>
export type PreviewShiftInput = z.input<typeof previewSchema>

// ---------------------------------------------------------------------------
// Session context (facility_id is ALWAYS derived server-side, never trusted
// from the client)
// ---------------------------------------------------------------------------

async function resolveFacility(): Promise<
  { ok: true; facilityId: string } | { ok: false; error: string }
> {
  await requireAdmin()
  const current = await getCurrentUser()
  const facilityId = current?.profile?.facility_id ?? null
  if (!facilityId) {
    return { ok: false, error: "No facility assigned to your account." }
  }
  return { ok: true, facilityId }
}

function firstZodError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input."
}

function dbError(
  err: { code?: string; message?: string } | null,
  fallback: string
): string {
  if (!err) return fallback
  if (err.code === "23505") {
    return "That value conflicts with an existing record (duplicate)."
  }
  return err.message?.trim() || fallback
}

/**
 * Defense-in-depth: confirm that a referenced employee / job area actually
 * belongs to the session facility. RLS scopes the schedule_shifts row by
 * facility_id, but the employee_id / job_area_id FKs do NOT enforce a facility
 * match, so a crafted client payload could otherwise point a shift at another
 * tenant's employee or job area. Both reads are themselves RLS-scoped, so a
 * missing row here means "not in your facility (or doesn't exist)".
 */
async function assertOwned(
  supabase: AnySupabase,
  facilityId: string,
  opts: { employeeId?: string | null; jobAreaId?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (opts.employeeId) {
    const { data } = await supabase
      .from("employees")
      .select("id")
      .eq("id", opts.employeeId)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!data) {
      return { ok: false, error: "That employee isn't part of your facility." }
    }
  }
  if (opts.jobAreaId) {
    const { data } = await supabase
      .from("employee_job_areas")
      .select("id")
      .eq("id", opts.jobAreaId)
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (!data) {
      return { ok: false, error: "That job area isn't part of your facility." }
    }
  }
  return { ok: true }
}

/** Whether this facility has opted into hard-blocking grid warnings. */
async function readBlockOnViolations(
  supabase: AnySupabase,
  facilityId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("schedule_settings")
    .select("block_on_violations")
    .eq("facility_id", facilityId)
    .maybeSingle()
  return Boolean(
    (data as { block_on_violations?: boolean } | null)?.block_on_violations
  )
}

/**
 * When the facility opted into blocking, refuse a write that raises any advisory
 * warning. No-op (allows) when blocking is off or the slot is unassigned.
 */
async function enforceBlocking(
  supabase: AnySupabase,
  facilityId: string,
  args: {
    employeeId: string | null
    startsAt: string
    endsAt: string
    breakMinutes: number | null
    jobAreaId: string | null
    excludeShiftId: string | null
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!args.employeeId) return { ok: true }
  if (!(await readBlockOnViolations(supabase, facilityId))) return { ok: true }
  const warnings = await collectShiftWarnings(supabase, { facilityId, ...args })
  if (warnings.length === 0) return { ok: true }
  return {
    ok: false,
    error: `Blocked by facility policy — ${warnings.join(" ")}`,
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Create a shift painted on the grid (drag-to-create) or dropped from a
 * template. facility_id is injected from the session. Returns the created row
 * so the client can reconcile its optimistic event.
 *
 * NOTE: Phase 3 folds the existing assignment-eligibility gate
 * (assertAssignable) in here; Phase 4 layers advisory warnings. For now this is
 * the foundational typed write.
 */
export async function createGridShift(
  input: CreateGridShiftInput
): Promise<GridResult<GridShiftDTO>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsed = createSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: firstZodError(parsed.error) }
    }
    const v = parsed.data

    const supabase = (await createClient()) as AnySupabase

    const owned = await assertOwned(supabase, ctx.facilityId, {
      employeeId: v.employee_id ?? null,
      jobAreaId: v.job_area_id ?? null,
    })
    if (!owned.ok) return { ok: false, error: owned.error }

    const blocked = await enforceBlocking(supabase, ctx.facilityId, {
      employeeId: v.employee_id ?? null,
      startsAt: v.starts_at,
      endsAt: v.ends_at,
      breakMinutes: v.break_minutes ?? null,
      jobAreaId: v.job_area_id ?? null,
      excludeShiftId: null,
    })
    if (!blocked.ok) return blocked

    const { data, error } = await supabase
      .from("schedule_shifts")
      .insert({
        facility_id: ctx.facilityId,
        department_id: v.department_id ?? null,
        job_area_id: v.job_area_id ?? null,
        employee_id: v.employee_id ?? null,
        starts_at: v.starts_at,
        ends_at: v.ends_at,
        break_minutes: v.break_minutes ?? 0,
        role_label: v.role_label ?? null,
        notes: v.notes ?? null,
        status: v.status ?? "draft",
        compliance_warnings: [],
      })
      .select(SHIFT_SELECT)
      .single()

    if (error || !data) {
      return { ok: false, error: dbError(error, "Failed to create shift.") }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, data: data as GridShiftDTO }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Update a shift — handles drag-move and edge-resize (new starts_at/ends_at) as
 * well as re-assignment (employee/job area). RLS-scoped to the session facility.
 */
export async function updateGridShift(
  input: UpdateGridShiftInput
): Promise<GridResult<GridShiftDTO>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsed = updateSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: firstZodError(parsed.error) }
    }
    const v = parsed.data

    // Only send the fields that were actually provided (partial update).
    const patch: Record<string, unknown> = {}
    if (v.starts_at !== undefined) patch.starts_at = v.starts_at
    if (v.ends_at !== undefined) patch.ends_at = v.ends_at
    if (v.employee_id !== undefined) patch.employee_id = v.employee_id
    if (v.job_area_id !== undefined) patch.job_area_id = v.job_area_id
    if (v.department_id !== undefined) patch.department_id = v.department_id
    if (v.break_minutes !== undefined) patch.break_minutes = v.break_minutes ?? 0
    if (v.role_label !== undefined) patch.role_label = v.role_label
    if (v.notes !== undefined) patch.notes = v.notes
    if (v.status !== undefined) patch.status = v.status

    if (Object.keys(patch).length === 0) {
      return { ok: false, error: "Nothing to update." }
    }

    const supabase = (await createClient()) as AnySupabase

    // Validate ownership only for fields actually being (re)assigned.
    const owned = await assertOwned(supabase, ctx.facilityId, {
      employeeId: v.employee_id ?? null,
      jobAreaId: v.job_area_id ?? null,
    })
    if (!owned.ok) return { ok: false, error: owned.error }

    // Blocking enforcement (only when the facility opted in). Move/resize may
    // omit employee/job area, so resolve the effective values from the current
    // row before evaluating warnings.
    if (await readBlockOnViolations(supabase, ctx.facilityId)) {
      const { data: cur } = await supabase
        .from("schedule_shifts")
        .select("employee_id, job_area_id, starts_at, ends_at, break_minutes")
        .eq("id", v.id)
        .eq("facility_id", ctx.facilityId)
        .maybeSingle()
      if (cur) {
        const blocked = await enforceBlocking(supabase, ctx.facilityId, {
          employeeId:
            v.employee_id !== undefined ? v.employee_id : cur.employee_id,
          startsAt: v.starts_at ?? cur.starts_at,
          endsAt: v.ends_at ?? cur.ends_at,
          breakMinutes:
            v.break_minutes !== undefined
              ? v.break_minutes
              : cur.break_minutes,
          jobAreaId:
            v.job_area_id !== undefined ? v.job_area_id : cur.job_area_id,
          excludeShiftId: v.id,
        })
        if (!blocked.ok) return blocked
      }
    }

    const { data, error } = await supabase
      .from("schedule_shifts")
      .update(patch)
      .eq("id", v.id)
      .eq("facility_id", ctx.facilityId)
      .select(SHIFT_SELECT)
      .single()

    if (error || !data) {
      return { ok: false, error: dbError(error, "Failed to update shift.") }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, data: data as GridShiftDTO }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Advisory preview: compute the warnings (weekly-hours cap, overlap, cert gaps,
 * time-off, overtime) for a candidate assignment without writing anything. Used
 * by the assign popover to warn before save. `blocking` reflects the facility
 * setting so the UI can disable Save when warnings are hard-blocked.
 */
export async function previewShiftWarnings(
  input: PreviewShiftInput
): Promise<GridResult<{ warnings: string[]; blocking: boolean }>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsed = previewSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: firstZodError(parsed.error) }
    }
    const v = parsed.data

    const supabase = (await createClient()) as AnySupabase
    const [warnings, blocking] = await Promise.all([
      collectShiftWarnings(supabase, {
        facilityId: ctx.facilityId,
        employeeId: v.employee_id,
        startsAt: v.starts_at,
        endsAt: v.ends_at,
        breakMinutes: v.break_minutes ?? null,
        jobAreaId: v.job_area_id,
        excludeShiftId: v.exclude_shift_id ?? null,
      }),
      readBlockOnViolations(supabase, ctx.facilityId),
    ])
    return { ok: true, data: { warnings, blocking } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/** Delete a shift. RLS-scoped to the session facility. */
export async function deleteGridShift(
  id: string
): Promise<GridResult<{ id: string }>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsedId = z.string().uuid().safeParse(id)
    if (!parsedId.success) return { ok: false, error: "Invalid shift id." }

    const supabase = await createClient()
    const { error } = await supabase
      .from("schedule_shifts")
      .delete()
      .eq("id", parsedId.data)
      .eq("facility_id", ctx.facilityId)

    if (error) {
      return { ok: false, error: dbError(error, "Failed to delete shift.") }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, data: { id: parsedId.data } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
