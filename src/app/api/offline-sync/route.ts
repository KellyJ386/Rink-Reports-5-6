import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import { wallTimeToUtc } from "@/lib/timezone"
import type { Json } from "@/types/database"
import {
  buildInputFromPayload,
  persistIncident,
  resolveIncidentRefs,
  resolveReporterIdentity,
  validateIncidentInput,
} from "@/app/reports/incidents/_lib/submit"
import {
  buildInputFromPayload as buildRefrigerationInput,
  persistRefrigeration,
  prepareRows as prepareRefrigerationRows,
} from "@/app/reports/refrigeration/_lib/submit"
import {
  buildInputFromPayload as buildAirQualityInput,
  persistAirQuality,
} from "@/app/reports/air-quality/_lib/submit"
import { claimQueueSlot, markClaimSynced, releaseClaim } from "@/lib/offline/claim"
import { handleAccidentReplay } from "@/app/reports/accidents/_lib/offline"
import { handleDailyReplay } from "@/app/reports/daily/_lib/offline"
import { handleIceDepthReplay } from "@/app/reports/ice-depth/_lib/offline"
import { handleIceOperationsReplay } from "@/app/reports/ice-operations/_lib/offline"
import { handleMessageReplay } from "@/app/reports/communications/_lib/offline"

// Validate the queued submission shape before it touches the DB, so a bad
// payload surfaces as a 400 here rather than an opaque RLS/insert failure.
// `action` mirrors the enqueueSubmission() client contract (a string defaulting
// to "submit") rather than a fixed enum, so a future action value can't silently
// 400 on replay and get marked failed by the service worker.
const bodySchema = z.object({
  localId: z.string().min(1),
  moduleKey: z.string().min(1),
  action: z.string().min(1).default("submit"),
  payload: z.record(z.string(), z.unknown()),
  startedAt: z.number().int().positive().optional(),
  // Auth uid of the user who queued this item (stamped client-side at enqueue).
  // Optional for backward-compat with any pre-upgrade queued records; when
  // present the route rejects a flush under a different session (E-01).
  ownerId: z.string().min(1).nullish(),
})

// IDEMPOTENCY CONTRACT — read before touching any `onConflict: "local_id"` claim
// below. `local_id` is a client-generated crypto.randomUUID() and is the SOLE
// dedup key: every replay handler upserts with
// `{ onConflict: "local_id", ignoreDuplicates: true }`, so a conflicting row
// returns zero rows and is treated as "already processed". This assumes a given
// `local_id` maps to exactly ONE logical submission. A client that ever reused a
// local_id for a *different* payload would have its second payload silently
// dropped (the first row wins). That is acceptable because randomUUID() collisions
// are astronomically unlikely and each enqueue mints a fresh id; facility/employee
// scoping is server-injected regardless, so this is a data-loss edge, not a
// security one. Do NOT key the claim on anything client-supplied beyond local_id.

export async function POST(request: NextRequest) {
  const current = await getCurrentUser()
  if (!current?.authUser) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }

  const { profile } = current
  if (!profile?.is_active || !profile?.facility_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 })
  }

  const { localId, moduleKey, action, payload, startedAt, ownerId } = parsed.data

  // E-01 — owner check. The offline queue is origin-global; on a shared kiosk a
  // report queued by user A can reach this endpoint under user B's session. If
  // the item was stamped with an owner uid at enqueue time and it does NOT match
  // the current session user, REJECT it (never silently re-attribute). This runs
  // BEFORE we derive employee_id from the current session below. A 422 is a
  // permanent status, so the service worker parks the item as "failed" rather
  // than burning transient retries; it can then sync when its owner signs in.
  if (ownerId && ownerId !== current.authUser.id) {
    return NextResponse.json(
      { error: "This submission was queued by a different user." },
      { status: 422 }
    )
  }

  const supabase = await createClient()

  // Resolve active employee
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", profile.id)
    .eq("facility_id", profile.facility_id)
    .eq("is_active", true)
    .maybeSingle()

  if (!employee) {
    return NextResponse.json({ error: "No active employee" }, { status: 403 })
  }

  const startedAtIso = startedAt
    ? new Date(startedAt).toISOString()
    : new Date().toISOString()

  // Modules with a real replay handler actually persist their rows here. Other
  // modules keep the legacy behaviour (log to the queue only).
  if (moduleKey === "incident_reports") {
    return handleIncidentReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
      userId: profile.id,
    })
  }

  if (moduleKey === "refrigeration") {
    return handleRefrigerationReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
    })
  }

  if (moduleKey === "air_quality") {
    return handleAirQualityReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
    })
  }

  if (moduleKey === "scheduling") {
    return handleSchedulingReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
    })
  }

  if (moduleKey === "accident_reports") {
    return handleAccidentReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
    })
  }

  if (moduleKey === "daily_reports") {
    return handleDailyReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
    })
  }

  if (moduleKey === "ice_depth") {
    return handleIceDepthReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
    })
  }

  if (moduleKey === "ice_operations") {
    return handleIceOperationsReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
    })
  }

  if (moduleKey === "communications") {
    return handleMessageReplay({
      supabase,
      localId,
      action,
      payload,
      startedAtIso,
      facilityId: profile.facility_id,
      employeeId: employee.id,
    })
  }

  // E-04 — unknown moduleKey. There is NO replay handler for this key, so no
  // report table would be written. Previously the item was upserted as `synced`
  // and the service worker deleted it — telling the user it synced while nothing
  // landed (a silent drop). Instead, record it as `failed` and return a
  // permanent 422 so the SW parks it as failed rather than faking success. This
  // is only reachable for a typo'd/never-wired key; all shipped keys dispatch
  // above.
  await supabase
    .from("offline_sync_queue")
    .upsert(
      {
        local_id: localId,
        facility_id: profile.facility_id,
        employee_id: employee.id,
        module_key: moduleKey,
        action,
        payload: payload as Json,
        sync_status: "failed",
        started_at: startedAtIso,
        error_message: `Unknown module: ${moduleKey}`,
      },
      { onConflict: "local_id", ignoreDuplicates: true }
    )

  return NextResponse.json(
    { error: `Unknown module: ${moduleKey}` },
    { status: 422 }
  )
}

type IncidentReplayArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
  userId: string
}

/**
 * Replay a queued incident submission into the real tables. Idempotent: the
 * `offline_sync_queue.local_id` unique key acts as a claim token — a duplicate
 * replay (the SW retrying after a lost response) is a no-op. On a persist
 * failure the claim is released so a later retry re-attempts.
 */
