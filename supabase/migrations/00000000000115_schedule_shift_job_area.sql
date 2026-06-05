-- =============================================================================
-- 00000000000115_schedule_shift_job_area.sql
-- Scheduling remediation P1: give a shift a real "role" by linking it to the
-- job-area catalog (public.employee_job_areas) instead of a free-text label.
--
-- Additive / non-destructive:
--   * Adds nullable job_area_id to schedule_shifts and schedule_template_shifts,
--     FK -> employee_job_areas(id) ON DELETE RESTRICT (mirrors how shifts already
--     reference departments).
--   * role_label is RETAINED as an optional free-text addendum/note for now;
--     a later migration may drop it once confirmed unused.
--
-- This bridges the two previously-unconnected taxonomies: a shift now carries a
-- job area, so an employee's qualification can be checked against
-- public.employee_job_area_assignments (see migration 118).
-- =============================================================================

alter table public.schedule_shifts
  add column if not exists job_area_id uuid
    references public.employee_job_areas(id) on delete restrict;

alter table public.schedule_template_shifts
  add column if not exists job_area_id uuid
    references public.employee_job_areas(id) on delete restrict;

create index if not exists idx_schedule_shifts_job_area
  on public.schedule_shifts (job_area_id);
create index if not exists idx_schedule_template_shifts_job_area
  on public.schedule_template_shifts (job_area_id);

comment on column public.schedule_shifts.job_area_id is
  'Scheduling: the job area (role) this shift is for, from public.employee_job_areas. NULL = unspecified. Drives the not_qualified / certification compliance checks in scheduling_assignment_violations().';
comment on column public.schedule_template_shifts.job_area_id is
  'Scheduling: job area (role) carried by this template slot; copied onto the generated schedule_shifts.job_area_id when the template is applied.';
