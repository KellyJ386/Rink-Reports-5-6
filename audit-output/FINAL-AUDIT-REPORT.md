# RinkReports 5-6 — Final Platform Audit Report

**Repo:** KellyJ386/Rink-Reports-5-6 · branch `claude/quirky-tesla-7z80dp`
**Supabase project:** `bqbdgwlhbhabsibjgwmk` (ACTIVE_HEALTHY, Postgres 17, us-east-1)
**Run type:** AUDIT-ONLY (no code changes) · **Date:** 2026-06-17
**Agents:** 13 specialists across 2 waves + orchestrator synthesis

---

## Section 1 — Grading Summary Table

| Module                  | Grade   | Status          |
|-------------------------|---------|-----------------|
| Daily Reports           | 86/100  | Near-Complete   |
| Ice Depth               | 88/100  | Near-Complete   |
| Ice Operations          | 77/100  | Near-Complete   |
| Refrigeration Logs      | 88/100  | Near-Complete   |
| Air Quality             | 82/100  | Near-Complete   |
| Incident Reporting      | 79/100  | Near-Complete   |
| Employee Scheduling     | 78/100  | Near-Complete   |
| Admin Control Center    | 82/100  | Near-Complete   |
| Cross-Module Health     | 74/100  | Scaffold→Near   |
|-------------------------|---------|-----------------|
| **OVERALL PLATFORM**    | **80/100** | **Near-Complete (NOT launch-ready)** |

Infrastructure agents (not graded 0-100): **Security** — 0 critical / 5 warn / 4 suggest; **Schema** — 105 tables, all RLS, 1 critical (migration drift); **Build** — PASS, 0 type errors, 0 lint, 0 `as any`; **Offline** — all checks PASS.

Module average is 82.5/100; the platform is held to 80 by cross-cutting security and configuration gaps (below).

---

## Section 2 — Critical Findings (🔴)

The platform is clean on every *automatic-critical ground rule* (no client-supplied `facility_id`, no `as any` casts, no tRPC, no AI/LLM, no photo upload in Ice Depth/Incident, service-role key never in client code). The criticals below are authorization-logic, deployment, and configuration gaps that the ground-rule greps don't catch.

### 🔴 C1 — Intra-facility privilege escalation via role assignment (Agent-ADMIN)
- **Where:** `src/app/admin/employees/_lib/actions.ts` (`createEmployee` / `updateEmployee`)
- **Issue:** Both write `role_id` directly with **no tier guard**. A `facility_manager`/`admin`-tier user can assign the `admin` role to any employee, minting another facility admin. RLS only enforces *cross-facility* isolation, not *intra-facility* tier ceilings.
- **Fix:** Server-side, clamp the assignable `role_id` to ranks at or below the actor's own tier; reject escalation attempts before the DB write. Add an assertion to `supabase/tests/rls_isolation.sql`.

### 🔴 C2 — Permissions matrix allows self-service admin grant (Agent-ADMIN)
- **Where:** per-user permission matrix admin UI + backing action (`admin/.../permissions` write path)
- **Issue:** A facility admin can grant `admin`/`admin` permission level through the matrix with **no app-layer or RLS guard**. RLS blocks only cross-facility writes, so the escalation succeeds within a facility.
- **Fix:** Gate permission-level grants behind the actor's tier; block granting a level ≥ the actor's own. Cover with an RLS/permission regression assertion.

### 🔴 C3 — Live DB is behind committed migrations (Agent-SCHEMA)
- **Where:** project `bqbdgwlhbhabsibjgwmk` migration history ends at on-disk `…140`; migrations `…141` (facility_spaces shared admin), `…142` (accidents→facility_spaces), `…143` (air_quality→facility_spaces) are **NOT applied to the live DB**.
- **Impact:** Air Quality is **non-functional on the live project** — code queries `facility_spaces` while the live FK target is still `air_quality_locations`. Also the root cause of the only type drift (`air_quality_locations` present live but absent from `src/types/database.ts`, which was generated post-143). Unblocks the Ice Operations `any` escape hatch fix too.
- **Fix:** Apply migrations 141–143 to the live project, then `pnpm types:write` against the migrated DB and commit regenerated `src/types/database.ts`.

### 🔴 C4 — No `facility_modules` table; module navigation is hardcoded (Agent-CROSS; Agent-ADMIN rated 🟡 W1)
- **Where:** `NAV_ITEMS` in the staff/admin shell (`src/components/app` / `src/components/admin`); no `facility_modules` table in the schema.
- **Issue:** All 11 staff modules always render regardless of facility configuration. Modules can be access-gated per *user* via `user_permissions`, but there is **no per-facility enable/disable** mechanism. The audit spec explicitly requires DB-driven module visibility ("disabled modules hidden from ALL staff nav immediately"). Severity split: CROSS rated 🔴 (spec requirement unmet); ADMIN rated 🟡 (access is still server-403-enforced, so it is not a data-exposure hole — it is a missing-capability + nav-hygiene gap).
- **Fix:** Add a `facility_modules(facility_id, module_key, enabled)` table + admin toggle UI, and drive `NAV_ITEMS` from it at runtime.

