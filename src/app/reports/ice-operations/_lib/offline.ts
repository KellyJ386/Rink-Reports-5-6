// Server-only offline-replay handler for the ice-operations module. Mirrors the
// air-quality/refrigeration replay handlers in `src/app/api/offline-sync/route.ts`
// (which imports + dispatches to this function). Kept in the module's `_lib/`
// rather than inline in route.ts so the op-type-specific logic lives next to the
// rest of the module's submission pipeline.
//
// All FOUR operation types (ice_make, blade_change, edging, circle_check) route
// through one handler: the `operation_type` discriminator rides inside the queued
// `payload`, so `buildInputFromPayload` reconstructs the same structured input the
// online server action does, and `persistIceOperation` lands the same rows.

import "server-only"

import { NextResponse } from "next/server"

import { currentUserCan } from "@/lib/permissions/check"
import type { createClient } from "@/lib/supabase/server"
import { claimQueueSlot, markClaimSynced, releaseClaim } from "@/lib/offline/claim"

import {
  buildInputFromPayload,
  persistIceOperation,
  validateIceOpsInput,
} from "./submit"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type IceOperationsReplayArgs = {
  supabase: SupabaseClient
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

/**
 * Replay a queued ice-operations submission into the real tables. Idempotent via
 * the `offline_sync_queue.local_id` claim token, mirroring the incident/air-quality
 * paths: parse → validate → permission → claim → persist → release-on-failure →
 * mark synced. The handler is operation-type-agnostic — the type discriminator is
 * read from the payload by `buildInputFromPayload`, so the same circle-check
 * results, failed-count rollup, alert, and notification fan-out run as online.
 */
export async function handleIceOperationsReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: IceOperationsReplayArgs): Promise<NextResponse> {
  // Reconstruct the structured input from the queued payload. A null result means
  // the payload is malformed (unknown/missing operation_type, or non-array
  // circle-check results) — a permanent failure, so 400.
  const input = buildInputFromPayload(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  // Pure per-op validation (rink/equipment/occurred_at required, failed-item
  // notes). Runs before claiming so a violating submit is a permanent 400 that
  // the service worker marks failed — identical to the online server action.
  //
  // DELIBERATELY NOT checked here: enabled_operation_types. The online action
  // rejects submissions for operation types the facility has disabled, but a
  // queued offline submission was created while the type was enabled —
  // rejecting it at replay would discard real field data over a config change
  // that happened after the fact.
  const validationError = validateIceOpsInput(input)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "ice_operations", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Claim the queue slot (idempotency token). A duplicate that already reached
  // `synced` is a no-op; an orphaned `pending` row is re-driven (see claim.ts).
  const claim = await claimQueueSlot({
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey: "ice_operations",
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

  const result = await persistIceOperation(supabase, {
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
