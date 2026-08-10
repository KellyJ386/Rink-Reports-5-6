// Server-only offline-replay handler for queued form-builder INSTANCE writes
// (migration 235): create / save / submit actions queued by the service
// worker while the device was offline. Mirrors `handleDailyReplay`: parse the
// queued payload → permission gate → claim the `offline_sync_queue` slot
// (idempotency token) → run the SAME pipeline the online server actions use →
// release the claim on failure → mark synced.
//
// LOCK CONFLICTS (the Phase-4 requirement): the pipeline re-checks
// daily_report_day_is_locked at replay time. If the day locked while the item
// sat in the offline queue, the replay returns a permanent 422 with explicit
// copy — the service worker parks the item as FAILED (it is NEVER silently
// dropped) and the error is shown verbatim on the Pending Sync Queue page.
// If an admin later unlocks the day, "Retry failed" re-drives the item and it
// syncs normally.

import "server-only"

import { NextResponse } from "next/server"

import { claimQueueSlot, markClaimSynced, releaseClaim } from "@/lib/offline/claim"
import { opaqueReplayFailure } from "@/lib/offline/replay-error"
import { currentUserCan } from "@/lib/permissions/check"
import type { createClient } from "@/lib/supabase/server"

import {
  createInstance,
  saveInstance,
  submitInstance,
  type InstanceWriteResult,
} from "./instances"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type DailyInstanceReplayArgs = {
  supabase: SupabaseClient
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

const LOCK_CONFLICT_MESSAGE =
  "The day was locked while this report was queued offline, so it could not " +
  "be synced. Nothing was lost — it stays in the queue. If it still needs to " +
  "be filed, ask an administrator to unlock the day, then retry it from here."

export async function handleDailyInstanceReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: DailyInstanceReplayArgs): Promise<NextResponse> {
  if (!(await currentUserCan(supabase, "daily_reports", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Build the pipeline call for this action. Validation of the payload's
  // CONTENT (title, responses vs. the frozen snapshot, lock state) happens
  // inside the pipeline — identically to the online path; only the payload's
  // SHAPE is checked here.
  let run: () => Promise<InstanceWriteResult>
  if (action === "create") {
    const areaId = str(payload.area_id)
    const templateId = str(payload.template_id)
    if (!areaId || !templateId) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    run = () =>
      createInstance(supabase, {
        employeeId,
        facilityId,
        areaId,
        templateId,
        title: payload.title,
      })
  } else if (action === "save" || action === "submit") {
    const instanceId = str(payload.instance_id)
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    run =
      action === "save"
        ? () =>
            saveInstance(supabase, {
              employeeId,
              facilityId,
              instanceId,
              responses: payload.responses,
              ...(payload.title !== undefined ? { title: payload.title } : {}),
            })
        : () =>
            submitInstance(supabase, {
              employeeId,
              facilityId,
              instanceId,
              ...(payload.responses !== undefined
                ? { responses: payload.responses }
                : {}),
            })
  } else {
    return NextResponse.json(
      { error: "Unsupported report-instance action" },
      { status: 400 },
    )
  }

  // Claim the queue slot (idempotency token). A duplicate that already reached
  // `synced` is a no-op; an orphaned `pending` row is re-driven (see claim.ts).
  const claim = await claimQueueSlot({
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey: "daily_report_instances",
    action,
    payload,
    startedAtIso,
  })
  if (claim.kind === "error") {
    if (claim.permanent) {
      return NextResponse.json({ error: claim.message }, { status: 422 })
    }
    return opaqueReplayFailure(
      "reports/daily/instance-offline-replay",
      new Error(claim.message),
      { step: "claim" },
    )
  }
  if (claim.kind === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const result = await run()

  if (!result.ok) {
    // Release the claim so a retry (automatic for transient failures, the
    // user-driven "Retry failed" for permanent ones) re-attempts the persist.
    await releaseClaim(supabase, localId, employeeId)
    if (result.lockConflict) {
      // The Phase-4 conflict: the day locked while this sat in the queue.
      // Surface it explicitly; never silently drop the data.
      return NextResponse.json({ error: LOCK_CONFLICT_MESSAGE }, { status: 422 })
    }
    if (result.permanent) {
      // Our own hand-written validation/state copy — safe to show verbatim on
      // the Pending Sync Queue page.
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    // Transient failures can echo raw DB internals; log the detail and keep
    // the body opaque. 500 keeps the SW retrying.
    return opaqueReplayFailure(
      "reports/daily/instance-offline-replay",
      new Error(result.error),
      { step: "persist", action },
    )
  }

  await markClaimSynced(supabase, localId, employeeId)

  return NextResponse.json({ ok: true, instanceId: result.instanceId })
}
