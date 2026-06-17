# RinkReports 5-6 — Cross-Module Integration Audit (Agent-CROSS)

- **Supabase project audited:** `bqbdgwlhbhabsibjgwmk`
- **Mode:** AUDIT-ONLY. No code/migration/schema writes were performed. Only this report + the DONE marker were written.
- **Date:** 2026-06-17
- **Prior audit context absorbed:** SCHEMA-report, SEC-report, BUILD-report, OFFLINE-report (all in `audit-output/`).

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 PASSING / minor

---

## Cross-Module Health Score: **74 / 100**

Score breakdown:

| Domain | Max | Score | Notes |
|---|---|---|---|
| CHECK 1 — Shared infra consistency | 25 | 20 | Supabase clients, auth guards, permission check all shared and consistent; `dbError` duplicated ×35, no shared Zod layer |
| CHECK 2 — Navigation | 20 | 14 | Active highlighting and mobile nav present; nav is hardcoded (not DB-driven per module access); brand-green split between legacy ramp + new #4DFF00 |
| CHECK 3 — Cross-module data relationships | 20 | 14 | Daily tabs, schedule job-areas, admin overview all wired; incident→ice-ops is activity-typed not FK-linked; `ice_operations_submissions` missing audit trigger |
| CHECK 4 — Type conflicts | 20 | 18 | Shared DB types used everywhere; no auth bypass found; `dbError` naming fragmentation only cosmetic |
| CHECK 5 — Loading/error/empty states | 15 | 8 | All 9 report modules have `loading.tsx`; `facility-paperwork` missing loading; all report modules rely on single root `error.tsx` (no per-module boundaries); per-module error.tsx is only present in admin/scheduling |

---

## Executive Summary

The codebase has a **solid shared infrastructure spine**: one Supabase client factory per context (server/client/session/admin), one auth library (`@/lib/auth`), and one permission-check RPC (`currentUserCan`) used uniformly across all 9 report modules and their offline replay paths. The `dbError` helper and Zod validation are not shared (35 private copies vs. 0 shared exports), which is an ergonomic debt rather than a safety risk. Navigation is fully hardcoded — modules are always shown regardless of facility-level permission grants (no `facility_modules`-driven visibility). The admin overview page aggregates three modules (daily, incidents, accidents) but not ice-depth, ice-operations, refrigeration, or air-quality. The audit trail is strong but has one gap: `ice_operations_submissions` has no `audit_row_change` trigger. Error boundaries are present at the section level (`/reports/error.tsx`, `/admin/error.tsx`) but absent at the per-module level, which is adequate but less precise for UX recovery.

---

## CHECK 1 — Shared Infrastructure Consistency

### 1a. Supabase client factory usage — 🟢 PASSING

All server components, route handlers, and server actions import from exactly one of three official factories:

| Factory | Path | Purpose | Evidence |
|---|---|---|---|
| `createClient` | `@/lib/supabase/server` | Server components, route handlers, actions | Every `reports/*/page.tsx`, `admin/*/page.tsx`, all `actions.ts` |
| `createClient` | `@/lib/supabase/client` | `"use client"` components only | `src/lib/supabase/client.ts` — `createBrowserClient` |
| `updateSession` | `@/lib/supabase/session` | Called only from `src/proxy.ts` | CLAUDE.md requirement satisfied |

Zero server actions or pages use `createBrowserClient`. All are typed with `Database` generic from `src/types/database.ts`. No raw `@supabase/supabase-js` imports outside the three sanctioned factories were found.

### 1b. Auth retrieval pattern — 🟢 PASSING

All protected pages use the shared `@/lib/auth` guard layer:

- Staff report pages: `requireUser()` — verified across all 9 report modules (`daily`, `ice-depth`, `ice-operations`, `refrigeration`, `air-quality`, `incidents`, `accidents`, `communications`, `scheduling`, `facility-paperwork`).
- Admin pages: `requireAdmin()` — verified across 15+ admin module pages.
- `getCurrentUser()` wrapped in React `cache()` — shared DB round-trip across layout + page.
- `getIsAdmin()` drives the "Admin Center" link visibility in the staff sidebar.

