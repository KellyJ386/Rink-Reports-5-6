-- =============================================================================
-- 00000000000127_schedule_availability_job_area.sql
-- Scheduling item 7: let employees record which job area / department they want
-- to work for a given availability block.
--
-- Adds a nullable job_area_id to schedule_availability referencing the
-- admin-managed employee_job_areas list (migration 107). NULL = "any area / no
-- preference". ON DELETE SET NULL so retiring a job area clears the preference
-- rather than blocking. The day-detail availability UI offers only the areas the
-- employee is assigned to (employee_job_area_assignments); the server action
-- enforces that too. RLS is unchanged — the existing schedule_availability
-- policies (own rows, same facility) already cover the new column.
--
-- ROLLBACK:
--   drop index if exists public.idx_schedule_availability_job_area;
--   alter table public.schedule_availability drop column if exists job_area_id;
-- =============================================================================
begin;

alter table public.schedule_availability
  add column if not exists job_area_id uuid
    references public.employee_job_areas(id) on delete set null;

comment on column public.schedule_availability.job_area_id is
  'Optional preferred job area / department for this availability block. NULL = no preference. References the admin-managed employee_job_areas list; the UI restricts choices to the areas the employee is assigned to.';

create index if not exists idx_schedule_availability_job_area
  on public.schedule_availability (job_area_id);

commit;
