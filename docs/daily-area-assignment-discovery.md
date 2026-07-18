# Daily Reports — Area Assignment & Routing: Phase 0 Discovery Report

**Date:** 2026-07-18 · **Branch:** `claude/daily-reports-area-assignment-to8r41` · **Status:** DISCOVERY ONLY — no schema, RLS, or code changes made. Awaiting gate approval before Phase 1.

This report maps the current system against the implementation plan's assumptions, proposes the schema diff and RLS diff for the assignment feature, and flags every place where the plan's assumptions do **not** match this codebase. Several are significant enough that the plan should be revised before Phase 1 (see §8).

---

## 1. Daily Reports data model (as-built)

Defined in `supabase/migrations/00000000000007_daily_reports_schema.sql`, amended by 90 (per-area submit RLS), 135 (auto-seed), 139 (module renamed `operational` → `daily_reports`), 156 (business_date), 161 (append-only).

```
daily_report_areas            (max 30 active per facility; id, facility_id, name, slug, color, sort_order, is_active)
  └─ daily_report_templates   ("shift types" within an area)
       └─ daily_report_checklist_items
       └─ daily_report_submissions   (facility_id, area_id, template_id, employee_id,
          │                           submitted_at, business_date)
          ├─ daily_report_submission_items  (label_snapshot, is_checked)
          └─ daily_report_notes
```

Key mechanics:

- **The plan's "tab" = an (area, template) pair.** Staff pick an area, then a template ("shift type"), tick checklist items, optionally add a note, submit. UI: `src/app/reports/daily/_components/daily-report-console.tsx`, server pipeline: `src/app/reports/daily/_lib/submit.ts` (`persistDaily`, shared by the online action and offline replay).
- **"Tab saved" = a `daily_report_submissions` row exists** for (facility, area, template, business_date). `business_date` is computed server-side in the facility's timezone at submit time (migration 156, `businessDateInTimeZone` in `_lib/compute.ts`).
- **There is NO report container entity and NO explicit lock.** There is no `daily_reports` "day" row, no `report_id`, no lock timestamp, no lock job. Migration 161 made submissions **append-only**: every submit (including a same-day correction) inserts a new row; staff UPDATE/DELETE are RLS-denied (admin-only). "Locking at end of day" is *implicit*: the form only ever targets today, so a new local day naturally starts fresh and past days can never be written by staff. Migration 161's header states this explicitly.
- **Retention: submissions purge after 14 days** (`purge_old_daily_reports()`, migration 7). Any assignment/snapshot data joined to submissions must either purge on the same cadence or stand alone.
- **A day's "report" is a derived view**: history (`src/app/reports/daily/history/page.tsx`) and the admin console list submissions individually; completeness per day/area is computed by aggregation, not stored.

### Impact on the plan

- Phase 5 "extend the end-of-day lock path" has **no lock path to extend**. There are two options (decision needed at the gate):
  - **(A — recommended) Keep lock implicit; make the snapshot day-keyed, not report-keyed.** `report_assignment_snapshots(report_id, …)` becomes `daily_area_assignment_snapshots(facility_id, business_date, area_id, …)`. Snapshot rows are written by a scheduled roll-over (pg_cron at facility-local end-of-day, mirroring the existing `purge_old_daily_reports` cron pattern) or lazily materialized the first time a past day is viewed. No new lock mechanism is introduced; D5's "lock is never blocked" is trivially satisfied.
  - **(B) Introduce an explicit per-day lock entity.** Much larger blast radius (touches the append-only model and every consumer); not required by any locked decision. Not recommended for v1.
- D8's snapshot contents (assignees, completed y/n, completed-by, timestamps) are all derivable at snapshot time from `report_area_assignments` + `daily_report_submissions`; the snapshot exists to survive the 14-day purge and later assignment edits.

## 2. Current RLS on daily-report tables (verbatim state)

Helpers (all `SECURITY DEFINER`, defined/unified in migrations 3 → 25 → 89 → 91 `unify_permission_helpers`):

