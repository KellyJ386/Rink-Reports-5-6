# Phase 1 — Consolidated Static Wiring Audit

Five parallel read-only agents (A–E). No source modified. Per-agent detail:
`agent-a-navigation.md`, `agent-b-buttons-forms.md`, `agent-c-admin-config.md`, `agent-d-rbac-security.md`, `agent-e-offline-state.md`.

## Triage totals

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 3 |
| MEDIUM | 10 |
| LOW | 26 |
| INFO | 4 |

**Publish-lock regression: FIXED** (Agent D traced every mutation path; DB trigger `trg_schedule_shifts_publish_lock` rejects INSERT/UPDATE/DELETE of published shifts from all end-user roles; edits route through audited RPCs; offline replay never touches shifts; two-person requester≠approver enforced).

**Invariant results:** No client-supplied `facility_id` in any server action except super-admin actions (correctly gated) and one admin write (D-08). No tRPC. `#69BE28` absent. No Dexie (offline = SW + IndexedDB); Zustand present in one ephemeral store only. Ice-depth has no photo feature.

---

## HIGH

**D-01 — Facility admin can mint a cross-tenant super-admin** · `supabase/migrations/…100…:155` (`guard_users_profile_update`)
The trigger exempts facility admins from the `is_super_admin` immutability check; combined with `users_update` RLS a facility admin can raw-PostgREST set `is_super_admin=true` on any same-facility user. No server action exposes it, but the DB boundary allows it. RLS harness only tests the *manager* case. → ASK-FIRST (RLS/migration).

**E-01 — Offline queue is origin-global, not user-keyed** · `src/app/api/offline-sync/route.ts:56-98`
Replays are attributed to the *current* session at flush time (incidents even re-stamp reporter identity from login). `AuthStateListener` clears the schedule cache but not the queue. On a shared kiosk, user A's queued report syncs as user B. → ASK-FIRST (Dexie/offline + identity).

**E-02 — No flush trigger survives SW termination on Safari/iOS** · `public/sw.js`, `src/lib/offline/use-sync-queue.ts`
Browsers without Background Sync have no path that drains pending items after the SW is killed: the window `online` handler never messages the SW, `GET_QUEUE` doesn't drain, backoff timers die with the SW, and no UI button flushes pending-only items. Queued reports can sit "pending" indefinitely. → ASK-FIRST (offline sync logic).

---

## MEDIUM

