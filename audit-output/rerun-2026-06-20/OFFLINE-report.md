# Phase 11 — Offline / PWA Audit (rerun 2026-06-20)

**Agent:** Agent-OFFLINE · **Scope:** audit only, no code changes
**Grade: 93 / 100**

> GROUNDING NOTE: This repo does **not** use Dexie.js, and that is correct. The
> offline architecture is service-worker + IndexedDB owned by `public/sw.js`,
> with the client communicating via `postMessage`. "Missing Dexie" is not a bug.
> The audit below evaluates the actual SW-based architecture.

---

## 1. Architecture overview (verified end-to-end)

```
report form (client)
  └─ navigator.onLine === false?
        └─ enqueueSubmission()  src/lib/offline/use-sync-queue.ts:65
              └─ postMessage ENQUEUE_SUBMISSION → SW
                    └─ public/sw.js: dbPut() into IndexedDB "rink-offline-queue"
                          └─ registration.sync.register("rink-offline-queue")
                                (fallback: replayQueue() immediately)
  └─ else: normal server action (online path), navigates to /done

reconnect / sync event / new enqueue
  └─ sw.js replayQueue()  (FIFO by startedAt, backoff-aware)  public/sw.js:179
        └─ POST /api/offline-sync  with the queued record
              └─ src/app/api/offline-sync/route.ts:44
                    ├─ auth + active-employee + facility gate
                    ├─ per-module replay handler → persists into real tables
                    └─ idempotent claim via offline_sync_queue.local_id
        └─ classifyReplayResult() → success(delete) / retry(backoff) / failed(park)
        └─ broadcastQueueUpdate() → SYNC_QUEUE_UPDATE to all tabs
```

The client **never** writes to `offline_sync_queue` directly — only the SW
POSTs to `/api/offline-sync`, and only the route handler touches the table.
This matches the CLAUDE.md contract.

---

## 2. Service worker registration — CONFIRMED

- `src/components/app/sw-register.tsx` registers `/sw.js`, mounted in
  `src/app/layout.tsx:85` (app root, so every authenticated page gets it).