async function handleIncidentReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
  userId,
}: IncidentReplayArgs): Promise<NextResponse> {
  const input = buildInputFromPayload(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  // Reporter identity comes from the login, not the queued payload.
  const reporter = await resolveReporterIdentity(supabase, userId)
  input.reporter_name = reporter.reporter_name
  input.reporter_phone = reporter.reporter_phone

  const { fieldErrors, error: validationError } = validateIncidentInput(input)
  if (Object.keys(fieldErrors).length > 0 || validationError) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "incident_reports", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const refs = await resolveIncidentRefs(supabase, facilityId, input)
  if (!refs.ok) {
    // The payload references a severity / activity / space that isn't available
    // in this facility (e.g. an admin deactivated it while the device was
    // offline). Replaying the identical payload will never resolve, so return a
    // permanent 4xx (422) — NOT 409 — so the replay queue parks it immediately
    // instead of burning all the transient retries.
    return NextResponse.json({ error: refs.error }, { status: 422 })
  }

  // Claim the queue slot (idempotency token). A duplicate that already reached
  // `synced` is a no-op; an orphaned `pending` row is re-driven (see claim.ts).
  const claim = await claimQueueSlot({
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey: "incident_reports",
    action,
    payload,
    startedAtIso,
  })
  if (claim.kind === "error") {
    return NextResponse.json({ error: claim.message }, { status: 500 })
  }
  if (claim.kind === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const result = await persistIncident(supabase, {
    employeeId,
    facilityId,
    input,
    refs,
  })

  if (!result.ok) {
    // Release the claim so a future retry re-attempts the persist.
    await releaseClaim(supabase, localId)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  await markClaimSynced(supabase, localId)

  return NextResponse.json({ ok: true, reportId: result.reportId })
}

type RefrigerationReplayArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

/**
 * Replay a queued refrigeration submission into the real tables. Same shape as
 * the incident replay: parse → permission → critical-note guard → claim → persist.
 * The guard runs BEFORE claiming so an offline submit that violates it (a
 * critical out-of-range reading without a corrective-action note) returns 400 and
 * the service worker marks it failed — mirroring the online server action.
 */
async function handleRefrigerationReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: RefrigerationReplayArgs): Promise<NextResponse> {
  const input = buildRefrigerationInput(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "refrigeration", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Pre-validate the critical-note guard without persisting (placeholder report
  // id; prepareRows only reads). A guard failure is permanent → 400.
  const precheck = await prepareRefrigerationRows(supabase, {
    facilityId,
    reportId: "00000000-0000-0000-0000-000000000000",
    input,
  })
  if (!precheck.ok) {
    return NextResponse.json({ error: precheck.error }, { status: 400 })
  }

  // Claim the queue slot (idempotency token). A duplicate that already reached
  // `synced` is a no-op; an orphaned `pending` row is re-driven (see claim.ts).
  const claim = await claimQueueSlot({
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey: "refrigeration",
    action,
    payload,
    startedAtIso,
  })
  if (claim.kind === "error") {
    return NextResponse.json({ error: claim.message }, { status: 500 })
  }
  if (claim.kind === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const result = await persistRefrigeration(supabase, {
    employeeId,
    facilityId,
    input,
  })

  if (!result.ok) {
    // Release the claim so a future retry re-attempts the persist.
    await releaseClaim(supabase, localId)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  await markClaimSynced(supabase, localId)

  return NextResponse.json({ ok: true, reportId: result.reportId })
}

type SchedulingReplayArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function parseHHMM(raw: string): string | null {
  const m = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return `${m[1]}:${m[2]}:${m[3] ?? "00"}`
}

/**
 * Replay a queued scheduling self-service write. Only the append-style flows are
 * offline-capable: `submit_availability` and `request_time_off`. Shift claiming
 * is intentionally NOT offline (it depends on live shift state and must run
 * online). Idempotent via the offline_sync_queue.local_id claim token.
 */
async function handleSchedulingReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: SchedulingReplayArgs): Promise<NextResponse> {
  if (!(await currentUserCan(supabase, "scheduling", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Build the write to persist, validating the same way the server actions
  // do. Each branch captures a fully-typed row in a closure; the closure runs
  // only after the queue claim below succeeds. `permanent` marks a failure that
  // will never succeed on retry (e.g. an availability edit whose target row was
  // deleted before sync — E-08), so the route returns 422 instead of a
  // transient 500 the SW would keep retrying.
  let doWrite: () => Promise<{
    error: { message: string } | null
    permanent?: boolean
  }>

  if (action === "submit_availability") {
    const day = Number(payload.day_of_week)
    const startTime = parseHHMM(asString(payload.start_time))
    const endTime = parseHHMM(asString(payload.end_time))
    const type = asString(payload.availability_type) || "available"
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return NextResponse.json({ error: "Invalid day of week" }, { status: 400 })
    }
    if (!startTime || !endTime || endTime <= startTime) {
      return NextResponse.json({ error: "Invalid time range" }, { status: 400 })
    }
    if (!["available", "unavailable", "preferred"].includes(type)) {
      return NextResponse.json({ error: "Invalid availability type" }, { status: 400 })
    }

    // Respect the facility availability-submission toggle (migration 117).
    const { data: settingsRow } = await supabase
      .from("schedule_settings")
      .select("availability_submission_enabled")
      .eq("facility_id", facilityId)
      .maybeSingle()
    if (settingsRow && settingsRow.availability_submission_enabled === false) {
      return NextResponse.json(
        { error: "Availability submission is turned off" },
        { status: 403 }
      )
    }

    const from = asString(payload.effective_from)
    const to = asString(payload.effective_to)
    const notes = asString(payload.notes)

    // A chosen job area must be one the employee is assigned to. This is
    // intentionally always-enforced (no facility opt-out): staff are declaring
    // their OWN availability, so it only makes sense for areas they actually
    // work. This is a different rule from the admin scheduling grid's
    // assertOwned (grid-actions.ts), which is a tenant fence only and lets an
    // admin assign any facility job area unless the facility opts into
    // `schedule_settings.require_job_area_qualification` (evaluated advisorily
    // by scheduling_assignment_violations). The two paths are not meant to
    // agree — they gate different actions by different actors.
    const jobAreaIdRaw = asString(payload.job_area_id)
    let jobAreaId: string | null = null
    if (jobAreaIdRaw.length > 0) {
      const { data: assignment } = await supabase
        .from("employee_job_area_assignments")
        .select("job_area_id")
        .eq("employee_id", employeeId)
        .eq("job_area_id", jobAreaIdRaw)
        .maybeSingle()
      if (!assignment) {
        return NextResponse.json(
          { error: "Invalid job area" },
          { status: 400 }
        )
      }
      jobAreaId = jobAreaIdRaw
    }

    const availabilityRow = {
      facility_id: facilityId,
      employee_id: employeeId,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      availability_type: type,
      effective_from: from.length > 0 ? from : null,
      effective_to: to.length > 0 ? to : null,
      notes: notes.length > 0 ? notes : null,
      job_area_id: jobAreaId,
    }
    const updateId = asString(payload.id) || null
    doWrite = updateId !== null
      ? async () => {
          // E-08: an offline availability EDIT whose target row was deleted
          // before sync updates 0 rows. Supabase returns no error for a 0-row
          // update, so without checking we would mark it `synced` and silently
          // drop the edit. `.select("id")` lets us detect the empty result and
          // fail permanently (the row is gone — retrying won't bring it back).
          const { data, error } = await supabase
            .from("schedule_availability")
            .update(availabilityRow)
            .eq("id", updateId)
            .eq("facility_id", facilityId)
            .eq("employee_id", employeeId)
            .select("id")
          if (error) return { error }
          if (!data || data.length === 0) {
            return {
              error: {
                message:
                  "The availability entry you edited offline no longer exists.",
              },
              permanent: true,
            }
          }
          return { error: null }
        }
      : async () =>
          supabase.from("schedule_availability").insert(availabilityRow)
  } else if (action === "request_time_off") {
    // datetime-local strings are wall-clock times in the FACILITY's timezone
    // (mirrors submitTimeOffRequest).
    const { data: facilityRow } = await supabase
      .from("facilities")
      .select("timezone")
      .eq("id", facilityId)
      .maybeSingle<{ timezone: string | null }>()
    const tz = facilityRow?.timezone ?? null
    const startsAt = wallTimeToUtc(asString(payload.starts_at), tz)
    const endsAt = wallTimeToUtc(asString(payload.ends_at), tz)
    if (!startsAt || !endsAt) {
      return NextResponse.json({ error: "Invalid dates" }, { status: 400 })
    }
    if (endsAt <= startsAt) {
      return NextResponse.json({ error: "End must be after start" }, { status: 400 })
    }
    const reason = asString(payload.reason)
    const timeOffRow = {
      facility_id: facilityId,
      employee_id: employeeId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reason: reason.length > 0 ? reason : null,
      status: "pending",
    }
    doWrite = async () =>
      supabase.from("schedule_time_off_requests").insert(timeOffRow)
  } else {
    return NextResponse.json({ error: "Unsupported scheduling action" }, { status: 400 })
  }

  // Claim the queue slot (idempotency token). A duplicate that already reached
  // `synced` is a no-op; an orphaned `pending` row is re-driven (see claim.ts).
  const claim = await claimQueueSlot({
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey: "scheduling",
    action,
    payload,
    startedAtIso,
  })
  if (claim.kind === "error") {
    return NextResponse.json({ error: claim.message }, { status: 500 })
  }
  if (claim.kind === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const { error: writeError, permanent } = await doWrite()

  if (writeError) {
    // Release the claim so a future retry re-attempts the persist.
    await releaseClaim(supabase, localId)
    // A permanent write failure (E-08: the edited row is gone) parks the item
    // immediately with 422 instead of burning transient 500 retries.
    return NextResponse.json(
      { error: writeError.message },
      { status: permanent ? 422 : 500 }
    )
  }

  await markClaimSynced(supabase, localId)

  return NextResponse.json({ ok: true })
}

type AirQualityReplayArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

/**
 * Replay a queued air-quality submission into the real tables. Idempotent via
 * the `offline_sync_queue.local_id` claim token, mirroring the incident path:
 * the same severity engine runs, so an offline reading lands the same
 * exceedance/severity rollup as an online one.
 */
async function handleAirQualityReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: AirQualityReplayArgs): Promise<NextResponse> {
  const input = buildAirQualityInput(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "air_quality", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Claim the queue slot (idempotency token). A duplicate that already reached
  // `synced` is a no-op; an orphaned `pending` row is re-driven (see claim.ts).
  const claim = await claimQueueSlot({
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey: "air_quality",
    action,
    payload,
    startedAtIso,
  })
  if (claim.kind === "error") {
    return NextResponse.json({ error: claim.message }, { status: 500 })
  }
  if (claim.kind === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const result = await persistAirQuality(supabase, {
    employeeId,
    facilityId,
    input,
  })

  if (!result.ok) {
    // Release the claim so a future retry re-attempts the persist.
    await releaseClaim(supabase, localId)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  await markClaimSynced(supabase, localId)

  return NextResponse.json({ ok: true, reportId: result.reportId })
}
