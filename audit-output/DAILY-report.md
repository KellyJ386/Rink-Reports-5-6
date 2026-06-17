# Daily Reports — Audit Report

- **Module audited:** Daily Reports (`src/app/reports/daily/`, `src/app/admin/daily-reports/`)
- **Supabase project:** `bqbdgwlhbhabsibjgwmk` (only)
- **Mode:** AUDIT-ONLY. No code/migration/schema writes performed. Only this report + DONE marker written.
- **Date:** 2026-06-17

---

## ### Grade: 86/100

---

## ### Status

**Near-complete.** The Daily Reports module is a full-stack, production-quality implementation covering DB schema, RLS, admin config CRUD, staff submission flow (online + offline), notification dispatch, and CSV bulk access management. Its primary gaps are: (1) no staff-side submission history view, (2) field types per checklist area are not configurable beyond `boolean` (checkbox-only — no text/numeric/select field types), and (3) hand-rolled rather than Zod-based validation on submit paths (systemic codebase pattern, not a module defect).

---

## ### Strengths (top 3)

1. **Robust offline-first submit pipeline.** The module is one of the cleanest offline implementations in the codebase. `enqueueSubmission` → SW queue → `/api/offline-sync` replay path is fully wired. `handleDailyReplay` in `src/app/reports/daily/_lib/offline.ts` runs the identical area/template/permission checks that the online path runs, idempotent via `offline_sync_queue.local_id`, and `facilityId`/`employeeId` come from the server session — never from the queued payload. Pure parsing logic is split into `compute.ts` (unit-tested, 37 cases in `compute.test.ts`) with no server-only imports, and side-effectful I/O in the `server-only` `submit.ts`. This is the reference pattern the spec asks for.

2. **Defense-in-depth server enforcement (facility + area + permission, three layers).** The submit path in `src/app/reports/daily/_lib/submit.ts` verifies area/facility match, template/facility/area triple match, and `module_area_permissions.can_submit` — all before the DB write. RLS on `daily_report_submissions` (migration 90) independently enforces `current_employee_module_permission('daily_reports') >= 'submit'` AND `has_area_submit_access('daily_reports', area_id)` and `employee_id = current_employee_id()`. The `facility_id` is always injected server-side from the authenticated employee row — never from any client input. Admin mutators in `actions.ts` pair every write with `.eq("facility_id", facility.facilityId)` scoped to the session.

3. **Rich, fully DB-driven admin config.** Admins can create/rename/reorder/deactivate areas (up to 30), create/rename templates (up to 3 per area: Opening/Operational/Closing in seed), add/reorder/toggle checklist items, and manage per-employee per-area submit access via a matrix UI or CSV bulk import — all without code deployments. `requireAdmin()` gates every admin action. The seed migration (135) populates 17 areas × 3 templates × ~30 items each for new facilities automatically on creation. Live DB confirms: 17 areas, 51 templates, 506 checklist items, all active.

---

## ### Gaps (top 3 with file paths)

1. **No staff-facing submission history view.** `src/app/reports/daily/` contains only the submit form (`page.tsx`) and the done page (`[areaSlug]/[templateId]/done/page.tsx`). There is no staff-side route to view past submissions filtered by date or area. The done page shows the single just-submitted record but no history list. History is admin-only (via the Submissions tab in `src/app/admin/daily-reports/page.tsx`). The checklist audit item "history view with date filtering" is NOT FOUND for staff.

2. **Field types are checkbox-only (no text/numeric/select per tab config).** `daily_report_checklist_items` has `label`, `description`, and `is_active` — no `field_type` column. The staff UI renders all items as `<input type="checkbox">` and there is no admin UI to configure field types per area/template. The checklist audit item "set field types per tab" is NOT FOUND. (The CLAUDE.md spec acknowledges daily/incidents are "flat field / checklist forms" with no temperature or threshold fields, so this may be by design, but the audit checklist asks for it.)

