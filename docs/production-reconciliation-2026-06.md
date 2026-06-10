# Production migration reconciliation — June 2026 snapshot

This captures the **exact** divergence between the git repo and the live
Supabase project (`bqbdgwlhbhabsibjgwmk`, "Rink Reports 5-6") as of the Day-7
deploy dry-run, and the steps to converge them safely. It is the concrete,
current companion to the general procedure in `DEPLOY.md` §8.

## State of play

### 1. Numbered 001–122 — aligned
Recorded on prod under the repo's `00000000000NNN` versions. No action.

### 2. Repo 123–127 are on prod under TIMESTAMP versions
The same five migrations exist in the repo as numbered files and on prod as
timestamp rows. The **schema is already applied**; only the history table's
version string differs.

| Repo file (version `db push` keys on) | Prod history version | Name |
|---|---|---|
| `00000000000123` | `20260608170210` | module_access_any_enabled_action |
| `00000000000124` | `20260609103535` | refrigeration_select_options_normalize |
| `00000000000125` | `20260609103544` | refrigeration_machine_hours_per_compressor |
| `00000000000126` | `20260609111407` | incident_arm_split_dropdowns |
| `00000000000127` | `20260609111341` | schedule_availability_job_area |

Because prod has no `00000000000123…127` rows, a naive `supabase db push`
would try to **re-apply** these five (and fail on existing objects). They must
be marked applied under their repo version during reconciliation (`supabase
migration repair --status applied 00000000000123 … 00000000000127`).

### 3. Four migrations are on PROD but in NO git branch
Applied directly to prod (parallel work stream / direct SQL), never committed.
Their SQL is reproduced verbatim below so it can be backfilled into the repo —
**the repo is not currently a faithful source of truth without these.**

| Prod version | Name | Effect |
|---|---|---|
| `20260603012740` | incident_reporter_phone_optional | `incident_reports.reporter_phone` → nullable |
| `20260609174838` | scheduling_grid_schema_additions | `employees.max_weekly_hours`; `schedule_shifts.department_id` → nullable |
| `20260609184411` | schedule_settings_block_on_violations | `schedule_settings.block_on_violations boolean not null default false` |
| `20260609185706` | schedule_template_shifts_nullable_department | `schedule_template_shifts.department_id` → nullable |

> **Schema drift to note:** the repo's base incident schema still declares
> `reporter_phone NOT NULL`, but prod made it nullable. A fresh DB built from
> the repo will diverge from prod until `incident_reporter_phone_optional` is
> backfilled as a repo migration.

### 4. The 128/129 numbering collision (DECISION REQUIRED)
`scheduling_grid_schema_additions`'s own SQL comments that it "mirrors
`00000000000128_scheduling_grid_schema_additions.sql`", i.e. the parallel
stream reserved **128/129/130** for:

- 128 = scheduling_grid_schema_additions
- 129 = schedule_settings_block_on_violations
- 130 = schedule_template_shifts_nullable_department

This branch already uses **128 = purge_module_data** and
**129 = scheduling_admin_facility_scope_fix**. These cannot both be 128/129.

**Recommended resolution:** the parallel migrations are already live on prod, so
they own the lower numbers. Backfill them into the repo as 128/129/130 (plus a
number for `incident_reporter_phone_optional`), and **renumber this branch's two
migrations to follow** — e.g. `purge_module_data` → 131,
`scheduling_admin_facility_scope_fix` → 132. (Renaming a *repo file* is safe;
it only changes the version `db push` keys on. Never renumber a migration whose
version is already in the prod history table — that's the timestamp rows in §2,
which stay put.)

## Backfilled SQL of the four prod-only migrations

Recovered from `supabase_migrations.schema_migrations.statements`. Reproduced
so the changes are not lost; commit these as repo migration files (numbering
per the decision above).

### incident_reporter_phone_optional
```sql
alter table public.incident_reports
  alter column reporter_phone drop not null;

comment on column public.incident_reports.reporter_phone is
  'Legacy/optional. No longer collected by the redesigned form (reporter is the logged-in user). Retained nullable for historical rows.';
```

### scheduling_grid_schema_additions
```sql
-- Phase 1 schema additions for the drag-to-create scheduling grid.

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

### schedule_settings_block_on_violations
```sql
alter table public.schedule_settings
  add column if not exists block_on_violations boolean not null default false;

comment on column public.schedule_settings.block_on_violations is
  'Scheduling grid: when true, assignment warnings (weekly-hours cap, overlap, required-cert gaps, time-off, overtime) become hard blocks in the grid create/update actions. Default false = advisory only.';
```

### schedule_template_shifts_nullable_department
```sql
alter table public.schedule_template_shifts
  alter column department_id drop not null;

comment on column public.schedule_template_shifts.department_id is
  'Legacy department grouping (FK -> departments). NULLABLE as of the grid template flow: template slots are keyed on job_area_id (employee_job_areas). Retained for backward compatibility.';
```

## Convergence runbook (run deliberately from a linked machine, not CI)

1. **Backfill** the four prod-only migrations into `supabase/migrations/` as
   numbered files (SQL above), and **renumber** this branch's 128/129 per the
   decision in §4. Regenerate types (`pnpm types:write`) and re-run the RLS
   harness so the repo is internally consistent.
2. `supabase link --project-ref bqbdgwlhbhabsibjgwmk`
3. `supabase migration list --linked` — confirm the §2 timestamp/numbered split.
4. Mark the already-applied repo migrations as applied under their **repo**
   version so `db push` won't replay them:
   ```bash
   supabase migration repair --status applied \
     00000000000123 00000000000124 00000000000125 00000000000126 00000000000127
   ```
   For the four backfilled files: their schema is already on prod under the
   timestamp versions, so **also** mark the new repo numbers applied (repair),
   rather than letting `db push` re-run the identical DDL. (The `add column if
   not exists` / `drop not null` bodies are idempotent, so a re-run would be a
   no-op even if missed — but repairing keeps the history clean.)
5. `supabase migration list --linked` — local and remote should now align with
   only the genuinely-new migrations (this branch's renumbered 131/132) pending.
6. `supabase db push` (or merge to `main` to let `deploy-migrations.yml` do it)
   applies only 131/132.
7. Post-deploy: run the smoke checklist (DEPLOY.md §5) and confirm the RLS
   leak fix is live (re-query the four scheduling policies — each admin branch
   should read `facility_id = current_facility_id() and has_module_admin_access`).

## Do NOT

- Re-apply the §2 migrations (123–127) by version `00000000000123…` without
  repairing first — they will fail on existing objects.
- Renumber the timestamp-versioned prod history rows.
- Apply this branch's 128/129 to prod while still numbered 128/129 — resolve
  the collision (§4) first.
