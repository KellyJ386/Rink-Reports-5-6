# Ice Operations Module Audit — Phase 5
**Date:** 2026-06-20  
**Auditor:** Agent-ICEOPS  
**Grade: 72 / 100**

---

## 1. Scope

Files audited:
- `src/app/reports/ice-operations/**` (page, actions, _lib, [operationType]/*)
- `src/app/admin/ice-operations/**` (page, actions, types, _components/*)
- Live DB: project `bqbdgwlhbhabsibjgwmk` — RLS policies + schema for all `ice_operations_*` tables

---

## 2. Checklist Results

### 2.1 Operation types & equipment types — hardcoded or configurable?

**Operation types: HARDCODED. Not admin-configurable.**

`operation_type` is a DB-level `CHECK` constraint:

```sql
CHECK (operation_type = ANY (ARRAY['ice_make','circle_check','edging','blade_change']))
```

The four types are fixed in TS enums in both `src/app/reports/ice-operations/types.ts` (lines 12–31) and `src/app/admin/ice-operations/types.ts` (lines 64–80). There is no admin UI to add or remove operation types. The spec item "Ice Cut, Patch, Blade Change configurable" is **not met** — only Blade Change maps (as `blade_change`); the others are immutable enum values, and "Patch" is absent entirely.

**Equipment types: HARDCODED. Not admin-configurable.**

Five fixed types (`ice_resurfacer`, `edger`, `blade_set`, `hand_edger`, `other`) are defined as TS constants (`src/app/admin/ice-operations/types.ts` lines 86–107). No admin table; validated server-side via `isEquipmentType()`. The spec mention of configurable operation/equipment types is **not implemented**.

**Fuel types: FULLY ADMIN-CONFIGURABLE.** `ice_operations_fuel_types` is a per-facility table with CRUD in `actions.ts` (lines 849–987). Correct.

**Rinks: FULLY ADMIN-CONFIGURABLE.** `ice_operations_rinks` CRUD present. Correct.

---

### 2.2 Tab structure — 4 tabs (Log Entry, History, Equipment, Reports)?

**Finding: PARTIAL MISMATCH vs spec.**

Admin side (`/admin/ice-operations`) has **3 tabs**: `Setup`, `History`, `Settings`  
(defined at `src/app/admin/ice-operations/types.ts` lines 121–132).

- `Setup` covers rinks + equipment + circle-check items + fuel types + templates (multi-section).
- `History` covers submission review + follow-up notes.
- `Settings` covers temperature unit + alert configuration.
- There is **no separate "Reports" tab** and **no standalone "Equipment" tab** (equipment lives inside Setup). A dedicated "Log Entry" tab does not appear on the admin side at all — it lives on the staff side as a per-operation-type page.

Staff side (`/reports/ice-operations/[operationType]`) has **4 operation tabs** rendered via `TabNav`: Ice Make, Circle Check, Edging, Blade Change (matching `OPERATION_TAB_ORDER`). This is the Log Entry equivalent. No History or Reports tab is exposed to staff.

**Verdict:** Spec's 4-tab structure (Log Entry / History / Equipment / Reports) does not precisely match implementation; closest reading is that staff gets Log Entry tabs and admin gets a 3-tab console. The admin "Reports" export is handled by `ExportButton` in the page header, not a dedicated tab. **Minor gap** — functional intent preserved but structure differs from spec.

---

### 2.3 Operator assignment links to authed user; auto-timestamps

**PASS.**

In `src/app/reports/ice-operations/actions.ts` (line 36–45), `performSubmit` calls `requireUser()`, looks up the matching `employees` row via `user_id = current.authUser.id`, then passes `employeeRow.id` as `employeeId` into `persistIceOperation`. The submission shell insert (`src/app/reports/ice-operations/_lib/submit.ts` lines 119–134) writes:

```ts
employee_id: employeeId,
occurred_at: input.occurred_at,
submitted_at: new Date().toISOString(),
```

`facility_id` is taken from `employeeRow.facility_id` — never from the form. Timestamps are server-generated. Staff cannot impersonate another employee on normal submission. The `blade_change` form passes `replaced_by_employee_id` from the form's employee picker — that is a separate "who replaced the blade" field, not the submitting operator.

---

### 2.4 Multi-rink selection

**PASS (with caveat).**

Admin can create multiple rinks in `ice_operations_rinks`. Staff form (`[operationType]/page.tsx` lines 140–153) loads all active rinks for the facility filtered by `is_active = true`. The UI presents a dropdown for rink selection on `ice_make` only (where `OPERATION_REQUIRES_RINK` = true). `circle_check`, `edging`, and `blade_change` do not require a rink and the rink picker is hidden via `OPERATION_SHOWS_RINK` (`types.ts` lines 81–87).

**Caveat:** The spec may expect rink selection on circle_check or edging; currently only ice_make is rink-scoped. No multi-select; only one rink per submission. Functionally correct within current spec constraints.

---

### 2.5 facility_id server-injected; offline via SW; RLS enforced

**facility_id: PASS.** Injected from the authenticated employee's `facility_id` in both online (`actions.ts` line 66) and offline (`offline.ts` lines via `persistIceOperation`) paths. Never trusted from form input.

**Offline via SW: PASS.** `useOfflineSubmit` hook (`[operationType]/_components/use-offline-submit.ts`) calls `enqueueSubmission()` from `@/lib/offline/use-sync-queue` which posts to the service worker. The replay handler (`_lib/offline.ts`) is correctly wired; it calls `buildInputFromPayload` → `validateIceOpsInput` → `persistIceOperation`, landing the same rows as online. No Dexie.

**RLS: PASS.** All `ice_operations_*` tables have RLS enabled (confirmed via `list_tables`). Policies are:
- SELECT: `has_module_access('ice_operations')` for all facility-scoped tables.
- INSERT/UPDATE/DELETE on config tables (rinks, equipment, items, templates, fuel types, settings): `has_module_admin_access('ice_operations')`.
- Submissions INSERT: `current_employee_module_permission('ice_operations') >= 'submit'`.
- Submissions UPDATE/DELETE: `is_super_admin()` only — immutable once submitted.
- `ice_operation_change_log` SELECT: `facility_id = current_facility_id()` (no `has_module_access` gating — minor: any authenticated employee in facility can read the change log regardless of module access).

---

### 2.6 Design compliance

**PARTIAL.**

The staff-side form shell (`[operationType]/page.tsx` line 345) uses `<Card className="border-l-4 border-l-module-ice-ops">` which presupposes a CSS token `--color-module-ice-ops` maps to `#4DFF00`. This needs to be verified in `globals.css`.

The `IceOpsShell` component (`ice-ops-shell.tsx`) uses `PageHeader variant="display" module="ice-ops"` with a `band` prop — matching the canonical refrigeration logbook pattern. Recent activity uses `SectionCard` + `DataList` + `Badge`. No hardcoded colors detected; all use semantic tokens (`text-muted-foreground`, `bg-card`, etc.).

No temperature toggle (`UnitToggle`) is present on ice-make — the spec does not require it for ice operations (temperature unit is a per-facility setting in `ice_operations_settings.temperature_unit`, not a per-submission UI toggle). This is acceptable per the CLAUDE.md pattern notes. The admin history tab correctly reads `settings.temperature_unit` to display temperatures.

**Negative:** The admin page has no dedicated "Reports" tab with a styled export section — exports are a header button only.

---

### 2.7 AnySupabase escape hatch — CONFIRMED PRESENT

**`type AnySupabase = any` is declared at line 31** of `src/app/admin/ice-operations/actions.ts` with the suppression comment `// eslint-disable-next-line @typescript-eslint/no-explicit-any`.

It is cast **20 times** across the file on `ice_operations_fuel_types`, `ice_operations_circle_check_templates`, and `ice_operations_circle_check_template_items` operations. Root cause: `FuelTypeRow`, `CircleCheckTemplateRow`, and `CircleCheckTemplateItemRow` are manually declared in `types.ts` (lines 19–52) because they were added in migration 75 and the generated `src/types/database.ts` **did not include them at that time**. However, a `grep` of `src/types/database.ts` confirms `ice_operations_fuel_types`, `ice_operations_circle_check_templates`, and `ice_operations_circle_check_template_items` ARE now present in the generated types file. The `AnySupabase` casts are therefore stale — the types exist but the actions file was never updated to use them. The `pnpm types:check` CI step should have caught this but the CLAUDE.md says CI only enforces freshness on migration PRs; this may have landed on a separate PR.

---

## 3. Findings — Top 5 by Severity

### GAP-1 | HIGH | `AnySupabase` type escape hatch — stale cast, 20 occurrences
**File:** `src/app/admin/ice-operations/actions.ts` lines 31, 253, 312, 871, 913, 943, 966, 1014, 1028, 1075, 1112, 1137, 1171, 1181, 1190, 1240, 1248, 1265, 1298, 1324, 1349

**Issue:** `type AnySupabase = any` was added when migration 75 tables (`ice_operations_fuel_types`, `ice_operations_circle_check_templates`, `ice_operations_circle_check_template_items`) were not yet in generated types. Those tables are now in `src/types/database.ts`. The casts are stale — they suppress TypeScript's ability to catch schema mismatches on 20 call sites. Any future column rename or type change in those tables will silently compile. CLAUDE.md explicitly states the `as any` pattern is retired (last paragraph of "Database / migrations").

**Fix:** Remove `AnySupabase`, update `EquipmentRow` to remove the `fuel_type_id?` manual extension, and use `createClient<Database>()` throughout. Run `pnpm types:check`.

---

### GAP-2 | HIGH | Operation types and equipment types are hardcoded, not admin-configurable — spec gap
**File:** `src/app/reports/ice-operations/types.ts` lines 12–31, 67–72; `src/app/admin/ice-operations/types.ts` lines 64–107; DB: `ice_operations_submissions` CHECK constraint

**Issue:** The spec calls for configurable operation types ("Ice Cut, Patch, Blade Change configurable"). The implementation uses a fixed `CHECK (operation_type = ANY(...))` DB constraint and hardcoded TS enums. There is no "Patch" operation type at all. Changing the allowed types requires a DB migration and code change; facility admins cannot self-serve. Equipment types are similarly fixed.

**Severity:** HIGH — spec requirement unmet; adding new operation types requires engineering involvement.

---

### GAP-3 | MEDIUM | Admin tab structure does not match spec (3 tabs vs 4; no standalone "Reports" tab)
**File:** `src/app/admin/ice-operations/types.ts` lines 121–132; `src/app/admin/ice-operations/page.tsx` lines 112–119

**Issue:** Spec expects 4 tabs: Log Entry, History, Equipment, Reports. Admin console has 3 (`setup`, `history`, `settings`). Equipment is a section within Setup, not a standalone tab. There is no Reports tab; CSV/PDF export is a header-level `ExportButton`, not a module tab. Minor usability gap — admins must navigate Setup to reach Equipment; no dedicated reporting view.

---

### GAP-4 | MEDIUM | `ice_operation_change_log` SELECT policy lacks `has_module_access` gate
**DB:** `ice_operation_change_log` SELECT policy: `(is_super_admin() OR (facility_id = current_facility_id()))`

**Issue:** Any authenticated user whose facility matches can SELECT from `ice_operation_change_log`, even if they have no `ice_operations` module access. All other `ice_operations_*` tables gate SELECT on `has_module_access('ice_operations')`. The change log likely records admin edits to submissions and should be comparably restricted. This is an information-disclosure risk: a user with module access disabled could still read the audit trail.

---

### GAP-5 | LOW | Multi-rink selection scoped to `ice_make` only; circle_check/edging have no rink association
**File:** `src/app/reports/ice-operations/types.ts` lines 74–87 (`OPERATION_REQUIRES_RINK`, `OPERATION_SHOWS_RINK`)

**Issue:** `OPERATION_REQUIRES_RINK` is `true` only for `ice_make`; `OPERATION_SHOWS_RINK` is identically scoped. Circle checks and edging runs have no rink recorded in the submission. This means the admin History tab cannot filter circle_check or edging records by rink (the filter exists in the UI but will return no results for those operation types since `rink_id` is always NULL). If multi-rink facilities want to track which rink received each circle check or edging pass, this is a gap.

---

## 4. Positive Findings

- **Offline pathway is complete and correct:** all four operation types share one `handleIceOperationsReplay` path; `local_id` deduplication via `onConflict: "local_id", ignoreDuplicates: true` prevents double-submit.
- **RLS coverage is comprehensive** on all core tables with correct admin vs. submit separation.
- **Submissions are immutable** post-insert (UPDATE/DELETE require `is_super_admin()`); follow-up notes are append-only; the original submission cannot be edited by staff.
- **facility_id is never trusted from the client** — always resolved from the authed user's employee row server-side.
- **Circle-check alert integration** is implemented and best-effort (alert failure does not roll back the submission).
- **Import/bulk-upload** for circle-check items and template items is implemented with server-side Zod re-validation and a cap (50 items total).
- **Seed defaults** action (`seedDefaultIceOperationsConfig`) provides an idempotent first-run bootstrap.
- **Generated types** for migration-75 tables (`fuel_types`, `circle_check_templates`, `circle_check_template_items`) are now present in `src/types/database.ts` — the `AnySupabase` casts are stale, not necessary.

---

## 5. Grade Breakdown

| Area | Max | Score | Notes |
|------|-----|-------|-------|
| Operation/Equipment configurability | 15 | 5 | Hardcoded; spec requires configurable |
| Admin tab structure | 10 | 6 | 3 tabs not 4; no Reports tab |
| Operator assignment + timestamps | 10 | 10 | Full pass |
| Multi-rink selection | 10 | 7 | Works for ice_make; absent for other ops |
| facility_id injection | 10 | 10 | Full pass |
| Offline / SW | 10 | 10 | Full pass |
| RLS | 15 | 12 | change_log SELECT gap |
| Design compliance | 10 | 8 | Shell pattern correct; no Reports tab view |
| AnySupabase / type hygiene | 10 | 4 | 20 stale casts, retired pattern |
| **Total** | **100** | **72** | |
