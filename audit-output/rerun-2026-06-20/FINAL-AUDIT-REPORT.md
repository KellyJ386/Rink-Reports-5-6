# RinkReports 5-6 — Platform Re-Audit (Fresh Full Run)

**Repo:** KellyJ386/Rink-Reports-5-6 · branch `claude/confident-allen-9auxs1`
**Supabase project:** `bqbdgwlhbhabsibjgwmk` (ACTIVE_HEALTHY, Postgres 17, us-east-1)
**Run type:** AUDIT-ONLY (no code changes) · **Date:** 2026-06-20
**Method:** 14 specialist agents (infra + per-module) across the 13-phase prompt, synthesized.
**Baseline:** This is the *second* full audit. The first (`audit-output/*.md`, 2026-06-17, overall 80/100) found criticals C1–C4; a remediation cycle fixed all four and merged to `main`. The repo has since advanced through PR #206. This run **verifies those fixes in current code** and re-grades the moved-on codebase.

> **Spec-vs-reality reconciliations applied** (the master prompt is partly stale — same as the 6/17 run):
> - **No Dexie.** Offline is service-worker based (`public/sw.js` + `/api/offline-sync` + `offline_sync_queue`). Not penalized.
> - **No Stripe / billing.** Entirely absent; the product is currently free-tier multi-tenant. "Tennity free pilot" is moot — no billing to gate.
> - **No `react-big-calendar`.** Removed as a dead dep; scheduling uses a bespoke pointer-events grid. Not penalized.
> - **Role model** is `super_admin(0) → admin(1) → manager(2) → staff(3)` + a custom `driver(4)` — *not* the spec's 5-tier (`org_admin/facility_manager/supervisor`). Graded against actual.
> - **Brand token:** live primary is `--rr-green #4DFF00` (Palette Refresh). `#69BE28` is **deprecated**; occurrences flagged. `lib/tokens.ts` **does** exist (mirrors globals.css).

---

## Section 1 — Grading Scoreboard

| Module / Area | Grade | Δ vs 6/17 | Status |
|---|---|---|---|
| Employee Scheduling | **93/100** | +15 | Production-ready |
| Offline / PWA (SW) | **93/100** | ~ | Production-ready |
| Admin Control Center | **91/100** | +9 | Production-ready |
| Daily Reports | **83/100** | −3 | Near-complete |
| Ice Depth | **82/100** | −6 | Near-complete |
| Incident Reporting | **81/100** | +2 | Near-complete |
| Refrigeration Logs | **79/100** | −9 | Near-complete |
| Design System | **76/100** | n/a | Near-complete |
| Cross-Module Health | **74/100** | ~ | Near-complete |
| Ice Operations | **72/100** | −5 | Below bar |
| Air Quality | **68/100** | −14 | Below bar |
| **OVERALL PLATFORM** | **~82/100** | +2 | **NEARLY READY** |

**Infrastructure (not graded 0–100):**
- **Security/RLS:** 🔴 **0 critical** · 🟡 3 · 🟢 5. Prior criticals **C1 & C2 verified closed in current code**. RLS enabled on all ~110 tables; `facility_id` server-injected everywhere; service-role key server-only; no hardcoded secrets; cron routes use `timingSafeEqual`.
- **Schema:** 103 tables, all RLS. **Migration *ledger* drift present** (versions 123–133 + 140 applied but unrecorded; 13 timestamp-style ledger rows with no on-disk file; duplicate on-disk prefix `139`). Generated types are fresh for the audited surface. Advisors: 54 security (53 warn/1 info), 167 performance (all info).
- **Billing:** absent (N/A).

> Grades for several modules *dropped* vs 6/17 not because they regressed, but because this run's agents probed deeper (e.g. Air Quality's regulatory-floor and sustained-engine gaps; Refrigeration's missing `readings_per_shift`). Admin (+9) and Scheduling (+15) reflect genuinely landed remediation.

---

## Section 2 — Prior Criticals: Verification Status

| ID | Prior critical | Status now | Evidence |
|---|---|---|---|
| **C1** | Intra-facility role-assignment escalation | ✅ **CLOSED** | `canAssignRoleLevel`/`assertCanAssignRole` (`src/lib/permissions/role-assignment-core.ts`, `role-assignment.ts`) wired into `createEmployee`/`updateEmployee`/bulk/roles. Non-super callers can't assign at/above their floor. Unit-tested. |
| **C2** | Permission-matrix self-grant of admin/admin | ✅ **CLOSED** | `isAdminConsoleGrant` guard blocks `admin/admin` across all 3 paths (`user-permission-actions.ts` upsert/preset/CSV) + facility-scope re-validation. |
| **C3** | Live DB behind migrations 141–143 | ✅ **CLOSED** | `air_quality_locations` dropped; FKs now target `facility_spaces`; AQ confirmed functional on live. |
| **C4** | No per-facility module enable/disable | ✅ **CLOSED (staff)** | `facility_modules` table (mig 144) + `/admin/modules` toggle + DB-driven staff nav (`getEnabledModuleKeys`). Admin nav remains static but page/RLS gate independently. |

