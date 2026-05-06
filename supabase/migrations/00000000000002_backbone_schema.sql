-- =============================================================================
-- 00000000000002_backbone_schema.sql
-- Shared backbone schema for the MFO / Rink Reports multi-tenant SaaS.
--
-- Conventions:
--   * UUID primary keys via gen_random_uuid()
--   * Strict facility isolation: every table (except `facilities`) carries
--     `facility_id` with ON DELETE RESTRICT.
--   * Soft delete via `is_active` / `deactivated_at` rather than row removal.
--   * snake_case names; timestamps in timestamptz.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at trigger function
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger helper: sets NEW.updated_at = now() on UPDATE.';

-- -----------------------------------------------------------------------------
-- 1. facilities
-- -----------------------------------------------------------------------------
create table if not exists public.facilities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  timezone    text not null default 'America/New_York',
  settings    jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

comment on table public.facilities is
  'Tenant root. Each facility is an isolated multi-tenant boundary.';
comment on column public.facilities.slug is
  'URL-safe unique identifier for the facility (e.g. ''max-ice-center'').';
comment on column public.facilities.settings is
  'Per-facility feature flags / configuration blob.';

create index if not exists idx_facilities_is_active
  on public.facilities (is_active);

drop trigger if exists trg_facilities_updated_at on public.facilities;
create trigger trg_facilities_updated_at
  before update on public.facilities
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. roles
-- -----------------------------------------------------------------------------
create table if not exists public.roles (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references public.facilities(id) on delete restrict,
  key              text not null,
  display_name     text not null,
  hierarchy_level  int  not null,
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  constraint roles_facility_key_uniq unique (facility_id, key),
  constraint roles_hierarchy_nonneg check (hierarchy_level >= 0)
);

comment on table public.roles is
  'Per-facility role definitions (super_admin, admin, gm, manager, supervisor, staff).';
comment on column public.roles.key is
  'Stable machine key for the role (e.g. ''gm'').';
comment on column public.roles.hierarchy_level is
  'Lower = more powerful. 0 = super_admin, 5 = staff.';
comment on column public.roles.is_system is
  'True for roles seeded by the system; protects against accidental edits.';

create index if not exists idx_roles_facility_id on public.roles (facility_id);

drop trigger if exists trg_roles_updated_at on public.roles;
create trigger trg_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. departments
-- -----------------------------------------------------------------------------
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  name        text not null,
  slug        text not null,
  color       text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint departments_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.departments is
  'Operational departments within a facility (Ice Ops, Concessions, Front Desk, etc.).';
comment on column public.departments.color is
  'Optional hex color for UI badges (e.g. ''#1e88e5'').';

create index if not exists idx_departments_facility_id on public.departments (facility_id);

