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
import { addDaysToKey, utcToWallTime, wallTimeToUtc } from "@/lib/timezone"
import type { TablesUpdate } from "@/types/database"

import {
  daysBetween,
  expandRecurrenceDates,
  validateRecurrenceSpec,
} from "../shifts/_lib/recurrence"
import { formatDayKeyLabel } from "./datetime"
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
  /** Series link: null for standalone shifts and series parents. */
  recurring_parent_id: string | null
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
  "id, starts_at, ends_at, employee_id, job_area_id, department_id, status, break_minutes, role_label, notes, recurring_parent_id"

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
const createFields = z.object({
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

const endAfterStart = {
  check: (v: { starts_at: string; ends_at: string }) =>
    new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime(),
  params: { message: "End must be after start.", path: ["ends_at"] },
}

const createSchema = createFields.refine(endAfterStart.check, endAfterStart.params)

// Weekly recurrence rule attached to a grid create: which weekdays repeat and
// the (inclusive, facility-local) end date. Range/occurrence caps are enforced
// by validateRecurrenceSpec against the facility-local anchor date.
const recurringCreateSchema = createFields
  .extend({
    repeat: z.object({
      days_of_week: z
        .array(z.number().int().min(0).max(6))
        .min(1, "Select at least one day of the week.")
        .max(7),
      until: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid repeat end date."),
    }),
  })
  .refine(endAfterStart.check, endAfterStart.params)

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
    // NOTE — publish-lock: `status` is intentionally NOT accepted here, mirroring
    // createSchema. A shift's status may only change via a governed path:
    // draft -> published through scheduling_approve_publish_request (the
    // two-person publish-request flow), published -> cancelled through
    // scheduling_admin_cancel_shift, draft -> cancelled by outright delete. If
    // this update path forwarded a client-supplied status, a scheduling admin
    // could flip a draft straight to 'published' via a direct UPDATE — bypassing
    // the second-approver check, the batch re-validation, the publish-events
    // audit row, the open-shift listings, and the publish notification. The DB
    // trigger (schedule_shifts_publish_lock, migration 181) rejects that
    // transition as a second layer.
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
export type CreateRecurringShiftsInput = z.input<typeof recurringCreateSchema>
export type UpdateGridShiftInput = z.input<typeof updateSchema>
export type PreviewShiftInput = z.input<typeof previewSchema>

/** Outcome of a recurring create: what landed plus what was skipped and why. */
export type RecurringCreateData = {
  created: GridShiftDTO[]
  skipped: { date: string; reason: string }[]
}

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
  if (err.code === "23P01") {
    // GiST exclusion `schedule_shifts_no_double_booking` (migration 140).
    return "Overlaps another shift for that employee."
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

/**
 * Human-readable cert/advisory warning lists from raw shift signals — the ONE
 * formatter shared by the single-shift gate, the popover preview, and the
 * recurring batch gate, so wording can't drift between them.
 */
function formatSignals(signals: {
  codes: string[]
  capWarning?: string | null
  boundsWarning?: string | null
}): { certCodes: string[]; certWarnings: string[]; advisoryWarnings: string[] } {
  const { cert, advisory } = partitionViolations(signals.codes)
  return {
    certCodes: cert,
    certWarnings: cert.map((c) => capitalize(describeViolation(c)) + "."),
    advisoryWarnings: [
      ...advisory.map((c) => capitalize(describeViolation(c)) + "."),
      ...(signals.capWarning ? [signals.capWarning] : []),
      ...(signals.boundsWarning ? [signals.boundsWarning] : []),
    ],
  }
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

  const signals = await computeShiftSignals(supabase, {
    facilityId,
    employeeId: args.employeeId,
    startsAt: args.startsAt,
    endsAt: args.endsAt,
    breakMinutes: args.breakMinutes,
    jobAreaId: args.jobAreaId,
    excludeShiftId: args.excludeShiftId,
  })
  const { certCodes: cert, certWarnings, advisoryWarnings } =
    formatSignals(signals)

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

/** Cap a warning list for display; the tail collapses into a count. */
function truncateLines(lines: string[], max = 10): string[] {
  if (lines.length <= max) return lines
  return [...lines.slice(0, max), `…and ${lines.length - max} more.`]
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
 * Create a weekly-recurring series from one painted shift: the drawn shift is
 * the series PARENT; one child draft is generated per selected weekday between
 * the anchor and the (inclusive) `repeat.until` date, linked via
 * `recurring_parent_id`. Occurrences are ordinary draft rows — they publish,
 * edit, and delete exactly like hand-drawn shifts.
 *
 * Times are facility-local wall clock: the parent's instants are converted to
 * the facility timezone once, then each occurrence re-projects that wall time
 * onto its own date (same pattern as applyTemplateToWeek), so a series keeps
 * e.g. 9:00–17:00 across a DST boundary.
 *
 * Gating runs per occurrence (same signals as a single create). Cert gaps on
 * ANY date hard-block unless overridden (each violating date is audit-logged);
 * advisory warnings aggregate into one confirm. Under block_on_violations,
 * advisory-flagged CHILD dates are skipped (policy blocks the date, not the
 * batch) while a flagged parent blocks outright, matching createGridShift.
 * Inserts are per-row so the DB's double-booking exclusion (23P01) skips just
 * the conflicting date; partial success is success and reports `skipped`.
 *
 * Within-batch limitation: signals are computed against EXISTING rows before
 * any insert, so two occurrences in the same batch can't warn about each
 * other (e.g. weekly-hour totals the batch itself creates). True same-time
 * overlaps are still caught by the exclusion constraint at insert time.
 */
export async function createRecurringGridShifts(
  input: CreateRecurringShiftsInput
): Promise<GridResult<RecurringCreateData>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsed = recurringCreateSchema.safeParse(input)
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

    // Wall-clock template from the PARENT's instants (facility timezone) — the
    // client never supplies wall times, so generation is independent of the
    // admin's browser zone.
    const { data: facilityRow } = await supabase
      .from("facilities")
      .select("timezone")
      .eq("id", ctx.facilityId)
      .maybeSingle<{ timezone: string | null }>()
    const timezone = facilityRow?.timezone ?? null

    const startWall = utcToWallTime(v.starts_at, timezone)
    const endWall = utcToWallTime(v.ends_at, timezone)
    if (!startWall || !endWall) {
      return { ok: false, error: "Invalid shift times." }
    }
    const anchorKey = startWall.slice(0, 10)
    const startTime = startWall.slice(11) // "HH:MM"
    const endKey = endWall.slice(0, 10)
    const endTime = endWall.slice(11)
    // Overnight shifts end 1+ calendar days after they start; carry the offset.
    const endDayOffset = daysBetween(anchorKey, endKey)

    const spec = {
      anchorKey,
      daysOfWeek: v.repeat.days_of_week,
      untilKey: v.repeat.until,
    }
    const valid = validateRecurrenceSpec(spec)
    if (!valid.ok) return { ok: false, error: valid.error }

    type Occurrence = { dateKey: string; startsAt: string; endsAt: string }
    const skipped: RecurringCreateData["skipped"] = []
    const children: Occurrence[] = []
    for (const dateKey of expandRecurrenceDates(spec)) {
      const startsAt = wallTimeToUtc(`${dateKey}T${startTime}:00`, timezone)
      const endsAt = wallTimeToUtc(
        `${addDaysToKey(dateKey, endDayOffset)}T${endTime}:00`,
        timezone
      )
      if (!startsAt || !endsAt) {
        skipped.push({ date: dateKey, reason: "Couldn't compute shift times." })
        continue
      }
      children.push({
        dateKey,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })
    }

    // ---- Batch gate (assigned series only; open slots never gate) ----------
    const policySkipped = new Set<string>()
    if (v.employee_id) {
      const employeeId = v.employee_id
      const probes: (Occurrence & { isParent: boolean })[] = [
        {
          dateKey: anchorKey,
          startsAt: v.starts_at,
          endsAt: v.ends_at,
          isParent: true,
        },
        ...children.map((c) => ({ ...c, isParent: false })),
      ]

      type ProbeSignals = {
        probe: (typeof probes)[number]
        certCodes: string[]
        certWarnings: string[]
        advisoryWarnings: string[]
      }
      const results: ProbeSignals[] = []
      const CHUNK = 5
      for (let i = 0; i < probes.length; i += CHUNK) {
        const batch = await Promise.all(
          probes.slice(i, i + CHUNK).map(async (probe) => {
            const signals = await computeShiftSignals(supabase, {
              facilityId: ctx.facilityId,
              employeeId,
              startsAt: probe.startsAt,
              endsAt: probe.endsAt,
              breakMinutes: v.break_minutes ?? null,
              jobAreaId: v.job_area_id ?? null,
              excludeShiftId: null,
            })
            return { probe, ...formatSignals(signals) }
          })
        )
        results.push(...batch)
      }

      const withCert = results.filter((r) => r.certCodes.length > 0)
      const certWarnings = truncateLines(
        withCert.flatMap((r) =>
          r.certWarnings.map(
            (w) => `${formatDayKeyLabel(r.probe.dateKey)}: ${w}`
          )
        )
      )
      const withAdvisory = results.filter((r) => r.advisoryWarnings.length > 0)
      const advisoryWarnings = truncateLines(
        withAdvisory.flatMap((r) =>
          r.advisoryWarnings.map(
            (w) => `${formatDayKeyLabel(r.probe.dateKey)}: ${w}`
          )
        )
      )

      // All gate DECISIONS run before any audit logging, so a round trip that
      // ends in another gate (e.g. override granted but advisories still need
      // a confirm) can't log the same override twice.
      if (withCert.length > 0) {
        if (!v.override_cert) {
          return {
            ok: false,
            error: certWarnings.join(" "),
            gate: { kind: "cert_block", certWarnings, advisoryWarnings },
          }
        }
        if (!v.job_area_id) {
          return {
            ok: false,
            error: "A job area is required to override a certification gap.",
          }
        }
      }

      if (withAdvisory.length > 0) {
        if (await readBlockOnViolations(supabase, ctx.facilityId)) {
          const parentFlagged = withAdvisory.find((r) => r.probe.isParent)
          if (parentFlagged) {
            return {
              ok: false,
              error: `Blocked by facility policy — ${parentFlagged.advisoryWarnings.join(" ")}`,
            }
          }
          for (const r of withAdvisory) {
            policySkipped.add(r.probe.dateKey)
            skipped.push({
              date: r.probe.dateKey,
              reason: `Blocked by facility policy — ${r.advisoryWarnings.join(" ")}`,
            })
          }
        } else if (!v.acknowledge_warnings) {
          return {
            ok: false,
            error: `Please confirm: ${advisoryWarnings.join(" ")}`,
            gate: { kind: "confirm", advisoryWarnings },
          }
        }
      }

      // Gates cleared — record one audit row per violating date that will
      // actually be created (no shift id yet; rows aren't inserted until now).
      const overrideJobAreaId = v.job_area_id
      if (overrideJobAreaId) {
        for (const r of withCert) {
          if (policySkipped.has(r.probe.dateKey)) continue
          const { error } = await supabase.rpc("scheduling_log_cert_override", {
            p_employee_id: employeeId,
            p_job_area_id: overrideJobAreaId,
            p_violation_codes: r.certCodes,
            p_reason: v.override_reason ?? undefined,
          })
          if (error) {
            return {
              ok: false,
              error: `Couldn't record the certification override: ${error.message ?? "unknown error"}.`,
            }
          }
        }
      }
    }

    // ---- Inserts: parent first, then children one row at a time ------------
    const baseRow = {
      facility_id: ctx.facilityId,
      department_id: v.department_id ?? null,
      job_area_id: v.job_area_id ?? null,
      employee_id: v.employee_id ?? null,
      break_minutes: v.break_minutes ?? 0,
      role_label: v.role_label ?? null,
      notes: v.notes ?? null,
      // Always drafts — publishing stays the governed two-person flow.
      status: "draft" as const,
      compliance_warnings: [],
    }

    const { data: parent, error: parentErr } = await supabase
      .from("schedule_shifts")
      .insert({ ...baseRow, starts_at: v.starts_at, ends_at: v.ends_at })
      .select(SHIFT_SELECT)
      .single()
    if (parentErr || !parent) {
      return { ok: false, error: dbError(parentErr, "Failed to create shift.") }
    }

    // Per-row inserts (never one bulk statement) so a single date tripping the
    // double-booking exclusion skips just that date; chunked concurrency keeps
    // a 62-occurrence series from serializing 62 round trips.
    const created: GridShiftDTO[] = [parent as GridShiftDTO]
    const toInsert = children.filter((occ) => !policySkipped.has(occ.dateKey))
    const INSERT_CHUNK = 5
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = await Promise.all(
        toInsert.slice(i, i + INSERT_CHUNK).map(async (occ) => {
          const { data, error } = await supabase
            .from("schedule_shifts")
            .insert({
              ...baseRow,
              starts_at: occ.startsAt,
              ends_at: occ.endsAt,
              recurring_parent_id: (parent as GridShiftDTO).id,
            })
            .select(SHIFT_SELECT)
            .single()
          return { occ, data, error }
        })
      )
      for (const { occ, data, error } of chunk) {
        if (error || !data) {
          skipped.push({
            date: occ.dateKey,
            reason: dbError(error, "Failed to create shift."),
          })
        } else {
          created.push(data as GridShiftDTO)
        }
      }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, data: { created, skipped } }
  } catch (e) {
    logServerError("admin/scheduling/_lib/grid-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * All rows of the recurring series containing shift `id` (the root plus every
 * child pointing at it), facility-scoped. A standalone shift yields just its
 * own row.
 */
async function loadSeries(
  supabase: ServerSupabase,
  facilityId: string,
  id: string
): Promise<
  | { ok: true; rows: { id: string; status: string }[] }
  | { ok: false; error: string }
> {
  const { data: member } = await supabase
    .from("schedule_shifts")
    .select("id, recurring_parent_id")
    .eq("id", id)
    .eq("facility_id", facilityId)
    .maybeSingle()
  if (!member) return { ok: false, error: "Shift not found." }

  const root = member.recurring_parent_id ?? member.id
  const { data: rows, error } = await supabase
    .from("schedule_shifts")
    .select("id, status")
    .eq("facility_id", facilityId)
    .or(`id.eq.${root},recurring_parent_id.eq.${root}`)
  if (error || !rows) {
    return { ok: false, error: dbError(error, "Failed to load the series.") }
  }
  return { ok: true, rows }
}

/**
 * Series membership for the delete dialog: how many shifts (and how many
 * deletable drafts) share a series with this one. The client's loaded window
 * can be narrower than a full series (±42-day fetch vs an up-to-84-day
 * series), so the dialog asks the server instead of trusting loaded events.
 */
export async function getRecurringSeriesInfo(
  id: string
): Promise<GridResult<{ memberCount: number; draftCount: number }>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsedId = z.string().uuid().safeParse(id)
    if (!parsedId.success) return { ok: false, error: "Invalid shift id." }

    const supabase = await createClient()
    const series = await loadSeries(supabase, ctx.facilityId, parsedId.data)
    if (!series.ok) return series

    return {
      ok: true,
      data: {
        memberCount: series.rows.length,
        draftCount: series.rows.filter((r) => r.status === "draft").length,
      },
    }
  } catch (e) {
    logServerError("admin/scheduling/_lib/grid-actions", e)
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Delete every DRAFT shift in a series (the parent and all children linked by
 * recurring_parent_id), given any member's id. Published occurrences are left
 * untouched — removing those is the governed per-shift cancel
 * (scheduling_admin_cancel_shift) — and their count is reported so the UI can
 * say so. Cancelled rows are likewise left as history.
 */
export async function deleteRecurringSeries(
  id: string
): Promise<GridResult<{ deletedIds: string[]; publishedLeft: number }>> {
  try {
    const ctx = await resolveFacility()
    if (!ctx.ok) return { ok: false, error: ctx.error }

    const parsedId = z.string().uuid().safeParse(id)
    if (!parsedId.success) return { ok: false, error: "Invalid shift id." }

    const supabase = await createClient()
    const series = await loadSeries(supabase, ctx.facilityId, parsedId.data)
    if (!series.ok) return series

    const draftIds = series.rows
      .filter((r) => r.status === "draft")
      .map((r) => r.id)
    const publishedLeft = series.rows.filter(
      (r) => r.status === "published"
    ).length

    if (draftIds.length > 0) {
      const { error } = await supabase
        .from("schedule_shifts")
        .delete()
        .in("id", draftIds)
        .eq("facility_id", ctx.facilityId)
        .eq("status", "draft")
      if (error) {
        return { ok: false, error: dbError(error, "Failed to delete series.") }
      }
    }

    revalidatePath("/admin/scheduling/shifts")
    revalidatePath("/admin/scheduling")
    return { ok: true, data: { deletedIds: draftIds, publishedLeft } }
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
    const [signals, blocking] = await Promise.all([
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

    const { certWarnings, advisoryWarnings } = formatSignals(signals)
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