No module was found calling `supabase.auth.getUser()` directly from page-level code, bypassing the shared guard. The one exception (`src/app/reports/ice-operations/page.tsx`) is a simple redirect shim with no data access.

### 1c. facility_id injection — 🟢 PASSING

Every write action derives `facility_id` server-side from the authenticated `employees` row (confirmed by SEC-report CHECK 1 and spot-checked across refrigeration/incidents/air-quality/accidents/communications actions). Pattern is consistent:

```typescript
const { data: employeeRow } = await supabase
  .from("employees")
  .select("id, facility_id")
  .eq("user_id", current.authUser.id)
  .eq("is_active", true)
  .limit(1)
  .maybeSingle()
// then: facilityId = employeeRow.facility_id
```

No module reads `facility_id` from form payload or URL params for writes.

### 1d. Shared Zod/types for common fields — 🟡 WARNING

All modules import DB row types from the single generated file `src/types/database.ts` via the `Tables<"table_name">` helper. **This is the correct pattern and is universally applied** — no module defines its own `IncidentReport` type from scratch; they all re-export from `Tables<"incident_reports">`.

**However**, there is no shared Zod schema layer for common fields across modules. Each module's `actions.ts` / `_lib/submit.ts` uses hand-rolled validation helpers (`nonEmpty`, `asInt`, `asNumber`, UUID_RE, SLUG_RE, `isSeverity`, etc.) rather than a shared schema. SEC-report W1 flags this comprehensively. Per the audit rubric this is 🟡 — schema cohesion deficit, not a bug.

The one shared Zod module (`src/lib/account/schema.ts`, used by `account/_lib/actions.ts`) and the scheduling grid actions (`admin/scheduling/_lib/grid-actions.ts`) are the only places Zod is used. All other modules (9 staff submit flows, ~20 admin CRUD files) do not use Zod.

### 1e. Error handling pattern consistency — 🟡 WARNING

Two error-handling patterns coexist:

| Pattern | Usage | Example |
|---|---|---|
| `.error` return from Supabase chained into `{ error: msg }` return | Dominant pattern across all report `actions.ts` | `if (empErr) return { error: empErr.message }` |
| `try/catch` | Not observed in report actions; some admin import-spec bulk handlers use per-row catch inside a loop | `admin/daily-reports/actions.ts`, `admin/air-quality/actions.ts` |

The `.error` return style is applied uniformly across all 9 staff report modules. This is internally consistent at the module level. The issue is the `dbError` helper function — it is **privately re-declared 35 times** across the codebase (19 admin action files + 16 report action/submit files) with identical signatures:

```typescript
function dbError(err: SupabaseError, fallback: string): string { ... }
```

This helper is never exported or imported from a shared location (`src/lib/` has no `db-error.ts`). It is a copy-paste artifact. While the implementations appear functionally identical (all call `err.message ?? fallback`), this violates DRY and means future changes (e.g., adding error code logging) must be applied 35 times. **Flagged 🟡 — no functional inconsistency today, but a refactor target.**

---

## CHECK 2 — Navigation

### 2a. Module nav driven by facility_modules table — 🔴 FINDING

The staff sidebar (`src/components/app/sidebar-nav.tsx`) declares a **hardcoded `NAV_ITEMS` array** of 11 links. It is not queried from any DB table at render time. There is no `facility_modules` table in the schema (SCHEMA-report confirmed this — module access is gated via `user_permissions` + `module_area_permissions` + `has_module_access()` helpers, not a separate feature-flag table).

Consequence: **every staff member sees all 11 report module links in the sidebar**, regardless of whether their facility has configured that module. A user clicking "Refrigeration" for a facility with no refrigeration config sees an empty "Not configured yet" card — that is the graceful fallback — but the nav item is always visible.

