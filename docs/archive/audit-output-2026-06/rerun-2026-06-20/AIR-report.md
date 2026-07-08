# Air Quality Module Audit — Phase 7
**Date:** 2026-06-20  
**Auditor:** Agent-AIR  
**Project:** RinkReports 5-6 (`bqbdgwlhbhabsibjgwmk`)  
**Grade: 68 / 100**

---

## 1. Migration-Fix Verification (facility_spaces FK)

**CONFIRMED FUNCTIONAL.** The prior breakage (location FK pointed to the now-deleted `air_quality_locations` table) is fully resolved:

- `air_quality_locations` table: **does not exist** (confirmed via `information_schema.tables` — count = 0).
- `air_quality_reports.location_id` FK: now points to `facility_spaces.id` (live DB FK constraint confirmed).
- Migration `air_quality_use_facility_spaces` is in `supabase_migrations.schema_migrations`.
- Code (both `submit.ts` and `[locationSlug]/page.tsx`) queries `facility_spaces` with `.eq("facility_id", …)` and `.eq("is_active", true)` — correct.
- `types.ts` line 4: `export type AirQualityLocation = Tables<"facility_spaces">` — DB types regenerated.

---

## 2. Escalation Model (Actual vs. Spec)

**Spec called for 4-tier ladder (Correction → Sustained → Critical → Evacuation).  
Actual model: 2-tier severity (warn / high / critical) stored per-threshold row, plus compliance rules displayed as UI text.**

### How it actually works:

| Layer | Mechanism | Location |
|---|---|---|
| Severity levels | `warn`, `high`, `critical` (3-tier, not 4) | `types.ts:13`, `compute.ts:17-27` |
| Live form badge | `evaluateBadge()` → ok / warn / alert via `warn_min/max` and `alert_min/max` | `submission-form.tsx:96-113` |
| Exceedance check | `evaluateReading()` checks only `alert_min` / `alert_max` | `compute.ts:302-313` |
| Severity rollup | `maxSeverityOf()` → highest severity stored in `air_quality_reports.max_severity` | `submit.ts:255` |
| Alert dispatch | `communication_alerts` INSERT (best-effort, fire-and-forget) | `submit.ts:283-293` |
| Rules display | `air_quality_compliance_rules` shown as read-only reference text on form | `submission-form.tsx:271-318` |

**The "4-tier ladder" does not exist as an automated engine.** The sustained-exceedance evacuation rule (`{sustained:[{co:40,minutes:60},…]}`) is stored as raw JSON in a `rule_body` text field with a comment "future engine pass" (`admin/actions.ts:1187`). There is no code that actually evaluates time-series aggregations. This is a display-only placeholder.

**Escalation steps in the data (MN jurisdiction, 5 rules):**
1. Acceptable air quality (baseline)
2. Correction (warn) — text only, no auto-action
3. Evacuation critical — single sample — text only
4. Evacuation critical — sustained — JSON placeholder for future engine
5. Reoccupancy — text only

---

## 3. Checklist Findings

### 3.1 4-Tier Escalation Ladder
- **Grade: 40/100** — The 4-tier ladder is partially modeled as compliance rule text but the automated engine only has 2 effective tiers (warn = badge; alert = exceedance + `communication_alerts`). Sustained/consecutive exceedance logic is not evaluated at all; it exists only as a JSON string in rule_body awaiting a "v2 engine."

### 3.2 Escalation Thresholds Jurisdiction-Aware + Regulatory Floor Clamp
- **Status: PARTIAL — MISSING REGULATORY FLOOR CLAMP**
- `air_quality_settings.default_jurisdiction` feeds `[locationSlug]/page.tsx:195` to filter compliance rules. Jurisdiction is thus display-only; thresholds themselves are not jurisdiction-scoped.
- `air_quality_thresholds` has no `jurisdiction` column. A facility admin can freely set `alert_max` to any value — there is no server-side check that thresholds do not fall below the regulatory minimums (CO > 83 ppm evacuation, NO2 > 2.0 ppm).
- `validateThreshold()` in `admin/actions.ts:610-633` only checks that min ≤ max; it does not clamp against regulatory floors.
- **GAP:** Admin can set `alert_max = 200` for CO (loosening the MN evacuation threshold) with no enforcement.

### 3.3 Escalation Contacts Configurable Per Facility
- **Status: ABSENT as a dedicated AQ field**
- Alert routing goes through `communication_routing_rules` (shared module). The `communication_routing_rules` table has `source_module` and `severity` columns, meaning per-module per-severity routing is possible — but **zero AQ-specific routing rules exist in the live DB**.
- `submit.ts:296-301`: `dispatchRulesForSubmission()` is called unconditionally on every submission (not just exceedances), which routes via the generic dispatch engine; `communication_alerts` is inserted separately only when `settingsRow?.alerts_enabled` is true and there is an exceedance.
- There is no AQ-specific "escalation contacts" UI. Admins must configure routing via the general communications admin, which is not surfaced in `/admin/air-quality`. **Medium gap.**

### 3.4 Reading Entry — DB-Driven Field Types, RangeBadgePill
- **Status: FULLY IMPLEMENTED AND CORRECT**
- Reading types are fully DB-driven: `air_quality_reading_types` columns (`key`, `label`, `unit`, `decimals`, `is_required`, `sort_order`) drive form generation in `[locationSlug]/page.tsx:163-171`.
- Three live reading types on DB: CO (ppm, required), NO2 (ppm, required), CO2 (ppm, optional).
- `RangeBadgePill` correctly renders "Within range" / "Warn" / "Alert" (`submission-form.tsx:1104-1108`) using `evaluateBadge()` which checks both `warn_min/max` and `alert_min/max`.
- **Minor inconsistency:** `evaluateBadge()` uses `>= alert_max` for alert hit (line 104: `value >= threshold.alert_max`), but `evaluateReading()` in `compute.ts:306` uses strict `>` (`value > threshold.alert_max`). This means the form badge shows "Alert" at exactly the boundary, but the server-side persistence does not record an exceedance at that exact boundary value. Off-by-one discrepancy.