**All four 6/17 criticals are genuinely closed in current code — not just per the remediation log.**

---

## Section 3 — P0 · Launch Blockers (must fix before Tennity pilot)

### P0-1 🔴 Air Quality thresholds can be loosened below regulatory floors
- **Module:** Air Quality · **File:** `src/app/admin/air-quality/actions.ts:610–633` (`validateThreshold`)
- **Root cause:** `validateThreshold` does no clamp against statutory minimums — an admin can set `alert_max` above MN limits (e.g. CO 83 ppm, NO2 2.0 ppm).
- **Why blocking:** Directly violates the master prompt's absolute constraint ("regulatory floor values are hardcoded minimums and cannot be overridden downward") and defeats the safety purpose of an air-quality compliance product.
- **Fix:** Add server-side regulatory-floor constants and reject any threshold that loosens past them. **Effort: M.**

### P0-2 🔴 Cross-tenant writes into append-only change/audit logs (RLS gap)
- **Modules:** Air Quality, Ice Depth (and Ice Operations variant) · **Where:** live RLS `INSERT` policies on `air_quality_change_log`, `ice_depth_change_log` have `WITH CHECK = null`; `ice_operation_change_log` `SELECT` lacks the `has_module_access` gate.
- **Root cause:** INSERT policies never constrain `facility_id`, so any authenticated user can write audit-log rows tagged with an arbitrary facility — a cross-tenant integrity hole in the immutable audit trail.
- **Fix:** One migration adding `WITH CHECK (facility_id = current_facility_id())` to the change-log INSERT policies and a module-access gate on the Ice Ops log SELECT; add assertions to `supabase/tests/rls_isolation.sql`. **Effort: S.**

### P0-3 🟡→blocker Two modules below the 75 bar
- Air Quality **68** and Ice Operations **72** fail the "all modules ≥ 75" launch criterion. They are lifted by fixing the items in this section (P0-1/P0-2 for AQ; P1-1/P1-2 for Ice Ops). Tracked here so the criterion isn't lost.

**No data-exposure / privilege-escalation criticals remain** (C1/C2 closed; `facility_id` server-injected; no `as any` data-bridge except the Ice Ops type alias below).

---

## Section 4 — P1 · Launch Risks (should fix before go-live)

