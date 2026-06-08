// Server-only offline-replay handler for the communications (staff messaging)
// module. The online server action (`actions.ts`) stays the source of truth;
// this mirrors its checks so a message composed offline lands the same rows
// when the service worker replays it via /api/offline-sync once back online.
//
// Contract note (isAdmin): `persistMessage` needs an `isAdmin` flag to gate the
// staff-only `staff_can_message` group restriction (mig 59). That flag is
// derived from the AUTH USER, not from supabase + ids alone. Replay runs while
// the user is authenticated (the SW flushes with their session), so this
// handler resolves it itself via `getCurrentUser()` + `getIsAdmin()` — exactly
// the way the online action does. Keeping that here means the route.ts dispatch
// stays a plain pass-through (it does not need to compute or forward isAdmin).

import { NextResponse } from "next/server"

import type { createClient } from "@/lib/supabase/server"
import { getCurrentUser, getIsAdmin } from "@/lib/auth"
import { currentUserCan } from "@/lib/permissions/check"
import type { Json } from "@/types/database"

import {
  buildMessageInputFromPayload,
  persistMessage,
  validateMessageInput,
} from "./submit"

export type MessageReplayArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

/**
 * Replay a queued compose-message submission into the real tables. Mirrors the
 * incident/air-quality replay shape: parse → validate → permission → derive
 * isAdmin → claim the `offline_sync_queue` slot → persist → release-claim on
 * failure → mark synced. Idempotent via the `offline_sync_queue.local_id` claim
 * token: a duplicate replay (the SW retrying after a lost response) is a no-op.
 *
 * Unlike the sensor reports, the staff-only group restriction depends on whether
 * the replaying user is an admin, so isAdmin is resolved from the session here.
 */
export async function handleMessageReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: MessageReplayArgs): Promise<NextResponse> {
  const input = buildMessageInputFromPayload(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  // Same field-level guards as the online action: empty body / no recipients is
  // a permanent failure → 400 (the SW marks it failed rather than retrying).
  const validation = validateMessageInput(input)
  if (!validation.ok) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "communications", "submit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Derive isAdmin the same way the online action and route POST do: from the
  // authenticated user. Replay always runs with the user's live session.
  const current = await getCurrentUser()
  if (!current?.authUser) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }
  const isAdmin = await getIsAdmin(current)

  // Claim the queue slot. With ignoreDuplicates, a conflicting (already-claimed)
  // local_id returns no rows → the submission was already processed.
  const { data: claimRows, error: claimErr } = await supabase
    .from("offline_sync_queue")
    .upsert(
      {
        local_id: localId,
        facility_id: facilityId,
        employee_id: employeeId,
        module_key: "communications",
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

  const result = await persistMessage(supabase, {
    employeeId,
    facilityId,
    isAdmin,
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

  return NextResponse.json({ ok: true, messageId: result.messageId })
}
