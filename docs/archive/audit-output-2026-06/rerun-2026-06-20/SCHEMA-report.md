# SCHEMA & MIGRATION INTEGRITY AUDIT — RinkReports 5-6

Agent: Agent-SCHEMA · Date: 2026-06-20 · Mode: AUDIT ONLY (no changes)
Supabase project ref: `bqbdgwlhbhabsibjgwmk`

---

## 1. Tables & RLS

**Total public tables: 103.** RLS is **ENABLED on every one** (`pg_class.relrowsecurity = true` for all 103). No RLS-disabled tables.

> Caveat: RLS *enabled* ≠ RLS *enforced*. See advisor findings (§5) — one table has RLS on but **no policy**, and one has an **always-true** INSERT policy.

Row counts (exact where probed; `~` = `reltuples` estimate, `-1` = never analyzed / empty-ish):
- `employees` 103, `audit_logs` 544, `role_permission_defaults` 151, `user_permissions` 140, `daily_report_checklist_items` 506, `daily_report_templates` 51, `refrigeration_fields` 53, `accident_dropdowns` 51, `ice_depth_measurements` 229, `ice_depth_measurements`/`_points` populated, `facilities` 1.
- **`employee_job_area_assignments` = 212 (exact)** — matches the Phase 9 expectation.
- Most transactional tables (reports, communications, schedule_*) show `-1` (never analyzed; effectively empty in this near-fresh production DB).

---

## 2. Migration integrity — DRIFT PRESENT (ledger), schema OK

**On-disk:** 146 files, prefixes `001`…`145`.
**Live ledger (`supabase_migrations.schema_migrations`):** 133 numeric-prefixed rows + 13 timestamp-style rows (`20260603…`–`20260614…`).

### 2a. Duplicate on-disk prefix (CLAUDE.md violation — one file per prefix)
- **`00000000000139` is used by TWO files:** `00000000000139_daily_report_rename_operational_to_daily.sql` AND `00000000000139_scheduling_expiry.sql`. The ledger records `00000000000139` **once**, so only one of these two was ever tracked as applied. This is the documented past-drift collision and it is **still present on disk**. SEVERITY: HIGH.

### 2b. Migrations on disk but NOT in the live ledger (versions 123–133, 140, 145-range)
Ledger jumps **122 → 134** and **139 → 141**. Missing ledger entries:
`123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 140`.

**However, the schema objects these migrations create DO exist live** (spot-checked):
- m132 `purge_module_data()` function — present
- m128 `schedule_shifts.job_area_id` — present
- m127 `schedule_availability.job_area_id` — present
- m129 `schedule_settings.block_on_violations` — present
- m140 `schedule_shifts_no_double_booking` EXCLUDE constraint — present (see §4)
- m125 — inserts a `machine_hours` row into `refrigeration_fields` (it adds a *data field*, not a column); the standalone column probe returning 0 is expected and not a gap.

**Conclusion:** This is **ledger drift, not schema drift** — the objects were applied (likely via direct push / db reset) but the ledger rows for 123–133 + 140 were never recorded. The 13 timestamp-prefixed ledger rows are post-hoc remediation migrations applied through the dashboard/CLI. `supabase db push` / `supabase migration repair` would now see 123–133 + 140 as "pending" and could attempt to re-run them — most are written idempotent, but this is fragile. SEVERITY: HIGH (deploy-process risk), MEDIUM (runtime risk).

### 2c. Live ledger versions not on disk
The 13 timestamp-style versions (`20260603012740` … `20260614110137`) have **no corresponding file** in `supabase/migrations/`. These are out-of-band changes applied directly to the remote project and not captured in the repo. SEVERITY: MEDIUM (repo is not the source of truth; a fresh `supabase db reset` would NOT reproduce production).

---

## 3. Type freshness (`src/types/database.ts`)

`DATABASE_URL` was UNSET, so `--check` could not run. Spot-check: all probed live-only tables/columns are **present** in `src/types/database.ts` — `facility_modules`, `job_area_certification_requirements`, and incident emergency fields `ambulance_flag` / `persons_involved` / `follow_up_required` (15 grep hits across these terms). **Verdict: types appear FRESH for the audited surface.** Not a byte-exact guarantee — recommend running `pnpm types:check` against a migrated DB in CI to confirm.