- Update flow is well-built: a newly-installed SW is **not** auto-activated
  (no `skipWaiting()` in `install` — `public/sw.js:63`). Instead the user is
  shown a Sonner toast ("A new version is available… Unsynced reports are
  kept.") and only on **Reload** does the page post `SKIP_WAITING`
  (`sw-register.tsx:58`). This deliberately avoids swapping the SW + IndexedDB
  queue out from under a staff member mid-report. `controllerchange` triggers a
  single guarded reload.

---

## 3. Which flows route through the offline queue

**All 10 staff report modules enqueue offline** (each form imports
`enqueueSubmission`, branches on `navigator.onLine`, and uses the normal server
action when online):

| Module | Form (client) | Replay handler (server) | Persists real rows? |
|---|---|---|---|
| refrigeration | refrigeration/_components/submission-form.tsx | route.ts:339 `handleRefrigerationReplay` | Yes |
| incidents | incidents/_components/submission-form.tsx | route.ts:241 `handleIncidentReplay` | Yes |
| air_quality | air-quality/_components/submission-form.tsx | route.ts:623 `handleAirQualityReplay` | Yes |
| accident_reports | accidents/_components/submission-form.tsx | accidents/_lib/offline.ts | Yes |
| daily_reports | daily/_components/daily-report-console.tsx | daily/_lib/offline.ts | Yes |
| ice_depth | ice-depth/_components/submission-form.tsx | ice-depth/_lib/offline.ts | Yes |
| ice_operations | ice-operations/[operationType]/_components/use-offline-submit.ts | ice-operations/_lib/offline.ts | Yes |
| communications | communications/_components/compose-form.tsx | communications/_lib/offline.ts | Yes |
| scheduling (availability) | scheduling/_components/availability-form.tsx | route.ts:442 `handleSchedulingReplay` (`submit_availability`) | Yes |
| scheduling (time-off) | scheduling/_components/time-off-form.tsx | route.ts:442 `handleSchedulingReplay` (`request_time_off`) | Yes |

**Intentionally NOT offline-capable** (documented as a design choice):
- **Scheduling shift-claiming** — depends on live shift state, must run online
  (route.ts:438 comment). Only append-style availability / time-off replay.
- **Navigation / page browsing** — SW serves pages network-only; offline value
  is the submission queue, not offline reading (see §6, kiosk security).

The route handler has a fallthrough (route.ts:199) that upserts any
unknown `moduleKey` as `sync_status: "synced"` (log-only, no persist) — a
legacy path; every current module now has a real replay handler, so it is
effectively dead but harmless.

---

## 4. Conflict resolution strategy

**Idempotency, not merge.** The strategy is a per-submission **claim token**, not
last-write-wins on report content:

- `offline_sync_queue.local_id` is a UNIQUE key. Each replay handler does an
  `upsert(..., { onConflict: "local_id", ignoreDuplicates: true }).select()`.
- If the upsert returns rows, this is the first replay → the handler persists
  the real report and marks the queue row `synced`.
- If it returns **no rows**, the `local_id` was already claimed → handler returns
  `{ ok: true, duplicate: true }` and persists nothing. This makes the SW
  retrying after a lost-response safe (no duplicate reports).
- On persist failure the claim is **released** (`delete().eq("local_id", …)`,
  e.g. route.ts:310) so a later retry re-attempts.

Net effect: each `local_id` produces **exactly one** report regardless of how
many times the SW replays it. There is no field-level conflict resolution and
none is needed — submissions are append-only inserts, not edits to shared rows.
The legacy fallthrough path uses plain `ignoreDuplicates` (last-claim-wins,
no-op on dup), consistent with the same idempotency model.

Retry policy (`src/lib/offline/retry-policy.ts`, mirrored inline in sw.js):
- Transient (network/5xx/401/408/409/425/429) → exponential backoff
  [5s,15s,60s,300s], max 4 retries, then parked as recoverable "failed".
- Permanent 4xx (bad payload, 403) → parked "failed" immediately (no retry).
- Pure logic is unit-tested (`retry-policy.test.ts`); sw.js carries a hand-kept
  inline copy because a classic SW can't import ES modules.

---

## 5. Sync status UI — present and good

- **Offline banner**: `src/components/offline/offline-banner.tsx`, mounted in
  `src/app/reports/layout.tsx:38`. Amber `role=status aria-live=polite` bar,
  shown when `!isOnline`, with pending-count text.
- **Sync status badge**: `src/components/offline/sync-status-badge.tsx`, mounted
  in `src/components/app/global-header.tsx:161`. Pill linking to
  `/reports/offline-queue`; shows "N pending" (spinning icon when offline) or
  "N failed" (destructive styling). Hidden when queue is empty.
- **Dedicated queue page**: `/reports/offline-queue` (page.tsx + OfflineQueueView)
  for inspecting/retrying. `retryFailedSubmissions()` re-arms failed items.
- **Online/offline/syncing tri-state**: `useSyncQueue()` tracks `isOnline`
  (online/offline window events) plus `pendingCount`/`failedCount` pushed from
  the SW via `SYNC_QUEUE_UPDATE` broadcast — covers all three states.

---

## 6. PWA manifest, scope, caching

- **Manifest**: `public/manifest.json`, linked via `metadata.manifest` in
  `layout.tsx:34`. `display: standalone`, `start_url: /dashboard`, theme/bg
  `#001A3A`, `portrait-primary`, icons 192 + 512 (`any maskable`). Icon files
  exist in `public/`. **Installable.**
- **Install prompt**: `pwa-install-prompt.tsx` (layout.tsx:86) handles Android
  `beforeinstallprompt` (native install button) and iOS manual "Add to Home
  Screen" instructions; dismissal persisted in localStorage; hidden when
  standalone. Uses `useSyncExternalStore` (SSR-safe).
- **SW scope**: registered at `/sw.js` → root scope, controls whole origin.
- **Caching strategy** (public/sw.js fetch handler):
  - `_next/static/**` → **cache-first** (content-hashed, safe to share).
  - Navigation requests → **network-only**, falling back to a synthetic inline
    "You're offline" HTML page on network failure.
  - Supabase / cross-origin and `/_next/data/` → bypassed (network-only).
  - Old caches purged on `activate` (CACHE_NAME `rink-reports-v4`).

**INTENTIONAL kiosk-security choice (confirmed, not a bug):** navigation HTML is
deliberately network-only and never cached. The header comment (public/sw.js:1-16)
explains caching authenticated HTML in a shared SW cache would risk cross-user
leak on shared kiosks (user B seeing user A's rendered admin/schedule pages).
Consequence: the published schedule and other authenticated pages are **not
readable offline** — only the submission queue works offline. Prior audit
flagged this as intentional; reconfirmed.

---

## 7. Findings

| # | Severity | Finding | Location |
|---|---|---|---|
| 1 | INFO | Caching strategy correctly trades offline page-browsing for kiosk cross-user isolation; navigation network-only is by design. | public/sw.js:1-16, :402 |
| 2 | LOW | Policy duplication: retry rules live in both `retry-policy.ts` and a hand-copied inline block in sw.js. Only the .ts half is unit-tested; drift risk if one is edited without the other. Mitigated by comments on both sides. | retry-policy.ts:5, public/sw.js:27-55 |
| 3 | LOW | Stray `/` typo at start of an inline comment line in the refrigeration offline branch (`/ Offline:`); cosmetic, not a syntax error since the next line is `//`. | refrigeration/_components/submission-form.tsx:424 |
| 4 | LOW | Dead-ish fallthrough: route.ts:199 upserts unknown `moduleKey` as `synced` without persisting. All current modules have real handlers, so it never runs, but it would silently "succeed" a future module that forgot its handler (data dropped, no error). | api/offline-sync/route.ts:199 |
| 5 | INFO | `enqueueSubmission` returns `false` if there is no SW controller (e.g. first load before activation). Forms branch on `navigator.onLine`, so a true-offline submit with no controller would not be queued; low real-world risk since SW claims clients on activate, but no explicit fallback. | use-sync-queue.ts:71 |
| 6 | INFO | Background Sync API (`registration.sync`) used when available with `online`-event + immediate-replay fallback; good progressive enhancement for browsers (iOS) lacking Background Sync. | public/sw.js:282, :448, :318 |

No high/critical findings. The offline subsystem is coherent, idempotent,
end-to-end persisting for all modules, and the security trade-offs are
deliberate and documented.