3. **`deleteSubmission` facility scoping is conditional, not always enforced (application layer).** In `src/app/admin/daily-reports/actions.ts:845–856`, `deleteSubmission` builds its query conditionally: `if (facilityId) query = query.eq("facility_id", facilityId)`. When `current.profile?.facility_id` is null (possible for super admins without a facility assignment), the delete fires without the facility filter. RLS on `daily_report_submissions_delete` still gates this via `has_module_admin_access`, so there is no cross-tenant escape — but the application-layer guard is inconsistent. Every other admin action in this file uses `requireAdmin()` + `resolveFacility()` with a hard error if facility is absent; `deleteSubmission` bypasses `resolveFacility()` and applies a soft conditional. Inconsistency, not a critical breach, but worth standardizing.
   - `src/app/admin/daily-reports/actions.ts:840–863`

---

## ### Critical findings affecting this module (from SEC/SCHEMA)

None from SEC-report.md affect Daily Reports specifically. The SEC report found:

- 🟡 **W1 (Zod validation):** Daily Reports uses hand-rolled helpers (`nonEmpty`, `asInt`, `SLUG_RE`, `buildInputFromForm`). The import path (`importDailyChecklistItems` in `actions.ts:451`) does use `checklistImportSpec.zodRow.safeParse()` — one of the few Zod-validated paths in the codebase. Staff submit paths (`buildInputFromForm`, `persistDaily`) are hand-validated — graded 🟡 per the SEC rubric, not 🔴.

From SCHEMA-report.md:
- 🟡 **Duplicate migration prefix `00000000000139`:** `00000000000139_daily_report_rename_operational_to_daily.sql` shares its prefix with `00000000000139_scheduling_expiry.sql`. Both applied to live DB under distinct remote timestamps, so no live impact — but a `supabase db reset` ordering hazard exists on-disk. The rename migration itself (changes "operational" → "daily" in area names) is not critical to this module's operation.
- 🟢 **`daily_report_notes.employee_id → employees` lacks a covering index** (listed in SCHEMA §E, minor).

---

## ### Checklist Results

### SCHEMA

| Item | Result | Evidence |
|------|--------|----------|
| Submission table with `id`, `facility_id`, `area/rink`, `user_id`, `area/tab id`, `submitted_at`, `data` | **PASS** | `daily_report_submissions`: id, facility_id, area_id, employee_id, template_id, submitted_at. Checklist data in `daily_report_submission_items` (label_snapshot + is_checked). Migration 7. |
| Tab/area config stored per-facility (not hardcoded) | **PASS** | `daily_report_areas` table with `facility_id`, seeded per-facility via `seed_default_daily_report_checklists()`. Live DB: 17 areas for 1 facility. |
| Supports multiple tabs (Tennity uses 10) | **PASS** | Schema supports up to 30 active areas per facility (DB trigger). Seed provides 17. Live DB: 17 active. |
| Submissions queryable by date/area/user | **PASS** | Admin page `SubmissionsTabLoader` filters by `from`/`to` dates, `area_id`, `employee_id`. Indexes: `idx_daily_report_submissions_facility_submitted`, `_area_submitted`, `_employee`. |

### UI

| Item | Result | Evidence |
|------|--------|----------|
| Tab/area nav renders from DB config (not hardcoded names) | **PASS** | `getAllowedDailyAreas()` queries `daily_report_areas` per facility + `module_area_permissions`; `DailyReportConsole` renders pills from props (`src/app/reports/daily/_components/daily-report-console.tsx:305-340`). |
| Fields appropriate per area | **PASS** | Checklist items are DB-driven per template; items loaded from `daily_report_checklist_items`. Each area gets Opening/Operational/Closing templates with distinct seeded items. |
| Submit locks against double-submit | **PASS** | `useFormStatus` → `pending` prop disables the submit button during server action. Unique index `uniq_daily_report_submission_items_sub_item` on `(submission_id, checklist_item_id)` prevents duplicate items at the DB level. |
| History view with date filtering | **FAIL — staff side NOT FOUND** | No staff-facing history route exists under `src/app/reports/daily/`. Admin has full date/area/employee filter history. Staff has only the post-submit done page. |
| Admin can view any staff report | **PASS** | Admin submissions tab loads all facility submissions via `requireAdmin()` + `facility_id` filter. RLS SELECT policy: `has_module_admin_access('daily_reports')` bypasses per-area check. |

