-- =============================================================================
-- 00000000000042_employee_custom_fields.sql
--
-- Phase 7 of the Admin Control Center redesign: facility-defined custom
-- employee fields. Each facility can declare its own attributes (locker
-- number, t-shirt size, license expiry, etc.) that render on the employee
-- form alongside the built-in fields.
--
-- Two tables:
--   employee_custom_fields         - the field definitions per facility
--   employee_custom_field_values   - the per-employee value for each field
--
-- Values are stored as text and coerced by the field_type at read time.
-- An enum on field_type keeps the renderer + validator narrow.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_custom_field_type') then
    create type public.employee_custom_field_type as enum (
      'text', 'number', 'date', 'boolean'
    );
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- 1. employee_custom_fields
--
-- Migration 38 created an earlier version of this table (columns
-- field_name/field_value) that is incompatible with this schema. It was never
-- wired up to the application and carries no production data, so drop it
-- here before recreating with the definition-based shape.
-- -----------------------------------------------------------------------------
drop table if exists public.employee_custom_fields cascade;

create table if not exists public.employee_custom_fields (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  key          text not null,
  label        text not null,
  field_type   public.employee_custom_field_type not null default 'text',
  is_required  boolean not null default false,
  sort_order   int     not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint employee_custom_fields_facility_key_uniq unique (facility_id, key),
  constraint employee_custom_fields_key_format check (key ~ '^[a-z][a-z0-9_]{0,62}$')
);

comment on table public.employee_custom_fields is
  'Facility-defined extra columns for employees. Each row is a definition '
  '(e.g. {key: locker_number, label: "Locker #", field_type: text}). Values '
  'live in employee_custom_field_values keyed by employee_id + field_id.';
comment on column public.employee_custom_fields.key is
  'Stable slug (lowercase, underscores). Used as the form field name. Once '
  'in use, prefer creating a new field over renaming.';

create index if not exists idx_employee_custom_fields_facility_active_sort
  on public.employee_custom_fields (facility_id, is_active, sort_order);

drop trigger if exists trg_employee_custom_fields_updated_at
  on public.employee_custom_fields;
create trigger trg_employee_custom_fields_updated_at
  before update on public.employee_custom_fields
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. employee_custom_field_values
-- -----------------------------------------------------------------------------
create table if not exists public.employee_custom_field_values (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  field_id     uuid not null references public.employee_custom_fields(id) on delete cascade,
  value        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint employee_custom_field_values_employee_field_uniq
    unique (employee_id, field_id)
);

comment on table public.employee_custom_field_values is
  'Per-employee value for a custom field definition. NULL/missing value '
  'means "not set". The application coerces value::text by the parent '
  'field_type when reading.';

create index if not exists idx_employee_custom_field_values_facility_id
  on public.employee_custom_field_values (facility_id);
create index if not exists idx_employee_custom_field_values_employee_id
  on public.employee_custom_field_values (employee_id);
create index if not exists idx_employee_custom_field_values_field_id
  on public.employee_custom_field_values (field_id);

drop trigger if exists trg_employee_custom_field_values_updated_at
  on public.employee_custom_field_values;
create trigger trg_employee_custom_field_values_updated_at
  before update on public.employee_custom_field_values
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.employee_custom_fields       enable row level security;
alter table public.employee_custom_field_values enable row level security;

-- ----- employee_custom_fields ----------------------------------------------
drop policy if exists employee_custom_fields_select on public.employee_custom_fields;
create policy employee_custom_fields_select
  on public.employee_custom_fields
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists employee_custom_fields_insert on public.employee_custom_fields;
create policy employee_custom_fields_insert
  on public.employee_custom_fields
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists employee_custom_fields_update on public.employee_custom_fields;
create policy employee_custom_fields_update
  on public.employee_custom_fields
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
create policy employee_custom_fields_delete
  on public.employee_custom_fields
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

-- ----- employee_custom_field_values ----------------------------------------
drop policy if exists employee_custom_field_values_select
  on public.employee_custom_field_values;
create policy employee_custom_field_values_select
  on public.employee_custom_field_values
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists employee_custom_field_values_insert
  on public.employee_custom_field_values;
create policy employee_custom_field_values_insert
  on public.employee_custom_field_values
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin', 'manager')
    )
  );

drop policy if exists employee_custom_field_values_update
  on public.employee_custom_field_values;
create policy employee_custom_field_values_update
  on public.employee_custom_field_values
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin', 'manager')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin', 'manager')
    )
  );

drop policy if exists employee_custom_field_values_delete
  on public.employee_custom_field_values;
create policy employee_custom_field_values_delete
  on public.employee_custom_field_values
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin', 'manager')
    )
  );

-- -----------------------------------------------------------------------------
-- Audit triggers (extend migration 41 coverage)
-- -----------------------------------------------------------------------------
drop trigger if exists trg_audit_employee_custom_fields
  on public.employee_custom_fields;
create trigger trg_audit_employee_custom_fields
  after insert or update or delete on public.employee_custom_fields
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_employee_custom_field_values
  on public.employee_custom_field_values;
create trigger trg_audit_employee_custom_field_values
  after insert or update or delete on public.employee_custom_field_values
  for each row execute function public.audit_row_change();
