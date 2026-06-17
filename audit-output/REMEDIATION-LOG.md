# Remediation Log — RinkReports 5-6 Critical Findings

Branch: `claude/quirky-tesla-7z80dp` · Supabase project: `bqbdgwlhbhabsibjgwmk`

All four audit criticals (C1–C4) addressed. tsc + lint + build clean; 295 unit tests pass.

## C1 — Role-assignment privilege escalation ✅ FIXED (code)
Non-super-admins can no longer assign an admin-tier (or higher) role.
- New shared guard `src/lib/permissions/role-assignment.ts` (+ pure, tested
  `role-assignment-core.ts`), reusing the existing `callerHierarchyFloor`
  convention (extracted out of `admin/roles/actions.ts`, which now imports it).
- Applied in `admin/employees/actions.ts` (`createEmployee`, `updateEmployee`)
  and `admin/employees/bulk/actions.ts` (which previously didn't even load
  `hierarchy_level`).
- Tests: `role-assignment-core.test.ts` (6 cases).

## C2 — Permission-matrix self-grant of Admin Center ✅ FIXED (code)
A non-super-admin can no longer enable the `admin/admin` cell or write outside
their own facility, via any of the three paths in
`admin/permissions/user-permission-actions.ts` (`upsertUserPermission`,
`applyPresetToUser`, `bulkImportUserPermissionsCsv`).

## C3 — Live DB behind migrations 141–143 ✅ FIXED (production DB)
Migrations 141, 142, 143 applied to the live project and recorded in
`supabase_migrations.schema_migrations` (versions `00000000000141/142/143`).
Pre-flight verified zero affected rows (no data migration needed). Post-state
verified:
- `air_quality_locations` dropped; `air_quality_reports.location_id` and
  `accident_reports.location_dropdown_id` FKs now target `facility_spaces`.
- `seed_default_facility_spaces` present; `location` accident dropdowns removed.
Air Quality is now functional on production.

## C4 — No per-facility module enable/disable ✅ FIXED (DB + code)
- **Migration 144** (`facility_modules.sql`): new `facility_modules`
  (facility_id, module_key, enabled) table with RLS (same-facility read;
  facility-admin/super write), an idempotent `seed_default_facility_modules`
  seeder, an AFTER INSERT trigger on `facilities`, and a backfill. Applied to
  production + recorded; backfill seeded the existing facility (10 modules,
  all enabled). Security advisor shows no new findings.
- **Types**: added the `facility_modules` block to `src/types/database.ts`
  (byte-matching the postgres-meta generator output).
- **DB-driven nav**: `src/lib/modules/facility-modules.ts`
  (`getEnabledModuleKeys`, fail-open) + pure `module-keys.ts`; staff
  `NAV_ITEMS` now tagged with `moduleKey` and filtered; threaded through the
  3 staff layouts → `AppSidebar`/`GlobalHeader` → `AppMobileSidebar`.
- **Admin UI**: `/admin/modules` page + `setFacilityModuleEnabled` server
  action (facility_id server-injected; RLS-guarded) + nav entry under Setup.

## Follow-ups discovered (not in original audit, out of scope here)
- **Pre-existing type drift**: `src/types/database.ts` differs from the live
  schema in places unrelated to this work — `ip` column nullability on
  rate-limit/audit tables, and missing `response_type_snapshot` /
  `text_response` / `is_response_required` / `response_type` columns on the
  daily-report checklist tables (migration 89 era). This is the same
  migration-history drift family as C3 and should be resolved with a full
  `pnpm types:write` against a fully-migrated DB once the live ledger is
  reconciled.
- The broader migration-history bookkeeping (live ledger mixes numeric +
  timestamp versions; on-disk files 134–139 not all recorded) predates this
  work; `supabase/reconcile_migration_history.sql` is the team's repair path.
