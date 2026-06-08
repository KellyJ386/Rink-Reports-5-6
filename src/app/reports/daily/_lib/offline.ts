// Server-only offline-replay handler for queued daily-report submissions.
// Mirrors `handleAirQualityReplay` in `/api/offline-sync/route.ts`: parse the
// queued payload → permission gate → claim the `offline_sync_queue` slot
// (idempotency token) → persist the same rows an online submit would land →
// release the claim on failure → mark synced. The route imports and dispatches
// this; it does not duplicate the logic.

import "server-only"

import { NextResponse } from "next/server"

import { currentUserCan } from "@/lib/permissions/check"
import type { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

import { buildInputFromPayload, persistDaily } from "./submit"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type DailyReplayArgs = {
  supabase: SupabaseClient
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

/**
 * Replay a queued daily-report submission into the real tables. Idempotent via
 * the `offline_sync_queue.local_id` claim token, mirroring the other replay
 * paths: the same area/template/permission checks and notification dispatch run,
 * so an offline submission lands the same rows as an online one.
 */
export async function handleDailyReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: DailyReplayArgs): Promise<NextResponse> {
  const input = buildInputFromPayload(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "daily_reports", "submit"))) {
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
        module_key: "daily_reports",
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

  const result = await persistDaily(supabase, {
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