- `has_module_access(m)` — super admin OR enabled `view` grant in `user_permissions` for (auth.uid(), current_facility, m).
- `has_module_admin_access(m)` — same but `admin` action.
- `has_area_access(m, area)` — super admin OR module admin OR (module `view` AND (**no `module_area_permissions` rows at all for this employee+module → full access**, else a row for this area with `can_view = true`)).
- `has_area_submit_access(m, area)` — same shape with module `submit` + `can_submit` (introduced migration 90, realigned 91).

Effective policies on the tables the feature touches:

| Table | SELECT | INSERT | UPDATE/DELETE |
|---|---|---|---|
| `daily_report_areas` / `_templates` / `_checklist_items` (migration 7) | super admin OR same-facility + `has_module_access('daily_reports')` | module admin | module admin |
| `daily_report_submissions` (migration 90 replaced 7's) | super admin OR same-facility AND (module admin OR (`current_employee_module_permission('daily_reports') >= 'view'` AND `has_area_access('daily_reports', area_id)`)) | super admin OR same-facility AND module permission ≥ `submit` AND `has_area_submit_access('daily_reports', area_id)` | module admin only (staff corrections are new INSERTs — migration 161) |
| `daily_report_submission_items` (7 + 90) | defers to parent submission via `EXISTS` subquery (parent RLS is the gate) | same-facility + module ≥ `view` (parent INSERT policy is the real gate) | module admin only |
| `daily_report_notes` (7) | defers to parent submission via `EXISTS` | same-facility + module access + parent-visible | module admin only |

**The clauses that grant staff access today** are exactly the `has_area_access` / `has_area_submit_access` branches on `daily_report_submissions` SELECT/INSERT. Children inherit through the `EXISTS` subqueries, so a change to the submissions policies propagates automatically.

### Critical pre-existing overlap with D10

**Per-area visibility restriction already exists.** `module_area_permissions(employee_id, module_key, area_id, can_view, can_submit)` (backbone migration 2) is a *standing* per-employee area grant, enforced server-side for daily reports since migration 90, with admin UI at `src/app/admin/daily-reports/_components/area-access-tab.tsx` (+ `area-access-actions.ts`, incl. CSV bulk import) and a UI mirror in `getAllowedDailyAreas()` (`src/app/reports/daily/actions.ts`). Semantics: **zero rows = access to all areas; any rows = allow-list**.

The plan's D10 adds a *date-scoped* layer on top: assigned-to-me-today OR area-unassigned-today OR elevated role. These two layers compose but must not be conflated:

- `module_area_permissions` answers "which areas may this employee *ever* work" (standing capability).
- `report_area_assignments` answers "which areas is this employee *responsible for today*" (daily routing).

Proposed composition (encoding D4 + D10): staff can see/submit a tab iff `has_area_submit_access(…)` (existing standing gate, unchanged) **AND** (an active assignment row names them for that area+date, OR no active assignment rows exist for that area+date). The plan's "role ≥ supervisor" branch maps to `has_module_admin_access('daily_reports')` OR a `daily_reports`/`edit` grant (see §3). Historic dates (no assignment rows) automatically take the open branch, satisfying the plan's historic-visibility requirement.

## 3. Roles: the plan's D3 role names do not exist

The plan grants assign/override to `supervisor` and `facility_manager` "and above". This codebase **retired `gm` and `supervisor`** (migrations 58/87); live canonical roles are `super_admin / admin / manager / staff` plus per-facility custom roles, and **authorization is resolved through `user_permissions` (`view`/`submit`/`edit`/`admin` per module), not role tiers** — roles only seed permission defaults (CLAUDE.md, migration 77).

**Proposal:** gate assign/reassign/override on the `daily_reports` module's **`edit`** action (currently unused for daily reports) — i.e. `currentUserCan(supabase, "daily_reports", "edit")` server-side plus a matching `user_permissions` check in RLS — with `admin` implying it in the server helper. Role defaults then seed `edit` for `manager` and above. This preserves the plan's intent ("managers can route staff without being module admins") inside the live permission model. **Needs sign-off at the gate.**

## 4. Scheduling (schedule-derived assignment, D1)

Core schema: `supabase/migrations/00000000000015_scheduling_schema.sql` (11 tables), extended by 107/115/117/127/128/136/137/148/164/168/181.

- **`schedule_shifts` is the assignment table** the schedule branch reads: `facility_id, department_id, employee_id (NULL = open/unassigned shift), starts_at/ends_at (timestamptz), role_label (legacy free text), status, job_area_id`.
- **Published state = `schedule_shifts.status text check (status in ('draft','published','cancelled'))`** — a status value, not a flag table. A partial index exists `where status = 'published'`. Publishing happens only through the two-person `schedule_publish_requests` flow via SECURITY DEFINER RPC `scheduling_approve_publish_request` (migrations 40/136/168), audited in `schedule_publish_events`.
- **Position concept:** `schedule_shifts.job_area_id → employee_job_areas` (migration 115), the per-facility admin catalog (Front Desk, Concessions, …; migration 107) with employee cross-training links in `employee_job_area_assignments` (max 4/employee). `role_label` survives as an optional free-text note.
- **Area↔position mapping: none, deliberately.** Migration 107's header: job areas "are a SEPARATE concept from Daily Report areas (public.daily_report_areas) and intentionally do NOT reference that table." The bridge table in §9 is net-new.
- **Publish-lock: fixed, DB-enforced.** The historical bypass (client-supplied `status` forwarded by `updateGridShift`, plus an INSERT gap) is documented and closed by trigger `schedule_shifts_publish_lock()` (migrations 148 → 164 → 181): end-user roles cannot INSERT published rows, mutate published rows, or transition `draft → published` outside the governed RPCs. App layer matches (`grid-actions.ts` forces `status: "draft"` on create and routes published-shift edits through DEFINER RPCs).
- **⚠ RLS does NOT filter published vs draft.** `schedule_shifts_select` (migration 15) gates only on facility + `has_module_access('scheduling')` — staff *can* read draft shifts through RLS; "published-only" is app-side query discipline (e.g. `src/app/reports/scheduling/page.tsx` filters `.eq("status","published")`). Consequence for D1: the resolution engine **must filter `status = 'published'` in its query** — RLS will not do it for us. (Adjacent pre-existing finding, out of scope but worth a ticket: `reports/scheduling/my-schedule/page.tsx` lets staff see their own draft shifts via `?status=all`, and its week view applies no status filter at all.)
- **Reads needed for the schedule branch (D1), confirmed read-only:** `schedule_shifts` where `status='published' AND employee_id IS NOT NULL AND job_area_id IN (mapped job areas)` and the shift overlaps the facility-local business day, joined through the new `daily_area_job_area_map`. No scheduling table is written. **Design note for Phase 3:** `starts_at/ends_at` are timestamptz; the day window must be computed in the facility timezone, and a rule is needed for overnight shifts spanning midnight (propose: a shift assigns the business date it *starts* on — decide at gate).

## 5. Notifications (D6)

In-app notification infrastructure **exists but is module-siloed** — there are two parallel systems, and neither fits D6 without a gate decision:

- **System A — `schedule_notifications`** (migration 15 §11): per-employee in-app inbox with `notification_type` (CHECK-constrained, 11 values, all scheduling-specific), `payload jsonb`, `read_at` (NULL = unread), `acknowledged_at`. Created by **plain inserts** (no helper — pattern: `src/app/admin/scheduling/_lib/governance-actions.ts:292`, batch dedup pattern in `shift-reminders.ts:84`). RLS (migrations 133/136): recipients read/update their own rows; **INSERT is restricted to scheduling module admins / super admin / SECURITY DEFINER** (staff cannot forge). Surfaced only at `/reports/scheduling/notifications` + an unread count on the scheduling landing — *not* in a global bell; the only sidebar badge is Communications'.
- **System B — communications routing/outbox**: `dispatchRulesForSubmission()` (`src/lib/notifications/dispatch.ts:23`) → `dispatch_rules_for_submission()` → `notification_outbox` → cron drain → `communication_messages`/`communication_recipients` (in-app; email is a separately-gated additive channel). This is **admin-rule-driven fan-out** ("when a daily report is submitted, notify group G"), not targeted "notify employee X" — `persistDaily` already calls it on every submission. Wrong shape for D6's "you're assigned to Concessions today".

**Proposal (gate decision):** create a minimal `daily_report_assignment_notifications` table mirroring the proven System A pattern (recipient-scoped SELECT/UPDATE RLS, insert via the assign server actions under the `edit`/admin gate, `payload jsonb`, `read_at`), surfaced as a banner/badge inside "My Areas Today" and the dashboard widget. Alternative — widening `schedule_notifications`' CHECK enum with daily-report types — is rejected: it cross-wires module inboxes (assignments would render in the *scheduling* notifications page) and every new type needs a constraint-rebuild migration anyway. Anti-spam (Phase 7 checklist): notify only on rows an action actually inserts/supersedes with `source='manual'`, and on first materialization of a schedule/default-derived assignment for the current day — resolution re-runs are no-ops.

## 6. Offline layer (D9) — the plan's Dexie assumption is wrong

**There is no Dexie, no Zustand, no IndexedDB wrapper anywhere in the repo.** The offline layer is:

- **Write path (primary):** the service worker (`public/sw.js`) owns a raw-IndexedDB queue (`rink-offline-queue`), message-driven from `src/lib/offline/use-sync-queue.ts` (`enqueueSubmission` / `retryFailedSubmissions` / `flushQueue`), flushed to `POST /api/offline-sync`, idempotent on `local_id` (`src/lib/offline/claim.ts`). The daily console already enqueues with `moduleKey: "daily_reports"` when offline (`daily-report-console.tsx:158`) and replays through `handleDailyReplay` → the same `persistDaily` pipeline as online.
- **Read path (one precedent):** authenticated pages are network-only offline **except** `/offline-schedule` — a deliberately data-free static shell cached by the SW, rendered from a second raw-IndexedDB read-model cache `rink-schedule-cache` (`src/lib/offline/schedule-cache.ts`, keyed by `userId`, 7-day TTL, populated while online by `offline-my-schedule.tsx`, cleared on auth change by `auth-state-listener.tsx`). RSC payloads and authenticated HTML are deliberately never cached (kiosk cross-user-leak protection).
- **Failure UX already exists:** permanent failures (any non-transient 4xx, incl. 422/403) park in the queue with `permanent: true` and are surfaced on `/reports/offline-queue` ("can't be synced automatically — contact your administrator"), with retry/flush controls.

**Phase 6 rewrite (D9):** mirror the schedule-cache pattern, not Dexie. Add a `rink-daily-assignments-cache` IndexedDB (or a second store in a shared DB) holding the user's resolved "My Areas Today" (+ open areas), populated on each online render of the daily landing view, TTL ≤ 24 h (assignments are day-scoped, so a stale next-day cache must self-invalidate by `business_date` key, not TTL alone), cleared on auth change; an offline shell route akin to `/offline-schedule` if offline *navigation* to the view is required. Assignment mutations stay online-only (no queue path is added for them — D9). **Stale-assignment edge (plan's Phase 6 caveat):** a user unassigned while offline can still enqueue a tab submission; at flush, RLS + the Phase 2 policy reject it, the route returns a permanent failure, and the existing queue page surfaces it — the "surface the rejection, don't silently drop" requirement is already met by infrastructure; Phase 6 only needs assignment-specific message copy.

