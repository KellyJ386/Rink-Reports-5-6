# Employee Scheduling Module Audit — Agent-SCHED

- **Project audited (MCP):** `bqbdgwlhbhabsibjgwmk`
- **Mode:** AUDIT-ONLY. No code/migration/schema writes performed except this report and the DONE marker.
- **Date:** 2026-06-17
- **Code paths:** `src/app/admin/scheduling/`, `src/app/reports/scheduling/`, scheduling migrations 15, 21, 40, 107, 115–120, 127–130, 133, 136–137, 139 (expiry), 140.

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK · ℹ️ INFO

---

## Grade: **78 / 100**

The scheduling module is architecturally complete and surprisingly deep. The core innovation — the custom drag-to-create week grid with live advisory warnings — is fully built, Zod-validated, and server-enforced. The DB layer is the most migration-tested module in the repo. Deductions come from: (a) react-big-calendar is installed but no longer drives the grid (replaced by a bespoke canvas — the comment trail says "lifted from the previous react-big-calendar grid"), leaving an unused 34 kB dependency; (b) month-view is stub-only; (c) per-employee `max_weekly_hours` has no admin UI setter on the employee edit form; (d) the supervisor "view area shifts" tier is retired (per the actual role model) and no mid-tier area-scoped read exists; (e) offline caching of the published schedule is navigation-only-network, not readable offline.

---

## CHECKLIST RESULTS

### SCHEMA

| Item | Status | Evidence |
|---|---|---|
| `schedule_shifts` with `employee_id, facility_id, job_area_id, start_time (starts_at), end_time (ends_at), status` | ✅ BUILT | Migration 15 + migration 115 adds `job_area_id`. Live: `job_area_id uuid nullable`, `starts_at`/`ends_at` timestamptz, `status text CHECK IN ('draft','published','cancelled')`, `facility_id` FK. 9 indexes, all RLS-enabled. 0 rows (dev DB). |
| `schedule_templates` for reusable patterns | ✅ BUILT | Migration 15: `schedule_templates` (header) + `schedule_template_shifts` (slots, with `day_of_week`, `start_time time`, `end_time time`, `staff_count`). Live: 1 template row. `grid-actions.ts:saveGridTemplate` writes both in one transaction with rollback on failure. |
| `max_weekly_hours` field on employees/profiles | ✅ BUILT | Migration 128 adds `employees.max_weekly_hours integer NULLABLE CHECK(1..168)`. Live column confirmed: `data_type=integer, is_nullable=YES`. Used by `grid-warnings.ts` advisory layer. |
| `job_area_certification_requirements` bridge table | ✅ BUILT | Migration 116. Live: 0 rows (seed not run), table present with `(facility_id, job_area_id, cert_name)` unique + CI unique index. Admin UI in `job-areas-client.tsx` allows add/remove cert requirements per job area. |
| `employee_job_area_assignments` table with live data | ✅ BUILT (live data confirmed) | Migration 107: `employee_job_area_assignments`. Live: **212 rows** (most data-rich scheduling table). `employee_job_areas` (the config table): 10 rows. |

### UI

| Item | Status | Evidence |
|---|---|---|
| `react-big-calendar` with `withDragAndDrop` installed | 🟡 PARTIAL | `package.json` lists `"react-big-calendar": "^1.20.0"` and `"@types/react-big-calendar": "^1.16.3"`. However, **no component imports it** — grep for `react-big-calendar`, `Calendar` from that package, or `withDragAndDrop` in `src/` returned zero hits. The grid was **replaced** by a bespoke canvas (`week-grid.tsx`, `board-model.ts`, `grid-geometry.ts`). Comment in `assign-popover.tsx` says "lifted from the previous react-big-calendar grid." The package is installed but unused (dead dep, ~34 kB bundle risk). |
| Full-week calendar renders | ✅ BUILT | `WeekGrid` renders a 7-column (or 1-column day view) time-grid with configurable `hourStart`/`hourEnd` from `resolveOperatingHours()`. Day header row with shift counts, hour gutter, per-day column layout, now-line indicator, today highlight. All custom — no library used. |
| Drag-to-create shifts on time grid (15-min snap) | ✅ BUILT | `week-grid.tsx`: `onColumnPointerDown` → sets `drag.kind="create"`, `onPointerMove` tracks `curH`, `onPointerUp` fires `onCreate(start, end)`. `yToHour()` in `grid-geometry.ts` uses `snapHour(raw, step=0.25)` — confirmed 15-min snap. Resize handles (top/bottom) and drag-move also fully implemented. |
| Shift creation modal captures employee/area/start/end | ✅ BUILT | `AssignPopover` (`assign-popover.tsx`): renders employee `<Select>` (with minor flag) and job-area `<Select>`, start/end displayed from `PopoverState`. Both create and edit modes. "Save as template" inline flow. |
| Smart-layer warnings: weekly hours exceeded | ✅ BUILT | `grid-warnings.ts:collectShiftWarnings` → checks `employees.max_weekly_hours` cap. Additionally checks facility-level `overtime_weekly_hours` via `scheduling_assignment_violations()` RPC. Warnings displayed in `AssignPopover` with `blocking` flag from `schedule_settings.block_on_violations`. |
| Smart-layer warnings: shift overlap for same employee | ✅ BUILT | `scheduling_assignment_violations()` SECURITY DEFINER RPC (migration 118) returns `double_booked` code. Additionally migration 140 adds a DB-level exclusion constraint on `schedule_shifts` for true last-line-of-defense double-booking prevention. |
| Smart-layer warnings: cert mismatch for job area | ✅ BUILT | `scheduling_assignment_violations()` returns `cert_missing:<cert_name>` codes when `job_area_certification_requirements` entries are not met by the employee's `employee_certifications`. `enforcement.ts:describeViolation` formats these. |
| Shift templates panel | ✅ BUILT | `ApplyTemplateForm` (`apply-template-form.tsx`) in the board toolbar. `saveGridTemplate` action in `grid-actions.ts`. Full `TemplatesClient` at `/admin/scheduling/templates` for managing template headers + slots. |
| Published schedule read-only for staff | ✅ BUILT | Staff pages (`/reports/scheduling`, `/reports/scheduling/my-schedule`) filter `status = 'published'` and scope to `employee_id = employeeRow.id`. RLS on `schedule_shifts` restricts staff to their own facility via `has_module_access('scheduling')` — admins are gated by `has_module_admin_access`. No staff-side write path to `schedule_shifts` (enforced in policy + no client insert). |
| Month view | 🟡 NOT BUILT (stubbed) | `week-board.tsx:514`: `if (v === "month") { toast.info("Month view is coming soon — showing the week."); return }`. Button renders but clicking it shows a toast and stays on week view. Listed as `BoardView` type but purely cosmetic. |

### ADMIN

| Item | Status | Evidence |
|---|---|---|
| Configure job areas | ✅ BUILT | `/admin/scheduling/job-areas`: `JobAreasClient` + `job-areas/actions.ts`. Full CRUD (create, rename, move up/down, soft-delete, activate/deactivate). |
| Configure required certs per job area | ✅ BUILT | Same `JobAreasClient` page — `addJobAreaCertRequirement` / `removeJobAreaCertRequirement` actions. UI shows per-area cert badge list with add/remove. |
| Set employee max weekly hours | 🟡 PARTIAL | `employees.max_weekly_hours` column exists and is consumed by the warnings engine. BUT: no admin UI form field sets it per-employee. The Employees admin edit form (`src/app/admin/employees/[id]/_components/`) has no `max_weekly_hours` input. It is currently only accessible via direct DB write or the compliance rule seed helper. The grid CrewRoster panel READS and displays per-employee caps correctly; the gap is the write path. |
| Publish/unpublish schedules | ✅ BUILT | `PublishButton` (`publish-button.tsx`) → `publish-request-actions.ts` creates a `schedule_publish_requests` row. `governance-actions.ts` contains `approvePublishRequest` which transitions shifts `draft → published` and writes `schedule_publish_events`. Full audit trail. Publish history page at `/admin/scheduling/publish`. |

### ROLE

| Item | Status | Evidence |
|---|---|---|
| `facility_manager+` create/edit shifts (server-enforced) | ✅ BUILT | `requireAdmin()` guards all admin scheduling server actions and pages. RLS `schedule_shifts_insert/update/delete` requires `has_module_admin_access('scheduling')`. `grid-actions.ts` calls `resolveFacility()` which calls `requireAdmin()` first. |
| Supervisor view area shifts (server-enforced) | 🟡 ROLE MODEL GAP (expected) | The spec's `supervisor` tier was retired in migration 87. No mid-tier "view area shifts but not all shifts" policy exists. Under the actual model, users either have `has_module_access` (see all facility shifts) or `has_module_admin_access` (write). There is no scoped per-area read role. Per audit instructions, the retired `supervisor` role is a spec/reality gap to document, not a defect. |
| Staff view own published only (server-enforced) | ✅ BUILT | Staff pages filter `employee_id = employeeRow.id` server-side BEFORE returning data, AND `status = 'published'` is added client-selectably — default is published-only. RLS additionally scopes by `current_facility_id()`. No staff path reads other employees' shifts. |

### OFFLINE

| Item | Status | Evidence |
|---|---|---|
| Published schedule readable offline via SW/cache | 🔴 NOT BUILT | `public/sw.js` comment block is explicit: "Navigation requests: network-only. Authenticated HTML must NOT be cached… The PWA's offline value is the IndexedDB submission queue, not offline page browsing." Line 399–404: all `navigate` mode requests fall through to `fetch(event.request).catch(() => offlineFallbackResponse())`. The scheduling dashboard and my-schedule pages are NOT cached. Staff cannot view their schedule when offline. This is an intentional SW design decision (cross-user kiosk leak risk), not an oversight — but it means the spec requirement "published schedule readable offline" is definitively not met. |

---

## Detailed findings

### 🔴 F1 — Published schedule not offline-accessible
The SW intentionally serves only a generic "You're offline" page for navigation requests. The staff schedule view (`/reports/scheduling`, `/reports/scheduling/my-schedule`) is fully network-dependent. The spec requirement for offline schedule reads is unmet by design. A targeted fix would require either (a) caching the pre-rendered published schedule HTML per-user (adds cross-user leak complexity), or (b) a client-side fetch + IndexedDB read cache for published shift data that bypasses full-page navigation caching.

### 🟡 F2 — react-big-calendar installed but unused (dead dependency)
`"react-big-calendar": "^1.20.0"` and `"@types/react-big-calendar": "^1.16.3"` are in `package.json` but zero imports reference the package. The bespoke `WeekGrid` component replaced it. This inflates the install footprint and will generate false-positive "is this used?" questions in future audits. Recommendation: remove the package and its types in a cleanup PR.

### 🟡 F3 — `max_weekly_hours` per-employee cap has no admin UI setter
`employees.max_weekly_hours` is used by the warning engine and displayed in the Crew Roster side panel. However, the employee edit form at `/admin/employees/[id]/` does not expose a field to set this value. Admins must currently set it via direct DB access. The column, constraint, RLS, and read paths are all correct; only the admin write-UI is absent.

### 🟡 F4 — Month view stub only
The "Month" button in the board toolbar shows a toast and falls back to week view. The `BoardView` type includes `"month"` but it has no implementation. Low impact (week + day views are fully functional), but the affordance misleads users.

### 🟡 F5 — `schedule_settings` has 0 rows on the live DB (seeding gap)
The live project shows `schedule_settings approx_rows=0` and `schedule_compliance_rules approx_rows=0`. The `seed_default_scheduling_config()` helper exists but hasn't been run. The grid falls back gracefully (`weekStartDay ?? 0`, `resolveOperatingHours` default), but compliance rules won't trigger and `block_on_violations` isn't configured — the warning engine is running in advisory-only mode on live. Not a code bug, but a deployment gap that could surprise an admin who expects blocking behavior.

### 🟢 F6 — `schedule_template_shifts.department_id` removed from grid but kept for legacy
Migration 128 relaxed `department_id NOT NULL` on `schedule_shifts`. The grid creates shifts with `department_id: null`. `schedule_template_shifts` still has a FK to `departments`. This is correct forward-compatibility, but worth noting: the templates created via `saveGridTemplate` set `department_id: null`, so the departments FK on template shifts is vestigial for new-grid templates.

### ✅ F7 — Zod validation on all grid server actions (positive finding)
All five `grid-actions.ts` exports (`createGridShift`, `updateGridShift`, `previewShiftWarnings`, `saveGridTemplate`, `deleteGridShift`) use `z.object().safeParse()` with typed schemas before any DB write. This module is one of only ~9 action files in the codebase that meets the Zod standard (SEC report W1). The schemas cover ISO-date refinement, UUID validation, time-ordering cross-field refinement, and string length bounds.

### ✅ F8 — Defense-in-depth: three enforcement layers for double-booking
1. Advisory: `collectShiftWarnings` → `scheduling_assignment_violations()` RPC → warns in popover.
2. Blocking (facility-optional): `enforceBlocking()` in `grid-actions.ts` re-runs the RPC and hard-blocks on write when `schedule_settings.block_on_violations = true`.
3. DB constraint: Migration 140 adds an exclusion constraint on `schedule_shifts` that prevents double-booking at the PostgreSQL level regardless of app-layer enforcement.

### ✅ F9 — facility_id always server-injected
`resolveFacility()` in `grid-actions.ts` derives `facilityId` from `getCurrentUser().profile.facility_id`, never from client input. Cross-tenant employee/job-area references are further validated via `assertOwned()` (RLS-scoped reads). The live check uses RLS itself as the oracle: "a missing row here means not in your facility."

---

## Summary table

| Area | Score | Notes |
|---|---|---|
| Schema completeness | 18/20 | All required tables present, live data in assignments (212 rows). Minor: max_weekly_hours write path missing in admin UI. |
| UI implementation | 20/25 | Custom grid built and working; drag-create/move/resize 15-min snap all confirmed. Deductions: react-big-calendar dead dep, month view stub, no per-employee max-hours UI. |
| Admin tools | 12/15 | Job areas + cert requirements fully built; publish lifecycle built; per-employee max hours setter missing. |
| Role / access control | 14/15 | Admin create/edit server-enforced; staff view-own enforced. Deduction: supervisor tier gap (expected per spec). |
| Offline | 0/10 | Explicit design decision to not cache navigation. Spec requirement unmet. |
| Code quality / Zod | 8/10 | All grid actions Zod-validated (rare in this codebase). Triple-layer double-booking defense. Minor: dead dep, no test for grid-actions server function (only pure helpers are unit-tested). |
| DB/RLS correctness | 6/5 (+1 bonus) | RLS on all 11+ scheduling tables, SECURITY DEFINER assignment-violations RPC, DB-level exclusion constraint as last-line-of-defense. Extra point for migration quality. |
| **Total** | **78/100** | |

---

## Recommendations (for future non-audit work — not actioned here)

1. 🟡 Add `max_weekly_hours` field to the employee edit form (`/admin/employees/[id]/`) — 1-2 hour change; the column, constraint, and read paths already exist.
2. 🟡 Remove `react-big-calendar` and `@types/react-big-calendar` from `package.json` (dead dependency cleanup).
3. 🟡 Run `seed_default_scheduling_config(facility_id)` on the live project so `schedule_settings` and `schedule_compliance_rules` are populated; consider auto-seeding on facility creation (migration 120 already wires this for new facilities — re-run needed for the existing one).
4. 🔴 Define an offline caching strategy for the published schedule. Options: per-employee IndexedDB fetch-cache populated on SW activate, or a lightweight schedule-sync endpoint that the SW can call. The current generic offline page is intentional for security, so any fix must account for the shared-kiosk concern.
5. 🟢 Implement month view or remove the "Month" button to avoid misleading users.
