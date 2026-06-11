# Production migration reconciliation — June 2026

The **current** divergence between the git repo (branch
`claude/great-shannon-5lwilt` → PR #174) and the live Supabase project
(`bqbdgwlhbhabsibjgwmk`, "Rink Reports 5-6"), and the steps to converge them
safely. Concrete companion to the general procedure in `DEPLOY.md` §8.

> **Last verified: 2026-06-10** against the live project. Re-verify with the
> queries at the bottom before running the convergence, since prod has been
> changing out-of-band.

## TL;DR

- The **cross-tenant scheduling RLS leak is already fixed on prod** (migration
  133 was applied out-of-band on 2026-06-10; verified — all four policies are
  facility-scoped and the legacy duplicate policies are gone). No longer urgent.
- Repo migrations **123–133 are all on prod under timestamp versions** — the
  schema is applied; only the history-table version strings differ. A naive
  `db push` would try to re-apply them and fail. They must be `migration
  repair --status applied` under their repo numbers first.
- Repo migrations **134 and 135 are the only genuinely-pending changes.**
  Verified their new objects don't exist on prod yet. These are what a deploy
  should actually apply.
- The repo is now a **faithful superset** of prod (the four formerly prod-only
  migrations were backfilled as 128–131). No prod-only orphans remain.

## State of play

### Aligned: 001–122
Recorded on prod under the repo's `00000000000NNN` versions. No action.

### Already-applied, version-mismatched: repo 123–133
The schema for every one of these is on prod, recorded under a timestamp
version. `supabase db push` keys on the version string, so it sees the repo's
numbered files as unapplied. **Repair each as applied under its repo number.**

| Repo file | Prod history version | Name |
|---|---|---|
| `00000000000123` | `20260608170210` | module_access_any_enabled_action |
| `00000000000124` | `20260609103535` | refrigeration_select_options_normalize |
| `00000000000125` | `20260609103544` | refrigeration_machine_hours_per_compressor |
| `00000000000126` | `20260609111407` | incident_arm_split_dropdowns |
| `00000000000127` | `20260609111341` | schedule_availability_job_area |
| `00000000000128` | `20260609174838` | scheduling_grid_schema_additions |
| `00000000000129` | `20260609184411` | schedule_settings_block_on_violations |
| `00000000000130` | `20260609185706` | schedule_template_shifts_nullable_department |
| `00000000000131` | `20260603012740` | incident_reporter_phone_optional |
| `00000000000132` | `20260610162900` | purge_module_data |
| `00000000000133` | `20260610162953` | scheduling_admin_facility_scope_fix |

(128–131 were backfilled into the repo from these prod rows; 132/133 originated
in this branch and were later applied to prod out-of-band — hence the
2026-06-10 timestamps.)

### Genuinely pending: repo 134–135
Not on prod in any form. Verified their core objects are absent:

| Repo file | Name | Creates | Verified absent on prod |
|---|---|---|---|
| `00000000000134` | purge_outbox_and_sync_queue | `purge_old_notification_outbox()`, `purge_old_offline_sync_queue()` | yes |
| `00000000000135` | auto_seed_daily_checklists_on_facility_create | `seed_default_daily_report_checklists()`; `create or replace`s `create_facility_with_roles()` | seed fn absent; the replaced fn's signature matches prod exactly, so it replaces cleanly (no dangling overload) |

These two are what a `db push` should apply.

## Convergence runbook (run deliberately from a linked machine, not CI)

1. `supabase link --project-ref bqbdgwlhbhabsibjgwmk`
2. `supabase migration list --linked` — confirm the split above.
3. Mark the already-applied repo migrations applied under their **repo**
   version so `db push` won't replay them:
   ```bash
   supabase migration repair --status applied \
     00000000000123 00000000000124 00000000000125 00000000000126 \
     00000000000127 00000000000128 00000000000129 00000000000130 \
     00000000000131 00000000000132 00000000000133
   ```
   (This inserts the repo version rows; the original timestamp rows remain as
   harmless orphans. Do **not** delete or renumber those.)
4. `supabase migration list --linked` — only 134 and 135 should show as pending.
5. `supabase db push` (or merge to `main` and let `deploy-migrations.yml` run it)
   applies **only** 134 and 135.
6. Post-deploy: run the smoke checklist (DEPLOY.md §5). The RLS leak fix is
   already verified live; spot-check 134's purge functions and 135's seed
   function now exist (queries below).

## Do NOT

- Re-apply 123–133 by their `00000000000NNN` versions without repairing first —
  they will fail on existing objects.
- Delete or renumber the timestamp-versioned prod history rows.

## Re-verification queries

Run before the convergence to confirm this snapshot still holds:

```sql
-- post-122 prod history (expect the 11 timestamp rows in the table above)
select version, name from supabase_migrations.schema_migrations
where version > '00000000000122' order by version;

-- 134/135 objects still absent? (expect 0,0,0)
select
  (select count(*) from pg_proc where pronamespace='public'::regnamespace
     and proname='purge_old_notification_outbox') as purge_outbox,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace
     and proname='purge_old_offline_sync_queue') as purge_sync,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace
     and proname='seed_default_daily_report_checklists') as seed_fn;

-- leak fix still live? (expect one facility-scoped SELECT policy per table)
select tablename, cmd, count(*)
from pg_policies
where schemaname='public'
  and tablename in ('schedule_availability','schedule_time_off_requests',
                    'schedule_notifications','schedule_swap_requests')
group by tablename, cmd order by tablename, cmd;
```

## Appendix — verbatim SQL of the backfilled migrations (128–131)

Recovered from `supabase_migrations.schema_migrations.statements` during the
Day-7 dry-run and committed as repo files 128–131. Kept here for provenance.

### 131 incident_reporter_phone_optional
```sql
alter table public.incident_reports
  alter column reporter_phone drop not null;

comment on column public.incident_reports.reporter_phone is
  'Legacy/optional. No longer collected by the redesigned form (reporter is the logged-in user). Retained nullable for historical rows.';
```

### 128 scheduling_grid_schema_additions
```sql
alter table public.employees
  add column if not exists max_weekly_hours integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.employees'::regclass
      and conname  = 'employees_max_weekly_hours_check'
  ) then
    alter table public.employees
      add constraint employees_max_weekly_hours_check
        check (max_weekly_hours is null
               or (max_weekly_hours > 0 and max_weekly_hours <= 168));
  end if;
end $$;

comment on column public.employees.max_weekly_hours is
  'Scheduling: per-employee weekly scheduled-hours cap (whole hours). NULL = no individual cap; the weekly-hours tally then falls back to facility-level schedule_settings (e.g. minor_max_weekly_hours / overtime_weekly_hours). Range 1..168.';

alter table public.schedule_shifts
  alter column department_id drop not null;

comment on column public.schedule_shifts.department_id is
  'Legacy department grouping (FK -> departments). NULLABLE as of the drag-to-create grid: shifts are keyed on job_area_id (employee_job_areas). Retained for backward compatibility with existing rows and the departments view.';
```

### 129 schedule_settings_block_on_violations
```sql
alter table public.schedule_settings
  add column if not exists block_on_violations boolean not null default false;

comment on column public.schedule_settings.block_on_violations is
  'Scheduling grid: when true, assignment warnings (weekly-hours cap, overlap, required-cert gaps, time-off, overtime) become hard blocks in the grid create/update actions. Default false = advisory only.';
```

### 130 schedule_template_shifts_nullable_department
```sql
alter table public.schedule_template_shifts
  alter column department_id drop not null;

comment on column public.schedule_template_shifts.department_id is
  'Legacy department grouping (FK -> departments). NULLABLE as of the grid template flow: template slots are keyed on job_area_id (employee_job_areas). Retained for backward compatibility.';
```
