-- =============================================================================
-- 00000000000038_employee_custom_fields.sql
-- Per-employee key/value custom field storage.
--
-- RLS pattern (standard backbone):
--   SELECT : super_admin OR same-facility
--   INSERT : super_admin OR (same-facility AND role in admin/gm/super_admin)
--   UPDATE : super_admin OR (same-facility AND role in admin/gm/super_admin)
--   DELETE : super_admin OR (same-facility AND role in admin/gm/super_admin)
-- =============================================================================

create table if not exists public.employee_custom_fields (
  id           uuid        primary key default gen_random_uuid(),
  facility_id  uuid        not null references public.facilities(id)  on delete cascade,
  employee_id  uuid        not null references public.employees(id)   on delete cascade,
  field_name   text        not null,
  field_value  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint employee_custom_fields_uniq unique (employee_id, field_name)
);

comment on table public.employee_custom_fields is
  'Arbitrary key/value pairs attached to an employee record. '
  'field_name is unique per employee.';

create index if not exists idx_employee_custom_fields_facility_id
  on public.employee_custom_fields (facility_id);

create index if not exists idx_employee_custom_fields_employee_id
  on public.employee_custom_fields (employee_id);

drop trigger if exists trg_employee_custom_fields_updated_at
  on public.employee_custom_fields;
create trigger trg_employee_custom_fields_updated_at
  before update on public.employee_custom_fields
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.employee_custom_fields enable row level security;

drop policy if exists employee_custom_fields_select on public.employee_custom_fields;
create policy employee_custom_fields_select on public.employee_custom_fields
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists employee_custom_fields_insert on public.employee_custom_fields;
create policy employee_custom_fields_insert on public.employee_custom_fields
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists employee_custom_fields_update on public.employee_custom_fields;
create policy employee_custom_fields_update on public.employee_custom_fields
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists employee_custom_fields_delete on public.employee_custom_fields;
create policy employee_custom_fields_delete on public.employee_custom_fields
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );
