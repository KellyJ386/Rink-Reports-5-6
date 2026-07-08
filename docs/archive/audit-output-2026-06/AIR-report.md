# Air Quality Module Audit — Agent-AIR

- **Module:** Air Quality (`src/app/reports/air-quality/`, `src/app/admin/air-quality/`)
- **Supabase project audited (MCP):** `bqbdgwlhbhabsibjgwmk` only.
- **Mode:** AUDIT-ONLY. No code, migration, or schema writes were performed.
- **Date:** 2026-06-17.
- **Prior context consumed:** SCHEMA-report.md (migration-143 drift), SEC-report.md (Zod gap W1, facility_id PASS).

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK · ℹ️ INFO

---

## Executive summary

The Air Quality module is the most feature-complete reporting module in the codebase. Its
threshold/severity engine is split into a pure, unit-tested compute layer (`compute.ts`) and
a server-only I/O layer (`submit.ts`), a pattern other modules should follow. RLS is
comprehensive and correctly scoped. The offline SW queue is fully wired. The admin panel
covers setup, compliance rules, history, and settings.

There is one structural 🔴 finding: **the code is typed and queries against `facility_spaces`,
but the live DB FK still points at `air_quality_locations`** (migration 143 unapplied). This is
a pre-existing cross-cutting defect documented by SCHEMA-report (#1/#3) and repeated here
for completeness; it affects every read/write in the live project today. All other findings
are 🟡 or lower.

**Grade: 82 / 100**

---

## CHECKLIST RESULTS

### SCHEMA

| Check | Result | Evidence |
|---|---|---|
| Air quality readings table exists | ✅ PASS | `air_quality_readings` (5 cols, facility_id, RLS ON) confirmed live via MCP |
| CO, CO2, NO2 metrics exist | ✅ PASS | `air_quality_reading_types` is DB-driven; seed defaults in `actions.ts:1106–1162` explicitly define `co_ppm`, `no2_ppm`, `co2_ppm` with correct units and decimal precision; 3 rows live |
| Alert thresholds per-facility per-metric (warn/alert min/max) | ✅ PASS | `air_quality_thresholds`: `warn_min`, `warn_max`, `alert_min`, `alert_max`, `compliance_min`, `compliance_max` all confirmed live; 3 rows (one per default type); scoped by `facility_id` and optionally `location_id` |
| Each reading has facility_id, location, user_id, recorded_at, metric values | ✅ PASS | `air_quality_reports` has `facility_id`, `location_id`, `employee_id`, `submitted_at`; `air_quality_readings` has `facility_id`, `report_id`, `value_numeric`, `key_snapshot`, `label_snapshot`, `unit_snapshot` |
| facility_id server-side only | ✅ PASS | `submit.ts` derives `facilityId` from `employeeRow.facility_id` (server lookup); `actions.ts:resolveFacility()` reads from `current.profile.facility_id`; offline replay uses `profile.facility_id` injected by `/api/offline-sync`; never from client payload (confirmed by SEC-report CHECK 1) |

**SCHEMA: ✅ 5/5 PASS** — with the migration-143 drift caveat (FK target mismatch live vs. types) as a pre-existing 🔴 cross-cutting defect inherited from SCHEMA-report.

---

### UI

| Check | Result | Evidence |
|---|---|---|
| Entry form exists | ✅ PASS | `src/app/reports/air-quality/[locationSlug]/page.tsx` → `SubmissionForm` client component |
| Values exceeding threshold flagged immediately on entry (client-side, RangeBadgePill before submit) | ✅ PASS | `submission-form.tsx:96–113` `evaluateBadge()` runs inline against `parsedNum` on every keystroke; `RangeBadgePill` renders `<Badge variant="success">Within range</Badge>`, `<Badge variant="warning">Warn</Badge>`, or `<Badge variant="error">Alert</Badge>` immediately (no submit required); both `warn_min/max` AND `alert_min/max` are evaluated with alert winning |
| Historical readings view filterable | ✅ PASS | Admin history tab (`history-tab.tsx`) filters by employee, location, equipment, reading_type, exceedance flag, date range, and free-text notes search; `HistoryFilters` component exposed |
| Threshold breaches visually distinct in history | ✅ PASS | History list shows `<Badge variant="destructive">` for critical, `<Badge variant="warning">` for others, with exceedance count and severity label; OK rows show muted "OK" text |

**UI: ✅ 4/4 PASS**

---

### ADMIN

| Check | Result | Evidence |
|---|---|---|
| Set threshold per metric per facility | ✅ PASS | `createThreshold` / `updateThreshold` / `setThresholdActive` / `deleteThreshold` in `admin/air-quality/actions.ts`; all scoped `.eq("facility_id", facility.facilityId)`; supports location-specific override (`location_id` nullable) plus facility-wide fallback (`location_id = null`) |
| Configure which metrics tracked | ✅ PASS | Full CRUD on `air_quality_reading_types` (create, update, activate/deactivate, delete, reorder, CSV import via Zod-validated `readingTypeImportSpec`); admin can add/remove/toggle any metric |
| Configure who receives alerts | 🟡 PARTIAL | `air_quality_settings.alerts_enabled` controls whether alerts fire at all, and `dispatchRulesForSubmission` routes notifications through `communication_routing_rules`. However, the Air Quality admin panel itself has **no dedicated UI to configure which employees/groups receive air quality alert notifications**. That configuration lives in `/admin/communications` → Routing tab and must be set up there with `source_module = 'air_quality'`. The settings tab exposes `alerts_enabled` and `default_alert_severity` but not recipient configuration. This is a UX gap (not a security gap), consistent with the platform-wide approach of centralising routing rules in the Communications module. |

**ADMIN: ✅ 2/3 PASS, 1 🟡 PARTIAL**

---

### ROLE ENFORCEMENT (server-side)

| Check | Result | Evidence |
|---|---|---|
| Staff submit guarded server-side | ✅ PASS | `actions.ts` and `[locationSlug]/page.tsx` both call `requireUser()` + `currentUserCan(supabase, "air_quality", "submit")`; RLS policy `air_quality_reports_insert` requires `current_employee_module_permission('air_quality') >= 'submit'` |
| Admin CRUD guarded server-side | ✅ PASS | Every admin action calls `requireAdmin()` at the top of the try block before any DB access; RLS policies `air_quality_*_insert/update/delete` require `has_module_admin_access('air_quality')` |
| RLS policies confirmed live (MCP) | ✅ PASS | All 11 `air_quality_*` tables have full INSERT/SELECT/UPDATE/DELETE policies enforcing `facility_id = current_facility_id()` with appropriate submit vs admin level gates; `air_quality_reports` and `air_quality_readings` updates/deletes are `is_super_admin()` only (immutable for staff/admins — correct) |
| Offline replay enforces permission | ✅ PASS | `/api/offline-sync/route.ts:627` calls `currentUserCan(supabase, "air_quality", "submit")` before invoking `persistAirQuality`; `facilityId` and `employeeId` are injected from the server session, not the queued payload |
| Role gap (spec vs. reality) | ℹ️ NOTE | As noted in SCHEMA/SEC reports: the spec's five-tier role hierarchy does not match the live `user_permissions` + `role_permission_defaults` model. No penalty — this is a spec documentation gap, not a defect. |

**ROLE ENFORCEMENT: ✅ PASS**

---

### OFFLINE (SW queue)

| Check | Result | Evidence |
|---|---|---|
| SW queue wired for air quality submissions | ✅ PASS | `submission-form.tsx:213–226` calls `enqueueSubmission({ moduleKey: "air_quality", ... })` when `!navigator.onLine`; the SW routes it to `/api/offline-sync` |
| Offline replay runs same severity engine | ✅ PASS | `handleAirQualityReplay` in `offline-sync/route.ts:613–675` calls `buildAirQualityInput` (= `buildInputFromPayload` from `compute.ts`) then `persistAirQuality` — the identical code path as the online action; exceedance/severity rollup is recomputed server-side at replay time |
| Idempotency | ✅ PASS | `upsert({ onConflict: "local_id", ignoreDuplicates: true })` prevents double-submission on retry |
| Offline UI feedback | ✅ PASS | Form shows "Saved on this device" confirmation card when queued; submit button label switches to "Save offline" when `!isOnline` |

**OFFLINE: ✅ PASS**

---

## Detailed Findings

### 🔴 F1 — Live DB FK mismatch: `facility_spaces` vs `air_quality_locations` (inherited, pre-existing)

**Severity:** CRITICAL (pre-existing; documented by SCHEMA-report #1/#3)

Live FKs for `air_quality_reports.location_id`, `air_quality_equipment.location_id`, and
`air_quality_thresholds.location_id` all point to **`air_quality_locations`** (the old table,
0 rows), not `facility_spaces`. The application code (`page.tsx`, `submit.ts`, admin loaders)
queries `facility_spaces` exclusively; `database.ts` types `location_id` against
`facility_spaces`. As a result:

- Every staff submission that attempts to verify the location against `facility_spaces`
  (`submit.ts:63–70`) will succeed only because `facility_spaces` is unscoped by FK — the
  inserted `air_quality_reports.location_id` will reference a `facility_spaces.id` UUID that
  has **no FK constraint satisfied in the live DB** (`air_quality_locations` has 0 rows and
  the FK target is that table).
- If `air_quality_locations` enforces `NOT NULL` or a deferrable FK, inserts into
  `air_quality_reports` with a `facility_spaces` UUID as `location_id` will **fail with a
  foreign-key violation at the live DB** once `air_quality_locations` has 0 matching rows.

**Root cause:** Migrations 141–143 are unapplied to `bqbdgwlhbhabsibjgwmk`.

**Impact:** The air quality submission flow is **broken in the live project** for any facility
that has `facility_spaces` rows (the page shows them) but has no matching `air_quality_locations`
rows (0 exist). Admins cannot create `air_quality_locations` via the admin UI since the code
was migrated to use `facility_spaces`. The module is effectively non-functional in the live DB.

**Recommended fix (non-audit):** Apply migrations 141–143 to the live project.

---

### 🟡 F2 — `deleteAirQualityReport` omits `facility_id` when caller is super-admin

**Severity:** WARNING

`admin/air-quality/actions.ts:1020–1028`: `facilityId` is read from `current.profile?.facility_id`.
If the caller is a super-admin with no `facility_id` set (`profile.facility_id = null`), the
`if (facilityId)` branch is skipped and the DELETE runs with only `.eq("id", reportId)`. The
RLS policy `air_quality_reports_delete` allows `is_super_admin()` unconditionally, so the
operation succeeds — but cross-facility deletion is possible for a super-admin without the
facility scoping guard being applied in the application layer.

This is intentional behaviour for super-admins (they are explicitly allowed cross-facility
access throughout the codebase). However, the pattern is worth noting: the code relies
entirely on the RLS `is_super_admin()` check rather than enforcing a facility constraint when
one is available. The `resolveFacility()` helper used by every other action in the file
returns an error when `facility_id` is null — only `deleteAirQualityReport` skips this
check. For consistency, the function should use `resolveFacility()` and separately allow
super-admin cross-facility via a different code path (or document the deliberate bypass).

---

### 🟡 F3 — Input validation: hand-rolled helpers, not Zod (systemic; per W1 in SEC-report)

**Severity:** WARNING (systemic across the project; inherited from SEC-report W1)

`admin/air-quality/actions.ts` uses `nonEmpty`, `asInt`, `asNumber`, `asBool`, and manual
`isSeverity` checks (not Zod). `reports/air-quality/actions.ts` uses `buildInputFromFormData`
(custom sanitizer in `compute.ts`) instead of a Zod schema. The exception is
`importReadingTypes`, which re-validates each imported row via `readingTypeImportSpec.zodRow.safeParse`
— this is the correct pattern and is already in place. Per the rubric, hand-rolled validation
→ 🟡, not 🔴.

---

### 🟡 F4 — Alert recipient configuration not surfaced in Air Quality admin UI

**Severity:** WARNING (UX gap; no security exposure)

There is no "who gets notified" configuration within the Air Quality admin panel. When an
exceedance is detected, `persistAirQuality` fires:
1. A `communication_alerts` insert (if `settings.alerts_enabled`).
2. `dispatchRulesForSubmission({ sourceModule: "air_quality" })`.

Step 2 routes to recipients via `communication_routing_rules.source_module = 'air_quality'`
entries, which are managed only in `/admin/communications` → Routing tab. A facility admin
configuring air quality for the first time will set up thresholds, metrics, and enable alerts
in the Air Quality settings tab — but will not be told that they also need to configure
routing rules in an entirely separate admin module. There is no cross-link or contextual hint
in the Air Quality settings tab pointing to the Communications routing configuration.

**Recommended fix:** Add a note or link in the Settings tab ("To configure who receives alert
notifications, set up a routing rule in [Communications → Routing](../communications?tab=routing)
with source module `air_quality`.").

---

### 🟢 F5 — `warn_min` / `warn_max` evaluation discrepancy: `>=` vs `>` boundary

**Severity:** MINOR

`submission-form.tsx:103` evaluates `alert_max` as `value >= threshold.alert_max`
(inclusive), but `compute.ts:306` evaluates it as `value > threshold.alert_max`
(exclusive: `threshold.alert_max !== null && value > threshold.alert_max`). The client badge
turns red one unit earlier than the server marks an exceedance. For the seeded default
(CO alert_max = 83 ppm), a reading of exactly 83 ppm will show an "Alert" badge on the form
but will NOT be marked `is_exceedance = true` in the database. The boundary case is a single
integer unit and is unlikely to cause a real compliance miss, but the inconsistency is
observable and unexpected.

---

### 🟢 F6 — Missing FK covering indexes on air quality tables

**Severity:** MINOR (inherited from SCHEMA-report §E)

Per SCHEMA-report: `air_quality_equipment.location_id → air_quality_locations`,
`air_quality_readings.threshold_id → air_quality_thresholds`,
`air_quality_reports.equipment_id → air_quality_equipment`,
`air_quality_thresholds.location_id → air_quality_locations` all lack a first-column covering
index. Low impact today (0 rows in most tables), future scaling concern.

---

### ✅ Passing checks (no finding)

- **No `as any`:** `types.ts` and all module files use `Tables<"...">` generic types; no `as
  any` casts found.
- **No tRPC / no AI:** confirmed by SEC-report.
- **Brand tokens:** form uses `bg-card`, `border-border`, `text-muted-foreground`, `rounded-xl`,
  `rounded-lg`, semantic token classes throughout; no hardcoded hex/rgb colors.
- **`facility_spaces` query uses `.eq("facility_id", employeeRow.facility_id)`:** location
  listing is always facility-scoped even before RLS.
- **Compliance rules correctly jurisdiction-filtered at read time:** `[locationSlug]/page.tsx`
  applies `effective_from` / `effective_to` and `jurisdiction` filters server-side before
  passing rules to the form; no client-side trust.
- **Threshold fallback logic correct:** both `compute.ts:lookupThreshold` and
  `submission-form.tsx:pickThreshold` implement location-specific-wins-over-null fallback
  identically, keeping client badge and server evaluation consistent (aside from F5 boundary).
- **Offline idempotency:** `local_id` claim token prevents duplicate submissions.
- **Report immutability:** `air_quality_reports` UPDATE and DELETE are `is_super_admin()` only
  in RLS; the admin panel only adds follow-up notes; the UI comment says "Original reports are
  immutable."
- **`air_quality_followup_notes` no-delete policy:** table has no DELETE policy in RLS →
  notes are effectively append-only, which matches the audit-trail requirement.

---

## Migration-143 drift impact summary (per spec)

Migration 143 (`air_quality_use_facility_spaces`) drops `air_quality_locations`, re-points
`air_quality_equipment.location_id`, `air_quality_reports.location_id`, and
`air_quality_thresholds.location_id` FKs to `facility_spaces`, and drops RLS policies on
`air_quality_locations`. The code (including `types.ts`, `submit.ts`, `page.tsx`, all admin
loaders) was already written post-143. The **live DB is pre-143**.

Drift impact on this module (beyond the SCHEMA-report cross-cutting note):

1. Staff submission **will fail** with FK violation when submitting a report with a
   `facility_spaces` UUID as `location_id`, because the live `air_quality_reports.location_id`
   FK targets `air_quality_locations` (0 rows). The staff page still reaches the form only if
   `facility_spaces` has rows (it does, 0 rows in live DB per SCHEMA-report), so in the seed
   state the form never renders either — the home page returns "Not configured yet" when
   `facility_spaces` is empty.
2. Equipment filtering (`.or("location_id.eq.${location.id},location_id.is.null")`) targets
   `air_quality_equipment.location_id` which still FKs to `air_quality_locations`. Equipment
   with a `location_id` set pre-143 would reference the old table; post-143 code expects
   `facility_spaces` UUIDs. Cross-table join resolution would silently differ.
3. The `air_quality_locations` RLS policies still exist in the live DB (confirmed via MCP),
   meaning the table is accessible but completely bypassed by the application.

**Net:** The Air Quality module is non-functional in the live project until migrations
141–143 are applied. This is a consequence of the migration drift documented in SCHEMA-report,
not a bug introduced by this module's code.

---

## Grade

**82 / 100**

Deductions:
- **-10** 🔴 F1: Live FK mismatch (migrations 141–143 unapplied) renders the module
  non-functional in the live DB. Pre-existing, cross-cutting, not an AIR-module code defect
  — partial deduction rather than full (a pure code audit would score higher).
- **-4** 🟡 F2: `deleteAirQualityReport` skips `resolveFacility()` guard for super-admins
  (minor inconsistency; RLS backstop present).
- **-2** 🟡 F3: Systemic Zod gap (inherited W1 from SEC-report; same partial deduction applied
  to all modules).
- **-2** 🟡 F4: Alert recipient configuration not discoverable from the Air Quality admin UI.

Strengths: threshold engine split into pure compute + server I/O layers (unit-tested), live
RangeBadgePill on entry, full RLS coverage with correct levels (submit vs. admin-admin),
offline queue fully wired with identical severity engine, compliance rules correctly filtered
server-side, immutable report design, no `as any`, correct brand tokens throughout.
