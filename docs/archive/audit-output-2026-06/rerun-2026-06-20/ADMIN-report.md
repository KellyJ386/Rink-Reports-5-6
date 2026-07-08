# Admin Control Center Audit (Re-run) — Agent-ADMIN

- **Repo:** /home/user/Rink-Reports-5-6
- **Supabase project (MCP):** `bqbdgwlhbhabsibjgwmk` (live; single-facility seed)
- **Mode:** AUDIT-ONLY. No code/schema writes.
- **Date:** 2026-06-20.
- **Roles (actual, graded against):** super_admin(0) → admin(1) → manager(2) → staff(3) + driver(4). No 5-tier spec model; no org_admin. Graded against actual.

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK

---

## GRADE: 91 / 100

## Status: PRODUCTION-READY. Both prior criticals (C1/C2) verified closed; the prior audit's three big config gaps (W1 facility_modules, W2 nav-hide, W3 dashboard windows) are all remediated. Remaining gaps are minor config-surface omissions.

Since the 6/17 audit (graded 82) the Admin Control Center has materially improved: privilege-escalation guards are in place and unit-test-friendly, a real per-facility `facility_modules` toggle exists with nav-hiding wired through the staff shell, and the system-health dashboard uses correct 7d/30d windows plus an offline-sync widget. The remaining deductions are: no facility logo/branding config surface, "readings-per-shift" is not an explicit configurable field, ice-operations operation/equipment types remain hardcoded enums, and incident_types lacks an admin CRUD UI.

---

## C1 / C2 VERIFICATION (prior criticals) — BOTH CONFIRMED CLOSED

