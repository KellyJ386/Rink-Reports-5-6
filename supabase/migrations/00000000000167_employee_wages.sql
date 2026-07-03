-- =============================================================================
-- 00000000000167_employee_wages.sql
--
-- Real labor-cost data for Employee Scheduling (audit item: the board's
-- "Labor cost" / "Est. pay" figures were computed from a hardcoded $26/hr).
--
-- 1. public.employee_wages — one optional hourly rate per employee.
--    Wages are SENSITIVE and deliberately live in their OWN table:
--    employees_select (migration 4) grants every authenticated user full-row
--    read of all employees in their facility (the staff swap page depends on
--    that), so a wage column on public.employees would be readable by every
--    coworker. This table's RLS has NO staff branch at all — only super
--    admins, permission-model scheduling admins, and role-based
--    admin/super_admin accounts in the row's facility can read or write it.
--
-- 2. schedule_settings.default_hourly_rate — optional facility-wide fallback
--    used for employees without an individual rate.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Per-employee wage table.
-- -----------------------------------------------------------------------------
create table if not exists public.employee_wages (
  employee_id  uuid primary key references public.employees(id)  on delete cascade,
  facility_id  uuid not null    references public.facilities(id) on delete restrict,
  hourly_rate  numeric not null check (hourly_rate >= 0 and hourly_rate <= 10000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.employee_wages is
  'Optional hourly wage per employee, powering scheduling labor-cost estimates. Kept separate from public.employees because that table is facility-wide readable by ALL staff; this one is admin-only (no staff RLS branch).';

create index if not exists idx_employee_wages_facility
  on public.employee_wages (facility_id);

drop trigger if exists trg_employee_wages_updated_at on public.employee_wages;
create trigger trg_employee_wages_updated_at
  before update on public.employee_wages
  for each row execute function public.set_updated_at();

alter table public.employee_wages enable row level security;

-- Same admin predicate for every operation: super admin anywhere, or —
-- in the row's facility only — a permission-model scheduling admin OR a
-- role-based admin (the accounts that manage employee records). Staff can
-- never read a coworker's (or their own) wage through PostgREST.
drop policy if exists employee_wages_select on public.employee_wages;
create policy employee_wages_select on public.employee_wages
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or public.current_user_role() in ('admin', 'super_admin')
      )
    )
  );

drop policy if exists employee_wages_insert on public.employee_wages;
create policy employee_wages_insert on public.employee_wages
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or public.current_user_role() in ('admin', 'super_admin')
      )
    )
  );

drop policy if exists employee_wages_update on public.employee_wages;
create policy employee_wages_update on public.employee_wages
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or public.current_user_role() in ('admin', 'super_admin')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or public.current_user_role() in ('admin', 'super_admin')
      )
    )
  );

drop policy if exists employee_wages_delete on public.employee_wages;
create policy employee_wages_delete on public.employee_wages
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or public.current_user_role() in ('admin', 'super_admin')
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 2. Facility-wide default rate (fallback when an employee has no wage row).
-- -----------------------------------------------------------------------------
alter table public.schedule_settings
  add column if not exists default_hourly_rate numeric;
alter table public.schedule_settings
  drop constraint if exists schedule_settings_default_hourly_rate_check;
alter table public.schedule_settings
  add constraint schedule_settings_default_hourly_rate_check
  check (default_hourly_rate is null or (default_hourly_rate >= 0 and default_hourly_rate <= 10000));

comment on column public.schedule_settings.default_hourly_rate is
  'Optional facility-wide hourly rate used for labor-cost estimates when an employee has no employee_wages row. NULL = no default; unrated shifts are excluded from cost totals.';
