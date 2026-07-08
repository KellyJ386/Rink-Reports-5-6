# Phase 1 — Agent E: Offline & State Integrity

Read-only audit, 2026-07-01. Scope: offline submission queue (SW + IndexedDB + `/api/offline-sync`),
server-side replay, locked/stale races, client state freshness, PWA caching, queue UI truth.

## Summary

The offline stack is **service worker + IndexedDB** (`public/sw.js`, DB `rink-offline-queue`, store
`submissions`, keyPath `localId`). There is **no Dexie**. **Zustand exists** (contrary to the mission
assumption "no Zustand"): `package.json:46` + exactly one store, `src/app/admin/employees/bulk/_lib/store.ts`
— an ephemeral client grid for bulk employee entry, not used for offline or server-mirrored state.

The design is unusually strong: durable IndexedDB persistence, a unit-tested retry policy with
exponential backoff and transient/permanent classification, server-side dedup via a
client-generated `local_id` claim token, per-module replay handlers that re-run the same
validation/permission/persist code as the online server actions, and a global header badge +
`/reports/offline-queue` page that surface pending/failed items with human-readable errors.
All 9 submitting modules replay **synchronously in the same request** — there is no deferred
cron/trigger processing to lose track of.

The two serious gaps are: (1) the submission queue is **origin-global, not user-keyed**, and replay
attributes submissions to whoever's session cookie is live at flush time — a cross-user
misattribution path on shared kiosk devices that the codebase elsewhere explicitly defends against;
and (2) on browsers **without Background Sync (Safari/iOS)** there is no reliable flush trigger after
the SW is terminated — pending items can sit indefinitely with a "N pending" badge and no user
control to drain them.

## Lifecycle diagram

```
FORM SUBMIT (client, "use client")
 │  onSubmit checks navigator.onLine
 │   ├─ online  → normal server action (submitXxx) → revalidate/redirect done
 │   └─ offline → enqueueSubmission({localId: crypto.randomUUID(), moduleKey, action, payload})
 │                 (use-sync-queue.ts:65-83; returns false if no controlling SW)
 │                  ├─ ok    → e.preventDefault(); terminal "Saved on this device" card / toast
 │                  └─ false → falls through to server action (network error surfaces)
 │                             EXCEPT ice-depth: blocks + explicit message (submission-form.tsx:306-333)
 ▼
SW message ENQUEUE_SUBMISSION (sw.js:301-325)
 │  dbPut IndexedDB record {localId, moduleKey, action, payload, startedAt,
 │                          status:"pending", retryCount:0, nextAttemptAt:0}
 │  broadcastQueueUpdate → all tabs (badge counts)
 │  flush attempt: registration.sync.register("rink-offline-queue")  [Background Sync]
 │                 else replayQueue() immediately                    [no-BG-sync browsers]
 ▼
FLUSH TRIGGERS (sw.js): sync event (:282) · SW 'online' event (:472) ·
                        enqueue (:317-322) · RETRY_FAILED (:327-349) ·
                        setTimeout retryTimer for backed-off items (:258-277)
                        ⚠ none survive SW termination except Background Sync — see E-02
 ▼
replayQueue (sw.js:179-254): FIFO by startedAt, skip items whose nextAttemptAt > now
 │  POST /api/offline-sync {localId, moduleKey, action, payload, startedAt}
 ▼
/api/offline-sync (route.ts:56):
 │  auth: getCurrentUser() from SESSION COOKIE (⚠ E-01) → active employee row (403 if none)
 │  zod bodySchema (400 on shape errors)
 │  dispatch by moduleKey → replay handler (table below); unknown key → legacy
 │  upsert marked 'synced' WITHOUT persisting anywhere (⚠ E-04)
 │
 │  Handler shape (identical in all 9): parse payload → per-module validation →
 │  currentUserCan(module,"submit") → CLAIM offline_sync_queue upsert
 │  {onConflict:"local_id", ignoreDuplicates:true, sync_status:"pending"}
 │    · zero rows returned ⇒ already processed → {ok:true, duplicate:true} (⚠ E-03 window)
 │  → persist into real report tables (same persistXxx as online action, incl. severity
 │    engines + notification dispatch) → on failure DELETE claim + 500 → on success
 │    UPDATE claim sync_status='synced'
 ▼
SW classifies response (retry-policy mirror, sw.js:32-55):
 │  2xx        → dbDelete item (done)
 │  transient (5xx, network, 401/408/409/425/429) → retryCount+1, backoff 5s/15s/60s/300s,
 │               max 4 retries then status:"failed" (permanent:false)
 │  other 4xx  → status:"failed" permanent:true immediately
 ▼
broadcastQueueUpdate → useSyncQueue() counts → SyncStatusBadge (global header) +
/reports/offline-queue detail view (live SW mirror via GET_QUEUE; "Retry failed" resets
failed→pending and re-flushes)
```

