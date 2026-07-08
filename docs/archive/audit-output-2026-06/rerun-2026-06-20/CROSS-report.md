# CROSS-MODULE / PLATFORM HEALTH AUDIT
**Date:** 2026-06-20  
**Auditor:** Agent-CROSS  
**Grade: 74 / 100**

---

## 1. Nav / Shell — DB-Driven via `facility_modules`

**C4 gap: CLOSED (staff nav). PARTIAL gap remains (admin nav).**

### Staff nav — FULLY DB-driven
- `src/lib/modules/facility-modules.ts` — `getEnabledModuleKeys(facilityId)` fetches `facility_modules` table, cached per render via React `cache()`.
- `src/components/app/sidebar-nav.tsx` — `NAV_ITEMS` carries a `moduleKey` per entry; `visibleItems` filters by `enabledModules` prop (null = show all, fail-open). All 10 toggleable modules wired correctly.
- `src/app/dashboard/layout.tsx`, `src/app/reports/layout.tsx`, `src/app/account/layout.tsx` — all call `getEnabledModuleKeys` and forward `enabledModules` to both `AppSidebar` and `AppBottomTabBar`.

### Admin nav — NOT DB-driven (by design, but note gap)
- `src/components/admin/sidebar-nav.tsx` renders `adminNavGroups` from the static `src/components/admin/nav-config.ts`. No `facility_modules` filtering. The admin layout (`src/app/admin/layout.tsx`) does **not** call `getEnabledModuleKeys`.
- Acceptable for admins, but means a super-admin console shows all module admin links regardless of facility toggle state. No RLS hole — the admin pages independently gate access — but UX inconsistency.
  - **Severity: LOW** — `src/components/admin/nav-config.ts` + `src/app/admin/layout.tsx`

### Minor gap: `AppBottomTabBar` hardcodes `/reports/daily`
- `src/components/app/bottom-tab-bar.tsx:55` — "Reports" tab always links to `/reports/daily` regardless of `enabledModules`. If `daily_reports` is disabled for a facility, tapping this tab hits a disabled/inaccessible module.
- **Severity: MEDIUM** — `src/components/app/bottom-tab-bar.tsx:55`

---

## 2. DRY / Consistency — `dbError` Duplication

`src/lib/db-error.ts` was extracted and is correct. However adoption is inconsistent:

- **6 files** import and use `dbError` (admin: communications, air-quality, ice-operations, spaces, incident-reports, refrigeration).
- **28 files** define their own local `function errFmt(err, fallback)` — the identical `return err.message?.trim() || fallback` pattern — instead of importing the shared helper.

Local clone hotspots (non-exhaustive):
| File | Line |
|---|---|
| `src/app/admin/super-admin/actions.ts` | 30 |
| `src/app/admin/scheduling/_lib/admin-core-actions.ts` | 40 |
| `src/app/admin/scheduling/_lib/governance-actions.ts` | 41 |
| `src/app/admin/scheduling/_lib/grid-actions.ts` | 160 |
| `src/app/admin/employees/actions.ts` | 30 |
| `src/app/admin/retention/actions.ts` | 15 |
| `src/app/admin/facility/actions.ts` | 71 |
| `src/app/admin/exports/actions.ts` | 24 |
| `src/app/reports/daily/_lib/submit.ts` | 23 |
| `src/app/reports/incidents/_lib/submit.ts` | 119 |
| `src/app/reports/refrigeration/_lib/submit.ts` | 38 |
| *(22 more across reports + admin)* | — |

Local clones lose the `23505`/`23503` duplicate-key translation that `dbError` provides.  
**Severity: MEDIUM** — `src/lib/db-error.ts` (6 importers vs 28 clones)

---

## 3. `error.tsx` / `loading.tsx` Coverage

### `loading.tsx` — good coverage
Most admin and report modules have `loading.tsx`. No critical gaps found.

### `error.tsx` — thin coverage
Only **4** error boundaries exist in the entire app:
- `src/app/error.tsx` (root catch-all)
- `src/app/reports/error.tsx` (reports group)
- `src/app/admin/error.tsx` (admin group)
- `src/app/admin/scheduling/error.tsx` (scheduling only)

**Missing per-module `error.tsx`** (all other modules fall through to group-level boundary):
- **All 11 report sub-modules** — `accidents`, `air-quality`, `communications`, `daily`, `facility-paperwork`, `ice-depth`, `ice-operations`, `incidents`, `refrigeration`, `scheduling`, `offline-queue`
- **20+ admin sub-modules** — `accident-reports`, `air-quality`, `audit-log`, `communications`, `daily-reports`, `departments`, `employees`, `exports`, `facility`, `facility-documents`, `ice-depth`, `ice-operations`, `incident-reports`, `modules`, `permissions`, `refrigeration`, `retention`, `roles`, `spaces`, `super-admin`

The group-level boundaries are a valid fallback, but an unhandled error in one report module (e.g. refrigeration) will kill the entire `/reports` layout including the navigation shell.  
**Severity: LOW–MEDIUM** — `src/app/reports/*/error.tsx`, `src/app/admin/*/error.tsx`

---