### 3.5 Exceedance Events Logged
- **Status: CORRECT**
- `air_quality_readings` stores: `is_exceedance` (boolean), `severity_at_submit` (text), `compliance_min_at_submit`, `compliance_max_at_submit`, `threshold_id`.
- `air_quality_reports` stores: `has_exceedance`, `max_severity`.
- `communication_alerts` insert is done in `submit.ts:283` with `source_module = 'air_quality'`, `source_record_id = reportId`, `severity = maxSeverity`, `requires_acknowledgement = true`.
- Spec column `communication_alerts` is populated correctly. **No gap here.**

### 3.6 facility_id Server-Injected; RLS Enforced
- **Status: CORRECT with one INSERT policy gap**
- `actions.ts` (staff): `facilityId` comes from `employees.facility_id` looked up server-side via `requireUser()` — never trusted from client.
- Admin actions: `resolveFacility()` calls `getCurrentUser()` + checks `profile.facility_id`.
- **RLS policies — all AQ tables** have facility-scoped SELECT/UPDATE/DELETE using `current_facility_id()`. INSERT `with_check` patterns:
  - `air_quality_reports`: requires `current_employee_module_permission('air_quality') >= 'submit'` — correct, tight.
  - `air_quality_readings`: requires `has_module_access('air_quality')` — correct (module access = view+).
  - `air_quality_thresholds/settings/compliance_rules`: require `has_module_admin_access('air_quality')` — correct.
- **MINOR RLS GAP:** `air_quality_change_log` INSERT policy has `with_check = null` (no row-level check). An authenticated user with any facility can insert change log rows for any facility_id. The SELECT policy is correctly facility-scoped, but inserts are unguarded.

### 3.7 Design Compliance (Report Form Pattern)
- **Status: CORRECT** — follows the CLAUDE.md "air-quality" canonical form (not the refrigeration/logbook pattern, as explicitly noted in CLAUDE.md). Uses `RangeBadgePill` with warn/alert, no global °F/°C toggle (readings are ppm, not temperature). Monitoring log sections collapse correctly with `<details>`. Theme tokens used throughout.

---

## 4. Top 5 Gaps (Ranked by Severity)

| # | Severity | Gap | Location |
|---|---|---|---|
| 1 | **HIGH** | No regulatory floor clamp on thresholds — admin can set alert_max above (or even below) the MN statutory limits (CO 83 ppm, NO2 2.0 ppm) with no server validation | `src/app/admin/air-quality/actions.ts:610-633` (`validateThreshold`) |
| 2 | **HIGH** | Sustained/time-series exceedance engine is a JSON placeholder only (`rule_body` stored as raw JSON string); the "Evacuation critical — sustained" rule is never evaluated by code | `src/app/admin/air-quality/actions.ts:1185-1190` + `src/app/reports/air-quality/_lib/compute.ts` (no time-series logic anywhere) |
| 3 | **MEDIUM** | No AQ-specific escalation contact configuration — zero `communication_routing_rules` rows exist for `source_module = 'air_quality'`; admins have no guided UI to set escalation contacts within the AQ admin | Live DB (no rows); `src/app/admin/air-quality/_components/settings-tab.tsx` (no routing config present) |
| 4 | **LOW** | Alert badge boundary inconsistency: form shows "Alert" at `value >= alert_max` (inclusive); server records exceedance only at `value > alert_max` (exclusive) — one-unit discrepancy at exactly the boundary | `src/app/reports/air-quality/_components/submission-form.tsx:103-105` vs `src/app/reports/air-quality/_lib/compute.ts:306` |
| 5 | **LOW** | `air_quality_change_log` INSERT policy has no `with_check` — any authenticated user can write change log rows for any facility_id (SELECT is correctly facility-scoped) | Live DB RLS policy `air_quality_change_log_insert` |

---

## 5. Summary Scorecard

| Checklist Item | Score | Notes |
|---|---|---|
| Escalation ladder (auto-engine) | 30/100 | Text rules present; sustained engine is a JSON stub |
| Regulatory floor clamp | 0/100 | Missing entirely |
| Escalation contacts configurable | 45/100 | Generic routing mechanism exists but zero AQ rules configured, no guided UI |
| Reading entry + RangeBadgePill | 90/100 | DB-driven, correct, minor boundary off-by-one |
| Exceedance logging | 95/100 | All columns populated correctly |
| facility_id injection + RLS | 85/100 | Correct pattern; change_log INSERT gap |
| Design compliance | 95/100 | Matches canonical AQ pattern from CLAUDE.md |
| Migration fix verification | 100/100 | Confirmed functional: FK → facility_spaces, old table gone |

**Overall: 68 / 100**

---

## 6. Positive Findings

- The `air_quality_use_facility_spaces` migration is applied and the FK is clean.
- The severity engine (`compute.ts`) is well-structured, pure, and unit-tested (29 test cases in `compute.test.ts`).
- Offline queue integration is correct: `buildInputFromPayload` mirrors `buildInputFromFormData`, same severity engine runs on replay via `/api/offline-sync`.
- `facility_id` is server-injected from `employees` row on every submission path — no client trust.
- `communication_alerts` is inserted with `requires_acknowledgement: true` on exceedance — correct.
- Admin bulk delete of reports (`deleteAirQualityReport`) is correctly gated by RLS with super_admin for cross-facility.
