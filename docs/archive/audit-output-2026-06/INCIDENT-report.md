# RinkReports 5-6 — Incident Reporting Module Audit (Agent-INCIDENT)

- **Supabase project:** `bqbdgwlhbhabsibjgwmk` (read-only via MCP; used only for schema cross-check per prior SCHEMA report).
- **Mode:** AUDIT-ONLY. No code, migration, or schema writes. Only this report and the DONE marker were written.
- **Date:** 2026-06-17.
- **Files examined:** `src/app/reports/incidents/**`, `src/app/admin/incident-reports/**`, `src/lib/notifications/dispatch.ts`, `src/app/api/offline-sync/route.ts`, migrations 8, 27, 102, 103, 104, 105, 126, 131.

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK · ℹ️ INFO

---

## Executive Summary

The Incident Reporting module is well-structured, with clean server-side facility_id injection, RLS on all tables, an offline SW queue, and a proper audit trail. There are no critical defects. The main gaps are:

1. 🟡 **`ambulance_flag` column does not exist** — checklist item from the audit spec is not implemented; no boolean emergency flag, no ambulance-triggered notification escalation path.
2. 🟡 **`persons_involved` column does not exist** — another spec-listed field absent from the schema and form.
3. 🟡 **`rink_id` not on `incident_reports`** — spec lists this; the redesign replaced it with multi-select `facility_spaces` (better), but the spec gap is still a 🟡.
4. 🟡 **No per-module emergency notification recipient config** — notifications route through `communication_routing_rules` (generic module-level), not a dedicated emergency-recipient configuration surface in the Incident admin.
5. 🟡 **Input validation is hand-rolled, not Zod** — consistent with platform-wide W1 from SEC report.
6. 🟢 **Admin: no incident_types CRUD tab** — `incident_types` table exists (seeded) but admin UI has no manage-types tab; the "Types" filter in history uses the table but no admin can add/edit/delete types. Only severities and activities have admin CRUD.
7. 🟢 **`updateIncidentReport` fetches existing report without explicit facility_id filter** — ownership is enforced via `employee_id` check and RLS; facility_id is taken from the fetched row. Not a bypass risk (RLS UPDATE policy enforces `facility_id = current_facility_id()`), but adds one unnecessary cross-facility row-fetch (mitigated by RLS).

**Grade: 79 / 100**

---

## SCHEMA Checklist

### ✅ `incident_reports` table exists with correct core columns

From migration 8 + redesign migrations 103/104/131 + SCHEMA report §D:

| Column | Status | Notes |
|---|---|---|
| `facility_id` (FK → facilities) | ✅ PASS | NOT NULL, indexed |
| `employee_id` (FK → employees) | ✅ PASS | nullable (on delete set null) |
| `incident_type_id` (FK → incident_types) | ✅ PASS | nullable, retained for history |
| `severity_level_id` (FK → incident_severity_levels) | ✅ PASS | required in app |
| `activity_id` (FK → incident_activities) | ✅ PASS | added mig 103 |
| `activity_other` text | ✅ PASS | added mig 103 |
| `location_other` text | ✅ PASS | added mig 103 |
| `immediate_actions` text | ✅ PASS | added mig 103 |
| `occurred_at` timestamptz | ✅ PASS | |
| `reporter_name` text NOT NULL | ✅ PASS | |
| `reporter_phone` text nullable | ✅ PASS | was NOT NULL mig 8, made nullable mig 131 |
| `description` text NOT NULL | ✅ PASS | |
| `status` text CHECK | ✅ PASS | `submitted`, `in_review`, `resolved`, `archived` (mig 27 fixed `reviewed` → `in_review`) |
| `submitted_at` timestamptz | ✅ PASS | |
| `reviewed_at`, `resolved_at`, `archived_at` timestamptz | ✅ PASS | nullable; stamped on status transitions |
| `edit_window_ends_at` timestamptz | ✅ PASS | 24-hour submitter edit window |
| **`ambulance_flag`** boolean | 🟡 NOT FOUND | Checklist-required field absent from schema and UI entirely. No emergency boolean anywhere on the table. |
| **`persons_involved`** | 🟡 NOT FOUND | Checklist-required field absent from schema. |
| **`rink_id`** (spec) | 🟡 NOT FOUND (by design) | Replaced by multi-select `incident_report_spaces` → `facility_spaces` (a cleaner solution). The spec asked for a single rink; the implementation uses named spaces. |
| **`follow_up_required`** boolean | 🟡 NOT FOUND | Checklist-required field absent. Follow-up is admin-narrative only (append-only notes), not a boolean flag. |

### ✅ No photo/file/image/storage column on `incident_reports`

SCHEMA report §D confirmed; re-verified by grep of all `.tsx` files in `src/app/reports/incidents/`. Zero matches for `file`, `photo`, `image`, `upload`, `FileReader`, `camera`, `storage.upload`. The SEC report's CHECK 6 also confirmed PASS.

### ✅ Status lifecycle correct

`submitted` → `in_review` → `resolved` / `archived`. Migration 27 fixed `reviewed` → `in_review`. Admin `setReportStatus` in `admin/incident-reports/actions.ts:303` stamps the matching `*_at` timestamp on each transition. `isIncidentStatus` guard prevents arbitrary values.

### ✅ Child tables present

| Table | Status |
|---|---|
| `incident_activities` | ✅ PASS (mig 102) |
| `incident_report_spaces` | ✅ PASS (mig 104) |
| `incident_witnesses` | ✅ PASS (mig 104; DB CHECK: max 3, phone/email required) |
| `incident_change_log` | ✅ PASS (mig 104, append-only) |
| `incident_followup_notes` | ✅ PASS (mig 8, append-only) |
| `incident_severity_levels` | ✅ PASS (mig 8) |
| `incident_types` | ✅ PASS (mig 8, seeded but not admin-manageable) |

---

## UI Checklist

### ✅ Form covers all present required fields

`submission-form.tsx` covers: reporter name, reporter phone, occurred_at (datetime-local), facility spaces (multi-select + "Other"), description (500-char limit with live counter), severity (required), activity (optional + "Other"), immediate actions (optional), witnesses (0–3, name + phone/email required per witness). All required fields validated client-side (before confirm dialog) and server-side (`validateIncidentInput` in `compute.ts` + `resolveIncidentRefs` in `submit.ts`).

### 🟡 Ambulance flag NOT in UI

No `ambulance_flag` field, no emergency toggle, no ambulance-specific UI element. The checklist item "ambulance flag prominent (not buried)" cannot be satisfied as the field does not exist.

### ✅ Status transitions enforced (staff submit, admin reviews)

- Staff path: server action `submitIncidentReport` sets `status: "submitted"`, checks `currentUserCan("incident_reports", "submit")`.
- Admin path: `setReportStatus` action in `admin/incident-reports/actions.ts` gated by `requireAdmin()`. RLS UPDATE policy on `incident_reports` only allows module admins (or super admins) to change status — the staff-only RLS extension (mig 103) adds submitter-edit within edit window but still only for field updates, not status.
- Status dropdown shown in admin `report-detail.tsx` with all 4 values.

### ✅ 24-hour edit window for submitters

`edit_window_ends_at` added in mig 103. RLS UPDATE policy (`incident_reports_update`, mig 103) enforces `now() <= edit_window_ends_at AND employee_id = current_employee_id()`. App-layer check in `updateIncidentReport` also enforces `existing.edit_window_ends_at <= Date.now()` with early return before DB update. Change log written on every edit.

### ✅ History filterable by type/date/status/severity/employee/location

`history-filters.tsx` exposes: status (select), type (select), severity (select), employee (select), location prefix (text input), date from/to (date inputs). `HistoryTabLoader` applies all filters server-side with `.eq()` and `.like()` calls. **PASS.**

### ✅ Done page with links back to edit and new report

`done/page.tsx` shows status, severity, timestamps, and provides "Edit report" / "Submit another" / "Back to home" buttons.

### ✅ Read-only view when edit window closed

