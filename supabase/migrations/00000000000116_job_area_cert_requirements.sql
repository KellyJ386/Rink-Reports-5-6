-- =============================================================================
-- 00000000000116_job_area_cert_requirements.sql
-- Scheduling remediation P4: per-job-area certification requirements.
--
-- A facility admin can declare that a job area (role) requires one or more named
-- certifications. At assignment time (migration 118) an employee is blocked from
-- a shift whose job area requires a certification they do not hold (matched
-- case-insensitively against public.employee_certifications.name, with
-- expires_at null-or-in-the-future).
--
-- Conventions mirror employee_job_areas (migration 107): UUID PK, facility_id FK,
-- is_active soft-delete, set_updated_at() trigger, scheduling-module RLS.
-- =============================================================================

create table if not exists public.job_area_certification_requirements (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id)         on delete restrict,
  job_area_id uuid not null references public.employee_job_areas(id) on delete cascade,
  cert_name   text not null check (length(btrim(cert_name)) between 1 and 200),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint job_area_cert_requirements_uniq unique (facility_id, job_area_id, cert_name)
);

comment on table public.job_area_certification_requirements is
  'Scheduling: certifications required to work a given job area. cert_name is matched case-insensitively against employee_certifications.name (non-expired) by scheduling_assignment_violations().';

-- Case-insensitive uniqueness so "CPR" and "cpr" cannot both be added.
create unique index if not exists job_area_cert_requirements_ci_uniq
  on public.job_area_certification_requirements (facility_id, job_area_id, lower(cert_name));
create index if not exists idx_job_area_cert_requirements_facility_area
  on public.job_area_certification_requirements (facility_id, job_area_id);

drop trigger if exists trg_job_area_cert_requirements_updated_at on public.job_area_certification_requirements;
create trigger trg_job_area_cert_requirements_updated_at
  before update on public.job_area_certification_requirements
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security (scheduling-module pattern):
--   SELECT : super admin OR (same facility AND scheduling module access)
--   write  : super admin OR (same facility AND scheduling module ADMIN access)
-- -----------------------------------------------------------------------------
alter table public.job_area_certification_requirements enable row level security;

drop policy if exists job_area_cert_requirements_select on public.job_area_certification_requirements;
create policy job_area_cert_requirements_select on public.job_area_certification_requirements
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists job_area_cert_requirements_insert on public.job_area_certification_requirements;
create policy job_area_cert_requirements_insert on public.job_area_certification_requirements
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists job_area_cert_requirements_update on public.job_area_certification_requirements;
create policy job_area_cert_requirements_update on public.job_area_certification_requirements
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists job_area_cert_requirements_delete on public.job_area_certification_requirements;
create policy job_area_cert_requirements_delete on public.job_area_certification_requirements
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );
