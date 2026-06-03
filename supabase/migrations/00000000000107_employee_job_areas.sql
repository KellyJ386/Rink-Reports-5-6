-- =============================================================================
-- 00000000000107_employee_job_areas.sql
-- Employee job-area assignment for the Employee Scheduling module.
--
-- Adds two NEW tables (additive / non-destructive):
--   1. employee_job_areas            -- per-facility, admin-configurable reference
--                                       list of job areas (Front Desk, Pro Shop, ...).
--   2. employee_job_area_assignments -- many-to-many cross-training link between
--                                       employees and job areas (max 4 per employee).
--
-- These job areas are a SEPARATE concept from Daily Report areas
-- (public.daily_report_areas) and intentionally do NOT reference that table.
--
-- Conventions mirror the existing facility-scoped reference tables
-- (ice_operations_fuel_types / ice_operations_rinks / incident_activities):
--   * UUID PKs via gen_random_uuid()
--   * facility_id FK with ON DELETE RESTRICT
--   * name / slug / sort_order / is_active soft-delete + timestamps
--   * set_updated_at() trigger
--   * RLS: SELECT = same-facility + scheduling module access;
--          write  = same-facility + scheduling module ADMIN access; super admin bypass.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. employee_job_areas  (reference list)
-- -----------------------------------------------------------------------------
create table if not exists public.employee_job_areas (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  name        text not null,
  slug        text not null,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint employee_job_areas_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.employee_job_areas is
  'Scheduling: per-facility, admin-configurable list of employee job areas (Front Desk, Pro Shop, etc.). Separate from Daily Report areas (daily_report_areas).';

create index if not exists idx_employee_job_areas_facility
  on public.employee_job_areas (facility_id);
create index if not exists idx_employee_job_areas_facility_active_sort
  on public.employee_job_areas (facility_id, is_active, sort_order);

drop trigger if exists trg_employee_job_areas_updated_at on public.employee_job_areas;
create trigger trg_employee_job_areas_updated_at
  before update on public.employee_job_areas
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. employee_job_area_assignments  (employee <-> job area, many-to-many)
-- -----------------------------------------------------------------------------
create table if not exists public.employee_job_area_assignments (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  job_area_id  uuid not null references public.employee_job_areas(id) on delete restrict,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint employee_job_area_assignments_uniq unique (employee_id, job_area_id)
);

comment on table public.employee_job_area_assignments is
  'Scheduling: many-to-many cross-training link of an employee to job areas. Hard cap of 4 job areas per employee (DB-enforced via constraint trigger). is_primary flags the employee''s main area.';

create index if not exists idx_employee_job_area_assignments_employee
  on public.employee_job_area_assignments (employee_id);
create index if not exists idx_employee_job_area_assignments_job_area
  on public.employee_job_area_assignments (job_area_id);
create index if not exists idx_employee_job_area_assignments_facility
  on public.employee_job_area_assignments (facility_id);

drop trigger if exists trg_employee_job_area_assignments_updated_at on public.employee_job_area_assignments;
create trigger trg_employee_job_area_assignments_updated_at
  before update on public.employee_job_area_assignments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Four-area cap (constraint trigger)
--   Rejects any insert/update that pushes an employee above 4 job areas.
--   SECURITY DEFINER so the row count is accurate regardless of the calling
--   role's RLS visibility -- the cap is a hard data invariant, not a per-user
--   view. Counts all assignments for the (post-change) employee_id.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_employee_job_area_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.employee_job_area_assignments
  where employee_id = new.employee_id;

  if v_count > 4 then
    raise exception
      'Employee % cannot be assigned more than 4 job areas (attempted %).',
      new.employee_id, v_count
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_employee_job_area_cap() is
  'Constraint-trigger guard: rejects inserts/updates that would give an employee more than 4 job-area assignments.';

revoke execute on function public.enforce_employee_job_area_cap() from public;

drop trigger if exists trg_employee_job_area_assignments_cap on public.employee_job_area_assignments;
create constraint trigger trg_employee_job_area_assignments_cap
  after insert or update on public.employee_job_area_assignments
  for each row execute function public.enforce_employee_job_area_cap();

-- -----------------------------------------------------------------------------
-- 4. Row Level Security
--   Mirrors the scheduling/reference-table policy shape:
--     SELECT : super admin OR (same facility AND scheduling module access)
--     INS/UPD/DEL : super admin OR (same facility AND scheduling module ADMIN access)
--   No row is visible or writable outside the user's own facility.
-- -----------------------------------------------------------------------------
alter table public.employee_job_areas             enable row level security;
alter table public.employee_job_area_assignments  enable row level security;

-- employee_job_areas ----------------------------------------------------------
drop policy if exists employee_job_areas_select on public.employee_job_areas;
create policy employee_job_areas_select on public.employee_job_areas
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists employee_job_areas_insert on public.employee_job_areas;
create policy employee_job_areas_insert on public.employee_job_areas
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists employee_job_areas_update on public.employee_job_areas;
create policy employee_job_areas_update on public.employee_job_areas
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

drop policy if exists employee_job_areas_delete on public.employee_job_areas;
create policy employee_job_areas_delete on public.employee_job_areas
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- employee_job_area_assignments ----------------------------------------------
drop policy if exists employee_job_area_assignments_select on public.employee_job_area_assignments;
create policy employee_job_area_assignments_select on public.employee_job_area_assignments
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists employee_job_area_assignments_insert on public.employee_job_area_assignments;
create policy employee_job_area_assignments_insert on public.employee_job_area_assignments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists employee_job_area_assignments_update on public.employee_job_area_assignments;
create policy employee_job_area_assignments_update on public.employee_job_area_assignments
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

drop policy if exists employee_job_area_assignments_delete on public.employee_job_area_assignments;
create policy employee_job_area_assignments_delete on public.employee_job_area_assignments
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Seed the Tennity facility's job areas (idempotent).
--   Facility-scoped by design: the hardcoded facility id only matches the
--   Tennity production facility, so this is a no-op on fresh/local databases
--   (no matching facility => zero inserts). Idempotent via ON CONFLICT.
-- -----------------------------------------------------------------------------
with facility as (
  select '4490bad7-ef1b-4544-8d7f-7aea49884550'::uuid as fid
)
insert into public.employee_job_areas (facility_id, name, slug, sort_order, is_active)
select f.fid, v.name, v.slug, v.sort_order, true
from facility f
cross join (values
  ('Front Desk',        'front_desk',         1),
  ('Pro Shop',          'pro_shop',           2),
  ('Custodial',         'custodial',          3),
  ('Concessions',       'concessions',        4),
  ('Operations',        'operations',         5),
  ('Learn to Skate',    'learn_to_skate',     6),
  ('Public Skate',      'public_skate',       7),
  ('Building Services', 'building_services',  8),
  ('Instructor',        'instructor',         9),
  ('Ice Tech',          'ice_tech',          10)
) as v(name, slug, sort_order)
where exists (select 1 from public.facilities where id = f.fid)
on conflict (facility_id, slug) do nothing;