`reports/incidents/[id]/page.tsx` checks `isOwner && isWindowOpen(report.edit_window_ends_at)`; non-owners or past-window renders a data-only `Card` without the edit form.

---

## ADMIN Checklist

### ✅ Configure severity levels

Admin `severities` tab: full CRUD (create, update, activate/deactivate, delete with in-use guard). Seed defaults button. Bulk import not shown for severities (activities have bulk import; severities use manual entry). Color, key, display_name, sort_order. **PASS.**

### ✅ Configure activities ("Activity at the time")

Admin `activities` tab: full CRUD + seed defaults + bulk CSV import. Unique key per facility constraint (DB). **PASS.**

### ✅ Configure facility spaces (location options)

Facility spaces are shared-admin managed via `/admin/spaces` module. Mig 105 broadened `facility_spaces` write policy so Incident Reports module admins can also write. Spaces feed the incident form's multi-select. **PASS** (spaces management is in the shared admin, not a dedicated Incident admin tab — acceptable architecture).

### 🟢 No `incident_types` admin CRUD tab

`incident_types` table is present (seeded with Theft, Vandalism, Safety Concern, Other) and used as a filter column in history. The admin page has tabs for History, Severity Levels, and Activities — but no tab to create/edit/delete incident types. Types can only be seeded via the DB function `seed_default_incident_types_and_severities` (service_role only). This is a minor gap: the type column is listed in history filters and in the types `IncidentTypeRow`, but facility admins cannot manage the values through the UI.

### 🟡 No dedicated emergency notification recipient configuration in the Incident admin

Notification dispatch calls `dispatchRulesForSubmission` with `sourceModule: "incident_reports"` — this routes through `communication_routing_rules` (generic per-module routing, managed in `/admin/communications`). There is no Incident-specific "configure emergency notification recipients" surface. The checklist item "configure emergency notification recipients" is generically covered by the communications admin, but not incident-specific.

---

## ROLE Checklist

### ✅ Staff create + submit (server-enforced)

`submitIncidentReport` calls `currentUserCan(supabase, "incident_reports", "submit")`. RLS INSERT on `incident_reports` requires `has_module_access('incident_reports') AND employee_id = current_employee_id()`.

### ✅ Admin-only review/close

`setReportStatus` calls `requireAdmin()`. RLS UPDATE enforces `has_module_admin_access('incident_reports')` for status changes (staff self-edit via the in-window path only touches content fields, not status).

### 🟡 Facility-manager+ emergency notification (spec role gap)

The spec lists "facility_manager+ receive emergency notifications" as a server-enforced role gate. Since `ambulance_flag` does not exist, there is no emergency trigger to receive. Notifications do dispatch on every submission via `dispatchRulesForSubmission`, but emergency escalation based on a severity or flag is not implemented at the application layer (would be a routing rule concern). This is noted as a 🟡 role gap, consistent with the platform-wide role model divergence described in SEC S1 and SCHEMA §G.

---

## OFFLINE (SW Queue) Checklist

### ✅ Incident reports use the SW queue

`submission-form.tsx` imports `enqueueSubmission, useSyncQueue` from `@/lib/offline/use-sync-queue`. When `!isOnline`, the form calls `enqueueSubmission({ localId, moduleKey: "incident_reports", action: "submit", payload: buildPayload() })`. The offline banner and "Save offline" button label are shown. On reconnect, SW posts to `/api/offline-sync`.

### ✅ Offline-sync replay path uses the same pipeline

`/api/offline-sync/route.ts:89` dispatches to `handleIncidentReplay`. That handler (confirmed by line references) calls `buildInputFromPayload` + `validateIncidentInput` + `resolveIncidentRefs` + `persistIncident` — the same server-only helpers used by the online path. `facility_id` is injected from `profile.facility_id` (never from the queued payload). **PASS.**

### ✅ `buildInputFromPayload` normalizes untrusted offline payloads

`compute.ts:130` parses every field from `raw` with `str()` coercion (no casts, no `as any`). Witnesses normalized via `normalizeWitnesses`. Space IDs deduplicated via `normalizeSpaceIds`. Validation runs identically on offline and online paths.

