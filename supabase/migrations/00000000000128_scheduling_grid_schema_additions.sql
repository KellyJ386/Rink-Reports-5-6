-- =============================================================================
-- 00000000000128_scheduling_grid_schema_additions.sql
--
-- Phase 1 schema additions for the drag-to-create scheduling grid.
--
-- BACKFILL: this migration was applied directly to the production project on
-- 2026-06-09 (history version 20260609174838) by a parallel work stream and
-- committed here after the fact so the repo is a faithful source of truth.
-- The body is reproduced verbatim from the prod history table; it is
-- idempotent (add column if not exists / drop not null) so re-applying to an
-- already-migrated database is a no-op. See
-- docs/production-reconciliation-2026-06.md.
-- =============================================================================

-- 1. employees.max_weekly_hours
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

-- 2. schedule_shifts.department_id — relax NOT NULL.
alter table public.schedule_shifts
  alter column department_id drop not null;

comment on column public.schedule_shifts.department_id is
  'Legacy department grouping (FK -> departments). NULLABLE as of the drag-to-create grid: shifts are keyed on job_area_id (employee_job_areas). Retained for backward compatibility with existing rows and the departments view.';
