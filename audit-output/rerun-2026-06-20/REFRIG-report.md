# Refrigeration Module Audit — Phase 6 Re-run
**Date:** 2026-06-20  
**Auditor:** Agent-REFRIG  
**Grade: 79 / 100**

---

## Checklist Results

### 1. Compressor count admin-configurable — PASS
Compressors are rows in `refrigeration_equipment`, which the admin UI creates and manages via `EquipmentCreateForm` / `EquipmentRowItem` in `src/app/admin/refrigeration/_components/setup-tab.tsx`. Live DB confirms 3 compressors + 3 brine pumps + 1 condenser defined as equipment rows. No hardcoded count anywhere in the codebase. Admin can add/remove/deactivate without a code change.

### 2. Readings-per-shift configurable — STILL MISSING (gap #1)
There is no `readings_per_shift` column in `refrigeration_settings` (schema confirmed: only `out_of_range_alerts_enabled` + `default_alert_severity`). No enforcement code was found anywhere in the stack (server action, offline replay, or any validation function). The `round_no` field on the submission form is informational only — it is a free integer input with no cap or validation against a configured max. Previous audit finding stands: **this feature does not exist**.

### 3. Required fields present — PASS (DB-driven, configurable)
Live DB confirms the full expected field set is present as DB rows, admin-configurable:
- Compressors (per equipment): Suction pressure (psig, required), Discharge pressure (psig, required), Oil pressure (psig, required), Motor amps (A, optional), Oil temperature (°F, optional)
- Supply/Return: Brine supply temp (°F, required), Brine return temp (°F, required), Brine flow (gpm, optional), Ice surface temp (°F, required)
- Condensers: Head pressure (psig, optional), Water in/out temp (°F, optional)
- Alarms: Gas detection (ppm, required), Leak/odor observed (boolean, required), Ventilation status (select, required)

Field-level `is_required` is stored in `refrigeration_fields.is_required` and enforced both client-side (`validate()` in submission-form.tsx:281) and server-side (RLS blocks non-submit-permission inserts). Admin can toggle `is_required`, change field type, add/remove fields at any time.

### 4. Normal ranges displayed inline (NormalRangeHint) — PASS
`NormalRangeHint` (submission-form.tsx:946–974) renders under every numeric field. It resolves thresholds from `refrigeration_thresholds` (loaded server-side in page.tsx:130–168) via `resolveRange()` (page.tsx:253–268), which matches the same equipment-specific > section-level fallback precedence as the server's `lookupThreshold`. Unit conversion to the active °F/°C display unit is applied. Admin can create/edit/delete thresholds inline per field via the Setup tab's `ThresholdCreateForm` / `ThresholdRowItem`.

### 5. Out-of-range flagged visually on entry — PARTIAL PASS (gap #2)
Critical OOR triggers a corrective-action note textarea (submission-form.tsx:899–916) with a destructive border/background, clearly visible. However, **non-critical OOR (warn, high severity) has no visual indicator on the input itself**. `isCriticalOutOfRange()` (submission-form.tsx:169–187) gates only on `severity === "critical"`. A `warn` or `high` threshold breach shows the `NormalRangeHint` text but no colour change, badge, or warning state on the field. Compare: air-quality uses live `RangeBadgePill` for all severity levels. This is a UX gap, not a data-integrity gap (server validates all OOR via `computeOor` regardless of severity).

### 6. Shift selection works — PASS
Shift is a free-text input (submission-form.tsx:544–553), serialized through `values_json` → `buildInputFromForm` → `persistRefrigeration` → inserted as `refrigeration_reports.shift` (text, nullable). The `reading_at` datetime-local input and `round_no` integer field also work correctly.

### 7. facility_id server-injected; offline via SW; RLS enforced — PASS
- **facility_id**: Always sourced from `employees.facility_id` server-side (actions.ts:35, offline-sync/route.ts:77). Never accepted from the client form.
- **Offline**: `enqueueSubmission()` with `moduleKey: "refrigeration"` → service worker → POST `/api/offline-sync` → `handleRefrigerationReplay()` which runs the same `prepareRows` + `persistRefrigeration` pipeline with critical-note pre-validation before the queue claim (offline-sync/route.ts:339–411). Idempotent via `local_id` claim token.
- **RLS**: All 9 refrigeration tables have RLS policies. INSERT WITH CHECK enforces `facility_id = current_facility_id()` AND `current_employee_module_permission('refrigeration') >= 'submit'` for reports/values/followup_notes/change_log. Config tables (sections/equipment/fields/thresholds/settings) require `has_module_admin_access('refrigeration')`. SELECT scoped to `current_facility_id()`. Cross-tenant isolation is solid.

