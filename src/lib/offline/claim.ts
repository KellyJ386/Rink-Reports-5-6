import "server-only"

import type { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

/**
 * Shared claim protocol for offline replay handlers.
 *
 * The `offline_sync_queue.local_id` unique key is the idempotency token: a
 * replay upserts with `{ onConflict: "local_id", ignoreDuplicates: true }` so a
 * conflicting row returns zero rows and the submission is treated as "already
 * processed".
 *
 * E-03 fix — crash-orphan handling. Previously a zero-row claim was reported to
 * the client as `{ ok: true, duplicate: true }` unconditionally, and the service
 * worker then DELETED the queued item. If the server had died between the claim
 * insert and the report persist (or the claim-release delete failed), the row
 * was left `sync_status:'pending'` with the report never written — a silent
 * loss. Now, on a zero-row claim we re-read the existing row's status:
 *   - `synced` → genuinely already processed → duplicate, safe to delete.
 *   - anything else (`pending`, an orphan) → RE-DRIVE the persist under the
 *     existing claim rather than reporting false success. Re-running persist is
 *     safe because each persist mints its own report rows; a partial prior
 *     persist would have released the claim (delete) and never reached here.
 *
 * On persist failure the claim is released (delete) so a later retry re-attempts;
 * on success the row is flipped to `synced`.
 *
 * Every post-claim read/write here is ALSO scoped to the calling employee, not
 * just `local_id`. `local_id` is globally unique across users/facilities, so
 * without that scoping a caller whose id matched another user's already-synced
 * row (a facility admin can SELECT every facility row) would be told
 * "duplicate" — and the SW would delete their queued report unsynced — and the
 * release/synced writes could touch a row the caller never owned. Users may
 * also delete their own queue rows directly, so a row vanishing between calls
 * is normal, not an error.
 */

export type ClaimSlotArgs = {
  supabase: SupabaseClient
  localId: string
  facilityId: string
  employeeId: string
  moduleKey: string
  action: string
  payload: Record<string, unknown>
  startedAtIso: string
}

export type ClaimResult =
  | { kind: "claimed" }
  | { kind: "duplicate" }
  | { kind: "error"; message: string }

/**
 * Claim the queue slot for `localId`. Returns:
 *  - `claimed`   — this request owns the slot; proceed to persist.
 *  - `duplicate` — the slot is already `synced`; the caller should report
 *                  `{ ok: true, duplicate: true }` and let the SW delete it.
 *  - `error`     — a DB error occurred (transient; surface as 500).
 */
export async function claimQueueSlot(args: ClaimSlotArgs): Promise<ClaimResult> {
  const {
    supabase,
    localId,
    facilityId,
    employeeId,
    moduleKey,
    action,
    payload,
    startedAtIso,
  } = args

  const { data: claimRows, error: claimErr } = await supabase
    .from("offline_sync_queue")
    .upsert(
      {
        local_id: localId,
        facility_id: facilityId,
        employee_id: employeeId,
        module_key: moduleKey,
        action,
        payload: payload as Json,
        sync_status: "pending",
        started_at: startedAtIso,
      },
      { onConflict: "local_id", ignoreDuplicates: true }
    )
    .select("local_id")

  if (claimErr) {
    return { kind: "error", message: claimErr.message }
  }

  if (claimRows && claimRows.length > 0) {
    return { kind: "claimed" }
  }

  // Zero rows → a row already exists for this local_id. Only treat it as a true
  // duplicate if it actually reached `synced` AND belongs to the calling
  // employee; a still-`pending` own row is a crash orphan and must be re-driven
  // (E-03). A row held by a DIFFERENT employee can be neither claimed (unique
  // key) nor marked synced (the writes below are employee-scoped), so
  // persisting under it would not be idempotent across retries — surface a
  // transient error instead of false success, keeping the item queued on the
  // device rather than letting the SW delete it.
  const { data: existing, error: readErr } = await supabase
    .from("offline_sync_queue")
    .select("sync_status, employee_id")
    .eq("local_id", localId)
    .maybeSingle<{ sync_status: string | null; employee_id: string | null }>()

  if (readErr) {
    return { kind: "error", message: readErr.message }
  }
  if (existing && existing.employee_id !== employeeId) {
    return { kind: "error", message: "Queue slot is held by another user" }
  }
  if (existing && existing.sync_status === "synced") {
    return { kind: "duplicate" }
  }
  // Orphaned own pending row (or row vanished) → take ownership and re-persist.
  return { kind: "claimed" }
}

/**
 * Release the claim so a future retry re-attempts the persist. Scoped to the
 * calling employee as well as local_id so a colliding id can never delete
 * another user's row.
 */
export async function releaseClaim(
  supabase: SupabaseClient,
  localId: string,
  employeeId: string
): Promise<void> {
  await supabase
    .from("offline_sync_queue")
    .delete()
    .eq("local_id", localId)
    .eq("employee_id", employeeId)
}

/**
 * Mark the claim `synced` once the report has been persisted. Scoped to the
 * calling employee as well as local_id so a colliding id can never flip
 * another user's still-pending row to `synced`.
 */
export async function markClaimSynced(
  supabase: SupabaseClient,
  localId: string,
  employeeId: string
): Promise<void> {
  await supabase
    .from("offline_sync_queue")
    .update({ sync_status: "synced", synced_at: new Date().toISOString() })
    .eq("local_id", localId)
    .eq("employee_id", employeeId)
}
