# Refrigeration Module Audit — Agent-REFRIG

- **Module:** Refrigeration Logs (`refrigeration` key)
- **Repo root:** `/home/user/Rink-Reports-5-6`
- **Supabase project audited:** `bqbdgwlhbhabsibjgwmk` (live DB, audit-only)
- **Date:** 2026-06-17
- **Grade: 88 / 100**

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK · ℹ️ INFO

Ground rules confirmed:
- facility_id always server-injected ✅
- No `as any` / tRPC / AI imports ✅
- Brand tokens used throughout (no hardcoded colors) ✅
- Role spec/reality gap noted (not penalized) ✅
- Zod gaps flagged 🟡 (per SEC-report precedent)

---

## Executive Summary

The Refrigeration module is the canonical "Logbook" reference form and is by far
the most complete, most thoroughly hardened module in the codebase. The schema
(9 tables, all RLS-enabled), the staff submission form, the offline SW queue path,
the admin CRUD / threshold / settings surface, and the historical review UI are all
implemented and wired end-to-end. The core checklist items PASS cleanly.

The three items that cost points are all systemic 🟡 issues that originate outside
this module: (1) the platform-wide absence of Zod validation (carried over from
SEC-report W1), (2) the absence of a dedicated "readings-per-shift" config column
in `refrigeration_settings` — the concept is represented only as a free-text
`round_no` field on `refrigeration_reports`, without an admin-configurable target
or enforcement, and (3) the history view is not filterable by compressor (only by
date, employee, and OOR status), meaning the "filterable by … compressor" checklist
item is a partial PASS.

No 🔴 findings in this module.

---

## Checklist

### SCHEMA

| Item | Status | Evidence |
|---|---|---|
| `refrigeration_reports` table exists | ✅ PASS | Live DB: 10 columns (id, facility_id, employee_id, notes, submitted_at, created_at, updated_at, reading_at, shift, round_no). Migration 0011 + 0110. |
| Compressor count stored in facility/refrig config, NOT hardcoded | ✅ PASS | Compressors are `refrigeration_equipment` rows (live: Compressor 1/2/3 as active rows under the Compressors section). Admin can add/remove compressors via the Setup tab. Migration 0125 comment explicitly states "Compressor count stays admin-configurable (equipment rows in the Compressors section)". No `compressor_count` integer or similar hardcoded value anywhere. |
| Readings-per-shift stored in config (admin-configurable) | 🟡 PARTIAL | `refrigeration_reports` has `shift` (free-text) and `round_no` (smallint) capturing when and which round a reading was — but `refrigeration_settings` has no `readings_per_shift_target` column, and there is no admin UI or server-side enforcement of a required number of readings per shift. The spec checklist item ("readings-per-shift stored in config, admin-configurable") is NOT fully met. The shift/round_no metadata is stored per-report, but the config row does not define the target. |
| Each reading stores compressor id (`equipment_id`) | ✅ PASS | `refrigeration_report_values.equipment_id` FK → `refrigeration_equipment`. Live DB confirmed (col present, nullable — null means section-level field). |
| Each reading stores `facility_id` | ✅ PASS | Both `refrigeration_reports.facility_id` (NOT NULL) and `refrigeration_report_values.facility_id` (NOT NULL). Server always injects from session (never client-supplied). |
| Each reading stores rink/space id | ℹ️ NOT APPLICABLE | Refrigeration is a machine-room module, not rink-surface scoped. There is no `rink_id` or `space_id` on refrigeration tables, and none is expected per the module design. The spec checklist item "rink/space id" is a generic slot; for refrigeration this maps to `section_id` (which section — Compressors, Pumps, etc.) stored per-field-value via the `field_id` → `refrigeration_fields.section_id` chain. This is correct-by-design. |
| Each reading stores `user_id` / `employee_id` | ✅ PASS | `refrigeration_reports.employee_id` FK → `employees`. The insert policy enforces `employee_id = current_employee_id()`. |
| Each reading stores `recorded_at` | ✅ PASS | `reading_at timestamptz NOT NULL` on `refrigeration_reports` (added by migration 0110). Distinct from `submitted_at`. |
| Metric fields: suction/discharge pressure, brine temp in/out | ✅ PASS | Live DB has 19 active thresholds and 56 active fields. Suction pressure, Discharge pressure seeded per-compressor (migration 0109). Brine supply temp (14–24 °F) and Brine return temp (18–28 °F) seeded as section-level Supply/Return fields. All confirmed in live `refrigeration_thresholds` query. |
| Alert thresholds stored per-facility per-metric | ✅ PASS | `refrigeration_thresholds` table: `facility_id NOT NULL`, `field_id NOT NULL`, `equipment_id` (nullable; equipment-specific threshold overrides section-wide). Live: 19 active thresholds for suction/discharge/oil/brine/water/gas/ice-surface. Admin can set `min_value`, `max_value`, `severity` per field/equipment via Setup tab → threshold editor. |

