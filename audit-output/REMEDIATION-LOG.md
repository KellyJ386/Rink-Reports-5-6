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

## Follow-up pass (post-C1–C4)

### Production migration drift — DEEPER than the audit reported ✅ FIXED (production DB)
While resolving the type follow-up, discovered the live DB was missing **all of
migrations 134–139a** (the live ledger jumped 133 → 139b → 140). Confirmed
missing and replayed each to production (idempotent, verified per migration),
recorded under versions `00000000000134`–`00000000000139`:
- **134** purge_old_notification_outbox / purge_old_offline_sync_queue
- **135** seed_default_daily_report_checklists + create_facility_with_roles wiring
- **136** scheduling_apply_swap / scheduling_approve_publish_request + RLS hardening
- **137** facility-local rules engine + scheduling_decide_open_claim / scheduling_notify_swap_request
- **138** ice_depth CHECK constraints (low<high, depth>=0) + purge_old_ice_depth_sessions
- **139a** Operational→Daily template rename (17 live rows) + Daily-phase seeder
Impact fixed: scheduling swap-apply / publish-approval / open-shift-claim flows
(were calling non-existent RPCs in prod), new-facility checklist seeding, retention
purge workers, and the Daily phase label. Live is now consistent through migration 144.

### Dead dependency removed ✅
`react-big-calendar` + `@types/react-big-calendar` (zero `src/` imports — replaced
by the bespoke pointer-events grid; only comment references remained).

### Loading boundary ✅
Added `src/app/reports/facility-paperwork/loading.tsx` (only report module that
lacked one). Note: group-level `error.tsx` already exists at `src/app/reports`
and `src/app/admin`, so per-module error boundaries are largely already covered.

### Delete-path facility scoping standardized (#7) ✅
`deleteSubmission` / `deleteIceDepthSession` / `deleteAirQualityReport` no longer
infer authorization from a null `facility_id`; non-super-admins are explicitly
facility-scoped (hard error if no facility), super admins delete cross-facility
by intent. RLS still backstops.

### Incident emergency fields (#6) ✅ (DB + UI + escalation)
Migration 145 (applied to prod + recorded): `ambulance_flag`, `persons_involved`
(>=0), `follow_up_required` on `incident_reports`. Wired into the staff form
(toggles + numeric), admin detail (Yes/No badges + value), and the edit/offline
paths. When `ambulance_flag` is set, submit escalates via the existing
`communication_alerts` (critical, requires-ack) + a severity-tagged
`dispatchRulesForSubmission` — mirroring the accident `medical_attention`
pattern (no new recipient UI).

### Daily Reports staff submission history ✅
New read-only `/reports/daily/history` (+ loading) listing the facility's recent
submissions under the existing `daily_report_submissions_select` RLS policy
(per-area "view" gate enforced); "View history" link on the daily landing page.

### Scheduling admin UI gaps ✅
The two facility-level weekly caps were already editable; the genuinely-missing
setter was the per-employee `employees.max_weekly_hours` (enforced by the grid,
no UI) — added to the employee form. The scheduling grid's "Month" view
placeholder toast was replaced with a real read-only month calendar built from
the board's already-loaded window.

### Admin dashboard windows + widgets (#9) ✅
Overview now shows correct, consistent last-7d / last-30d submission counts for
all nine modules (parallel `count: "exact", head: true` queries, facility-scoped),
and a read-only offline-sync-queue health widget (counts by `sync_status`).

### dbError DRY (#8) ✅ (partial, by design)
Extracted `src/lib/db-error.ts` (superset handling 23505/23503/P0001/message).
Migrated the 6 call sites whose behavior it reproduces exactly; intentionally
left ~29 sites whose local variant differs (message-only, custom per-code copy,
or special codes like 23P01/42501) to guarantee zero behavior change. Documented
in the commit.

### Still open (need owner input / systemic / blocked)
- **#5 Ice Ops `AnySupabase` + full type resync** — left in place. Now that prod
  == migrations, run `pnpm types:write` against the live DB and commit; then the
  20 `as any` casts in `admin/ice-operations/actions.ts` can be removed cleanly.
  (Couldn't run the repo's generator here without DB creds / pg-meta parity.)
- **Brand tokens** — needs the canonical color from the design owner.
- **Migration ledger / duplicate-`139` prefix** — the live ledger mixes numeric
  + timestamp versions across 123–140; safest fixed as one deliberate reconcile
  pass (mirroring `reconcile_migration_history.sql`), not piecemeal.
- **Offline schedule readability** — intentionally unmet (kiosk-security design).

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