### 8. History filterable by compressor — STILL NOT FILTERABLE (gap #3)
`HistoryFilters` (src/app/admin/refrigeration/_components/history-filters.tsx) exposes filters for: employee, date from/to, OOR (yes/no), and full-text notes search. There is **no compressor/equipment filter**. The `HistoryTabLoader` (admin/refrigeration/page.tsx:243–436) does not query by `equipment_id` or `section_id`, and there is no server-side join to `refrigeration_report_values` for equipment filtering. Previous audit finding confirmed: **compressor-level filtering is not implemented**.

**Additional gap**: OOR filtering is applied client-side after fetch (page.tsx:339–340 `list.filter(...)`) rather than server-side. For large datasets this means the DB sends all rows and client discards non-matching ones. Functional but unscalable. Not a blocker at current data volumes.

### 9. Zod/validation on submit — PARTIAL PASS (gap #4)
- **Server action** (`actions.ts`): Uses `buildInputFromForm` (pure parser with manual type guards in `compute.ts`) + `prepareRows` + `validateCriticalFollowups`. No Zod schema. Parsing is thorough but imperative — missing the exhaustive error type coverage that Zod would provide.
- **Offline sync** (`offline-sync/route.ts`): The outer envelope is validated with `z.object(...)` (route.ts:36–42). The refrigeration payload itself goes through the same non-Zod `buildRefrigerationInput` parser. Inconsistency: incident path also lacks Zod on the payload, but the outer schema protects the envelope.
- **Client-side**: `validate()` function (submission-form.tsx:281–309) performs required/numeric/critical-note checks. No Zod.
- **Tests** (`compute.test.ts`): 5 describe blocks covering `buildInputFromObject`, `parseComputedSpec`, `evaluateComputed`, `buildComputedRows`, `validateCriticalFollowups` — good pure-logic coverage.

**Gap**: The `values_json` payload shape has no Zod schema; a malformed but non-null payload returns `{ error: "Invalid form data." }` without field-level detail. Low severity since the client constructs the payload, but a Zod schema on `RefrigerationInput` + `SubmittedFieldValue` would harden the boundary.

### 10. Compressor oil pressure / amps / oil temp present — PASS
Confirmed in DB: Discharge pressure (psig, required), Suction pressure (psig, required), Oil pressure (psig, required) per compressor. Motor amps (A) and Oil temperature (°F) present but optional. All DB-driven and admin-configurable.

---

## Gap Summary (severity / file:line)

| # | Gap | Severity | Location |
|---|-----|----------|----------|
| 1 | `readings_per_shift` not in schema, no enforcement | HIGH | `refrigeration_settings` table (no column); `submit.ts` (no check) |
| 2 | warn/high OOR has no visual indicator on the field (only critical triggers note UI) | MEDIUM | `submission-form.tsx:169–187` (`isCriticalOutOfRange` gates on severity=critical only) |
| 3 | History tab not filterable by compressor/equipment | MEDIUM | `history-filters.tsx` (no equipment filter); `admin/refrigeration/page.tsx:271–282` (no equipment_id query param) |
| 4 | No Zod schema on `RefrigerationInput` / `SubmittedFieldValue` payload | LOW | `_lib/compute.ts:72–116` (manual parsing, no Zod); `actions.ts:23` |
| 5 | OOR filter applied client-side post-fetch (unscalable) | LOW | `admin/refrigeration/page.tsx:339–340` (`list.filter(...)` after full DB fetch) |

---

## Scoring Breakdown

| Item | Score | Notes |
|------|-------|-------|
| Compressor count configurable | 10/10 | Fully DB-driven |
| Readings-per-shift | 0/10 | Feature absent, not in schema |
| Required fields present | 10/10 | All expected fields confirmed in DB |
| NormalRangeHint from thresholds | 10/10 | Correct, unit-converted, admin-configurable |
| OOR visual flag | 6/10 | Critical-only; warn/high not highlighted |
| Shift selection | 10/10 | Works correctly |
| facility_id / offline / RLS | 10/10 | All three solid |
| History compressor filter | 0/10 | Still not implemented |
| Zod/validation | 8/10 | Good coverage, no Zod on payload shape |
| Field set configurability | 10/10 | Full CRUD via admin Setup tab |
| Deduction: OOR filter post-fetch | -5 | Scalability concern |
| **Total** | **79/100** | |

---

## Unchanged Findings from Prior Audit

Both prior gaps flagged as MISSING are still unresolved:
1. `readings_per_shift` — absent at DB and code level.
2. History compressor filter — `HistoryFilters` component has no equipment/section dimension; `HistoryTabLoader` does not support it.