drop trigger if exists trg_departments_updated_at on public.departments;
create trigger trg_departments_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. users  (1:1 extension of auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  facility_id     uuid references public.facilities(id) on delete restrict,
  email           citext not null unique,
  full_name       text,
  phone           text,
  is_super_admin  boolean not null default false,
  is_active       boolean not null default true,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

comment on table public.users is
  'App-level user profile, 1:1 with auth.users. Super admins may have NULL facility_id.';
comment on column public.users.facility_id is
  'Home facility. NULL is permitted ONLY for super admins.';
comment on column public.users.is_super_admin is
  'Cross-tenant administrator. Bypasses facility isolation in RLS.';

create index if not exists idx_users_facility_id on public.users (facility_id);
create index if not exists idx_users_is_super_admin on public.users (is_super_admin)
  where is_super_admin = true;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. employees
--    Operational identity. May be linked to a user (login), or stand alone.
-- -----------------------------------------------------------------------------
create table if not exists public.employees (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  user_id                  uuid references public.users(id) on delete set null,
  role_id                  uuid not null references public.roles(id) on delete restrict,
  employee_code            text,
  first_name               text not null,
  last_name                text not null,
  email                    citext,
  phone                    text,
  is_minor                 boolean not null default false,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  hire_date                date,
  is_active                boolean not null default true,
  deactivated_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  created_by               uuid references public.users(id) on delete set null,
  constraint employees_facility_code_uniq unique (facility_id, employee_code)
);

comment on table public.employees is
  'Operational staff identity. Single-valued role_id (no multi-level membership). '
  'Inactive employees are retained for historical FK integrity.';
comment on column public.employees.user_id is
  'Optional link to an auth user. NULL means employee has no login.';
comment on column public.employees.is_minor is
  'True if employee is under 18 (drives labor law UI / scheduling restrictions).';

create index if not exists idx_employees_facility_id on public.employees (facility_id);
create index if not exists idx_employees_user_id     on public.employees (user_id);
create index if not exists idx_employees_role_id     on public.employees (role_id);
create index if not exists idx_employees_is_active   on public.employees (is_active);

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. employee_departments  (many-to-many)
-- -----------------------------------------------------------------------------
create table if not exists public.employee_departments (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint employee_departments_uniq unique (employee_id, department_id)
);

comment on table public.employee_departments is
  'Junction: an employee may belong to many departments. is_primary marks the home dept.';

create index if not exists idx_employee_departments_facility_id
  on public.employee_departments (facility_id);
create index if not exists idx_employee_departments_employee_id
  on public.employee_departments (employee_id);
create index if not exists idx_employee_departments_department_id
  on public.employee_departments (department_id);

-- At most one primary department per employee.
create unique index if not exists uniq_employee_departments_primary
  on public.employee_departments (employee_id)
  where is_primary = true;

-- -----------------------------------------------------------------------------
-- 7. module_permissions
-- -----------------------------------------------------------------------------
create table if not exists public.module_permissions (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  module_key  text not null,
  can_view    boolean not null default false,
  can_submit  boolean not null default false,
  can_admin   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint module_permissions_employee_module_uniq unique (employee_id, module_key)
);

comment on table public.module_permissions is
  'Per-employee, per-module capability flags (view/submit/admin). '
  'module_key examples: daily_reports, ice_depth, ice_operations, incident_reports, '
  'accident_reports, refrigeration, air_quality, scheduling, communications, admin.';

create index if not exists idx_module_permissions_facility_id
  on public.module_permissions (facility_id);
create index if not exists idx_module_permissions_employee_id
  on public.module_permissions (employee_id);
create index if not exists idx_module_permissions_module_key
  on public.module_permissions (module_key);

drop trigger if exists trg_module_permissions_updated_at on public.module_permissions;
create trigger trg_module_permissions_updated_at
  before update on public.module_permissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 8. module_area_permissions
--    Finer-grained per-area scoping. area_id intentionally has no FK because
--    "area" lives inside per-module tables (e.g. ice rinks, HVAC zones).
-- -----------------------------------------------------------------------------
create table if not exists public.module_area_permissions (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  module_key  text not null,
  area_id     uuid not null,
  can_view    boolean not null default false,
  can_submit  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint module_area_permissions_uniq unique (employee_id, module_key, area_id)
);

comment on table public.module_area_permissions is
  'Per-area access within a module. area_id is a soft reference into module-specific '
  'tables; no FK is enforced here because the target table varies by module.';

create index if not exists idx_module_area_permissions_facility_id
  on public.module_area_permissions (facility_id);
create index if not exists idx_module_area_permissions_employee_id
  on public.module_area_permissions (employee_id);
create index if not exists idx_module_area_permissions_module_key
  on public.module_area_permissions (module_key);
create index if not exists idx_module_area_permissions_area_id
  on public.module_area_permissions (area_id);

-- -----------------------------------------------------------------------------
-- 9. audit_logs
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities(id) on delete restrict,
  actor_user_id      uuid references public.users(id) on delete set null,
  actor_employee_id  uuid references public.employees(id) on delete set null,
  action             text not null,
  entity_type        text not null,
  entity_id          uuid,
  before             jsonb,
  after              jsonb,
  ip                 inet,
  user_agent         text,
  created_at         timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only audit trail. No UPDATE/DELETE allowed by RLS.';
comment on column public.audit_logs.action is
  'Verb (e.g. ''create'', ''update'', ''delete'', ''login'').';
comment on column public.audit_logs.entity_type is
  'Logical type (table or domain object) being acted upon.';

create index if not exists idx_audit_logs_facility_id
  on public.audit_logs (facility_id);
create index if not exists idx_audit_logs_actor_user_id
  on public.audit_logs (actor_user_id);
create index if not exists idx_audit_logs_entity
  on public.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_logs_created_at
  on public.audit_logs (created_at desc);