---

## 4. Scheduling schema checklist (Phase 9) — ALL CONFIRMED

| Check | Result |
|---|---|
| `schedule_*` tables exist | **12** present |
| `employees.max_weekly_hours` column | PRESENT |
| Job-area cert requirements table (`job_area_certification_requirements`) | PRESENT |
| `employee_job_area_assignments` ≈ 212 rows | **212 exact** |
| `schedule_shifts` double-booking exclusion (mig 140) | PRESENT — `schedule_shifts_no_double_booking` EXCLUDE USING gist (employee_id =, tstzrange(starts_at, ends_at,'[)') &&) WHERE employee_id IS NOT NULL AND status IN ('draft','published') |
| `facility_modules` table | PRESENT |
| Incident emergency cols (ambulance_flag/persons_involved/follow_up_required) | All 3 PRESENT |

---

## 5. Advisors

### Security — 54 total (53 WARN, 1 INFO)
- **44 ×** `authenticated_security_definer_function_executable` (WARN) — SECURITY DEFINER funcs executable by `authenticated`. Bulk review needed; many likely intentional RPCs but the count is large.
- **4 ×** `anon_security_definer_function_executable` (WARN) — executable by **anon**: `check_rate_limit`, `enforce_incident_witnesses_cap`, `seed_default_facility_modules`, `tg_seed_facility_modules`. The two trigger funcs (`enforce_incident_witnesses_cap`, `tg_seed_facility_modules`) and `seed_default_facility_modules` should NOT be anon-RPC-callable — revoke EXECUTE from anon. SEVERITY: HIGH.
- **1 ×** `rls_policy_always_true` (WARN) — `information_requests` INSERT policy `information_requests_insert` has WITH CHECK = true → unrestricted insert for anon + authenticated, effectively bypassing RLS. SEVERITY: HIGH.
- **1 ×** `rls_enabled_no_policy` (INFO) — `rate_limit_counters` has RLS enabled but zero policies (deny-all to non-service-role; functionally locked but flagged).
- **2 ×** `extension_in_public` (WARN) — `citext` (+1 other) in public schema.
- **1 ×** `function_search_path_mutable` (WARN) — `schedule_swap_set_expiry`.
- **1 ×** `auth_leaked_password_protection` (WARN) — leaked-password protection disabled.

### Performance — 167 total (all INFO)
- **111 ×** `unused_index`
- **55 ×** `unindexed_foreign_keys` — FKs without covering index (write/cascade cost).
- **1 ×** `auth_db_connections_absolute`.
No CRITICAL/ERROR-level perf advisors.

---

## Top findings (by severity)

1. **HIGH — Ledger drift:** versions 123–133 + 140 applied to schema but absent from the migration ledger; 13 timestamp-style ledger rows have no on-disk file. Repo is not a faithful source of truth; `db push`/`db reset` is unsafe without `migration repair`.
2. **HIGH — Duplicate prefix `00000000000139`** on disk (two files), violating CLAUDE.md one-file-per-prefix rule; only one is tracked in the ledger.
3. **HIGH — `information_requests` INSERT policy is always-true**, bypassing RLS for anon/authenticated.
4. **HIGH — 3 trigger/seed SECURITY DEFINER functions callable by anon** via PostgREST RPC (`enforce_incident_witnesses_cap`, `seed_default_facility_modules`, `tg_seed_facility_modules`).
5. **MEDIUM — 44 authenticated-callable SECURITY DEFINER functions** warrant a bulk authz review.
6. **MEDIUM — `auth_leaked_password_protection` disabled**; `extension_in_public` (citext); `schedule_swap_set_expiry` mutable search_path.
7. **LOW/INFO — 167 perf advisors** (111 unused indexes, 55 unindexed FKs).
8. **INFO — Type freshness:** could not run `--check` (no DATABASE_URL); spot-checks pass. Confirm via CI.