| # | Sev | Finding | File:line | Effort |
|---|---|---|---|---|
| P1-1 | 🟡 | **Ice Ops `type AnySupabase = any` (20 casts)** — the tables it papered over are now in generated types; CLAUDE.md retires this pattern. Remove all 20. | `src/app/admin/ice-operations/actions.ts:31` (+19) | S |
| P1-2 | 🟡 | Ice Ops operation/equipment types are hardcoded TS enums + DB CHECK (spec wants admin-configurable; "Patch" doesn't exist). | `src/app/reports/ice-operations/types.ts:12–31` | M |
| P1-3 | 🟡 | **Refrigeration `readings_per_shift` does not exist** — no config column, no enforcement; `round_no` uncapped. | `refrigeration_settings`; `_lib/submit.ts` | M |
| P1-4 | 🟡 | **Daily Reports has no submission lock / double-submit guard** — no `is_locked`/`status` column, no uniqueness on `(facility,area,template,date)`. | `reports/daily/_lib/submit.ts` | M |
| P1-5 | 🟡 | AQ sustained-exceedance / **Evacuation tier is a stub** (`rule_body` JSON, "future engine pass"); no time-series evaluation exists. | `admin/air-quality/actions.ts:1185–1190` | L |
| P1-6 | 🟡 | `incident_types` has **no admin CRUD UI** (read-only; severities/activities are editable). | `reports/incidents/.../types.ts:64` | M |
| P1-7 | 🟡 | **Migration ledger drift** — live ledger ≠ on-disk files; duplicate prefix `139`. Repo is not a faithful source of truth; `supabase db push/reset` is unsafe without `migration repair`. | `supabase/migrations/`, live ledger | M |
| P1-8 | 🟡 | Bottom-tab-bar "Reports" hardcodes `/reports/daily`, ignoring `enabledModules` (breaks if `daily_reports` disabled). | `src/components/app/bottom-tab-bar.tsx:55` | S |
| P1-9 | 🟡 | Communications **reminders scheduler unimplemented** but shows "not yet implemented" to admins. | `admin/communications/_components/reminders-tab.tsx:74` | S/L |
| P1-10 | 🟡 | Zod adoption inconsistent (~5–9 of ~45 mutating actions); rest hand-roll validation (offline-sync route included). | `src/app/**/actions.ts` | L (incremental) |

---

## Section 5 — P2 · Post-Launch (can ship with these open)

- **15 `#69BE28` occurrences in production UI** (worst: `pwa-install-prompt.tsx` ×5; also `request-information.tsx`, `page.tsx`, ice-depth SVGs, department-form default). Replace with `--rr-green`. **S.**
- **Staff Scheduling design = 48/100** — bypasses the token system with inline hex and no shadcn Card/PageHeader chrome. **M.**
- 28 inline `dbError`/`errFmt` clones (DRY; some lose 23505/23503 translation). Extend shared `src/lib/db-error.ts`. **M.**
- Per-module `error.tsx` boundaries (only group-level today). **M.**
- AQ alert-badge off-by-one (form `>= alert_max` inclusive vs server `> alert_max` exclusive). **S.**
- Refrigeration: non-critical (warn/high) OOR has no visual flag; history not filterable by compressor; OOR filter applied client-side post-fetch. **S–M.**
- Ice Depth: confirm/ wire admin date-range filter server-side; `window.print()` instead of a heat-map PDF; centralize default-threshold fallbacks. **S–L.**
- Incident: `immediate_actions` optional vs checklist "required"; accident location dropdown not `required`; body-diagram pressed-state hardcoded red. **S.**
- Scheduling: `job_area_certification_requirements` unseeded (0 rows — logic correct, never fires); staff week view relies on RLS without explicit published filter. **S.**
- Offline: SW retry-policy duplicated inline vs `retry-policy.ts`; `/api/offline-sync:199` silently marks unknown moduleKey synced. **S.**
- DB hygiene: enable Auth leaked-password protection; move `citext`/`pg_trgm` out of `public`; 111 unused indexes / 55 unindexed FKs (perf, defer). 

---

## Section 6 — Recommended Fix Order (minimum back-tracking)

1. **P0-2 change-log RLS migration** (S, security, no dependencies) + RLS test assertions.
2. **P0-1 AQ regulatory-floor clamp** (M) → lifts Air Quality toward ≥75.
3. **P1-1 remove Ice Ops `AnySupabase`** (S, types already exist) → lifts Ice Ops.
4. **P1-3 Refrig `readings_per_shift`** + **P1-4 Daily submission lock** (M each) — both are schema + form + enforcement; do together.
5. **P1-2 configurable Ice Ops types** + **P1-6 `incident_types` CRUD** (M) — same admin-config pattern.
6. **P1-7 migration-ledger reconcile** (M) — do as one deliberate `reconcile_migration_history.sql` pass; unblocks safe `db push`.
7. **P1-5 AQ sustained engine** (L) — or ship a documented manual-monitoring fallback for the Evacuation tier.
8. **P2 design/token sweep** (`#69BE28` → token, staff-scheduling chrome) + DRY/`error.tsx`.

After steps 1–3, re-run `pnpm test && npx tsc --noEmit && pnpm lint` and re-grade Air Quality + Ice Operations.

---

## Section 7 — Tennity Pilot Launch Determination

**Criteria:** (a) zero 🔴 critical, (b) all 8 modules ≥ 75, (c) Admin ≥ 85.

| Criterion | Status |
|---|---|
| Zero privilege-escalation / data-exposure criticals | ✅ (C1–C4 closed) |
| All 8 modules ≥ 75 | ❌ Air Quality 68, Ice Operations 72 |
| Admin ≥ 85 | ✅ 91 |

### 🟡 NEARLY READY

The platform is materially stronger than the 6/17 baseline: **all four prior criticals are closed and verified**, Admin is production-ready (91), Scheduling (93) and the offline pipeline (93) are excellent, RLS covers all tables, and `facility_id` is server-injected everywhere. There are **no privilege-escalation or data-exposure blockers**.

What stands between here and a clean pilot is a small, well-scoped set: the **Air Quality regulatory-floor clamp** (an explicit absolute-constraint violation in a safety module), the **cross-tenant change-log RLS gap** (cheap), and lifting **Air Quality + Ice Operations above 75** (largely the `AnySupabase` cleanup, `readings_per_shift`, and configurable types). The migration-ledger drift should be reconciled before any `db push`/`reset`.

**Estimate: ~1 week** to clear P0 + the load-bearing P1 items, after which the platform meets all three launch criteria.