### ✅ C1 — Intra-facility role-assignment escalation — CLOSED
- Pure guard logic in `src/lib/permissions/role-assignment-core.ts` (`canAssignRoleLevel`, `ADMIN_TIER_LEVEL=1`). Non-super callers may only assign roles strictly *below* their floor; unknown level → deny; missing employee-row floor falls back to ADMIN_TIER (so a perm-only admin still can't mint admin/super_admin). Lines 28-37.
- Server wrapper `assertCanAssignRole` / `callerHierarchyFloor` (`role-assignment.ts:23-79`) resolves the caller's **facility-scoped** floor (lowest active employee role in the *target* facility).
- Wired into **all** assignment paths:
  - `createEmployee` — `src/app/admin/employees/actions.ts:217-223`
  - `updateEmployee` — `src/app/admin/employees/actions.ts:335-341`
  - bulk add — `src/app/admin/employees/bulk/actions.ts:140, 168`
  - role create/update — `src/app/admin/roles/actions.ts:143, 240` (via `callerHierarchyFloor`)
- Verdict: a facility admin can no longer mint another facility admin. Closed.

### ✅ C2 — Permission-matrix self-grant of admin/admin — CLOSED
- `src/app/admin/permissions/user-permission-actions.ts` adds `isAdminConsoleGrant(module,action)` (`module==='admin' && action==='admin'`, :44-46) and enforces it in **all three** write paths:
  - `upsertUserPermission` — :69-78 (facility-scope check + admin/admin block for non-super)
  - `applyPresetToUser` — :117-132 (preset can't flip admin/admin on for non-super)
  - `bulkImportUserPermissionsCsv` — :224-235 (per-row facility-scope + admin/admin block, in app code, not just RLS)
- CSV facility_id is now re-validated against the caller's facility in app code (:225-229) — the prior gap.
- Verdict: closed app-side; RLS still backstops cross-facility.

---

## 2A — Facility config

| Item | Result | Evidence |
|---|---|---|
| Facility name / slug / timezone / address / contact | ✅ | `facility/_components/facility-form.tsx` (name :168, slug :185, timezone :212 from `TIMEZONE_OPTIONS`, address/city/state/zip/phone/email). DB cols confirmed: `facilities(name,slug,timezone,address,city,state,zip_code,phone,email,settings,is_active)`. |
| **Logo / branding (colors, theme)** | 🟡 **NOT FOUND** | No logo/branding/primary_color field anywhere in `admin/facility/`. `facilities.settings` jsonb exists but is **not** edited by the facility form/actions (grep of facility/actions.ts,types.ts = no settings usage). Logo handling exists only in `admin/exports` (PDF header). Gap. |
| Ice sheet count | ✅ (indirect) | No numeric "sheet count" field; rinks are rows in `ice_operations_rinks`/`ice_depth_rinks`/`facility_spaces` (22 spaces), editable in their own admin pages. Count = row count, not a single setting. |
| Compressor count | ✅ | Row count of `refrigeration_equipment` (7 rows), editable via `admin/refrigeration` sections/equipment CRUD. |
| **Readings-per-shift** | 🟡 **NOT AN EXPLICIT FIELD** | No `readings_per_shift` column anywhere (grep empty). Refrigeration cadence is field/section-driven (`refrigeration_fields`/`_sections`), not a configurable numeric "N readings per shift." Spec item unmet as a discrete setting. |
| Daily Report facility spaces / tabs | ✅ | `daily_report_areas`/`_templates`/`_checklist_items` fully CRUD via `admin/daily-reports/actions.ts` (createArea :76-117, templates :252-285, items :385+). DB-driven, no deploy. |
| facilities.settings jsonb editable | 🟢 | Column exists but no admin surface edits it (see logo/branding row). |

## 2B — User management

| Item | Result | Evidence |
|---|---|---|
| Invite flow end-to-end | ✅ | `createEmployee` → `inviteEmployeeByEmail` (`src/lib/auth/invite-employee.ts`): GoTrue `inviteUserByEmail` w/ redirect to `/callback?next=/update-password`, dedupe on existing auth user (:66-96), `users` profile upsert (:104), `employees.user_id` link (:120-124), then `seedRolePermissionDefaults` (actions.ts:284). Best-effort warnings, no rollback. Row "Invite" re-send path noted. |
| Role assignment restricted by tier | ✅ | C1 fix above — verified across create/update/bulk/roles. |
| Deactivation removes access, preserves records | ✅ | `deactivateEmployee` sets `is_active=false, deactivated_at=now()` (actions.ts:451); `reactivateEmployee` restores (:487). Hard `deleteEmployee` is separate/super-admin (:504). `requireAdmin` denies deactivated accounts first. |

## 2C — Per-module config admin UI (DB-driven?)

| Module | Result | Evidence |
|---|---|---|
| Daily (tabs/fields) | ✅ RUNTIME-DB | `admin/daily-reports/actions.ts` CRUD on areas/templates/checklist_items. |
| Ice Operations | 🟡 PARTIAL — **operation & equipment TYPES hardcoded** | Rinks/circle-check templates/fuel types are DB-CRUD (`admin/ice-operations/actions.ts:81+`). But `operation_type` ("ice_make","circle_check","edging","blade_change") and `equipment_type` are hardcoded TS enums in `src/app/admin/ice-operations/types.ts:64-107` (`isOperationType` validation). Not a CHECK constraint, but adding/renaming a type **requires a deploy**. FLAGGED per task. |
| Refrigeration | ✅ RUNTIME-DB (compressor count, ranges) | `refrigeration_sections`/`_equipment`/`_fields`/`_thresholds` CRUD via `admin/refrigeration/actions.ts`; normal ranges via thresholds. **Readings-per-shift = no discrete setting** (see 2A). `refrigeration_settings` holds only `out_of_range_alerts_enabled`, `default_alert_severity`. |
| Air Quality | ✅ RUNTIME-DB | `air_quality_equipment`/`_reading_types`/`_thresholds`/`_compliance_rules` CRUD via `admin/air-quality/actions.ts`; jurisdiction thresholds + escalation contacts in compliance_rules. |
| Scheduling | ✅ RUNTIME-DB | Job areas + cert reqs via `admin/scheduling/job-areas/actions.ts:87-323` (`employee_job_areas`, `job_area_certification_requirements`); max weekly hours in `schedule_settings` + per-employee `employees.max_weekly_hours`. |
| Incident | 🟡 PARTIAL — **incident_types no admin CRUD UI** | Severity levels + activities are full CRUD (`admin/incident-reports/actions.ts:60-687`). `incident_types` table exists (5 rows, facility-scoped) but **no create/update UI** in `_components/` — read-only from admin; changing types needs DB/migration. Body regions configurable via `accident_dropdowns` (accident-reports admin). |
| Ice Depth | ✅ RUNTIME-DB | `ice_depth_layouts`/`_points`/`_rinks` CRUD via `admin/ice-depth/actions.ts:95+`; measurement points fully configurable. |
| **Facility module enable/disable** | ✅ **RESOLVED (was W1)** | `facility_modules` table + RLS + `seed_default_facility_modules` (migration `00000000000144_facility_modules.sql`); admin UI `admin/modules/page.tsx` + `module-toggles.tsx`; write action `admin/modules/actions.ts:31-69` (facility resolved server-side, RLS `is_facility_admin`). **Nav-hiding wired**: `sidebar-nav.tsx:27-62` filters `NAV_ITEMS` by `enabledModules` (fail-open). `getEnabledModuleKeys` cached, `lib/modules/facility-modules.ts:23-34`. Toggle revalidates staff layouts (no re-login). 10 facility_modules rows seeded (MCP). |

## 2D — Audit log

| Item | Result | Evidence |
|---|---|---|
| Actions logged (actor/action/timestamp/record) | ✅ | `audit_logs` = **559 rows** (MCP). DB triggers (migrations 41/46) + app-side `logAudit()`. Columns include actor_employee_id, action, entity_type, entity_id, created_at, facility_id. |
| Viewable by super_admin/admin | ✅ | `admin/audit-log/page.tsx` gated by `requireAdmin` (:65); facility-scoped (`.eq("facility_id", facilityId)` :114, super_admin sees all), filters by action/entity/actor/date/q, detail view, 300-row cap. Search input sanitized vs PostgREST DSL injection (:123). |

---

## TOP GAPS (this re-run)

1. 🟡 **Facility logo/branding not configurable** — no logo/color/theme field in `admin/facility/`; `facilities.settings` jsonb unused by the form. Spec "branding" unmet. (`facility-form.tsx`, `facility/actions.ts`)
2. 🟡 **Ice Operations operation/equipment types hardcoded** — TS enums in `src/app/admin/ice-operations/types.ts:64-107`; adding a type needs a deploy. (Carried over; the only non-DB-driven report config left.)
3. 🟡 **incident_types has no admin CRUD UI** — table is facility-scoped but read-only from admin; severity/activities are editable, types are not. (`admin/incident-reports/_components/`)
4. 🟡 **"Readings-per-shift" is not a discrete configurable setting** — refrigeration cadence is field-driven; `refrigeration_settings` has no per-shift count. Spec item only partially satisfied.
5. 🟢 **`facilities.settings` jsonb is an unused config surface** — present in schema but not surfaced by any admin UI; could absorb branding/per-shift settings.

(Inherited 🟡: admin CRUD largely hand-rolled validation rather than Zod — platform-wide, per prior SEC W1.)

---

## Files for future (non-audit) PRs
1. `admin/facility/_components/facility-form.tsx` + `facility/actions.ts` — add logo upload + branding/timezone-display fields (use `facilities.settings` jsonb or new columns).
2. `src/app/admin/ice-operations/types.ts` — move operation/equipment type set to a per-facility table for runtime config.
3. `admin/incident-reports/_components/` — add incident_types CRUD UI (mirror severity-levels editor).
4. `refrigeration_settings` + `admin/refrigeration` — add explicit readings-per-shift setting if the spec requires a discrete cadence value.
