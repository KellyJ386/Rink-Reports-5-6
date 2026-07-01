// Server-only offline-replay handler for queued ice-depth submissions.
// Mirrors `handleAirQualityReplay` in `/api/offline-sync/route.ts`: parse the
// queued payload → permission gate → claim the `offline_sync_queue` slot
// (idempotency token) → persist the same rows an online submit would land →
// release the claim on failure → mark synced. The route imports and dispatches
// this; it does not duplicate the logic.

import "server-only"

import { NextResponse } from "next/server"

import { currentUserCan } from "@/lib/permissions/check"
import type { createClient } from "@/lib/supabase/server"
import { claimQueueSlot, markClaimSynced, releaseClaim } from "@/lib/offline/claim"

import { buildInputFromPayload, persistIceDepth } from "./submit"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type IceDepthReplayArgs = {
  supabase: SupabaseClient
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

/**
 * Replay a queued ice-depth session into the real tables. Idempotent via the
 * `offline_sync_queue.local_id` claim token, mirroring the other replay paths:
 * the same layout/point validation, severity recompute, summary rollup, alert,
 * and notification dispatch run, so an offline session lands the same rows as an
 * online one.
 */
export async function handleIceDepthReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: IceDepthReplayArgs): Promise<NextResponse> {
  const input = buildInputFromPayload(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "ice_depth", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Claim the queue slot (idempotency token). A duplicate that already reached
  // `synced` is a no-op; an orphaned `pending` row is re-driven (see claim.ts).
  const claim = await claimQueueSlot({
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey: "ice_depth",
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

  const result = await persistIceDepth(supabase, {
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
