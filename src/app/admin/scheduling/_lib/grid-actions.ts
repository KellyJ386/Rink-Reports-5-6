"use server"

// NOTE — offline policy: these admin grid writes (drag-create / edit / delete)
// are intentionally ONLINE-ONLY; they call server actions directly rather than
// the service-worker offline queue. Scheduling is a desk task done on-
// connection, so the §4 offline round-trip guarantee is satisfied by the
// STAFF-side scheduling writes (time-off + availability), which DO enqueue via
// enqueueSubmission(moduleKey:"scheduling") and replay idempotently through
// src/app/api/offline-sync/route.ts. Routing the admin grid offline would mean
// replaying the cert / hour-cap / publish-lock enforcement on the server at
// flush time; deferred deliberately, not by oversight.

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getCurrentUser, requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/observability/log-server-error"
import type { TablesUpdate } from "@/types/database"

import { computeShiftSignals } from "./grid-warnings"
import {
  describeViolation,
  formatViolations,
  partitionViolations,
} from "./enforcement"
import { formatShiftWindow, queueSchedulingEmails } from "./notify-email"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

/**
 * Why a shift write was refused, so the client can offer the right next step:
 *  - `cert_block`: a required cert is missing/expired — hard block. A
 *    facility_manager may re-submit with `override_cert: true`, which logs an
 *    audit record (scheduling_log_cert_override) and proceeds.
 *  - `confirm`: advisory warnings (hour-cap, overtime, time-off, …) — not a
 *    block. Re-submit with `acknowledge_warnings: true` to record the
 *    deliberate decision and save.
 */
export type GridGate =
  | { kind: "cert_block"; certWarnings: string[]; advisoryWarnings: string[] }
  | { kind: "confirm"; advisoryWarnings: string[] }

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

/** A single-slot reusable shift template surfaced in the grid's side panel. */
export type GridTemplateDTO = {
  id: string
  name: string
  job_area_id: string | null
  start_time: string // "HH:MM:SS"
  end_time: string // "HH:MM:SS"
  break_minutes: number
}

export type GridResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; gate?: GridGate }

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

// NOTE — publish-lock: `status` is intentionally NOT accepted on create. A new
// shift is always born a `draft`; the only way a shift becomes `published` is
// the governed two-person publish-request flow (requestSchedulePublish ->
// scheduling_approve_publish_request). Letting the client choose `status` here
// would let a direct call mint a `published` (locked) shift outright, bypassing
// that approval — the create-leg of the publish-lock bypass. The DB trigger
// (schedule_shifts_publish_lock) rejects a published INSERT as a second layer.
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
    override_cert: z.boolean().optional(),
    acknowledge_warnings: z.boolean().optional(),
    override_reason: z.string().trim().max(1000).nullable().optional(),
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
    // No `status` field: a client-supplied status could flip a draft straight
    // to 'published' through the direct-update branch below, skipping the
    // two-person publish-request approval. Status transitions happen only
    // through the governed paths (publish-request RPC, cancel RPC, delete).
    override_cert: z.boolean().optional(),
    acknowledge_warnings: z.boolean().optional(),
    override_reason: z.string().trim().max(1000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.starts_at == null ||
      v.ends_at == null ||
      new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime(),
    { message: "End must be after start.", path: ["ends_at"] }
  )

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Invalid time")

const saveTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    job_area_id: z.string().uuid().nullable(),
    day_of_week: z.number().int().min(0).max(6),
    start_time: timeOfDay,
    end_time: timeOfDay,
    break_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  })
  .refine((v) => v.end_time > v.start_time, {
    message: "End must be after start.",
    path: ["end_time"],
  })

export type SaveGridTemplateInput = z.input<typeof saveTemplateSchema>

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