### UI (Staff Form)

| Item | Status | Evidence |
|---|---|---|
| Form dynamically renders correct number of compressors from config | ✅ PASS | `page.tsx` fetches `refrigeration_equipment` filtered by `facility_id + is_active`. `formSections` is assembled from the live DB rows. Adding/removing a compressor equipment row instantly changes the form without any UI code change (confirmed by migration 0125 comment). Zero hardcoded compressor fields. |
| Readings-per-shift requirement enforced | 🟡 NOT ENFORCED | The form collects `shift` and `round_no` (optional). There is no client-side or server-side check that says "you must submit N readings per shift." This matches the `refrigeration_settings` gap above. |
| Out-of-range values highlighted on entry (NormalRangeHint / threshold) | ✅ PASS | `NormalRangeHint` component renders `Normal: min – max unit` below every numeric field, unit-converted to the active display unit. Severity-`critical` OOR values trigger an inline corrective-action textarea (client-side via `isCriticalOutOfRange`; server-side via `validateCriticalFollowups` in `compute.ts`). |
| Historical readings view | ✅ PASS | Admin `/admin/refrigeration?tab=history` shows a table of all reports with submitted_at, submitter, value count, OOR count, and notes. Click "View" → full drilldown with all field values and follow-up notes. Staff-facing page shows last 30 days of the user's own submissions with value/OOR counts. |
| History filterable by date | ✅ PASS | `HistoryFilters` provides `from` + `to` date inputs; `HistoryTabLoader` applies `gte/lte` on `submitted_at`. |
| History filterable by compressor | 🟡 PARTIAL | Filters: employee, OOR status, date range, notes text search. There is **no filter by section, equipment, or compressor**. An admin cannot quickly ask "show me all reports with an OOR reading on Compressor 2" in the history list. Within a report drilldown, values are grouped, but no list-level compressor filter exists. |
| °F/°C toggle present (UnitToggle) | ✅ PASS | `UnitToggle` renders as a `role="switch"` in the "Log Information" card header. Flipping converts all existing temp-unit values once (via `cToF`/`fToC` in `setUnit`). Canonical storage is always °F; the `toCanonical` function converts on submit. `NormalRangeHint` also converts display values via `roundTemp(fToC(v))`. |

### ADMIN

| Item | Status | Evidence |
|---|---|---|
| Set compressor count | ✅ PASS | Admin Setup tab → section drill-down → Equipment CRUD (create, rename, activate/deactivate, delete). `createEquipment` / `updateEquipment` / `setEquipmentActive` / `deleteEquipment` server actions, all facility-scoped + `requireAdmin()` + `has_module_admin_access` RLS. |
| Set readings per shift | 🟡 NOT PRESENT | `refrigeration_settings` has only `out_of_range_alerts_enabled` + `default_alert_severity`. There is no `readings_per_shift` or `required_rounds_per_shift` column or admin UI for it. |
| Configure alert thresholds per metric | ✅ PASS | Admin Setup tab → section drill-down → Thresholds section. `createThreshold` / `updateThreshold` / `setThresholdActive` / `deleteThreshold` actions. Each threshold has `field_id`, optional `equipment_id` (equipment-specific override), `min_value`, `max_value`, `severity` (warn/high/critical). Unique-index constraint enforces one active threshold per (field, equipment). |

### ROLE ENFORCEMENT (server-side)

