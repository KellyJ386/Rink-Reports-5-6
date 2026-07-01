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
import { claimQueueSlot, markClaimSynced, releaseClaim } from "@/lib/offline/claim"

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

  // E-07 — pre-validate the referenced area + template are still active BEFORE
  // claiming, mirroring the incident replay's ref check. If an admin deactivated
  // the area/template while the device was offline, `persistDaily` would fail
  // with a 500 that will NEVER succeed on retry — burning ~6 min of transient
  // retries. Detecting it here returns a permanent 422 so the SW parks the item
  // immediately with a clear reason.
  const { data: area } = await supabase
    .from("daily_report_areas")
    .select("is_active")
    .eq("id", input.area_id)
    .eq("facility_id", facilityId)
    .maybeSingle<{ is_active: boolean | null }>()
  if (!area || area.is_active === false) {
    return NextResponse.json({ error: "Area not available." }, { status: 422 })
  }

  const { data: template } = await supabase
    .from("daily_report_templates")
    .select("is_active")
    .eq("id", input.template_id)
    .eq("facility_id", facilityId)
    .eq("area_id", input.area_id)
    .maybeSingle<{ is_active: boolean | null }>()
  if (!template || template.is_active === false) {
    return NextResponse.json({ error: "Template not available." }, { status: 422 })
  }

  // Claim the queue slot (idempotency token). A duplicate that already reached
  // `synced` is a no-op; an orphaned `pending` row is re-driven (see claim.ts).
  const claim = await claimQueueSlot({
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey: "daily_reports",
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

  const result = await persistDaily(supabase, {
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
