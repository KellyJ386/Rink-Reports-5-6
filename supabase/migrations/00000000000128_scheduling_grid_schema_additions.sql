-- =============================================================================
-- 00000000000128_scheduling_grid_schema_additions.sql
-- Drag-to-create weekly grid (Employee Scheduling) — Phase 1 schema additions.
--
-- Scope was deliberately trimmed during Phase 0 discovery, because the existing
-- schema already covers most of what the feature needs:
--
--   * Shifts            -> public.schedule_shifts          (starts_at/ends_at timestamptz)   [reuse]
--   * Templates         -> public.schedule_templates       (header)                          [reuse]
--                          public.schedule_template_shifts  (start_time/end_time as `time`)   [reuse]
--   * Required certs    -> public.job_area_certification_requirements (migration 116)         [reuse]
--                          UNIQUE(facility_id, job_area_id, cert_name); cert match is handled
--                          by scheduling_assignment_violations() (migration 118). We do NOT
--                          create a parallel `job_area_required_certs` table.
--   * Operating hours   -> public.facilities.settings (jsonb), under the documented key shape
--                          below. No DDL — the grid reads it config-driven with a code fallback.
--
-- That leaves exactly two DDL changes here:
--   1. employees.max_weekly_hours — per-employee weekly-hours cap (Phase 4 tally).
--   2. schedule_shifts.department_id — relax NOT NULL. The live "who works where"
--      concept is the job area (employee_job_area_assignments, 212 rows /
--      schedule_shifts.job_area_id), not departments. The drag-to-create popover
--      assigns employee + job_area, so a shift must be creatable without a
--      department. Existing rows are unaffected (they keep their department).
--
-- Operating-hours jsonb convention (facilities.settings), documented for Phase 2:
--   {
--     "scheduling": {
--       "operating_hours": { "start": "06:00", "end": "23:00" }   -- 24h "HH:MM" local
--     }
--   }
--   When absent, the grid falls back to a sensible default in code (not hardcoded
--   in the DB). No seed is written here so the value stays admin-configurable.
--
-- Additive / non-destructive. Safe to re-run (IF EXISTS / IF NOT EXISTS / NOT VALID-free).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. employees.max_weekly_hours
--    Nullable (NULL = "no per-employee cap; fall back to facility settings").
--    CHECK keeps it a sane positive number of hours within a 168-hour week.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2. schedule_shifts.department_id — relax NOT NULL.
--    Job area is the live role concept; a grid-painted shift need not carry a
--    department. FK and existing data are untouched.
-- -----------------------------------------------------------------------------
alter table public.schedule_shifts
  alter column department_id drop not null;

comment on column public.schedule_shifts.department_id is
  'Legacy department grouping (FK -> departments). NULLABLE as of the drag-to-create grid: shifts are keyed on job_area_id (employee_job_areas). Retained for backward compatibility with existing rows and the departments view.';

-- =============================================================================
-- VERIFICATION (run manually after apply; expected results in comments)
-- =============================================================================
-- -- (a) Column exists, nullable, integer:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema='public' and table_name='employees' and column_name='max_weekly_hours';
-- -- expect: max_weekly_hours | integer | YES
--
-- -- (b) CHECK constraint present and correct:
-- select pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid='public.employees'::regclass and conname='employees_max_weekly_hours_check';
-- -- expect: CHECK ((max_weekly_hours IS NULL) OR ((max_weekly_hours > 0) AND (max_weekly_hours <= 168)))
--
-- -- (c) Bounds enforced (both should RAISE):
-- --   update public.employees set max_weekly_hours = 0   where false;  -- 0  -> violates check
-- --   update public.employees set max_weekly_hours = 169 where false;  -- 169 -> violates check
--
-- -- (d) department_id is now nullable:
-- select is_nullable from information_schema.columns
-- where table_schema='public' and table_name='schedule_shifts' and column_name='department_id';
-- -- expect: YES
-- =============================================================================
