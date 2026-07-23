// Server-only offline-replay handler for queued Dasher Boards writes.
// Mirrors handleIceDepthReplay: parse payload → permission gate → claim the
// offline_sync_queue slot (idempotency token) → persist via the same
// _lib/submit.ts functions an online action uses → release on failure → mark
// synced. The /api/offline-sync route imports and dispatches this.
//
// Offline walk contract: a walk started offline has NO server id, so every
// queued payload targets the RINK and the replay resolves "my open walk on
// that rink" server-side — exactly how the online persist layer auto-links.
// The service worker replays FIFO (by startedAt), so a queued sequence
// start_walk → report_issue → save_responses → complete_walk lands in order:
// the walk exists by the time its issues/responses/sign-off replay.
//
// Conflict rule (resolution fields): ack/resolve are NOT offline actions —
// they are supervisor decisions made against live state; the house queue would
// make them last-write-wins by replay order, which is the documented rule if
// they are ever queued. completeInspection's three sign-off gates re-run at
// replay time, so an offline sign-off that no longer satisfies them parks as
// failed instead of forging an attestation.

import "server-only"

import { NextResponse } from "next/server"

import { currentUserCan } from "@/lib/permissions/check"
import type { createClient } from "@/lib/supabase/server"
import { claimQueueSlot, markClaimSynced, releaseClaim } from "@/lib/offline/claim"

import { isUuid } from "./compute"
import {
  completeInspection,
  parseIssueReportInput,
  persistIssueReport,
  saveChecklistResponses,
  startInspection,
  type ChecklistResponseInput,
} from "./submit"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type DasherBoardsReplayArgs = {
  supabase: SupabaseClient
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

async function resolveOpenWalkId(
  supabase: SupabaseClient,
  employeeId: string,
  rinkId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("dasher_boards_inspections")
    .select("id")
    .eq("rink_id", rinkId)
    .eq("inspector_id", employeeId)
    .is("completed_at", null)
    .maybeSingle()
  return data?.id ?? null
}

// Did this inspector already complete a walk on this rink very recently? Used
// to make a complete_walk re-drive (crash after completion, before the queue
// row was marked synced) an idempotent success instead of a false "no open
// walk" permanent failure.
async function hasRecentlyCompletedWalk(
  supabase: SupabaseClient,
  employeeId: string,
  rinkId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from("dasher_boards_inspections")
    .select("id")
    .eq("rink_id", rinkId)
    .eq("inspector_id", employeeId)
    .not("completed_at", "is", null)
    .gte("completed_at", since)
    .limit(1)
    .maybeSingle()
  return !!data
}

export async function handleDasherBoardsReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: DasherBoardsReplayArgs): Promise<NextResponse> {
  if (!(await currentUserCan(supabase, "dasher_boards", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Validate the payload for the action BEFORE claiming, so a malformed item
  // 400s (permanent) instead of consuming a claim.
  let doWrite: () => Promise<{ ok: true } | { ok: false; error: string; permanent?: boolean }>

  if (action === "report_issue") {
    const input = parseIssueReportInput(payload)
    if (!input) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    doWrite = async () => {
      // Thread the queue localId so a crash-window re-drive dedups instead of
      // inserting a second issue (persistIssueReport keys on source_local_id).
      const r = await persistIssueReport(supabase, {
        employeeId,
        facilityId,
        input,
        sourceLocalId: localId,
      })
      return r.ok ? { ok: true } : r
    }
  } else if (action === "start_walk") {
    const rinkId = asString(payload.rinkId)
    if (!isUuid(rinkId)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    doWrite = async () => {
      // startInspection resumes an existing open walk, so a duplicate replay
      // (or an online walk started meanwhile) is naturally idempotent.
      const r = await startInspection(supabase, { employeeId, facilityId, rinkId })
      return r.ok ? { ok: true } : r
    }
  } else if (action === "save_responses") {
    const rinkId = asString(payload.rinkId)
    const raw = Array.isArray(payload.responses) ? payload.responses : null
    if (!isUuid(rinkId) || !raw) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    const responses: ChecklistResponseInput[] = []
    for (const r of raw) {
      if (typeof r !== "object" || r === null) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
      }
      const itemId = asString((r as Record<string, unknown>).itemId)
      const status = asString((r as Record<string, unknown>).status)
      if (!isUuid(itemId) || (status !== "pass" && status !== "flag")) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
      }
      responses.push({ itemId, status: status as "pass" | "flag" })
    }
    doWrite = async () => {
      const inspectionId = await resolveOpenWalkId(supabase, employeeId, rinkId)
      if (!inspectionId) {
        // The walk this belongs to was never created (its start_walk failed)
        // or is already signed off — retrying will never fix that.
        return { ok: false, error: "No open walk for this rink.", permanent: true }
      }
      const r = await saveChecklistResponses(supabase, {
        employeeId,
        facilityId,
        inspectionId,
        responses,
      })
      return r.ok ? { ok: true } : r
    }
  } else if (action === "complete_walk") {
    const rinkId = asString(payload.rinkId)
    if (!isUuid(rinkId)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    const notes = asString(payload.notes)
    doWrite = async () => {
      const inspectionId = await resolveOpenWalkId(supabase, employeeId, rinkId)
      if (!inspectionId) {
        // No OPEN walk. If one completed here very recently, this is a re-drive
        // of an already-successful completion (crash before the queue synced) —
        // treat it as an idempotent success, not a false permanent failure.
        if (await hasRecentlyCompletedWalk(supabase, employeeId, rinkId)) {
          return { ok: true }
        }
        return { ok: false, error: "No open walk for this rink.", permanent: true }
      }
      // The three sign-off gates run HERE, at replay time — an offline
      // sign-off that fails them (e.g. an unacked severity-A issue) parks as
      // failed rather than forging the attestation. ONLY gate/terminal
      // failures are permanent; a transient DB error keeps its retries.
      const r = await completeInspection(supabase, {
        employeeId,
        facilityId,
        inspectionId,
        notes: notes.length > 0 ? notes : null,
      })
      if (r.ok) return { ok: true }
      const gateFailure =
        /severity-A|due checklist item|flagged checklist item|already signed off|Walk not found/.test(
          r.error,
        )
      return { ...r, permanent: gateFailure }
    }
  } else {
    return NextResponse.json(
      { error: "Unsupported dasher_boards action" },
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
    moduleKey: "dasher_boards",
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

  const result = await doWrite()

  if (!result.ok) {
    // Release the claim so a future retry re-attempts the persist (transient),
    // or park permanently with 422 (the SW stops retrying).
    await releaseClaim(supabase, localId)
    return NextResponse.json(
      { error: result.error },
      { status: result.permanent ? 422 : 500 },
    )
  }

  await markClaimSynced(supabase, localId)

  return NextResponse.json({ ok: true })
}