| ID | Area | file:line | Summary | Route |
|---|---|---|---|---|
| N-002 | nav | `(auth)/login/actions.ts:33` + `session.ts:50-63` | Login ignores `redirectTo`; every user lands on `/dashboard` instead of original target | AUTO (nav) but touches auth → ASK-FIRST |
| B-01 | destructive UI | `admin/scheduling/shifts/_components/week-board.tsx:477` (via assign-popover:342 / board-pieces:560) | Admin shift delete has NO confirmation — one click hard-deletes a draft or cancels a published shift | ASK-FIRST (scheduling) |
| C-01 | config | `dashboard/page.tsx:264-269` | Dashboard tiles ignore `facility_modules` toggle (filter only per-employee `hidden_modules`); disabled module keeps tile + route | AUTO |
| C-02 | config | `reports/ice-operations/actions.ts:103-105` | Submit never checks `enabled_operation_types`; a disabled op type is still submittable via direct action | ASK-FIRST (server action gate) |
| C-03 | config | `reports/ice-depth/_lib/submit.ts:121-129` vs `admin/ice-depth/settings-tab.tsx:54-55` vs migration 14 | Ice-depth fallback thresholds disagree 3 ways (DB 0.99/1.75 · staff 1/1.5 · admin 1/2) | AUTO (align to DB) |
| C-04 | config | `admin/incident-reports/*` + `reports/incidents/*` | `incident_types` orphaned: admin CRUD + history filter exist but nothing writes `incident_reports.incident_type_id` | ASK-FIRST (scope) |
| C-05 | config | `reports/scheduling/my-schedule/page.tsx:134-140` | Hardcodes Sunday weeks, ignoring `schedule_settings.week_start_day` (other views honor it) | AUTO |
| D-02 | RBAC | `reports/facility-paperwork` + migration 85:69-74 | No module-permission check; RLS gates on facility only → any active staff can list/download all facility documents | ASK-FIRST (RLS/permission) |
| D-03 | RBAC | `admin/employees` role/permission grant | Facility admin can grant admin/admin to peers (matches CLAUDE.md model — flagged for explicit ratification) | ASK-FIRST (ratify) |
| D-08 | RBAC | `admin/employees/actions.ts:538` (`seedRolesForCurrentFacility`) | Trusts client-supplied `facilityId` in roles upsert with no `=== profile.facility_id` check; only RLS stops cross-facility seeding | ASK-FIRST (facility_id invariant) |
| E-03 | offline | `api/offline-sync/route.ts` (claim protocol) | Server death between claim upsert and persist leaves a `pending` row; retry gets `duplicate:true`, SW deletes item → report silently never persisted | ASK-FIRST (offline) |
| E-04 | offline | `api/offline-sync/route.ts:211-233` | Unknown-moduleKey fallback marks items `synced` without writing any table (latent silent drop for typo'd/future keys) | ASK-FIRST (offline) |

---

## LOW (26) — grouped

**Navigation / UX**
- N-001 / B-02 — `reports/refrigeration/_components/submission-form.tsx:466` — only `router.back()` in app; deep-link unsafe; correct parent `/reports`. (AUTO)
- N-003 — `not-found.tsx:7` links `/dashboard` (harmless; middleware intercepts unauthed). (AUTO/none)
- C-12 — disabled op-type URL redirects with no message. (AUTO)
- C-15 — `getIsAdmin` omits the `user_permissions` admin/admin check `requireAdmin` accepts → matrix-granted admins get no Admin nav link. (AUTO but auth-adjacent → note)

**Destructive-action confirmation (consistency)**
- B-05 — availability delete (`availability-row.tsx:118`) + cancel time-off (`cancel-time-off-button.tsx:42`) no confirm (own/recoverable data). (AUTO)
- B-06 (INFO) — definitive `confirm()` inventory: **40 sites** (38 deletes + renumber-points + publish-approve), all wired + pending-guarded; native `window.confirm` vs AlertDialog is consistency debt only.

**Employee cert sub-form (`admin/employees/[id]/_components/employee-detail.tsx`)**
- B-03 — cert "Add" is the only form without pending-disable → double-click double-inserts.
- B-04 — optimistic `tmp-…` cert rows never re-sync → Edit/Delete on a just-added cert sends a fake id until reload.

**Config drift / hardcoded-vs-admin (mostly by-design)**
- C-06 refrigeration canonical °F hardcoded (display-only toggle). · C-07 AQ unit strings unsanitized. · C-08 AQ readings no plausibility bounds. · C-09 AQ empty reading-type config doesn't block submit. · C-10 daily-area cap 30 duplicated (documented sync). · C-11 ice-ops op-type list hardcoded in 3 synced places. · C-13 ice-depth aspect ratio validated on update only. · C-14 schedule templates Sunday-anchored. · C-16 body-diagram fixed to 17 SVG keys (unmapped admin body parts unselectable). · C-17 accidents severity→alert hardcoded (custom keys always "high"; deliberate + unit-tested). · C-18 AQ fuel types hardcoded while ice-ops fuel types are admin-managed.

**RBAC (defense-in-depth gaps, RLS-covered today)**
- D-04 `deleteEmployee` scopes by id only (super-admin gated). · D-05 ice-depth done/pdf lacks explicit `currentUserCan` (RLS covers). · D-06 `deleteAvailability`/`acceptSwapRequest` SELECTs omit explicit facility filter (RLS+ownership cover). · D-07 same guard exemption lets facility admin toggle is_active/facility_id (bounded by RLS; fixed with D-01). · D-09 `/admin/permissions` pages query `users` with no facility filter (relies on `users_select` RLS).

**Offline (edge cases)**
- E-05 `genLocalId` non-crypto fallbacks violate `uuid` column → guaranteed 500 (surfaced as failed, not lost). · E-06 after hard reload (`controller===null`) badge/queue page falsely show empty. · E-07 permanently-doomed replays classed as transient 500s (~6 min wasted retries; only incidents park at 422). · E-08 offline availability edit whose row was deleted → 0 rows updated but marked synced (silent drop). · E-09 no `navigator.storage.persist()` → queue in evictable storage. · E-12 permission-matrix preset apply sets client matrix with no server refresh.

**INFO**
- B-07 online submits are plain INSERTs (no local_id dedupe; timeout-then-retry can duplicate). · B-08 F-038 public form validation adequate (fields/regex/caps/rate-limit; note: documented fail-open on RPC error, no honeypot). · E-11 `STATIC_CACHE` accumulates old hashed assets between cache bumps (storage only).

---

## Verified-OK (high-value confirmations)
- Publish-lock: no bypass on any traced path; two-person control enforced in RPC + reject action.
- All 48 server actions derive facility_id server-side (except super-admin, gated); `current_facility_id()` not client-switchable; no non-super-admin facility switcher.
- api/exports + api/offline-sync do per-module permission checks with server-injected facility/employee.
- Roles/permissions are per-request DB reads (no JWT/session cache) → changes take effect without re-login.
- Daily-report area access triple-gated (render filter + submit check + RLS); no daily-report lock exists (so no locked-target offline race).
- Refrigeration, air-quality, daily, ice-depth, ice-ops config forms are DB-driven (no hardcoded field/section lists); AQ override direction IS validated (`compliance.ts:243`, unit-tested — earlier sub-claim retracted).
- Every form renders its error path; every admin mutation revalidates; no silent error swallowing.
- Report detail pages rely on module-gated deny-by-default RLS SELECT (`has_module_access`).
