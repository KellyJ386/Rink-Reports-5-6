# Offline Stack Fixes — change log

Fixes for findings E-01…E-09 from `audit/phase1/agent-e-offline-state.md`.
No DB schema change / no migration: the fixes work with the existing
`offline_sync_queue` columns (`local_id`, `facility_id`, `employee_id`,
`module_key`, `action`, `payload`, `sync_status`, `retry_count`,
`error_message`). The E-01 owner uid is carried in the client record + POST
body and compared in the route — no new column.

`pnpm exec tsc --noEmit`: clean (no errors). `pnpm test`: 411/411 pass
(retry-policy SW-mirror test unaffected).

---

## New shared modules

- `src/lib/offline/local-id.ts` — `genLocalId()` with a spec-compliant UUIDv4
  fallback (E-05).
- `src/lib/offline/current-owner.ts` — client-side cache of the signed-in auth
  uid, seeded/updated by `AuthStateListener`, read synchronously by
  `enqueueSubmission` (E-01).
- `src/lib/offline/claim.ts` — `claimQueueSlot()` / `releaseClaim()` /
  `markClaimSynced()`: shared claim protocol with crash-orphan re-drive (E-03),
  replacing the duplicated claim/persist/finalize block in all 9 handlers.

---

## E-01 (HIGH) — queue is origin-global, not user-keyed

- `src/lib/offline/use-sync-queue.ts:enqueueSubmission` (~line 155) — stamps
  `ownerId: getCurrentOwnerId()` on the `ENQUEUE_SUBMISSION` message.
- `public/sw.js` ENQUEUE_SUBMISSION handler (record build, ~line 340) — persists
  `ownerId` on the IndexedDB record; it rides along in the replay POST body
  (`replayQueue` posts the whole `item`).
- `src/app/api/offline-sync/route.ts:36-46` — `bodySchema` gains
  `ownerId: z.string().min(1).nullish()`.
- `src/app/api/offline-sync/route.ts` (~line 92, right after parse, BEFORE the
  employee lookup) — rejects `ownerId && ownerId !== current.authUser.id` with a
  permanent **422** "This submission was queued by a different user." (never
  silently re-attributes; runs before employee_id is derived from the new
  session).
- `src/components/app/auth-state-listener.tsx` — seeds `setCurrentOwnerId` on
  session load; on SIGNED_OUT / different-user sign-in it now posts
  `QUARANTINE_FOREIGN` to the SW (in addition to the existing schedule-cache
  wipe).
- `public/sw.js` new `QUARANTINE_FOREIGN` message handler (~line 380) — marks any
  queued item whose `ownerId !== currentOwnerId` as permanent `failed` with
  "Queued by a different user — sign in as that user to sync."

**Owner-check flow:** (1) at enqueue, the record + payload are stamped with the
current auth uid (owner). (2) On user-switch/sign-out `AuthStateListener` tells
the SW to quarantine any item whose owner ≠ the new user, so the SW never sends
another user's items. (3) As a server backstop, `/api/offline-sync` compares the
item's `ownerId` to `current.authUser.id` BEFORE deriving employee_id and returns
a permanent 422 on mismatch instead of re-attributing. `local_id` idempotency is
untouched.

## E-02 (HIGH) — no flush survives SW termination on Safari/iOS

- `src/lib/offline/use-sync-queue.ts` — `useSyncQueue` now drains ALL
  pending+failed via a new `FLUSH_QUEUE` SW message on window `online`, on
  `visibilitychange`→visible, and on `focus`. New exported `flushQueue()` and
  `postToServiceWorker()` helpers.
- `public/sw.js` new `FLUSH_QUEUE` handler (~line 358) — resets non-permanent
  `failed`→`pending` and re-runs `replayQueue()` (permanent 4xx/422 items left
  for the explicit "Retry failed" action). `activate` also calls
  `replayQueue()`.
- `src/app/reports/offline-queue/_components/offline-queue-view.tsx` — a manual
  **"Sync now"** button (shown when `pendingCount > 0`) that calls `flushQueue()`.
- Background Sync (`registration.sync`) kept as the fast path where supported.

## E-03 (MEDIUM) — claim-protocol crash orphan

Fix chosen: **confirm the row reached a written state before telling the SW to
delete** (the minimal safe fix; a single cross-table transaction isn't available
through the PostgREST client without a new RPC/migration, which is out of
scope). `src/lib/offline/claim.ts:claimQueueSlot` now, on a zero-row claim,
re-reads `sync_status`: only `synced` → `{duplicate}` (SW deletes); a still
`pending` orphan → returns `claimed` so the persist RE-RUNS. Re-running persist
is safe because a prior *partial* persist releases the claim (delete) before
returning, so any row seen here is either fully synced or an un-persisted orphan.
Applied to all 9 handlers (route.ts incidents/refrigeration/air_quality/
scheduling + the 5 module `_lib/offline.ts` files).

## E-04 (MEDIUM) — unknown moduleKey marked synced without writing

- `src/app/api/offline-sync/route.ts` (~line 230) — the fallback now upserts
  `sync_status: 'failed'` with `error_message: "Unknown module: …"` and returns a
  permanent **422** `{ error }`. Never `synced`.

## E-05 (LOW) — genLocalId non-UUID fallback → uuid column violation

- All `genLocalId` definitions replaced with the shared
  `import { genLocalId } from "@/lib/offline/local-id"` (RFC 4122 v4 fallback):
  refrigeration, accidents, incidents, air-quality, daily, ice-depth,
  communications (`comm-…`), ice-operations (`ice-ops-…`), scheduling
  availability + time-off submission forms.

## E-06 (LOW) — badge/queue false-empty after hard reload

- `src/lib/offline/use-sync-queue.ts` — `GET_QUEUE` now goes through
  `postToServiceWorker`, which falls back to `serviceWorker.ready` when
  `controller === null`; re-queries on `controllerchange`.
- `offline-queue-view.tsx` — same `postToServiceWorker` fallback + a
  `controllerchange` re-query for the item list.

## E-07 (LOW) — permanently-doomed daily replays classed transient

- `src/app/reports/daily/_lib/offline.ts` — pre-claim check that the referenced
  area + template are still `is_active` (mirrors the incident ref check); a
  deactivated ref returns a permanent **422** instead of the transient 500 that
  burned ~6 min of retries.

## E-08 (LOW) — offline availability EDIT of a deleted row silently synced

- `src/app/api/offline-sync/route.ts` scheduling handler — the availability
  UPDATE closure now `.select("id")`s and reports `{ permanent: true }` on 0 rows
  affected; the handler returns **422** with "The availability entry you edited
  offline no longer exists." instead of marking it synced.

## E-09 (LOW) — no persistent-storage grant

- `public/sw.js` `activate` — calls `requestPersistentStorage()`
  (`navigator.storage.persist()`, guarded/try-caught, best-effort).

---

## Not done / not needed
None stopped. No fix required a DB column or an unsafe change. E-03's fully
transactional variant would need a SECURITY DEFINER RPC (a migration) — out of
scope — so the documented status-confirmation approach was used instead, which is
safe with the current schema.
