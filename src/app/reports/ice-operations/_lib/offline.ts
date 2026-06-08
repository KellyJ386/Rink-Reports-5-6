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
import type { Json } from "@/types/database"

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
  const validationError = validateIceOpsInput(input)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "ice_operations", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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
        module_key: "ice_operations",
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

  const result = await persistIceOperation(supabase, {
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