/** Slugify a template name and add a short random suffix to dodge collisions. */
function templateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base || "template"}-${suffix}`
}

/**
 * Defense-in-depth: confirm that a referenced employee / job area actually
 * belongs to the session facility. RLS scopes the schedule_shifts row by
 * facility_id, but the employee_id / job_area_id FKs do NOT enforce a facility
 * match, so a crafted client payload could otherwise point a shift at another
 * tenant's employee or job area. Both reads are themselves RLS-scoped, so a
 * missing row here means "not in your facility (or doesn't exist)".
 *
 * This is a TENANT FENCE ONLY — it checks that job_area_id exists in this
 * facility's `employee_job_areas` catalog, NOT that the assigned employee is
 * personally qualified/trained for that area. Per-employee job-area
 * qualification is a separate, intentionally opt-in concern: when a facility
 * enables `schedule_settings.require_job_area_qualification`,
 * `scheduling_assignment_violations` (called via `checkAssignmentViolations` in
 * ./enforcement) checks the pairing against `employee_job_area_assignments` and
 * surfaces a `not_qualified` violation. By default an admin may assign any
 * facility job area to any employee — that is intended, not a gap. Contrast
 * with the offline staff-availability replay (api/offline-sync/route.ts), which
 * hard-blocks against `employee_job_area_assignments` unconditionally; that is
 * a different feature (staff declaring their own availability) with a
 * different, always-enforced rule, not the same check relaxed here.
 */
async function assertOwned(
  supabase: ServerSupabase,
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
  supabase: ServerSupabase,
  facilityId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("schedule_settings")
    .select("block_on_violations")
    .eq("facility_id", facilityId)
    .maybeSingle()
  return Boolean(data?.block_on_violations)
}

type GateArgs = {
  employeeId: string | null
  startsAt: string
  endsAt: string
  breakMinutes: number | null
  jobAreaId: string | null
  excludeShiftId: string | null
  shiftId?: string | null
}

type GateOpts = {
  overrideCert?: boolean
  acknowledgeWarnings?: boolean
  overrideReason?: string | null
  /**
   * Whether the cert override should be logged here (via
   * scheduling_log_cert_override). Default true. The published-shift edit path
   * passes false because its DEFINER RPC records the override itself, so the
   * gate only makes the block/confirm DECISION without double-logging.
   */
  logCertOverride?: boolean
}

/**
 * The single shift-write gate, shared by create + update.
 *
 *  - Missing/expired required certs ALWAYS hard-block, regardless of the
 *    facility's block_on_violations toggle. A facility_manager may override
 *    by re-submitting with `overrideCert`, which records an audit row via the
 *    manager-gated scheduling_log_cert_override RPC before proceeding.
 *  - Other advisory signals (hour-cap, overtime, time-off, overlap, …) warn:
 *    if the facility opted into block_on_violations they hard-block; otherwise
 *    they require an explicit `acknowledgeWarnings` confirm.
 *  - An open/unassigned slot never gates.
 */
async function gateShiftWrite(
  supabase: ServerSupabase,
  facilityId: string,
  args: GateArgs,
  opts: GateOpts
): Promise<{ ok: true } | { ok: false; error: string; gate?: GridGate }> {
  if (!args.employeeId) return { ok: true }

  const { codes, capWarning, boundsWarning } = await computeShiftSignals(
    supabase,
    {
      facilityId,
      employeeId: args.employeeId,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      breakMinutes: args.breakMinutes,
      jobAreaId: args.jobAreaId,
      excludeShiftId: args.excludeShiftId,
    }
  )

  const { cert, advisory } = partitionViolations(codes)
  const advisoryWarnings = [
    ...advisory.map((c) => capitalize(describeViolation(c)) + "."),
    ...(capWarning ? [capWarning] : []),
    ...(boundsWarning ? [boundsWarning] : []),
  ]
  const certWarnings = cert.map((c) => capitalize(describeViolation(c)) + ".")

  // --- Cert gate (always blocks unless a manager overrides + logs it) -------
  if (cert.length > 0) {
    if (!opts.overrideCert) {
      return {
        ok: false,
        error: formatViolations(cert),
        gate: { kind: "cert_block", certWarnings, advisoryWarnings },
      }
    }
    if (!args.jobAreaId) {
      return { ok: false, error: "A job area is required to override a certification gap." }
    }
    // The published-shift edit RPC logs the override itself; only log here for
    // the normal (draft / create) write paths.
    if (opts.logCertOverride !== false) {
      const { error } = await supabase.rpc("scheduling_log_cert_override", {
        p_employee_id: args.employeeId,
        p_job_area_id: args.jobAreaId,
        p_violation_codes: cert,
        p_shift_id: args.shiftId ?? undefined,
        p_reason: opts.overrideReason ?? undefined,
      })
      if (error) {
        return {
          ok: false,
          error: `Couldn't record the certification override: ${error.message ?? "unknown error"}.`,
        }
      }
    }
    // Override approved — cert no longer blocks this write.
  }

  // --- Advisory (hour-cap, overtime, …): block-by-policy or confirm ---------
  if (advisoryWarnings.length > 0) {
    if (await readBlockOnViolations(supabase, facilityId)) {
      return {
        ok: false,
        error: `Blocked by facility policy — ${advisoryWarnings.join(" ")}`,
      }
    }
    if (!opts.acknowledgeWarnings) {
      return {
        ok: false,
        error: `Please confirm: ${advisoryWarnings.join(" ")}`,
        gate: { kind: "confirm", advisoryWarnings },
      }
    }
  }

  return { ok: true }
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

    const supabase = await createClient()

    const owned = await assertOwned(supabase, ctx.facilityId, {
      employeeId: v.employee_id ?? null,
      jobAreaId: v.job_area_id ?? null,
    })
    if (!owned.ok) return { ok: false, error: owned.error }

    const gate = await gateShiftWrite(
      supabase,
      ctx.facilityId,
      {
        employeeId: v.employee_id ?? null,
        startsAt: v.starts_at,
        endsAt: v.ends_at,
        breakMinutes: v.break_minutes ?? null,
        jobAreaId: v.job_area_id ?? null,
        excludeShiftId: null,
        shiftId: null,
      },
      {
        overrideCert: v.override_cert,
        acknowledgeWarnings: v.acknowledge_warnings,
        overrideReason: v.override_reason ?? null,
      }
    )
    if (!gate.ok) return gate

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
        // Always a draft — publishing is the governed two-person flow only.
        status: "draft",
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
    logServerError("admin/scheduling/_lib/grid-actions", e)
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
    const patch: TablesUpdate<"schedule_shifts"> = {}
    if (v.starts_at !== undefined) patch.starts_at = v.starts_at
    if (v.ends_at !== undefined) patch.ends_at = v.ends_at
    if (v.employee_id !== undefined) patch.employee_id = v.employee_id
    if (v.job_area_id !== undefined) patch.job_area_id = v.job_area_id
    if (v.department_id !== undefined) patch.department_id = v.department_id
    if (v.break_minutes !== undefined) patch.break_minutes = v.break_minutes ?? 0
    if (v.role_label !== undefined) patch.role_label = v.role_label
    if (v.notes !== undefined) patch.notes = v.notes

    if (Object.keys(patch).length === 0) {
      return { ok: false, error: "Nothing to update." }
    }

    const supabase = await createClient()

    // Validate ownership only for fields actually being (re)assigned.
    const owned = await assertOwned(supabase, ctx.facilityId, {
      employeeId: v.employee_id ?? null,
      jobAreaId: v.job_area_id ?? null,
    })
    if (!owned.ok) return { ok: false, error: owned.error }

    // Resolve the current row so move/resize (which omit employee/job area) and
    // the published-lock branch can compute effective values.
    const { data: cur } = await supabase
      .from("schedule_shifts")
      .select(
        "employee_id, job_area_id, starts_at, ends_at, break_minutes, role_label, notes, status"
      )
      .eq("id", v.id)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!cur) return { ok: false, error: "Shift not found." }

    const eff = {
      employeeId: v.employee_id !== undefined ? v.employee_id : cur.employee_id,
      jobAreaId: v.job_area_id !== undefined ? v.job_area_id : cur.job_area_id,
      startsAt: v.starts_at ?? cur.starts_at,
      endsAt: v.ends_at ?? cur.ends_at,
      breakMinutes:
        v.break_minutes !== undefined ? v.break_minutes : cur.break_minutes,
      roleLabel: v.role_label !== undefined ? v.role_label : cur.role_label,
      notes: v.notes !== undefined ? v.notes : cur.notes,
    }
    const isPublished = cur.status === "published"

    // Assignment gate. Always runs: cert gaps hard-block (override + audit);
    // advisory signals warn (block by policy / require confirm). For a
    // published shift the override is logged by the edit RPC, not here.
    const gate = await gateShiftWrite(
      supabase,
      ctx.facilityId,
      {
        employeeId: eff.employeeId,
        startsAt: eff.startsAt,
        endsAt: eff.endsAt,
        breakMinutes: eff.breakMinutes,
        jobAreaId: eff.jobAreaId,
        excludeShiftId: v.id,
        shiftId: v.id,
      },
      {
        overrideCert: v.override_cert,
        acknowledgeWarnings: v.acknowledge_warnings,
        overrideReason: v.override_reason ?? null,
        logCertOverride: !isPublished,
      }
    )
    if (!gate.ok) return gate

    // A published shift is frozen at the DB boundary; apply the change through
    // the governed, audited republish RPC instead of a direct UPDATE.
    if (isPublished) {
      const { data: rpc, error: rpcErr } = await supabase.rpc(
        "scheduling_admin_edit_published_shift",
        {
          p_shift_id: v.id,
          // Generated RPC arg types are non-nullable (a pg-meta limitation),
          // but the SQL treats NULL as "open slot / clear field" — hence the
          // narrowing casts (same pattern as enforcement.ts).
          p_employee_id: eff.employeeId as unknown as string,
          p_job_area_id: eff.jobAreaId as unknown as string,
          p_starts_at: eff.startsAt,
          p_ends_at: eff.endsAt,
          p_break_minutes: eff.breakMinutes ?? 0,
          p_role_label: eff.roleLabel as unknown as string,
          p_notes: eff.notes as unknown as string,
          p_override_cert: v.override_cert ?? false,
          p_override_reason: v.override_reason ?? undefined,
        }
      )
      if (rpcErr) {
        return { ok: false, error: dbError(rpcErr, "Failed to update shift.") }
      }
      const result = (rpc ?? {}) as { ok?: boolean; error?: string; violations?: string[] }
      if (result.ok !== true) {
        const detail =
          result.error === "cert_blocked" && result.violations?.length
            ? formatViolations(result.violations)
            : (result.error ?? "Failed to update shift.")
        return { ok: false, error: detail }
      }
      const { data: fresh } = await supabase
        .from("schedule_shifts")
        .select(SHIFT_SELECT)
        .eq("id", v.id)
        .eq("facility_id", ctx.facilityId)
        .single()
      revalidatePath("/admin/scheduling/shifts")
      revalidatePath("/admin/scheduling")
      return { ok: true, data: fresh as GridShiftDTO }
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
    logServerError("admin/scheduling/_lib/grid-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

export type PreviewWarnings = {
  /** Combined human-readable list (cert + advisory), kept for display. */
  warnings: string[]
  /** Always-blocking cert gaps (overridable only by a facility_manager). */
  certWarnings: string[]
  /** Advisory signals (hour-cap, overtime, time-off, …) — warn + confirm. */
  advisoryWarnings: string[]
  /** Facility block_on_violations: advisory warnings hard-block when true. */
  blocking: boolean
}

/**
 * Advisory preview: compute the signals (weekly-hours cap, overlap, cert gaps,
 * time-off, overtime) for a candidate assignment without writing anything. Used
 * by the assign popover. Cert gaps are surfaced separately because they always
 * block (a facility_manager override is required); `blocking` reflects the
 * facility setting for the advisory signals.
 */
export async function previewShiftWarnings(
  input: PreviewShiftInput
): Promise<GridResult<PreviewWarnings>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsed = previewSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: firstZodError(parsed.error) }
    }
    const v = parsed.data

    const supabase = await createClient()
    const [{ codes, capWarning, boundsWarning }, blocking] = await Promise.all([
      computeShiftSignals(supabase, {
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

    const { cert, advisory } = partitionViolations(codes)
    const certWarnings = cert.map((c) => capitalize(describeViolation(c)) + ".")
    const advisoryWarnings = [
      ...advisory.map((c) => capitalize(describeViolation(c)) + "."),
      ...(capWarning ? [capWarning] : []),
      ...(boundsWarning ? [boundsWarning] : []),
    ]
    return {
      ok: true,
      data: {
        warnings: Array.from(new Set([...certWarnings, ...advisoryWarnings])),
        certWarnings,
        advisoryWarnings,
        blocking,
      },
    }
  } catch (e) {
    logServerError("admin/scheduling/_lib/grid-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Save a painted/selected block as a reusable single-slot template. Writes a
 * schedule_templates header + one schedule_template_shifts row (times as
 * time-of-day). Applying a template re-uses createGridShift, so the Phase 4
 * checks run on apply. Returns the template DTO for the side panel.
 */
export async function saveGridTemplate(
  input: SaveGridTemplateInput
): Promise<GridResult<GridTemplateDTO>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsed = saveTemplateSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: firstZodError(parsed.error) }
    }
    const v = parsed.data

    const supabase = await createClient()

    const owned = await assertOwned(supabase, ctx.facilityId, {
      jobAreaId: v.job_area_id,
    })
    if (!owned.ok) return { ok: false, error: owned.error }

    const { data: tpl, error: tplErr } = await supabase
      .from("schedule_templates")
      .insert({
        facility_id: ctx.facilityId,
        name: v.name,
        slug: templateSlug(v.name),
        is_active: true,
      })
      .select("id, name")
      .single()
    if (tplErr || !tpl) {
      return { ok: false, error: dbError(tplErr, "Failed to save template.") }
    }

    const breakMinutes = v.break_minutes ?? 0
    const { error: slotErr } = await supabase
      .from("schedule_template_shifts")
      .insert({
        facility_id: ctx.facilityId,
        template_id: tpl.id,
        department_id: null,
        job_area_id: v.job_area_id,
        day_of_week: v.day_of_week,
        start_time: v.start_time,
        end_time: v.end_time,
        break_minutes: breakMinutes,
        staff_count: 1,
      })
    if (slotErr) {
      // Roll back the orphaned header so we don't leave an empty template.
      await supabase
        .from("schedule_templates")
        .delete()
        .eq("id", tpl.id)
        .eq("facility_id", ctx.facilityId)
      return { ok: false, error: dbError(slotErr, "Failed to save template.") }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling/templates")
    return {
      ok: true,
      data: {
        id: tpl.id,
        name: tpl.name,
        job_area_id: v.job_area_id,
        start_time: v.start_time,
        end_time: v.end_time,
        break_minutes: breakMinutes,
      },
    }
  } catch (e) {
    logServerError("admin/scheduling/_lib/grid-actions", e)
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

    // A published shift can't be hard-deleted (publish-lock). Removing it is a
    // governed cancel via the DEFINER RPC; drafts are deleted outright.
    const { data: cur } = await supabase
      .from("schedule_shifts")
      .select("status, employee_id, starts_at, ends_at")
      .eq("id", parsedId.data)
      .eq("facility_id", ctx.facilityId)
      .maybeSingle()
    if (!cur) return { ok: false, error: "Shift not found." }

    if (cur.status === "published") {
      const { data: rpc, error: rpcErr } = await supabase.rpc(
        "scheduling_admin_cancel_shift",
        { p_shift_id: parsedId.data }
      )
      if (rpcErr) {
        return { ok: false, error: dbError(rpcErr, "Failed to cancel shift.") }
      }
      const result = (rpc ?? {}) as { ok?: boolean; error?: string }
      if (result.ok !== true) {
        return { ok: false, error: result.error ?? "Failed to cancel shift." }
      }
      // The RPC wrote the in-app notification; add the best-effort email.
      if (cur.employee_id) {
        await queueSchedulingEmails([
          {
            facilityId: ctx.facilityId,
            employeeId: cur.employee_id,
            subject: "Your shift was cancelled",
            body: `Your shift on ${formatShiftWindow(cur.starts_at, cur.ends_at)} was cancelled by a manager.`,
            sourceRecordId: parsedId.data,
          },
        ])
      }
    } else {
      const { error } = await supabase
        .from("schedule_shifts")
        .delete()
        .eq("id", parsedId.data)
        .eq("facility_id", ctx.facilityId)
      if (error) {
        return { ok: false, error: dbError(error, "Failed to delete shift.") }
      }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, data: { id: parsedId.data } }
  } catch (e) {
    logServerError("admin/scheduling/_lib/grid-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