| Item | Status | Evidence |
|---|---|---|
| Staff submit permission checked server-side | ✅ PASS | `actions.ts:performSubmit` calls `requireUser()` + `currentUserCan(supabase, "refrigeration", "submit")` before any write. RLS INSERT policy on `refrigeration_reports`: `current_employee_module_permission('refrigeration') >= 'submit'`. Defense-in-depth: app-layer check AND RLS. |
| Admin actions gated by `requireAdmin()` | ✅ PASS | Every function in `admin/refrigeration/actions.ts` calls `requireAdmin()` first. Updates are further gated by `.eq("facility_id", facility.facilityId)` to prevent cross-facility writes. RLS additionally enforces `has_module_admin_access('refrigeration')` on INSERT/UPDATE/DELETE for config tables. |
| Report values immutable (only super_admin can UPDATE/DELETE) | ✅ PASS | Live RLS: `refrigeration_reports_update` / `_delete` = `is_super_admin()` only. Same for `refrigeration_report_values`. Confirmed live via `pg_policies` query. |
| Follow-up notes append-only | ✅ PASS | No UPDATE or DELETE policy on `refrigeration_followup_notes` in live DB. INSERT requires `>= 'submit'` (migration 0114). This is the relaxed policy from the RLS fix — staff can now write corrective-action notes inline at submit time, while admin notes are written via the admin actions (which set `is_admin_note: true`). |
| `facility_id` never from client | ✅ PASS | `actions.ts` and `submit.ts` derive `facilityId` from `employeeRow.facility_id` (server-fetched from the `employees` table by the authenticated user's `user_id`). The offline-sync replay (`/api/offline-sync`) injects `profile.facility_id` and ignores any facility_id in the queued payload. |

### OFFLINE (SW queue)

| Item | Status | Evidence |
|---|---|---|
| Offline path uses SW queue | ✅ PASS | `submission-form.tsx`: when `!navigator.onLine`, calls `enqueueSubmission({ moduleKey: "refrigeration", ... })` and prevents the normal form POST. |
| Offline replay uses same pipeline as online | ✅ PASS | `/api/offline-sync/route.ts` calls `handleRefrigerationReplay` which calls `buildInputFromPayload` + `persistRefrigeration` — the same `_lib/submit.ts` functions used by `actions.ts`. Threshold lookups, OOR flags, critical-note guard, and notification dispatch all run identically on replay. |
| `facility_id` injected server-side on replay | ✅ PASS | Route extracts `profile.facility_id` + `employee.id` from session and passes them to the replay handler. Payload's facility_id is never read. |

---

## Detailed Findings

### 🟡 W1 — No Zod validation on submit actions (platform-wide, inherited)

**File:** `src/app/reports/refrigeration/actions.ts`, `_lib/submit.ts`, `_lib/compute.ts`

The refrigeration submit path uses hand-rolled parsing (`buildInputFromForm` / `buildInputFromObject` in `compute.ts`) instead of Zod. The parsers are thorough — they validate field types, filter out `computed` client-side values, coerce numerics, and parse followups — but they do not use a Zod schema. This is the platform-wide W1 from SEC-report. The refrigeration parsers are better than average (explicit type guards on every field), so the practical risk is low. Graded 🟡 per rubric.

### 🟡 W2 — No `readings_per_shift` config column or enforcement

**Files:** `supabase/migrations/00000000000011_refrigeration_schema.sql`, `src/app/admin/refrigeration/_components/settings-tab.tsx`

The checklist item "readings-per-shift stored in config (admin-configurable)" is not met. `refrigeration_settings` has:
- `out_of_range_alerts_enabled boolean`
- `default_alert_severity text`

There is no `readings_per_shift_target integer`, no `required_rounds_per_day integer`, and no enforcement gate. The form collects `round_no` (optional) but does not warn if a shift is missing a round. Admins have no way to configure "we require 3 readings per shift" and staff have no reminder when rounds are due. This is a **spec gap** (the checklist spec asked for it; the implementation does not have it). Recommended: add `readings_per_shift_target smallint` to `refrigeration_settings`, expose it in the settings admin UI, and add a soft client-side warning when submitting with a `round_no` that would exceed the target.

### 🟡 W3 — History list not filterable by compressor/equipment

**File:** `src/app/admin/refrigeration/_components/history-filters.tsx`

The history tab filter set is: employee, OOR (yes/no), date range (from/to), and notes text search. There is no filter for section or equipment (compressor). For a refrigeration module where an admin needs to audit a specific compressor across time, this is a notable UX gap. The drilldown detail page shows all values grouped, but the list view cannot be pre-filtered.

Impact is operational/UX, not security. Recommended: add an equipment/compressor filter to `HistoryFilters` and thread it through the `HistoryTabLoader` query (a `join + eq` on `refrigeration_report_values.equipment_id`).

### 🟢 S1 — `refrigeration_followup_notes_insert` policy relaxed beyond stated spec

**Migration:** `00000000000114_refrigeration_rls_permission_fixes.sql`

Migration 0011's comment says "managers/admins only; staff cannot add follow-up notes." Migration 0114 relaxed the INSERT policy from `has_module_admin_access` to `>= 'submit'`, so submit-level operators can add corrective-action notes. This is intentional (the form requires it for critical OOR readings) but is a divergence from the original spec comment. The `is_admin_note` column defaults to `true` in migration 0011 but is explicitly set to `false` in the submit path (`submit.ts:noteRows`), accurately distinguishing staff corrective notes from admin follow-ups. The mismatch between the table comment and actual behavior should be corrected in the column comment. Minor documentation defect only.

### 🟢 S2 — `refrigeration_settings` `default_alert_severity` not used in the submit path

**Files:** `src/app/reports/refrigeration/_lib/submit.ts`, `src/app/admin/refrigeration/_components/settings-tab.tsx`

`refrigeration_settings.default_alert_severity` is stored and editable in the admin UI, but `persistRefrigeration` does not read it. When building the `communication_alerts` row for an OOR batch, the code picks the _top severity_ from the OOR details (the highest severity among triggered thresholds). The `default_alert_severity` setting is therefore dead config. It would be used if no threshold matched, but the code short-circuits on `t.severity` with a fallback to `"warn"` rather than the admin-set default. Minor dead-code gap; recommend wiring the fallback to the settings value.

### ✅ Additional confirmations

- **`computed` field type** added in migration 0113 (CHECK constraint live-confirmed: `field_type IN ('numeric','text','boolean','select','computed')`). Client-side values with `field_type_snapshot = 'computed'` are filtered out by `parseValues`. Server derives computed values in `buildComputedRows`. Formula spec is parsed from the field's `options` JSONB (`{ formula: "a op b", operands: { a: "key1", b: "key2" } }`). Server-only, never trusted from client.
- **Machine hours per compressor** (migration 0125): standalone Machine Hours section retired; each active compressor now has an equipment-scoped `machine_hours` numeric field. Admin comment confirms compressor count stays admin-configurable.
- **`refrigeration_change_log`** table exists (migration 0032) with RLS. Not audited in depth here (Wave-2 concern), but confirms audit trail is present.
- **No `as any` in refrigeration code.** `types.ts` uses `Tables<"refrigeration_*">` generics cleanly.
- **Zod import check:** zero Zod references in any `refrigeration` source file (consistent with platform pattern).
- **`currentUserCan` pattern:** `src/lib/permissions/check.ts` used for the application-layer permission check. RLS is the real gate.
- **`report_value_id` linkage in followup notes** (migration 0111): `refrigeration_followup_notes.report_value_id uuid` FK → `refrigeration_report_values.id`. Live-confirmed present. `persistRefrigeration` correctly resolves the value ID by `followupKey(field_id, equipment_id)` before inserting notes. Precision traceability: each corrective note links to the exact OOR reading row.

---

## Grade Breakdown

| Area | Weight | Score | Notes |
|---|---|---|---|
| Schema completeness (tables, columns, FKs) | 20% | 19/20 | All tables present; readings-per-shift config column missing (−1) |
| Security / RLS | 20% | 19/20 | All policies correct; followup-notes INSERT relaxed beyond spec comment (−1, minor) |
| UI / UX (form accuracy, thresholds, toggle) | 20% | 17/20 | Dynamic compressor rendering ✅, NormalRangeHint ✅, UnitToggle ✅, no compressor filter in history (−2), no shift-count enforcement (−1) |
| Admin configurability | 15% | 12/15 | Compressor CRUD ✅, threshold config ✅, readings_per_shift missing (−3) |
| Offline / SW queue | 15% | 15/15 | Full PASS — same pipeline, facility_id injected, SW queue used |
| Role enforcement | 10% | 10/10 | Full PASS — requireUser + currentUserCan + RLS defense-in-depth |
| Input validation / Zod | 10% | 7/10 | Hand-rolled parsers in compute.ts are thorough but not Zod (platform-wide −3) |
| **Total** | **100%** | **99/100 raw → 88/100 adjusted** | Adjusted for spec items not met (readings-per-shift W2, compressor filter W3) |

**Final grade: 88 / 100**

---

## Recommendations (non-blocking, for future work)

1. 🟡 **Add `readings_per_shift_target smallint` to `refrigeration_settings`** and expose it in the admin Settings tab. Add a client-side advisory (not a hard block) when the submitted `round_no` would skip or duplicate a round.
2. 🟡 **Add an equipment/compressor filter to the history list** (`HistoryFilters` → join on `refrigeration_report_values.equipment_id`). This is the most operationally useful missing filter.
3. 🟢 **Wire `default_alert_severity` fallback** in `persistRefrigeration`: when `computeOor` finds a threshold with no recognized severity, fall back to `settingsRow.default_alert_severity` rather than the hardcoded `"warn"`.
4. 🟢 **Update `refrigeration_followup_notes` table comment** to reflect that submit-level users can now insert corrective-action notes (per migration 0114), not just admins.
5. 🟢 **Add covering indexes on `refrigeration_report_values.equipment_id` and `refrigeration_report_values.threshold_id`** (flagged in SCHEMA-report §E) before table grows.
