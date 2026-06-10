-- =============================================================================
-- 00000000000130_schedule_template_shifts_nullable_department.sql
--
-- BACKFILL of production history version 20260609185706 (applied 2026-06-09 by
-- a parallel work stream). Reproduced verbatim from the prod history table so
-- the repo matches prod; idempotent (drop not null). See
-- docs/production-reconciliation-2026-06.md.
-- =============================================================================

alter table public.schedule_template_shifts
  alter column department_id drop not null;

comment on column public.schedule_template_shifts.department_id is
  'Legacy department grouping (FK -> departments). NULLABLE as of the grid template flow: template slots are keyed on job_area_id (employee_job_areas). Retained for backward compatibility.';
