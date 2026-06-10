-- =============================================================================
-- 00000000000130_schedule_template_shifts_nullable_department.sql
--
-- BACKFILL of production history version 20260609185706 (applied 2026-06-09 by
-- a parallel work stream). Reproduced verbatim from the prod history table so
-- the repo matches prod; idempotent (drop not null). See
-- docs/production-reconciliation-2026-06.md.
-- Scheduling grid Phase 5: shift templates saved from the grid.
--
-- Mirrors migration 128 (which made schedule_shifts.department_id nullable): a
-- template slot painted on the grid is keyed on job_area_id, not a department,
-- so relax the NOT NULL on schedule_template_shifts.department_id. FK and any
-- existing rows are untouched.
--
-- Additive / non-destructive; `drop not null` is a no-op if already nullable.
-- =============================================================================

alter table public.schedule_template_shifts
  alter column department_id drop not null;

comment on column public.schedule_template_shifts.department_id is
  'Legacy department grouping (FK -> departments). NULLABLE as of the grid template flow: template slots are keyed on job_area_id (employee_job_areas). Retained for backward compatibility.';

-- VERIFICATION:
-- select is_nullable from information_schema.columns
-- where table_schema='public' and table_name='schedule_template_shifts'
--   and column_name='department_id';   -- expect: YES