Persistence: IndexedDB, so the queue survives SW restarts, tab closes, and SW updates
(install is deliberately no-`skipWaiting`; updates apply only after a user-accepted prompt —
`sw.js:58-65`, `sw-register.tsx:58-67`). Retention purge of the *server* table: synced > 90d,
failed > 180d, pending never (`supabase/migrations/00000000000134_purge_outbox_and_sync_queue.sql`).

## moduleKey → replay-handler map

| moduleKey | Client enqueue site | Replay handler (all run in-request) | Persist target |
|---|---|---|---|
| `daily_reports` | `reports/daily/_components/daily-report-console.tsx:161` | `handleDailyReplay` — `reports/daily/_lib/offline.ts:36` | `persistDaily` (daily submit tables + notifications) |
| `incident_reports` | `reports/incidents/_components/submission-form.tsx:306-325` (confirm dialog) | `handleIncidentReplay` — `api/offline-sync/route.ts:253` (reporter identity re-resolved from login, :268-271; deactivated refs → permanent 422, :282-290) | `persistIncident` |
| `accident_reports` | `reports/accidents/_components/submission-form.tsx:324` | `handleAccidentReplay` — `reports/accidents/_lib/offline.ts` (pre-claim `validateFields`, :53-59) | `persistAccident` |
| `refrigeration` | `reports/refrigeration/_components/submission-form.tsx:427-443` | `handleRefrigerationReplay` — `route.ts:356` (critical-note guard pre-claim → 400, :376-383) | `persistRefrigeration` |
| `air_quality` | `reports/air-quality/_components/submission-form.tsx:260-273` | `handleAirQualityReplay` — `route.ts:648` (same severity engine) | `persistAirQuality` |
| `ice_depth` | `reports/ice-depth/_components/submission-form.tsx:311-334` | `handleIceDepthReplay` — `reports/ice-depth/_lib/offline.ts:37` (severity recompute, rollup, alerts) | `persistIceDepth` |
| `ice_operations` (4 form types) | shared hook `.../[operationType]/_components/use-offline-submit.ts:36-49` (stamps `operation_type`) | `handleIceOperationsReplay` — `reports/ice-operations/_lib/offline.ts:46` (pre-claim `validateIceOpsInput`) | per-op persist + circle-check rollup |
| `communications` | `reports/communications/_components/compose-form.tsx:134-150` (mirrors required-field guard offline, :138) | `handleMessageReplay` — `reports/communications/_lib/offline.ts` (admin status resolved from session) | `persistMessage` |
| `scheduling` / `submit_availability` | `reports/scheduling/_components/availability-form.tsx:115-142` | `handleSchedulingReplay` — `route.ts:459` (same day/time/type checks, facility toggle, job-area-assignment check as `upsertAvailability`) | `schedule_availability` insert/update |
| `scheduling` / `request_time_off` | `reports/scheduling/_components/time-off-form.tsx:93-101` | `handleSchedulingReplay` — `route.ts:559-586` (wall-time→UTC in facility tz, mirrors `submitTimeOffRequest`) | `schedule_time_off_requests` (status `pending`) |
| *(any other key)* | — | **legacy fallback** `route.ts:211-233`: upsert `sync_status:'synced'` into `offline_sync_queue` only — **nothing lands in a report table** (E-04) | none |
| `facility-paperwork` | n/a — read-only documents browser, no submissions | n/a | n/a |
| admin scheduling grid | intentionally online-only (`admin/scheduling/_lib/grid-actions.ts:3-11`) | n/a by design | n/a |

