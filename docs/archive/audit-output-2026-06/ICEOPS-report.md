# Ice Operations Module Audit — Agent-ICEOPS

- **Module:** Ice Operations (`ice_operations`)
- **Supabase project:** `bqbdgwlhbhabsibjgwmk` (audit-only; no writes)
- **Date:** 2026-06-17
- **Migrations reviewed:** 13, 34, 75 (fuel types/templates), 75 (equipment type rename), 76, 89

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK · ℹ️ INFO

---

## Grade: 77 / 100

---

## Status

**FUNCTIONAL WITH GAPS.** The core submission pipeline — all four operation types, offline SW queue, server-side facility/employee scoping, RLS — is correctly implemented and production-ready. Two categories of defect keep the grade below 90: (1) systemic `as any` escape hatches in the admin actions file (a ground-rule-adjacent issue, noted not punished under the SEC audit's W1 standard, but materially degrading here because the table definitions for newly-added tables were never added to `database.ts`), and (2) the audit checklist's `operation_types` table / `start_time` / `end_time` column requirements are not met by the current architecture (intentional design decision that diverges from the spec, mirrored in migration 13's own header comment).

---

## Strengths (top 3)

1. **Clean four-path submission pipeline with shared validation.** `compute.ts` (pure, unit-tested) + `submit.ts` (I/O) + `offline.ts` (replay) cleanly separate concerns. The same `validateIceOpsInput` + `persistIceOperation` run for both online and offline paths — zero drift between paths. Evidence: `src/app/reports/ice-operations/_lib/compute.ts`, `submit.ts`, `offline.ts`.

2. **facility_id is always server-injected; never client-supplied.** In both the online action (`actions.ts:66` — `facilityId = employeeRow.facility_id`) and the offline replay (`offline.ts:54` — `facilityId` comes from `profile.facility_id` which is injected by `route.ts` before any payload is read), the tenant identifier is resolved from the session, not the posted payload. Rink and equipment are server-validated against `facilityId` before insert (`submit.ts:95-115`). Matches SEC report CHECK 1 PASS.

3. **Admin config is fully DB-driven; no hardcoded dropdown options in form code.** Rinks, equipment, circle-check items, fuel types, and templates are all loaded server-side from their respective tables, filtered by `facility_id` and `is_active`, and passed as props to client components. The four `operation_type` values ARE hardcoded as a CHECK constraint in the DB and mirrored as a TS enum — but this is an explicit, documented design decision (migration 13 header: "Fixed-structure module: the four operation_type values … are hard-coded into the submissions check constraint and cannot be deleted by admins"). There are no magic strings for the DB-driven config items anywhere in the form components.

---

## Gaps (top 3)

### G1 🟡 — `as any` / `AnySupabase` cast on fuel-type and circle-check-template tables (admin actions)
`src/app/admin/ice-operations/actions.ts:29-30` declares `type AnySupabase = any` (suppressed by an explicit eslint-disable comment) and uses `(supabase as AnySupabase).from(...)` for all fuel-type, circle-check-template, and circle-check-template-item operations (lines 268, 327, 886, 928, 958, 981, 1029, 1043, 1090, 1127, 1152, 1186, 1196, 1205, 1255, 1263, 1280, 1313, 1339, 1364). Root cause: `ice_operations_fuel_types`, `ice_operations_circle_check_templates`, and `ice_operations_circle_check_template_items` were added in migration 76 but are NOT in `src/types/database.ts` — confirmed by `admin/types.ts:18-52` which hand-rolls those row types with the comment "Tables added in migration 75; not yet in generated database types." The fix is to regenerate `database.ts` with `pnpm types:write` against a fully-migrated DB (`supabase start`), remove the `AnySupabase` alias, and replace all casts. Until then, any schema change to these tables (column add, type change) is silently invisible to the type checker.

### G2 🟡 — Spec's `start_time`/`end_time` column pair and `≥15-min granularity` picker requirement are NOT implemented
The audit checklist requires: "start/end time picker (≥15-min granularity)". The DB schema has no `start_time` / `end_time` columns on `ice_operations_submissions`. The ice-make form captures `time_in`/`time_out` as `type="time"` HTML inputs with no `step` attribute (the browser default is 60-second granularity, not 15-minute) — these are stored in the `payload` JSONB, not as dedicated timestamp columns. Other operation types capture only `occurred_at` (auto-set to "now" at page load via `nowForDateTimeLocal()`). This is a spec/implementation divergence. Evidence: `ice-make-form.tsx:179,190` (bare `type="time"`, no `step`), migration 13 schema (no `start_time`/`end_time` columns), `compute.ts:30-31` (`time_in`/`time_out` as `string | null` in payload only).

### G3 🟡 — No dedicated `operation_types` or `equipment_types` lookup tables; both are check-constraint enums
The audit checklist requires: "operation_types table exists, admin-configurable per-facility (default types: Ice Cut, Circle Check, Edging, Patch, Blade Change)" and "equipment_types table exists, admin-configurable per-facility (resurfacer names)." Neither table exists. Operation types are a four-value CHECK constraint on `ice_operations_submissions.operation_type` (migration 13) — admin cannot add/remove them. Equipment types (`ice_resurfacer`, `edger`, `blade_set`, `hand_edger`, `other`) are a five-value CHECK constraint on `ice_operations_equipment.equipment_type` (migration 75). Individual equipment units (the resurfacer names) are admin-configurable via `ice_operations_equipment`, but the equipment type classifications are not. "Patch" does not appear in the schema or UI as an operation type at all. This is a fundamental spec/implementation architectural divergence — the module deliberately chose a fixed-enum approach documented in migration 13's own header.

---

## Critical Findings

None. No ground-rule violations found:
- facility_id: always server-injected (PASS)
- No `as any` in _submission_ code paths — the `AnySupabase` alias is limited to the admin config actions, and it is used solely to work around a missing DB type, not to bypass validation or security. Under the SEC report's stated rule ("no `as any`/`@ts-ignore`" is ground-rule GR3), the eslint-disable + AnySupabase alias IS a violation of the letter of GR3. However, the SEC agent confirmed zero matches for whole-word `\bas any\b` in its scan — this pattern uses an intermediate type alias, which the SEC scan missed. This is flagged here as 🟡, not 🔴, because it does not bypass security; it only silences type errors on new tables not yet in `database.ts`.
- No tRPC, no AI/LLM, no photo upload, no client-side Supabase writes.

---

## Checklist

### SCHEMA

| Item | Status | Evidence |
|---|---|---|
| `ice_operations_submissions` table exists | ✅ PASS | Migration 13; live DB (SCHEMA audit: 3 rows, 7 indexes) |
| Submissions store facility_id | ✅ PASS | Migration 13 column `facility_id uuid not null references facilities(id)` |
| Submissions store rink/space id | ✅ PASS | Column `rink_id uuid references ice_operations_rinks(id) on delete set null` |
| Submissions store user_id (employee_id) | ✅ PASS | Column `employee_id uuid references employees(id)` |
| Submissions store start_time | 🔴 NOT FOUND | No `start_time` column. Ice Make stores `time_in`/`time_out` in JSONB payload only |
| Submissions store end_time | 🔴 NOT FOUND | No `end_time` column. Same as above |
| Submissions store operation_type | ✅ PASS | Column `operation_type text not null CHECK (operation_type in ('ice_make','circle_check','edging','blade_change'))` |
| Submissions store equipment_id (FK) | ✅ PASS | Column `equipment_id uuid references ice_operations_equipment(id)` |
| Submissions store notes | ✅ PASS | Column `notes text` |
| `operation_types` table exists, admin-configurable per-facility | 🔴 NOT FOUND | Design uses CHECK constraint enum; no `operation_types` table. "Patch" operation type also absent. |
| Default operation types: Ice Cut, Circle Check, Edging, Patch, Blade Change | 🟡 PARTIAL | Circle Check, Edging, Blade Change exist; "Ice Cut" maps to "Ice Make" (acceptable rename); "Patch" is absent entirely |
| `equipment_types` table exists, admin-configurable per-facility | 🔴 NOT FOUND | Equipment types are a CHECK constraint; no `equipment_types` table. Individual equipment units (resurfacer names) are admin-configurable via `ice_operations_equipment` |
| Equipment types not hardcoded in components | ✅ PASS | Dropdowns populated from DB rows (filtered by `equipment_type` column), not from a hardcoded list; type enum is a DB constraint, not a UI hardcode |

### UI

| Item | Status | Evidence |
|---|---|---|
| Log entry form (all 4 op types) | ✅ PASS | `ice-make-form.tsx`, `circle-check-form.tsx`, `edging-form.tsx`, `blade-change-form.tsx` |
| Start/end time picker (≥15-min granularity) | 🟡 PARTIAL | `ice-make-form.tsx:179,190` — `type="time"` inputs exist but with no `step` attribute (default 60s, not 900s/15min); no start/end picker for other 3 op types |
| Operation type dropdown from DB (not hardcoded enum) | 🟡 PARTIAL | Operation type is NOT a dropdown on the submission form — the user picks the type by navigating to the correct URL tab (`/reports/ice-operations/ice_make`, etc.). The tabs are driven by a hardcoded constant array. This is a tab-nav UI pattern, not a DB-driven dropdown. |
| Equipment dropdown from DB | ✅ PASS | `page.tsx:155-165` — server loads `ice_operations_equipment` filtered by `facility_id`, `is_active`, and `equipment_type` |
| Operations history/log with date filtering | ✅ PASS | Admin page History tab (`history-tab.tsx`, `history-filters.tsx`) with `from`/`to` date params, employee/rink/equipment/op-type/failed-check filters |

### ADMIN

| Item | Status | Evidence |
|---|---|---|
| Add/edit/deactivate operation types | 🔴 NOT FOUND | No admin UI for operation types — they are a fixed DB enum |
| Add/edit/deactivate equipment (individual units) | ✅ PASS | `setup-tab.tsx` / `actions.ts` `createEquipment`, `updateEquipment`, `setEquipmentActive`, `deleteEquipment` |
| Deactivated equipment drops out of staff dropdowns | ✅ PASS | `page.tsx:160` — `.eq("is_active", true)` filter on equipment query |
| Admin config changes appear immediately | ✅ PASS | All admin actions call `revalidatePath("/admin/ice-operations")` |
| Circle-check items: add/edit/deactivate | ✅ PASS | `createCircleCheckItem`, `updateCircleCheckItem`, `setCircleCheckItemActive`, `moveCircleCheckItem` all in `actions.ts` |
| Fuel types: add/edit/deactivate | ✅ PASS | `createFuelType`, `updateFuelType`, `setFuelTypeActive`, `deleteFuelType` in `actions.ts` |
| Circle-check templates: add/edit/deactivate | ✅ PASS | `createCircleCheckTemplate`, `updateCircleCheckTemplate`, `setCircleCheckTemplateActive`, `deleteCircleCheckTemplate` in `actions.ts` |

### ROLE ENFORCEMENT (server-side)

| Item | Status | Evidence |
|---|---|---|
| Staff submission requires `has_module_access('ice_operations')` | ✅ PASS | `page.tsx:128` and `actions.ts:58` both call `currentUserCan(supabase, "ice_operations", "submit")` |
| Admin actions require `requireAdmin()` | ✅ PASS | Every function in `admin/ice-operations/actions.ts` calls `requireAdmin()` before any write |
| facility_id never from client | ✅ PASS | `actions.ts:66` derives `facilityId` from `employeeRow.facility_id` (session-bound) |
| RLS policies on all 7 core tables | ✅ PASS | Migration 13 enables RLS + defines SELECT/INSERT/UPDATE/DELETE policies on all 7 tables |
| Circle-check results/submissions immutable (super_admin only for UPDATE/DELETE) | ✅ PASS | Migration 13 lines 591-600: `using (public.is_super_admin())` for submissions UPDATE/DELETE; same for results |

### OFFLINE (SW queue path)

| Item | Status | Evidence |
|---|---|---|
| Offline submission queued via SW | ✅ PASS | `use-offline-submit.ts` — intercepts `onSubmit`, calls `enqueueSubmission` with `operation_type` discriminator |
| All 4 op types route through offline handler | ✅ PASS | `use-offline-submit.ts:26` — single hook used by all four forms; `operation_type` stamped on payload |
| Offline replay uses same validation + persist | ✅ PASS | `offline.ts` calls `validateIceOpsInput` + `persistIceOperation` — identical to online action |
| `offline-sync` route handler registered | ✅ PASS | `src/app/api/offline-sync/route.ts:173` — `if (moduleKey === "ice_operations")` dispatches to `handleIceOperationsReplay` |
| facility_id not from client payload in offline path | ✅ PASS | `offline.ts:52` — `facilityId` comes from caller (`route.ts` injects `profile.facility_id`) |

---

## Files Needing Work

| File | Issue |
|---|---|
| `src/app/admin/ice-operations/actions.ts:29-30` | Remove `AnySupabase` alias; regenerate `database.ts` first |
| `src/app/reports/ice-operations/[operationType]/_components/ice-make-form.tsx:179,190` | Add `step="900"` to time inputs for 15-min granularity |
| `src/types/database.ts` | Regenerate with `pnpm types:write` to include mig-76 tables (`ice_operations_fuel_types`, `ice_operations_circle_check_templates`, `ice_operations_circle_check_template_items`) — blocked on the mig-141/142/143 live-DB lag identified in the SCHEMA report |
| `supabase/migrations/00000000000013_ice_operations_schema.sql` | Spec gap only — no code change needed; the fixed-enum design is intentional and documented. Note the "Patch" operation type divergence in any spec update. |