The admin sidebar (`src/components/admin/nav-config.ts`) is similarly hardcoded with 20 nav items across 3 groups, with no DB-driven filtering.

This is consistent with the current codebase design (the RLS + permission checks happen at the page/action level, not the nav level), but it means there is no facility-level module suppression at navigation. Whether this is a deliberate "always-show, gate-at-page" design or a gap is not documented. Flagged 🔴 as a CHECK 2 gap per the audit specification which asks for nav driven by `facility_modules`.

### 2b. Role-based suppression (staff don't see Admin) — 🟢 PASSING

The "Admin Center" nav link is conditionally rendered:
```tsx
{isAdmin && (
  <>
    <div className="divider" />
    <Link href="/admin">Admin Center</Link>
  </>
)}
```

`isAdmin` is computed server-side in `src/lib/auth/get-is-admin.ts` by checking `users.is_super_admin` or an active `employees` row with `roles.key IN ('admin', 'super_admin')`. This is correct and consistent. Staff users (non-admin role) will never see the Admin Center link.

### 2c. Active module highlighted — 🟢 PASSING

Both the staff sidebar (`AppSidebarNav`) and the admin sidebar (`SidebarNav`) implement `usePathname()` + `isActive()` logic:
- Staff: `border-l-[3px] border-sidebar-primary bg-sidebar-accent` on the active link.
- Admin: same `border-sidebar-primary bg-sidebar-accent` token pattern.
- Both use `pathname.startsWith(href + "/")` for nested-route matching, with an `exact` flag for the Dashboard root.
- Both set `aria-current="page"` on the active item.

### 2d. Mobile nav on narrow viewports — 🟢 PASSING

Both `AppMobileSidebar` (staff) and `MobileSidebar` (admin) are implemented as Sheet drawers triggered by a hamburger button that is `lg:hidden`. The main sidebar column is `hidden lg:flex`. The `GlobalHeader` conditionally mounts the appropriate mobile sidebar trigger based on the `variant` prop (`"admin"` or `"staff"`). Coverage is correct for all screen widths.

### 2e. Brand tokens — 🟡 WARNING (minor)

**Sidebar and admin chrome use the correct tokens** (`bg-sidebar` = `--navy-700` = `#002244`, `bg-sidebar-primary` = `--rr-green`). However two inconsistencies exist:

1. **Global header gradient uses the legacy green ramp, not `--primary`/`--rr-green`:**
   `src/components/app/global-header.tsx` line 118 uses `var(--green-400/500/600)` — the legacy `#82CC36/#69BE28/#54A01A` progression. Following the Palette Refresh (May 2026), the canonical brand primary was updated to `--rr-green = #4DFF00`. The header intentionally creates a graduated gradient, but it uses the **pre-refresh** green family. Whether this was an intentional choice to keep a softer gradient is not commented. Flagged 🟡 for consistency review.

2. **`pwa-install-prompt.tsx` hardcodes legacy hex `#69BE28` and `#001A3A`** (5 occurrences, `src/components/app/pwa-install-prompt.tsx` lines 208–258). The file comment acknowledges these are "fixed brand colors" for the install prompt, but after the Palette Refresh the primary is `#4DFF00` and the nav surface is `#002244`. These are stale hardcoded values rather than CSS custom properties — they bypass the design-token system and will not adapt to future brand updates. Flagged 🟡.

---

## CHECK 3 — Cross-Module Data Relationships

### 3a. Incident can optionally reference an ice operation event — 🟡 WARNING (gap)

`incident_reports` has an `activity_id` column referencing `incident_activities` (a per-facility admin-managed activity list, e.g., "Zamboni operation", "Stick and Puck"). This provides loose activity-type linking but **there is no direct FK from `incident_reports` to `ice_operations_submissions`**. An incident cannot be tied to a specific logged ice operation run by UUID.

