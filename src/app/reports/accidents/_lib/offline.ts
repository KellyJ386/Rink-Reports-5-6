// Server-only offline replay handler for accident reports. The route handler
// (`src/app/api/offline-sync/route.ts`) dispatches to this when a queued
// submission with moduleKey "accident_reports" comes back online. It mirrors
// `handleAirQualityReplay` EXACTLY (parse → validate → permission → claim →
// persist → release-on-failure → mark synced) so an offline submission lands
// the same rows, with the same checks, as an online one.

import "server-only"

import { NextResponse } from "next/server"

import { currentUserCan } from "@/lib/permissions/check"
import type { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

import {
  buildInputFromPayload,
  persistAccident,
  validateFields,
} from "./submit"

type AccidentReplayArgs = {
  supabase: Awaited<ReturnType<typeof createClient>>
  localId: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
  facilityId: string
  employeeId: string
}

/**
 * Replay a queued accident submission into the real tables. Idempotent via the
 * `offline_sync_queue.local_id` claim token, mirroring the air-quality path: the
 * same persist pipeline runs (report shell + body parts + witnesses + change log
 * + medical-attention alert + notification fan-out), so an offline submission
 * lands identically to an online one.
 */
export async function handleAccidentReplay({
  supabase,
  localId,
  action,
  payload,
  startedAtIso,
  facilityId,
  employeeId,
}: AccidentReplayArgs): Promise<NextResponse> {
  const input = buildInputFromPayload(payload)
  if (!input) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  // Field-level validation (required name/contact/age/occurred_at/description)
  // runs BEFORE claiming so a bad offline submit returns 400 and the service
  // worker marks it failed — mirroring the online server action.
  const fieldErrors = validateFields(input)
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  if (!(await currentUserCan(supabase, "accident_reports", "submit"))) {
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
        module_key: "accident_reports",
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

  const result = await persistAccident(supabase, {
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