## 4. Dead Dependencies / Dead Code

### `react-big-calendar` — CONFIRMED REMOVED
Not present in `package.json`. ✓

### No other obviously dead dependencies found
All packages in `package.json` (`xlsx`, `libphonenumber-js`, `@react-pdf/renderer`, `zustand`, `posthog-js`, `resend`, etc.) have evident usage in the codebase.

### Stale "not yet in generated types" comments — LOW priority
Several files carry comments saying a table/column "not yet in generated types" but `src/types/database.ts` already includes them:
- `src/app/admin/ice-operations/types.ts:10,18` — `fuel_type_id`, `ice_operations_fuel_types` **are present** in `database.ts`.
- `src/app/admin/accident-reports/types.ts:71` — `accident_witnesses` **is present** in `database.ts`.
- `src/app/reports/accidents/actions.ts:329` — `injured_person_age` **is present** in `database.ts`.

These are zombie comments, not actual type drift. The local type shims in `types.ts` can be replaced with `Tables<"ice_operations_fuel_types">` etc.  
**Severity: LOW** — `src/app/admin/ice-operations/types.ts:10,18` / `src/app/admin/accident-reports/types.ts:71`

---

## 5. Communications Alert Dispatch Consistency

All source modules dispatch to `communication_alerts` table and call `dispatchRulesForSubmission` as expected:

| Module | `communication_alerts` insert | `dispatchRulesForSubmission` |
|---|---|---|
| refrigeration (OOR) | ✓ `submit.ts:349` | ✓ `submit.ts:365` |
| air_quality (exceedance) | ✓ `submit.ts:283` | ✓ `submit.ts:296` |
| accidents (medical) | ✓ `submit.ts:207` | ✓ `submit.ts:222` |
| incidents (ambulance) | ✓ `submit.ts:246` | ✓ `submit.ts:262` |
| ice_operations | ✓ `submit.ts:240` | ✓ `submit.ts:255` |
| ice_depth | ✓ `submit.ts:234` | ✓ `actions.ts:176` |
| daily | — (no alert criteria) | ✓ `submit.ts` |
| scheduling | — (no alert criteria) | — |

Pattern is consistent across modules that have threshold/emergency criteria. No gaps.

### Gap: scheduling `communication_reminders` — unfinished feature
`src/app/admin/communications/_components/reminders-tab.tsx:74` renders a visible **"Scheduling is not yet implemented"** UI string to admin users. Configurations are stored but no cron/scheduler runs them.  
**Severity: MEDIUM** — `src/app/admin/communications/_components/reminders-tab.tsx:74`

---

## 6. Admin Overview Dashboard — Module Count

The `moduleSources` array in `src/app/admin/page.tsx:281–345` covers **9 modules**:
`daily`, `ice_depth`, `ice_operations`, `refrigeration`, `air_quality`, `incidents`, `accidents`, `scheduling`, `communications`.

**Missing: `facility_paperwork`** — there is a `facility_documents` table in the schema (confirmed in `database.ts:2435`) but no corresponding entry in `moduleSources`.

The prior audit's "only 3 of 9" finding is no longer accurate — it is now 9 of 10.  
**Severity: LOW** — `src/app/admin/page.tsx:281` (add `facility_paperwork` source entry)

---

## 7. TODO / FIXME / Placeholder Hotspots

No `TODO:` or `FIXME:` markers found in source. One notable unfinished-feature string exposed to users:

- **"Scheduling is not yet implemented"** — visible admin UI text, `src/app/admin/communications/_components/reminders-tab.tsx:74`
- **Severity: MEDIUM**

---

## Summary

| # | Finding | Severity | File:Line |
|---|---|---|---|
| 1 | Bottom-tab-bar "Reports" tab hardcodes `/reports/daily` ignoring `enabledModules` | MEDIUM | `src/components/app/bottom-tab-bar.tsx:55` |
| 2 | 28 local `errFmt` clones vs 6 `dbError` importers; clones lack 23505/23503 handling | MEDIUM | `src/lib/db-error.ts` (28 sites) |
| 3 | Communications reminders scheduler "not yet implemented" shown to admins | MEDIUM | `src/app/admin/communications/_components/reminders-tab.tsx:74` |
| 4 | `error.tsx` missing for all 11 report sub-modules and 20+ admin sub-modules | LOW–MED | `src/app/reports/*/`, `src/app/admin/*/` |
| 5 | Admin nav not DB-driven (static `nav-config.ts`); shows all modules regardless of facility toggle | LOW | `src/components/admin/nav-config.ts` |
| 6 | Admin dashboard `moduleSources` covers 9/10 modules; `facility_paperwork` absent | LOW | `src/app/admin/page.tsx:281` |
| 7 | Zombie "not yet in generated types" comments in `ice-operations/types.ts`, `accident-reports/types.ts` | LOW | `src/app/admin/ice-operations/types.ts:10,18` |

**C4 gap (DB-driven nav): CLOSED for staff nav. Admin nav is static by design (low risk).**  
**`react-big-calendar`: CONFIRMED removed.**  
**Communications dispatch: CONSISTENT across all applicable modules.**