### ADMIN INTEGRATION

| Item | Result | Evidence |
|------|--------|----------|
| Admin can add/rename/reorder tabs without code deploy | **PASS** | `createArea`, `updateArea`, `reorderArea`, `setAreaActive` in `src/app/admin/daily-reports/actions.ts`. AreasTab UI with inline edit/reorder. |
| Set field types per tab | **FAIL — NOT BUILT** | `daily_report_checklist_items` has no `field_type` column. All items are checkbox-only. No UI to set field type per item or area. |
| Set who can submit vs view-only | **PARTIAL** | `setDailyAreaAccess` (area-access-actions.ts) grants `can_submit + can_view` together or deletes both — no way to grant view-only without submit. The schema (`module_area_permissions.can_view`, `can_submit`) supports separate flags but the UI grants both atomically. Bulk CSV also maps `can_submit=false` to revoke (not view-only). |
| Config changes appear on next load | **PASS** | Every admin action calls `revalidatePath("/admin/daily-reports")`. Staff page is `force-dynamic`. |

### ROLE ENFORCEMENT (server-side)

| Item | Result | Evidence |
|------|--------|----------|
| Staff submit own only | **PASS** | RLS INSERT policy: `employee_id = public.current_employee_id()` (migration 90). Application layer in `persistDaily`: `module_area_permissions.can_submit` check before insert. |
| Supervisor+ view all | **PASS (per actual permission model)** | RLS SELECT: `has_module_admin_access('daily_reports')` bypasses area filter. The spec's "supervisor" role was retired (mig 87); equivalent is `has_module_admin_access`. `requireAdmin()` guards all admin routes. |
| Facility_manager+ configure | **PASS** | RLS on areas/templates/items: `has_module_admin_access('daily_reports')`. Admin actions all call `requireAdmin()` + `resolveFacility()`. |

### OFFLINE

| Item | Result | Evidence |
|------|--------|----------|
| Submission routes through SW queue | **PASS** | `handleSubmit` in `daily-report-console.tsx:205-218` calls `enqueueSubmission` when `!navigator.onLine`. SW postMessage integration from `@/lib/offline/use-sync-queue`. |
| Pending visible in UI | **PASS (queued state shown, but no persistent list)** | When offline and queued, the form replaces with a "Saved on this device" card (`daily-report-console.tsx:220-252`). However, no persistent queue list showing pending items for the user to monitor across sessions — the `useSyncQueue` hook exists but only the transient `queued` state is shown in this module. (This is a minor gap common to all modules per OFFLINE agent scope.) |
| Replay endpoint registered | **PASS** | `src/app/api/offline-sync/route.ts:149-158` dispatches to `handleDailyReplay`. `facilityId`/`employeeId` from server session, not payload. |
| Idempotent replay | **PASS** | `offline_sync_queue` upsert `onConflict: "local_id", ignoreDuplicates: true` in `src/app/reports/daily/_lib/offline.ts:56-70`. Duplicate returns `{ ok: true, duplicate: true }`. |

---

## ### Files That Need Work

| File | Issue |
|------|-------|
| `src/app/reports/daily/` (missing file) | No staff history page. Need `src/app/reports/daily/history/page.tsx` or similar route with date/area filter for staff to view their own past submissions. |
| `src/app/admin/daily-reports/actions.ts:840–863` | `deleteSubmission` — use `resolveFacility()` and hard-error if absent, matching every other action in the file. |
| `src/app/admin/daily-reports/area-access-actions.ts` (and `area-access-tab.tsx`) | The area access grant/revoke always sets both `can_view + can_submit` together or deletes both. Add a view-only grant path so admins can assign read-only access without submit permission. |
| `supabase/migrations/` | `00000000000139_daily_report_rename_operational_to_daily.sql` shares prefix with scheduling migration — rename to `00000000000139a` or renumber to resolve on-disk collision (hygiene; no live impact). |
| (No field_type in schema) | If field types per checklist item are desired, requires a new migration adding `field_type` to `daily_report_checklist_items`, admin UI, and staff form branching. Currently out of scope per CLAUDE.md ("flat field / checklist forms"). |
