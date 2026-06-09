"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

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

export type CreateGridShiftInput = z.input<typeof createSchema>
export type UpdateGridShiftInput = z.input<typeof updateSchema>

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