Offline reachability: every submitting form gates on `navigator.onLine` inside `onSubmit` (or the
confirm handler), so the offline path is reached without the user doing anything special. Ice-depth
("offline-aware submit" per Phase 0) is confirmed and is the *most* defensive: when the SW isn't
controlling, it refuses to fire a doomed network action and tells the user their readings are kept
(`submission-form.tsx:306-333`); all other forms fall through to the server action so the failure
surfaces as a network error rather than a false success.

## Locked/stale race analysis (Task 4)

- **Daily reports: there is no end-of-day / submission lock.** Searched `src/app/reports/daily`
  and `src/app/admin/daily-reports` for lock/finalization — none exists (only color-dot class
  names match). So there is no "target became locked before sync" race for daily. The real
  staleness race is a **deactivated area/template**: `persistDaily` re-checks `is_active`
  (`reports/daily/_lib/submit.ts:85-102`) at replay time and fails → claim released → 500 →
  SW retries then parks as `failed` with the error shown in the queue view. Not silent, but
  misclassified as transient (see E-07).
- **Scheduling time-off queued for a week whose schedule got published:** neither the online
  action (`reports/scheduling/actions.ts:94-143`) nor the replay (`route.ts:559-586`) checks
  publish state — both insert `status:'pending'` for admin adjudication. Parity holds; nothing is
  silently dropped or auto-approved. Publish-lock enforcement is an admin-grid concern and the
  grid is online-only by design.
- **Availability overlapping a since-created shift:** availability is advisory (violations are
  evaluated by the scheduling violation engine, not blocked at write). Neither path does an
  overlap check (Phase-0 F-016's "overlap" validation note is inaccurate — `upsertAvailability`
  has none), so online/offline parity holds. Exception: an offline **edit** of an availability row
  that was deleted before sync updates 0 rows and is still marked synced (E-08).

## State freshness (Task 5)