The `incident_activities` table (`migration 102`) is decoupled from the ice operations module — it is its own admin-managed list seeded with activity presets. A staff member reporting an incident during a specific Zamboni operation cannot link to that specific `ice_operations_submissions` row. This is a cross-module relationship gap if the spec intends incident → ice operation submission linkage. Currently it is a "type-of-activity" tag only, not a record reference.

🟡 — Design gap vs. spec intent (not a bug in what was built).

### 3b. Employee schedules reference Admin-configured job areas — 🟢 PASSING

`schedule_shifts.job_area_id → employee_job_areas` (migration 115). The scheduling report module (`src/app/reports/scheduling/actions.ts` line 259) validates job area IDs against `employee_job_area_assignments` before writing. The admin `scheduling/job-areas` module manages `employee_job_areas`. The staff scheduling view loads job area names for availability (`_components/availability-form.tsx:46`). Cross-module data flow is correct.

### 3c. Daily report tab list from Admin config — 🟢 PASSING

`src/app/reports/daily/page.tsx` queries:
1. `daily_report_areas` for the tab list (module-permission-filtered via `getAllowedDailyAreas()`).
2. `daily_report_templates` for templates within each allowed area.
3. `daily_report_checklist_items` for checklist items per template.

All three tables are admin-configured via `src/app/admin/daily-reports/`. The staff view is purely driven by admin config — no hardcoded tab names. Correct.

### 3d. All modules feed an Admin "recent activity" view — 🟡 WARNING (partial)

The Admin dashboard (`src/app/admin/page.tsx`) shows count widgets for:
- Active employees
- Reports submitted today (`daily_report_submissions`)
- Incidents + accidents in last 90 days (`incident_reports` + `accident_reports`)

**Missing from the admin overview**: `ice_depth_sessions`, `ice_operations_submissions`, `refrigeration_reports`, `air_quality_reports` do not contribute to the Admin summary view. The admin page is a "setup checklist + 3-module count" view, not a unified cross-module activity feed.

The `audit_logs` table (accessible via `/admin/audit-log`) captures events from most modules via `audit_row_change` triggers, including: `employees`, `facilities`, `incident_reports`, `accident_reports`, `daily_report_submissions`, `refrigeration_reports`, `air_quality_reports`, `ice_depth_sessions`, `user_permissions`, `roles`, `communication_groups`. However:

- **`ice_operations_submissions` has NO `audit_row_change` trigger.** Migration 46 attempted to add one via `do $$ begin ... if to_regclass('public.ice_operation_reports') ... end $$` — but this checked for the phantom table `ice_operation_reports` (which was corrected to `ice_operations_submissions` in migration 61). The dynamic block never fires against the real table, leaving `ice_operations_submissions` unaudited. 🟡

- No aggregated "recent activity" dashboard component exists that spans all 9 modules side by side. The `audit-log` page provides cross-module filtering by entity type, which partially covers this use case, but it requires manual filtering per module.

---

## CHECK 4 — Type Conflicts

### 4a. Conflicting types for same concept — 🟢 PASSING (no conflicts found)

All modules derive their primary data types from `Tables<"...">` in `src/types/database.ts`:
- `incidents/types.ts` → `Tables<"incident_reports">`, `Tables<"incident_types">`, `Tables<"incident_severity_levels">`
- `refrigeration/types.ts` → `Tables<"refrigeration_*">`
- All other module `types.ts` files follow the same pattern.

No module defines a parallel, conflicting type for the same concept. The naming convention within `_lib/submit.ts` files uses camelCase `employeeId`/`facilityId` for function arguments (standard TypeScript), while DB columns are `employee_id`/`facility_id` (snake_case). This is the expected TypeScript/SQL impedance mapping, not a conflict. Both naming conventions are applied consistently within their respective contexts.