---

## Section 3 — Warnings (🟡)

**Platform-wide**
- **Zod adoption (SEC W1):** Only ~9 of ~290 mutating server actions use Zod (account form, scheduling grid, CSV imports). The de-facto standard is hand-rolled validation in pure `compute.ts` modules — robust but inconsistent with ground rule #2. Treat as a 🟡 backlog item, not a blocker.
- **`dbError` helper copy-pasted ~35 times (CROSS):** never extracted to a shared module (DRY).
- **Brand-token drift (CROSS):** current brand primary is `--rr-green #4DFF00` ("Palette Refresh", May 2026); header gradient still uses legacy `--green-400/500/600` and `pwa-install-prompt.tsx` hardcodes stale `#69BE28`. NOTE: the audit spec's mandated `#69BE28` is itself outdated — confirm the canonical brand value with the design owner before "fixing."
- **Duplicate migration prefix `00000000000139` (SCHEMA/BUILD):** two files share the prefix (`_daily_report_rename_operational_to_daily` + `_scheduling_expiry`), violating CLAUDE.md's one-file-per-prefix rule.

**Security (SEC, all verified non-critical)**
- Public unauthenticated INSERT on `information_requests` (intentional lead form; advisor-flagged).
- One function with mutable `search_path`; extensions installed in `public` schema; leaked-password protection disabled in Auth settings.

