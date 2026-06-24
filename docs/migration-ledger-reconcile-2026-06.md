# Migration-ledger reconcile — plan (2026-06-22)

> **⚠️ SUPERSEDED 2026-06-24.** This plan assumed prefixes 146–149 belonged to
> this branch's new migrations. After merging the current `main`, those prefixes
> are already taken (146 `air_quality_compliance_profiles` … 154
> `communication_email_sending_claim`). To clear the prefix collisions, this
> branch's new migrations were renumbered to the tail —
> `155_refrigeration_readings_per_shift`, `156_daily_report_business_date`,
> `157_ice_operations_enabled_types` — and `…148_scheduling_expiry.sql` was
> restored to `…139_scheduling_expiry.sql` (it matches the version already applied
> on the live project, so it is not re-applied on deploy). The 139→148 move below
> is therefore reverted. **`supabase/reconcile_migration_history.sql` must NOT be
> run as-is** — its 001–148 INSERT list no longer matches the on-disk files. The
> live-project ledger reconciliation (the 146/147/148 timestamp→numeric folding
> recorded below) conflicts with the merged `main` and must be re-derived from
> `supabase migration list --linked` by a human with live-project access before
> any future ledger rebuild.

**Status (original): ✅ EXECUTED 2026-06-22.** The duplicate `…139_scheduling_expiry.sql`
was renamed to `…148_scheduling_expiry.sql`, `supabase/reconcile_migration_history.sql`
was rebuilt for the full 001–148 set, and the rebuild was run against the live
project. Verified: ledger = 148 numeric rows (0 timestamp versions),
contiguous `00000000000001`–`00000000000148`, matching the on-disk files exactly.

---

_Original plan below._

This rewrites the *production* migration
ledger (`supabase_migrations.schema_migrations` on project
`bqbdgwlhbhabsibjgwmk`). It is bookkeeping-only — every migration below is
already physically applied — but it must be run deliberately by a human (or on
explicit go-ahead), because an incorrect ledger makes a future
`supabase db reset`/`db push` dangerous.

## The drift (verified against live `pg_policies` / `schema_migrations`)

The repo uses monotonic numeric prefixes `00000000000001`…`147`. The live ledger
recorded **15 migrations under timestamp versions** instead of their numeric
prefixes, and the numeric series has a hole at 123–133, 140:

| On-disk file (numeric) | Live ledger version |
|---|---|
| 123 module_access_any_enabled_action | 20260608170210 |
| 124 refrigeration_select_options_normalize | 20260609103535 |
| 125 refrigeration_machine_hours_per_compressor | 20260609103544 |
| 126 incident_arm_split_dropdowns | 20260609111407 |
| 127 schedule_availability_job_area | 20260609111341 |
| 128 scheduling_grid_schema_additions | 20260609174838 |
| 129 schedule_settings_block_on_violations | 20260609184411 |
| 130 schedule_template_shifts_nullable_department | 20260609185706 |
| 131 incident_reporter_phone_optional | 20260603012740 |
| 132 purge_module_data | 20260610162900 |
| 133 scheduling_admin_facility_scope_fix | 20260610162953 |
| 139 scheduling_expiry (DUPLICATE prefix) | 20260614110130 |
| 140 schedule_shifts_no_double_booking | 20260614110137 |
| 146 refrigeration_readings_per_shift | 20260621144430 |
| 147 daily_report_business_date | 20260621145302 |

Everything else (001–122, 134–139 `daily_report_rename`, 141–145) is recorded
under its numeric prefix already.

## Duplicate prefix `00000000000139`

Two on-disk files share prefix 139:
- `00000000000139_daily_report_rename_operational_to_daily.sql` (ledger: `…139` ✓)
- `00000000000139_scheduling_expiry.sql` (ledger: `20260614110130`)

**Recommended minimal resolution:** rename the *second* file to the next free
slot at the tail — `00000000000148_scheduling_expiry.sql` — so exactly **one**
file moves (no cascade renumber of 140–147). All listed migrations are already
applied, so ledger order only matters for a from-scratch `db reset`; nothing in
141–148 depends on `scheduling_expiry`'s objects, so tail placement is safe.

## Execution (run once, in a transaction, via SQL editor or psql)

1. Rename `…139_scheduling_expiry.sql` → `…148_scheduling_expiry.sql` in the repo.
2. Run a full ledger rebuild (DELETE + re-INSERT every on-disk version/name,
   001–147 + 148 scheduling_expiry) — the same pattern as the legacy
   `supabase/reconcile_migration_history.sql`, brought current.
3. Verify `supabase migration list` shows local == remote and `db push` is a no-op.

Because `apply_migration` (MCP) assigns timestamp versions, migrations 146/147
applied during the 2026-06-20 remediation also show as timestamps
(`20260621…`); the rebuild folds them back to their numeric prefixes. All three
new migrations (146, 147, 148) are written defensively (`add column if not
exists`, `create index if not exists`, idempotent backfills) so a replay is safe.

## Why not done automatically

No application/runtime impact today (the app reads the schema, not the ledger).
The risk is entirely in the deploy tooling, and the safe, auditable path is a
single reviewed pass — matching the original remediation's recommendation.