The `AuthedUser` / `UserProfile` / `ActiveEmployee` types in `src/lib/auth/types.ts` are the single source of truth for auth identity across all modules. No module redefines these.

### 4b. Modules with local auth checks instead of shared guard — 🟢 PASSING

Every report page that requires authentication calls `requireUser()` from `@/lib/auth`. Every admin page calls `requireAdmin()` from `@/lib/auth`. No raw `supabase.auth.getUser()` calls were found in page-level code outside the shared library.

The `src/app/reports/ice-operations/page.tsx` does not call `requireUser()` but it is a redirect shim — the real page `[operationType]/page.tsx` calls `requireUser()` at line 107.

Server actions independently call `requireUser()` / `requireAdmin()` as a defense-in-depth check within their action body, in addition to the page-level guard already having run. This is correct — server actions are callable independently from the client, so they must re-verify.

The permission check layer (`currentUserCan()` via `@/lib/permissions/check`) is universally applied in all 9 staff report action files before any write. This is consistent and correct.

### 4c. `dbError` fragmentation — 🟡 WARNING (DRY violation)

The `dbError(err, fallback)` helper function is **defined 35 times** across the codebase (19 admin action files + 16 report files), never exported from a shared location. All implementations are functionally equivalent. This is not a type conflict but a significant maintainability gap — any change to error formatting requires touching 35 files. Recommend extracting to `src/lib/db-error.ts` and importing everywhere.

---

## CHECK 5 — Loading / Error / Empty States

### 5a. loading.tsx coverage — 🟡 WARNING (1 gap)

| Module | loading.tsx | Notes |
|---|---|---|
| reports/accidents | ✅ Present | Skeleton shimmer matching form layout |
| reports/air-quality | ✅ Present | |
| reports/communications | ✅ Present | |
| reports/daily | ✅ Present | |
| reports/ice-depth | ✅ Present | |
| reports/ice-operations | ✅ Present | |
| reports/incidents | ✅ Present | Verified — proper skeleton shimmer |
| reports/refrigeration | ✅ Present | |
| reports/scheduling | ✅ Present | |
| reports/facility-paperwork | 🟡 MISSING | Only `_components/` + `page.tsx` — no `loading.tsx` |

All admin modules have `loading.tsx` at their respective level (admin root + all 18 sub-modules checked). The admin scheduling sub-routes (swaps, time-off, compliance, publish, etc.) each have their own `loading.tsx`.

`facility-paperwork` is a read-only document browser that calls `requireUser()` and then a single Supabase query. A missing `loading.tsx` means Next.js App Router falls back to the nearest ancestor boundary (the reports-segment level), which has no loading shimmer. A user on a slow connection will see a blank page during navigation rather than a skeleton. 🟡

### 5b. error.tsx coverage — 🟡 WARNING (module-level gaps)

| Level | error.tsx | Coverage |
|---|---|---|
| `/reports` (segment root) | ✅ Present | Catches errors from any sub-route that doesn't have its own boundary |
| `/admin` (segment root) | ✅ Present | Same |
| `/admin/scheduling` | ✅ Present | Module-specific recovery with "Back to scheduling" affordance |
| All other report modules | 🟡 ABSENT | Falls through to `/reports/error.tsx` |
| All other admin modules (18 modules) | 🟡 ABSENT | Falls through to `/admin/error.tsx` |

The root-level boundaries (`/reports/error.tsx`, `/admin/error.tsx`) are functional — they keep the shell alive and show a retry + escape-hatch link. However they redirect back to the section root (`/dashboard` or `/admin`) rather than the module that errored. Per-module `error.tsx` boundaries would offer better UX recovery (e.g., an incident form error recovers to `/reports/incidents` rather than `/dashboard`).

This is a UX quality gap, not a functional failure — the root boundaries catch everything. Flagged 🟡.

### 5c. Empty-state UI — 🟢 PASSING

All 9 report modules handle the "no data / not configured" state explicitly in their page.tsx:

- `refrigeration/page.tsx`, `air-quality/page.tsx`, `incidents/page.tsx`, `ice-operations/[operationType]/page.tsx`: render `<Card>` with `<CardTitle>Not configured yet</CardTitle>` + admin-contact description.
- `daily/page.tsx`: inline `<Card>` with "No areas assigned" message.
- `ice-depth/page.tsx`: uses the shared `<EmptyState>` component (`src/components/ui/empty-state.tsx`).
- `facility-paperwork`: `<DocumentsBrowser>` uses `<EmptyState>` for the empty document list.
- `scheduling`, `accidents`, `communications`: each has a dedicated empty/unconfigured state in their form components.

The shared `<EmptyState>` component exists at `src/components/ui/empty-state.tsx` but adoption is **inconsistent** — some modules use it (ice-depth, facility-paperwork) while others inline a custom `<Card>` empty state (incidents, refrigeration, air-quality). No functional impact, but a minor consistency gap.

---

## Summary of Findings

| # | Finding | Severity |
|---|---|---|
| C2-NAV-1 | Staff and admin nav are hardcoded arrays — no DB-driven module visibility per facility access grants | 🔴 |
| C3-XMOD-1 | `ice_operations_submissions` has no `audit_row_change` trigger — missing from audit trail and admin audit-log | 🟡 |
| C3-XMOD-2 | Incident → ice operation relationship is activity-type tag only, not a FK to a specific `ice_operations_submissions` row | 🟡 |
| C3-XMOD-3 | Admin overview counts only 3 modules (daily, incidents, accidents); ice-depth, ice-ops, refrigeration, air-quality absent | 🟡 |
| C1-ZOD | No shared Zod validation layer; ~270 mutating actions use hand-rolled helpers (per SEC-report W1) | 🟡 |
| C1-DBERROR | `dbError` helper copy-pasted 35 times; never exported from a shared module | 🟡 |
| C2-BRAND | Global header uses legacy green ramp (`--green-400/500/600` = pre-refresh `#69BE28` family) instead of current `--primary`/`--rr-green` (`#4DFF00`) | 🟡 |
| C2-BRAND-2 | `pwa-install-prompt.tsx` hardcodes `#69BE28` (legacy) instead of `var(--primary)` or `var(--rr-green)` | 🟡 |
| C5-LOAD | `reports/facility-paperwork` missing `loading.tsx` (only 1 of 10 report modules) | 🟡 |
| C5-ERROR | Per-module `error.tsx` absent in 8 report modules and 18 admin modules; coverage provided only at segment root | 🟡 |
| C5-EMPTY | `<EmptyState>` component exists but adoption is inconsistent (some modules use it, others inline a custom Card pattern) | 🟢 |

---

## Recommendations (non-audit, for future work)

1. **Extract `dbError`** to `src/lib/db-error.ts` and import everywhere — replaces 35 private copies.
2. **Adopt Zod** for staff submit flows first (highest untrusted-input surface), using the scheduling grid actions as a template.
3. **Add `audit_row_change` trigger** to `ice_operations_submissions` (currently the only report submission table without one).
4. **Expand admin overview** to include ice-depth sessions, ice-operations submissions, refrigeration reports, and air-quality reports counts alongside the existing daily/incident/accident widgets.
5. **Add per-module `error.tsx`** boundaries for the 9 staff report modules, pointing "escape" back to the module's own list page.
6. **Add `loading.tsx`** to `reports/facility-paperwork`.
7. **Review header gradient**: decide whether `var(--green-400/500/600)` or `var(--primary)`/`var(--rr-green)` is the intended post-refresh header color, and document the decision. Update `pwa-install-prompt.tsx` to use semantic CSS variables.
8. **Consider DB-driven module nav visibility**: if the product intent is that a facility can disable modules from staff view, add a `facility_modules` table or use `user_permissions` to filter `NAV_ITEMS` server-side before passing to the sidebar.