---

## Security Cross-checks

### ✅ facility_id always server-injected

- Submit: from `employeeRow.facility_id` (loaded by `user_id + is_active` lookup).
- Update: from `existing.facility_id` (read from DB, protected by RLS).
- Admin actions: from `getCurrentUser().profile.facility_id`.
- Offline replay: from `profile.facility_id` (session), payload `facility_id` is never read.

### ✅ No `as any` in incident module

grep of `src/app/reports/incidents/` and `src/app/admin/incident-reports/` returns zero `as any` hits (consistent with SEC GR3 PASS).

### ✅ No photo/file upload in incident module

Zero `<input type="file"`, `FileReader`, `storage.upload`, or camera references anywhere in `src/app/reports/incidents/`. CRITICAL ground rule passes.

### 🟡 Input validation is hand-rolled (consistent with SEC W1)

`validateIncidentInput` in `compute.ts` uses manual `if (!x)` checks and length comparison. No Zod. This is the platform-wide pattern (SEC W1, 🟡, per rubric "manual checks → 🟡"). Specific gaps: `reporter_phone` is validated as non-empty but no format/pattern check; `occurred_at` is checked as non-NaN date but no future-date guard; `severity_level_id` and space IDs are validated against DB (server-side ref resolution) which is the correct defense.

### ✅ RLS enforces facility isolation on all incident tables

All 8 incident module tables have RLS ON with `facility_id = current_facility_id()` in USING/WITH CHECK. Append-only tables (`incident_followup_notes`, `incident_change_log`) have no UPDATE/DELETE policies → denied by default. Verified via SCHEMA report inventory.

---

## Findings Summary

| # | Severity | Finding |
|---|---|---|
| F1 | 🟡 | `ambulance_flag` column absent — boolean emergency flag not in schema or UI. |
| F2 | 🟡 | `persons_involved` column absent — spec-listed field not implemented. |
| F3 | 🟡 | `follow_up_required` boolean absent — tracked via append-only notes, not a structured flag. |
| F4 | 🟡 | No emergency notification recipient config in Incident admin (uses generic communications routing). |
| F5 | 🟡 | Input validation hand-rolled, not Zod (platform-wide W1, per rubric). |
| F6 | 🟢 | `incident_types` table not manageable via admin UI — seeded only, no CRUD tab. |
| F7 | 🟢 | `updateIncidentReport` fetches existing row without explicit `facility_id` filter — RLS protects isolation, but extra defensive filter would be cleaner. |
| F8 | 🟢 | `rink_id` spec field replaced by multi-select `facility_spaces` — architectural improvement, not a defect, but spec gap noted. |

### Passing items
- ✅ No photo/file/upload in incident module (CRITICAL ground rule — PASS).
- ✅ All tables have RLS with facility scoping.
- ✅ `facility_id` server-injected on all write paths.
- ✅ Status lifecycle correct (submitted → in_review → resolved / archived).
- ✅ 24-hour edit window enforced both in RLS and app layer.
- ✅ Append-only audit trail (`incident_change_log`, `incident_followup_notes`).
- ✅ Offline SW queue wired; replay uses same pipeline.
- ✅ Admin: severities CRUD (full), activities CRUD (full + bulk import + seed defaults).
- ✅ History filterable by status, type, severity, employee, location prefix, date range.
- ✅ Notification dispatch fires on every submission (`dispatchRulesForSubmission`).
- ✅ No `as any`, no tRPC, no AI/LLM imports.
- ✅ Brand tokens (semantic CSS variables used throughout; no hardcoded colors).

---

## Grade: 79 / 100

**Deductions:**
- −8 🟡 `ambulance_flag` absent (schema + UI gap, spec-required field)
- −4 🟡 `persons_involved` absent (schema + UI gap)
- −3 🟡 `follow_up_required` boolean absent
- −3 🟡 No incident-specific emergency notification recipient config
- −2 🟡 Hand-rolled validation (consistent platform gap, per rubric)
- −1 🟢 `incident_types` not admin-manageable via UI
