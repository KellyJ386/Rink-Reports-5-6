import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import type { Json } from "@/types/database"
import {
  buildInputFromPayload,
  persistIncident,
  resolveIncidentRefs,
  validateIncidentInput,
} from "@/app/reports/incidents/_lib/submit"
import {
  buildInputFromPayload as buildRefrigerationInput,
  persistRefrigeration,
  prepareRows as prepareRefrigerationRows,
} from "@/app/reports/refrigeration/_lib/submit"

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
})

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

  const { localId, moduleKey, action, payload, startedAt } = parsed.data

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

  // Upsert into the sync queue (ON CONFLICT local_id = no-op for dedup).
  const { error } = await supabase
    .from("offline_sync_queue")
    .upsert(
      {
        local_id: localId,
        facility_id: profile.facility_id,
        employee_id: employee.id,
        module_key: moduleKey,
        action,
        payload: payload as Json,
        sync_status: "synced",
        started_at: startedAtIso,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "local_id", ignoreDuplicates: true }
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

type IncidentReplayArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
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
}: IncidentReplayArgs): Promise<NextResponse> {
  const input = buildInputFromPayload(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }
  const { fieldErrors, error: validationError } = validateIncidentInput(input)
  if (Object.keys(fieldErrors).length > 0 || validationError) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "incident_reports", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const refs = await resolveIncidentRefs(supabase, facilityId, input)
  if (!refs.ok) {
    return NextResponse.json({ error: refs.error }, { status: 409 })
  }

  // Claim the queue slot. With ignoreDuplicates, a conflicting (already-claimed)
  // local_id returns no rows → the submission was already processed.
  const { data: claimRows, error: claimErr } = await supabase
    .from("offline_sync_queue")
    .upsert(
      {
        local_id: localId,
        facility_id: facilityId,
        employee_id: employeeId,
        module_key: "incident_reports",
        action,
        payload: payload as Json,
        sync_status: "pending",
        started_at: startedAtIso,
      },
      { onConflict: "local_id", ignoreDuplicates: true }
    )
    .select("local_id")

  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 })
  }
  if (!claimRows || claimRows.length === 0) {
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
    await supabase.from("offline_sync_queue").delete().eq("local_id", localId)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  await supabase
    .from("offline_sync_queue")
    .update({ sync_status: "synced", synced_at: new Date().toISOString() })
    .eq("local_id", localId)

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

  // Claim the queue slot (idempotency token). No rows ⇒ already processed.
  const { data: claimRows, error: claimErr } = await supabase
    .from("offline_sync_queue")
    .upsert(
      {
        local_id: localId,
        facility_id: facilityId,
        employee_id: employeeId,
        module_key: "refrigeration",
        action,
        payload: payload as Json,
        sync_status: "pending",
        started_at: startedAtIso,
      },
      { onConflict: "local_id", ignoreDuplicates: true }
    )
    .select("local_id")

  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 })
  }
  if (!claimRows || claimRows.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const result = await persistRefrigeration(supabase, {
    employeeId,
    facilityId,
    input,
  })

  if (!result.ok) {
    // Release the claim so a future retry re-attempts the persist.
    await supabase.from("offline_sync_queue").delete().eq("local_id", localId)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  await supabase
    .from("offline_sync_queue")
    .update({ sync_status: "synced", synced_at: new Date().toISOString() })
    .eq("local_id", localId)

  return NextResponse.json({ ok: true, reportId: result.reportId })
}