**Module-specific**
- **Ice Operations:** `type AnySupabase = any` escape hatch across ~22 call sites (`admin/ice-operations/actions.ts`) — caused by un-regenerated types after migration 76 (blocked by C3). `operation_types`/`equipment_types` are CHECK-constraint enums, not admin-configurable per-facility tables; "Patch" type absent; no dedicated `start_time`/`end_time` columns and no 15-min granularity on time inputs. *(NOTE: this `= any` type alias is why BUILD's `as any` grep returned 0 — it is a distinct, equally-discouraged escape hatch.)*
- **Incident:** spec fields `ambulance_flag`, `persons_involved`, `follow_up_required` do not exist in schema/UI; no incident-specific emergency-notification recipient config (routes through generic `communication_routing_rules`); `incident_types` not CRUD-able via admin UI.
- **Refrigeration:** no `readings_per_shift` config/enforcement; history not filterable by compressor.
- **Scheduling:** `max_weekly_hours` enforced but no admin UI setter; month view is a placeholder toast; published schedule **not readable offline** (SW is network-only for navigation by kiosk-security design — spec requirement intentionally unmet).
- **Daily Reports:** no staff-facing submission history (admin-only); checklist items checkbox-only (no per-tab field-type config); area-access grant couples `can_submit`+`can_view` (no view-only).
- **Air Quality:** `deleteAirQualityReport` bypasses `resolveFacility()` guard for super-admins (RLS backstops); settings tab doesn't link to Communications routing where alert recipients live.
- **Cross-module:** `incident_reports.activity_id` references a facility activity-type list, not a concrete ice-operation record (no FK linkage); Admin overview counts only 3 of 9 modules; `ice_operations_submissions` has no `audit_row_change` trigger (migration 46 targeted a phantom table name); `react-big-calendar` is a **dead dependency** (zero `src/` imports — replaced by a bespoke pointer-events grid); `facility-paperwork` missing `loading.tsx`; per-module `error.tsx` boundaries only on `/admin/scheduling`.

**Pattern of note:** several modules apply the `facility_id` filter *conditionally* for super-admins on delete (`deleteSubmission`, `deleteIceDepthSession`, `deleteAirQualityReport`) rather than hard-erroring. RLS backstops all of them, but the inconsistency is worth standardizing.

---

## Section 4 — Top 10 Priority Work Order

Ranked by severity × platform impact ÷ effort.

1. **Apply migrations 141–143 to live DB + regenerate types (C3).** Unblocks Air Quality (currently broken live), clears the only type drift, and unblocks the Ice Ops `any` fix. *Effort: S (hours). Highest leverage.*
2. **Add tier guard to role assignment (C1).** Server-side clamp in `createEmployee`/`updateEmployee` + RLS test. *Effort: S–M. Closes the most serious security hole.*
3. **Gate permission-matrix grants by actor tier (C2).** App-layer guard + regression assertion. *Effort: M. Closes second escalation path.*
4. **Introduce `facility_modules` + DB-driven nav (C4).** Table, admin toggle, runtime nav read. *Effort: M–L. Unlocks the per-facility module control the platform is sold on.*
5. **Resolve Ice Ops `any` escape hatch.** Falls out of #1; then delete `AnySupabase`. *Effort: S after #1.*
6. **Add Incident emergency fields + escalation (`ambulance_flag` et al.).** Schema + form + notification trigger. *Effort: M. Safety-critical for an incident system.*
7. **Standardize delete-path facility scoping.** Replace conditional super-admin filters with explicit guards. *Effort: S. Removes a recurring footgun.*
8. **Adopt a shared Zod validation layer + extract `dbError`.** Start with highest-risk mutations. *Effort: L, incremental. Pays down platform-wide debt.*
9. **Fill module error/loading boundaries + Admin dashboard windows.** Per-module `error.tsx`, `facility-paperwork` `loading.tsx`, fix 30d/7d windows + offline-sync widget. *Effort: M.*
10. **Cleanup: dedupe migration prefix 139, drop dead `react-big-calendar` dep, reconcile brand tokens with design owner.** *Effort: S. Hygiene.*

---

## Section 5 — Tennity Launch Readiness

**Criteria:** (a) zero 🔴 CRITICAL, (b) all 8 modules ≥ 75/100, (c) Admin Control Center ≥ 85/100.

| Criterion | Status |
|---|---|
| Zero critical findings | ❌ 4 open (C1–C4) |
| All 8 modules ≥ 75 | ✅ lowest is Ice Ops 77 |
| Admin ≥ 85 | ❌ Admin is 82 |

**Verdict: NOT launch-ready.** Blocking items:
1. C1 + C2 — privilege-escalation holes (must fix before any real-facility rollout).
2. C3 — live DB behind migrations; **Air Quality is broken in production** until 141–143 apply.
3. C4 — no per-facility module enable/disable (a core sales requirement).
4. Admin 82 → ≥85: fixing C1/C2 (the two findings holding Admin below 90) plus the `facility_modules` capability lifts Admin past the bar.

The good news: the codebase is fundamentally sound — clean build, full RLS coverage on all 105 tables, server-injected `facility_id` everywhere, a production-quality offline pipeline, and no ground-rule violations. The blockers are a small, well-scoped set; items #1–#4 above are a realistic 1–2 week sprint.

---

## Section 6 — Agent Performance Log

| Agent | Model | Result | Trust |
|---|---|---|---|
| Agent-SEC | opus | Complete — 0🔴/5🟡/4🟢 | ✅ |
| Agent-SCHEMA | opus | Complete — caught migration drift | ✅ |
| Agent-BUILD | haiku | Complete — build PASS | ✅ |
| Agent-OFFLINE | haiku | Complete — correctly audited SW (not Dexie) | ✅ |
| Agent-DAILY | sonnet | Complete — 86 | ✅ |
| Agent-ICEDEPTH | sonnet | Complete — 88 | ✅ |
| Agent-ICEOPS | sonnet | Complete — 77 | ✅ |
| Agent-REFRIG | sonnet | Complete — 88 | ✅ |
| Agent-AIR | sonnet | Complete — 82 | ✅ |
| Agent-INCIDENT | sonnet | Complete — 79 | ✅ |
| Agent-SCHED | sonnet | Complete — 78 | ✅ |
| Agent-ADMIN | opus | Complete — 82, found C1/C2 | ✅ |
| Agent-CROSS | sonnet | Complete on **re-run** — 74 | ✅ (see note) |

**Note on Agent-CROSS:** the first two CROSS attempts came to rest returning a meta non-answer ("running in the background") without writing the report — they appear to have mis-delegated. A re-run with an explicit "do the work yourself, do not delegate" instruction produced the full `CROSS-report.md` (score 74). Trust the final report; the earlier stubs were discarded.

**Orchestrator notes / spec-vs-reality reconciliations applied during grading:**
- **Dexie:** the audit spec assumes a Dexie offline DB; this repo has none. Offline is service-worker based (`public/sw.js` + `/api/offline-sync` + `offline_sync_queue`). "Missing Dexie" was correctly *not* penalized.
- **Role hierarchy:** spec's `super_admin→org_admin→facility_manager→supervisor→staff` does not match the code, which retired `gm`/`supervisor` (migrations 55/58/87) for a `user_permissions` matrix (`super_admin→admin→manager→staff`). Graded against actual design; gap reported, not penalized.
- **Brand token:** spec mandates `#69BE28`, but the live design system moved to `--rr-green #4DFF00` (May 2026). Flagged for design-owner confirmation rather than auto-"fixed."
- **Table names:** spec invented names; Agent-SCHEMA established the authoritative live inventory that Wave 2 mapped against.