- **Zustand:** present (`package.json:46`) but only in `src/app/admin/employees/bulk/_lib/store.ts`
  — pure client grid state; per-row server results are cleared on any edit ("stale badges never
  linger"). Not a server-state mirror; no freshness issue.
- **Admin scheduling week-board** (`admin/scheduling/shifts/_components/week-board.tsx:345-559`):
  optimistic patch → server action → on success **merges the server-returned DTO**
  (`replaceEvent(id, res.data)` / `setEvents` with `dtoToEvent(res.data)`), on failure reverts and
  toasts, on gate reopens the editor. No stale UI after success.
- **Module toggles** (`admin/modules/_components/module-toggles.tsx:26-40`): optimistic + rollback
  + `router.refresh()` on success. Fresh.
- **Permission matrix** (`admin/permissions/_components/permission-matrix.tsx:51-89`): per-toggle
  optimistic + revert-on-error is fine; the **preset** path sets client-computed
  `presetMatrix(preset)` instead of server-returned state and never refreshes (E-12, low).
- **Offline queue view** (`reports/offline-queue/_components/offline-queue-view.tsx`): a live
  mirror of SW IndexedDB via `GET_QUEUE` + `SYNC_QUEUE_UPDATE` broadcasts — truth, except when no
  SW controls the page (hard reload), when it falsely reports an empty, fully-synced queue (E-06).

## PWA caching (Task 6)

- Navigations are **network-only**; authenticated HTML is never cached (kiosk cross-user-leak
  rationale documented at `sw.js:1-16`); offline navigation gets a synthetic offline page
  (`sw.js:426-431, 434-467`).
- Sole exception: `/offline-schedule` — a **data-free shell** cached network-first
  (`sw.js:404-421`). Shift data comes from a **per-user** IndexedDB cache
  (`lib/offline/schedule-cache.ts`), refreshed on mount and on window `online`
  (`offline-my-schedule.tsx:141-150`). When serving from cache it shows an explicit
  "Offline — showing your last-synced schedule (as of N ago)" banner (`offline-my-schedule.tsx:178-189`)
  — staleness is unbounded but always disclosed with a timestamp. Cache is wiped on sign-out and
  on different-user sign-in (`components/app/auth-state-listener.tsx:28-37`).
- `_next/static` is cache-first (content-hashed, safe); old hashed assets accumulate until the
  next cache-name bump (E-11, info).

## useSyncQueue statuses (Task 7)

Client-side item states: `pending` (with optional `nextAttemptAt` backoff, shown as a live
countdown) and `failed` (with `permanent` flag distinguishing "won't retry" from retriable);
`synced` items are deleted from IndexedDB (server keeps the `synced` row 90 days).
`retryFailedSubmissions` resets **all** failed items (including `permanent` ones — they'll fail
again, but the queue view labels them "won't retry"/"contact your administrator", so the loop is
disclosed) and re-triggers a flush that also drains any due pending items. Gap: there is **no user
control that flushes pending-only items** — the Retry button renders only when `failedCount > 0`
(`offline-queue-view.tsx:125-130`), which matters under E-02.

## Findings

| Severity | ID | Evidence | Description | Suggested fix |
|---|---|---|---|---|
| HIGH | E-01 | `public/sw.js:301-325` (queue record has no user id); `src/app/api/offline-sync/route.ts:56-98` (identity = current session cookie); `route.ts:268-271` (incident reporter deliberately re-resolved from login); `src/components/app/auth-state-listener.tsx:28-37` (wipes schedule cache but NOT the submission queue) | **Cross-user replay attribution on shared devices.** The IndexedDB submission queue is origin-global. If user A queues a report offline, logs out (or the kiosk switches users) and user B signs in, the SW replays A's payload with B's cookies: the report is persisted under B's employee_id/facility, and for incidents the reporter name/phone are B's. The SW header comment shows shared-kiosk leakage is an explicit threat model, and the schedule cache already gets per-user hygiene — the queue does not. | Stamp `userId` on each queued record at enqueue; have the client (AuthStateListener) tell the SW to park/clear foreign-user items on SIGNED_OUT/user-switch; optionally include the enqueuing user id in the POST and 409 when it mismatches the session. |
| HIGH | E-02 | `public/sw.js:282-286` (Background Sync), `:472-474` (SW 'online' — not delivered to a terminated/stopped SW), `:258-277` (`setTimeout` retryTimer dies with SW termination), `:317-322` (enqueue-time flush); `src/lib/offline/use-sync-queue.ts:22-31` (window `online` only flips UI state — never messages the SW); `offline-queue-view.tsx:125-130` (Retry button only for failed) | **No reliable flush trigger without Background Sync.** On Safari/iOS (no Background Sync) the only replay triggers are events delivered to a *running* SW. After the SW is terminated (seconds of idle) or the app is relaunched online, nothing drains pending items: `GET_QUEUE` doesn't replay, the window `online` handler doesn't message the SW, and there is no pending-flush button. A queued report can show "1 pending" indefinitely while the user believes it "will sync automatically". Backed-off items whose timer died are equally stranded. | Post a `FLUSH_QUEUE` message from the client on window `online` and on app mount (sw-register or useSyncQueue); also call `replayQueue()` from the SW `activate` handler. |
| MEDIUM | E-03 | `route.ts:292-336` (claim → persist → mark-synced sequence; same shape in every handler, e.g. `reports/daily/_lib/offline.ts:56-97`); `route.ts:314-316` (`duplicate ⇒ ok:true`); migration `00000000000134` ("pending rows are NEVER purged") | **Silent-loss window in the claim protocol.** If the server dies/times out between the claim upsert (`sync_status:'pending'`) and the persist (or the claim-release `delete` on persist failure itself fails), the DB row stays claimed. The SW's retry then hits the `local_id` conflict, gets `{ok:true, duplicate:true}`, deletes the IndexedDB item — and the report was never written to the real tables. The orphaned `pending` row is never purged but also never surfaced anywhere. | On duplicate-claim, check the row's `sync_status`: if still `pending`, re-run the persist (claim ownership via a conditional update) instead of reporting success; add an admin/ops query for stale `pending` rows. |
| MEDIUM | E-04 | `route.ts:100-101, 211-233` (fallback upsert with `sync_status:'synced'`, returns `{ok:true}`) | **Unknown-moduleKey fallback fakes success.** A moduleKey with no handler is upserted into `offline_sync_queue` marked `synced` and the SW deletes the item — the user is told it synced but no report table row exists. All 9 current keys have handlers, so this is latent — but a future module wired client-side before its route branch lands (or a typo'd key) silently drops data. | Return 400/422 for unknown moduleKeys (permanent-park), or at minimum store `sync_status:'pending'` and alert. |
| LOW | E-05 | `supabase/migrations/00000000000031_offline_sync_queue.sql:17` (`local_id uuid not null`); non-UUID fallbacks: `compose-form.tsx:55` (`comm-…`), `use-offline-submit.ts:11` (`ice-ops-…`), and the other `genLocalId` fallbacks | **genLocalId fallback violates the uuid column.** When `crypto.randomUUID` is unavailable the fallback id (`comm-<ts>-…`) fails the `uuid` cast at claim time → 22P02 → 500 → 5 transient retries → parked failed. Only reachable in non-secure/legacy contexts (SW itself requires a secure context), so impact is edge-case; the item is surfaced as failed, not lost. | Use a spec-compliant UUIDv4 polyfill in the fallback (or reject enqueue without `crypto.randomUUID`). |
| LOW | E-06 | `use-sync-queue.ts:34-36` and `offline-queue-view.tsx:63-67` (both gate on `navigator.serviceWorker.controller`); `offline-queue-view.tsx:133-143` ("Queue is empty · All submissions have been synced") | **Queue view/badge desync after hard reload.** Shift-reload leaves `controller === null`; `GET_QUEUE` is never sent, counts stay 0, the badge hides, and `/reports/offline-queue` asserts everything synced even with pending/failed items in IndexedDB. Self-heals on the next soft navigation. | Fall back to `navigator.serviceWorker.ready.then(r => r.active?.postMessage(...))` when `controller` is null. |
| LOW | E-07 | `reports/daily/_lib/offline.ts:86-90` + `reports/daily/_lib/submit.ts:85-102` (deactivated area/template → 500); contrast `route.ts:282-290` (incidents returns permanent 422 for the same class) | **Permanently-doomed replays classified transient.** Most modules return 500 for persist failures that will never succeed (e.g. area/template deactivated while offline), burning 5 attempts over ~6.3 min before parking as retriable-failed; only incidents pre-checks refs and parks immediately with 422. Outcome is still surfaced — this is consistency/UX, not loss. | Pre-validate replay-time references per module and return 422 like incidents. |
| LOW | E-08 | `route.ts:549-558` (update path), `:616-629` (no-row-count check; Supabase update matching 0 rows returns no error) | **Offline availability edit can vanish silently.** A queued `submit_availability` update whose target row was deleted before sync updates 0 rows, is marked `synced`, and the user's "Saved offline" edit disappears with no signal. Also plain last-write-wins over interim online edits. | `.select("id")` on the update and treat 0 rows as a permanent 4xx (or re-insert). |
| LOW | E-09 | no matches for `navigator.storage.persist` anywhere in `src/`; queue lives in default (best-effort) origin storage | **No persistent-storage grant requested.** The browser may evict the origin's IndexedDB under storage pressure (and non-installed Safari usage is subject to the 7-day script-storage cap), destroying queued submissions with no trace. Outside-app-control loss vector for an app whose offline value *is* this queue. | Call `navigator.storage.persist()` during SW registration and surface the result. |
| LOW | E-12 | `admin/permissions/_components/permission-matrix.tsx:77-89` (`setMatrix(presetMatrix(preset))`, no server merge, no refresh) | **Preset apply trusts a client-side mirror.** After `applyPresetToUser` succeeds the matrix is set to the *client's* preset definition; if the server's preset ever drifts (or partially applies), the UI shows wrong permissions until a full reload. Per-toggle path is correctly optimistic-with-revert. | Have the action return the resulting matrix and merge it (as week-board does), or `router.refresh()`. |
| INFO | E-11 | `public/sw.js:70-83` (activate deletes only non-current cache names), `:385-397` (cache-first put, never pruned) | `STATIC_CACHE` accumulates superseded content-hashed assets between cache-name bumps. Storage growth only — hashes prevent staleness. | Optional: prune entries not referenced recently, or bump the static cache name per deploy. |

## Verified OK

- **Persistence is durable, not SW memory:** IndexedDB store keyed by `localId` (`sw.js:88-102`); survives SW restarts/termination/tab close; SW updates never swap mid-shift (no `skipWaiting` on install — `sw.js:58-65`; user-prompted update in `sw-register.tsx:58-67`, copy even says "Unsynced reports are kept").
- **`local_id` is client-generated once and stable across retries** (React state per form instance), regenerated only for the *next* logical submission (refrigeration `:438`, incidents `:302`, availability `:137`, time-off `:101`); single-shot forms (daily/air-quality/ice-depth/ice-ops/communications) render a terminal "Saved on this device" state so their fixed id can't be reused for a different payload. Server dedup: `onConflict:"local_id", ignoreDuplicates:true` with the documented idempotency contract (`route.ts:44-54`).
- **Retry policy is principled and unit-tested:** transient (network/5xx/401/408/409/425/429) vs permanent 4xx, backoff 5s→15s→60s→300s, max 4 retries; the SW inline mirror (`sw.js:32-55`) currently matches `src/lib/offline/retry-policy.ts` exactly (guarded by `retry-policy.test.ts`).
- **All 9 submitting modules have real replay handlers** running the same validation, `currentUserCan(module,"submit")` permission gate, persist code, severity engines, and notification dispatch as the online actions — no fire-and-forget legacy path is reachable from current clients. Claims are released on persist failure so retries re-attempt (`…/offline.ts` in each module).
- **Failures are surfaced app-wide:** `SyncStatusBadge` in the global header (`components/app/global-header.tsx:161`) links to `/reports/offline-queue`, which shows per-item status, attempt count, live backoff countdown, server `lastError`, and distinct copy for permanent failures; `OfflineBanner` in the reports layout shows pending count while offline.
- **No authenticated HTML is cached** (navigations network-only with a synthetic offline page); Supabase/external origins bypassed; the one cached page (`/offline-schedule`) is a data-free shell whose data is per-user IndexedDB, wiped on sign-out/user-switch (`auth-state-listener.tsx`) and always labeled with cached-age when offline.
- **No daily-report lock exists** → no locked-target replay race for daily; deactivated-reference races fail loudly (though see E-07).
- **Scheduling offline parity is genuine:** replay re-implements the same validations as `submitTimeOffRequest`/`upsertAvailability` (facility timezone conversion, availability toggle, job-area assignment check); time-off always lands `pending` for admin decision; admin grid is online-only by explicit documented decision (`grid-actions.ts:3-11`).
- **Client state freshness:** week-board merges server-returned shift DTOs with optimistic revert-on-error; module toggles roll back + `router.refresh()`; bulk-employee Zustand store clears result badges on any edit; queue view is a live SW mirror (modulo E-06).
- **Server queue hygiene:** fixed-interval purge of terminal rows (synced 90d / failed 180d, pending never) via `purge_old_offline_sync_queue()`, service-role only, invoked by the retention cron.
- **facility-paperwork** is a read-only documents browser — correctly has no offline queue path.