## 7. Other mapped infrastructure

- **Per-facility feature flag (Phase 7 requirement):** `facility_modules(facility_id, module_key, enabled)` (migration 144) is a *module-level* nav toggle, not per-feature. The assignment feature needs its own flag; propose a `facility_settings`-style boolean or a dedicated `daily_report_settings` row (`assignment_routing_enabled boolean default false`, plus the D5 pre-lock warning threshold minutes). When disabled, the resolution engine writes nothing and the RLS assignment branch sees zero rows ⇒ every area is open ⇒ exact current behavior.
- **Dashboard widget (D7):** the dashboard already computes per-module status via `getDashboardModuleStatus` (`src/app/dashboard/_lib/status.ts`) rendered as `StatusBubble`s on module tiles (`src/app/dashboard/page.tsx`). The "My Areas Today" widget slots into this pattern (count complete/total for the current user's assignments).
- **Admin console:** `src/app/admin/daily-reports/page.tsx` with tab components under `_components/` (areas / templates / items / area-access / submissions). Default-owners config and area↔job-area mapping UI belong here as new tabs.
- **Precedent for SECURITY DEFINER + cron:** `purge_old_daily_reports()` (migration 7) and the seeding functions (135/144) establish the service-role-only function + pg_cron pattern the snapshot roll-over would reuse.
- **Scheduling publish-lock bypass (standing guard): already fixed.** The plan assumes a known UI-only publish-lock bypass. Per `docs/scheduling-audit.md` and migrations 148/164/181, the publish lock is now DB-enforced on INSERT/UPDATE/DELETE. The regression guard remains cheap to honor (this feature adds no scheduling writes) but the bypass itself is closed.

## 8. Plan assumptions contradicted by discovery (gate decisions needed)

| # | Plan assumption | Reality | Proposed resolution |
|---|---|---|---|
| C1 | Next.js 15 | Next.js 16.2 / React 19.2 (see CLAUDE.md; `src/proxy.ts` replaces middleware) | Follow repo conventions; no plan impact beyond phrasing |
| C2 | Dexie.js + Zustand offline layer | No Dexie/Zustand anywhere; offline = service worker (`public/sw.js`) + `offline_sync_queue` write-queue (§6) | Rewrite Phase 6 against the SW/Cache-API model (§6 proposal) |
| C3 | `supervisor` / `facility_manager` roles | Roles retired (migrations 58/87); permission-model is `user_permissions` actions | Gate on `daily_reports`.`edit` (§3) |
| C4 | An end-of-day lock path exists to extend | No lock entity; append-only + implicit day rollover (migrations 156/161) | Day-keyed snapshot via cron/lazy materialization, no new lock (§1, option A) |
| C5 | Up-to-20 admin-configurable tabs | Cap is 30 active areas per facility (migration 7 trigger); tabs are (area × template) | Cosmetic; use 30 |
| C6 | Publish-lock bypass is open (UI-only) | Closed at DB level (148/164/181) | Guard stays, treat as regression check only |
| C7 | Area↔position mapping may exist | Confirmed absent by design: `employee_job_areas` is "a SEPARATE concept from Daily Report areas" (migration 107 header); shifts carry `job_area_id` (migration 115) | New `daily_area_job_area_map` join table (Phase 1) + admin mapping UI (Phase 4) |
| C8 | Visibility restriction (D10) is net-new | Standing per-area allow-list already enforced (`module_area_permissions`, migration 90) | Layer date-scoped assignment on top; do not touch the standing layer (§2) |
| C9 | Brand `#4DFF00`/`#002244`, Space Grotesk/Space Mono | App uses semantic tokens in `globals.css`, module accent `--module-daily`, Geist + Anton, both themes | Use existing tokens (CLAUDE.md mandate); no hardcoded colors |
| C10 | In-app notification infra may not exist | Exists but module-siloed: scheduling inbox (`schedule_notifications`, typed CHECK enum) + communications rule-driven outbox; no targeted cross-module channel | Minimal new daily-report notification table mirroring the `schedule_notifications` pattern (§5) |
| C12 | Schedule reads are safe by default | Scheduling RLS does **not** filter draft shifts — published-only is query discipline | Resolution engine hard-filters `status='published'`; add an RLS-harness assertion is *not* possible without a policy change (out of scope), so enforce via code review + Phase 7 grep |
| C11 | 14-day retention not mentioned in plan | Submissions purge after 14 days | Snapshots must define their own retention (propose: same 14-day purge, added to `purge_old_daily_reports` or a sibling) |

## 9. Proposed schema diff (Phase 1 — for approval, not applied)

All tables: `facility_id uuid not null references facilities(id) on delete restrict`, RLS **enabled with no policies (deny-all)** until Phase 2, `set_updated_at` triggers per convention.

```sql
-- 1. Daily assignment rows (D2 multiple assignees; supersede-don't-delete)
create table public.report_area_assignments (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  report_date   date not null,                -- facility-local business date
  area_id       uuid not null references public.daily_report_areas(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  source        text not null check (source in ('manual','schedule','default')),
  assigned_by   uuid references public.employees(id) on delete set null,
  created_at    timestamptz not null default now(),
  superseded_at timestamptz
);
-- one ACTIVE row per (area, date, employee)
create unique index report_area_assignments_active_uniq
  on public.report_area_assignments (facility_id, report_date, area_id, employee_id)
  where superseded_at is null;
create index idx_raa_facility_date on public.report_area_assignments (facility_id, report_date);
create index idx_raa_employee_date on public.report_area_assignments (employee_id, report_date);

-- 2. Standing default owners (admin-configured)
create table public.area_default_owners (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  area_id     uuid not null references public.daily_report_areas(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint area_default_owners_uniq unique (area_id, employee_id)
);

-- 3. Area ↔ scheduling job-area mapping (C7: net-new, feeds the schedule branch)
create table public.daily_area_job_area_map (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  area_id     uuid not null references public.daily_report_areas(id) on delete cascade,
  job_area_id uuid not null references public.employee_job_areas(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint daily_area_job_area_map_uniq unique (area_id, job_area_id)
);

-- 4. Day-keyed assignment snapshot (C4: no report_id exists; frozen at day close)
create table public.daily_area_assignment_snapshots (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  business_date date not null,
  area_id       uuid not null references public.daily_report_areas(id) on delete cascade,
  assignees     jsonb not null,               -- [{employee_id, name, source}]
  completed     boolean not null,
  completed_by  jsonb,                        -- [{employee_id, name, submission_id, submitted_at}]
  snapshot_at   timestamptz not null default now(),
  constraint daily_area_assignment_snapshots_uniq unique (facility_id, business_date, area_id)
);

-- 5. Feature flag + pre-lock warning threshold (per facility)
create table public.daily_report_settings (
  facility_id                 uuid primary key references public.facilities(id) on delete cascade,
  assignment_routing_enabled  boolean not null default false,
  prelock_warning_minutes     int not null default 60,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz
);
```

Notes: `employee_id` (not `user_id`) matches how every daily-report table and `module_area_permissions` reference people. Snapshot `assignees`/`completed_by` are jsonb to survive the 14-day submission purge and employee deactivation. Names of the first two tables keep the plan's names where possible; `report_assignment_snapshots` is renamed because there is no `report_id` (C4).

## 10. Proposed RLS diff (Phase 2 — for approval, not applied)

New helper (SECURITY DEFINER, mirrors existing helper conventions):

```sql
-- True iff the caller may work the given daily area on the given date under
-- assignment routing: routing disabled OR area open that day OR assigned to caller.
create function public.daily_area_assignment_allows(p_area_id uuid, p_date date)
returns boolean … as $$
  select
    not exists (select 1 from public.daily_report_settings s          -- flag off ⇒ open
                 where s.facility_id = public.current_facility_id()
                   and s.assignment_routing_enabled)
    or not exists (select 1 from public.report_area_assignments a     -- D4: no active rows ⇒ open
                    where a.facility_id = public.current_facility_id()
                      and a.area_id = p_area_id and a.report_date = p_date
                      and a.superseded_at is null)
    or exists (select 1 from public.report_area_assignments a         -- assigned to me
                join public.employees e on e.id = a.employee_id
               where a.facility_id = public.current_facility_id()
                 and a.area_id = p_area_id and a.report_date = p_date
                 and a.superseded_at is null
                 and e.user_id = auth.uid() and e.is_active = true);
$$;
```

Policy changes (only `daily_report_submissions` policies change; children inherit via existing `EXISTS` subqueries):

- `daily_report_submissions_insert` — append `AND public.daily_area_assignment_allows(area_id, /*today, facility-local*/)` to the existing staff branch. Module-admin / super-admin branches unchanged. (Elevated non-admin `edit` holders also bypass — exact clause drafted in Phase 2.)
- `daily_report_submissions_select` — same additional conjunct on the staff branch, keyed on the row's `business_date` (null-safe: pre-feature rows with any date fall into the open branch). Historic reports stay visible (D4/D10 historic requirement) because dates with no assignment rows are open.
- New tables: staff SELECT own assignment rows (+ open-area rows needed to render "Open areas"); `daily_reports` `edit`-or-admin INSERT/UPDATE (supersede) within facility; `area_default_owners` + `daily_area_job_area_map` + `daily_report_settings` admin-write / facility-read; snapshots facility-read per existing report visibility, **no INSERT/UPDATE/DELETE for any role** — written only by a SECURITY DEFINER snapshot function (service_role/cron), mirroring `purge_old_daily_reports`.
- Adversarial tests: extend `supabase/tests/rls_isolation.sql` (the single regression harness, run by `.github/workflows/rls-isolation.yml`) with the Phase 2 matrix: staff-A vs staff-B, revert-to-open on supersede, multi-assignee, admin unaffected, cross-facility, pre-feature dates, flag-off behavior.

## 11. Resolution engine placement (Phase 3 note)

`resolveAssignmentsForDate(facilityId, date)` materializes rows priority manual > schedule > default, never overwriting `manual` rows: run on first daily-console load of the day and on the admin/pre-lock views, guarded by an advisory lock or `on conflict` idempotency so concurrent loads don't duplicate. Schedule branch (D1) reads published shifts joined through `daily_area_job_area_map`; falls through to `area_default_owners` when the day's schedule is unpublished or the mapping is empty. Notifications fire only on rows the run actually inserts/supersedes with `source='manual'`… (full design in Phase 3; resolution re-runs must be no-ops for notification purposes).

---

## 12. Gate decisions (approved 2026-07-18)

- **§1 = Option A.** No lock entity; day-keyed `daily_area_assignment_snapshots`, written by the Phase 5 day-close SECURITY DEFINER path.
- **Assign/reassign rights:** gated on the `daily_reports` module's `edit` action (server-side `currentUserCan(…, "daily_reports", "edit")` + matching RLS clause; `admin` implies it). Role defaults seed `edit` for canonical `manager` and `admin`, plus any per-facility custom role keyed `supervisor`.
- **Notifications (D6):** new minimal daily-report notification table mirroring the `schedule_notifications` pattern (recipient-scoped RLS), surfaced in My Areas Today + the dashboard widget. Do **not** widen the scheduling enum.
- **Overnight shifts:** a schedule-derived shift assigns the business date it **starts** on.
- **§9 schema diff and §10 RLS approach approved.** Phase 1 shipped as migration `00000000000182_daily_area_assignment_schema.sql` (tables + indexes + deny-all RLS; policies deferred to Phase 2), with `src/types/database.ts` regenerated.
- **Phase 2 shipped** as migration `00000000000183_daily_area_assignment_rls.sql` (helpers + policies + a `business_date` stamping trigger closing the NULL-date INSERT bypass) with a 39-assertion "DAR" section in `rls_isolation.sql`.
- **Phase 5 shipped** as migration `00000000000185_daily_assignment_snapshot.sql`: a past-date guard trigger on `report_area_assignments` (closed facility-local days are immutable for end-user roles — "no reassignment after lock" at the DB boundary), the insert-only `snapshot_daily_assignment_days` writer (assignees + completed + completed-by, frozen once, 14-day lookback) invoked opportunistically from the resolution engine and hourly via `/api/cron/snapshot-daily-assignments`, plus the "Assignment record" section on `/reports/daily/history` rendering the permanent "Completed by X" / "Assigned to X — not completed" flags. Open areas get no snapshot row and render as pre-feature. Lock is never blocked (D5) — snapshots only record. Harness section "DAR-5" (13 assertions).
- **Phase 3 shipped** as migration `00000000000184_daily_assignment_engine.sql` (`daily_report_assignment_notifications` + `resolve_daily_area_assignments`, tested in the "DAR-3" harness section) plus the server layer (`reports/daily/_lib/assignments.ts`, `assignment-actions.ts`, `admin/daily-reports/assignment-config-actions.ts`). **Engine semantics decision:** first-materialization-per-(area, date) wins — areas with any assignment rows for a date (active or superseded) are never re-materialized, making re-runs no-op (no notification spam) and making unassign a durable open-area tombstone. Consequence: schedule changes published after first materialization do not auto-flow; supervisors adjust manually (v1 scope). Scheduling regression note (D1): the engine reads `schedule_shifts` with `status = 'published'` only and writes no scheduling table (verified by grep + the DAR-3 draft-shift assertion).
