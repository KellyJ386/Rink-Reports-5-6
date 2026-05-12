-- =============================================================================
-- 00000000000038_permission_level_enum.sql
--
-- Phase 2a of the Admin Control Center redesign: introduces the
-- permission_level enum, the role-based defaults table, and a unified
-- effective_module_permission() resolver. See docs/admin-redesign.md.
--
-- This migration is purely additive. The legacy can_view / can_submit /
-- can_admin columns on module_permissions are preserved; a sync trigger
-- (migration 39) keeps both representations consistent so existing app code
-- continues to work unchanged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum
--
-- Declaration order IS comparison order: 'view' < 'submit' < ... < 'admin'.
-- RLS policies can write `effective_module_permission(...) >= 'submit'`.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'module_permission_level') then
    create type public.module_permission_level as enum (
      'none',
      'view',
      'submit',
      'edit_own',
      'edit_all',
      'approve',
      'publish',
      'manage_settings',
      'admin'
    );
  end if;
end$$;

comment on type public.module_permission_level is
  'Ordered permission grain for the Admin Control Center. '
  'Ordinal comparison is meaningful: a higher level implies all lower-level capabilities.';

-- -----------------------------------------------------------------------------
-- 2. module_permissions.permission_level
--
-- NOT NULL default 'none'. Existing rows get backfilled in migration 39.
-- -----------------------------------------------------------------------------
alter table public.module_permissions
  add column if not exists permission_level public.module_permission_level
    not null default 'none';

comment on column public.module_permissions.permission_level is
  'Authoritative per-employee per-module permission. Legacy can_view/can_submit/can_admin '
  'columns are kept in sync via trigger and read by older code paths.';

create index if not exists idx_module_permissions_permission_level
  on public.module_permissions (permission_level)
  where permission_level <> 'none';

-- -----------------------------------------------------------------------------
-- 3. role_module_permission_defaults
--
-- Per-facility, per-role default permission level for each module. Resolved
-- as a fallback when an employee has no explicit module_permissions row for
-- a given (employee_id, module_key) pair.
-- -----------------------------------------------------------------------------
create table if not exists public.role_module_permission_defaults (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references public.facilities(id) on delete restrict,
  role_id          uuid not null references public.roles(id) on delete cascade,
  module_key       text not null,
  permission_level public.module_permission_level not null default 'none',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  constraint role_module_permission_defaults_uniq unique (role_id, module_key)
);

comment on table public.role_module_permission_defaults is
  'Role-based fallback permissions. effective_module_permission() consults this when '
  'no per-employee module_permissions row exists for a given module.';

create index if not exists idx_role_mp_defaults_facility_id
  on public.role_module_permission_defaults (facility_id);
create index if not exists idx_role_mp_defaults_role_id
  on public.role_module_permission_defaults (role_id);
create index if not exists idx_role_mp_defaults_module_key
  on public.role_module_permission_defaults (module_key);

drop trigger if exists trg_role_mp_defaults_updated_at
  on public.role_module_permission_defaults;
create trigger trg_role_mp_defaults_updated_at
  before update on public.role_module_permission_defaults
  for each row execute function public.set_updated_at();

alter table public.role_module_permission_defaults enable row level security;

drop policy if exists role_mp_defaults_select on public.role_module_permission_defaults;
create policy role_mp_defaults_select
  on public.role_module_permission_defaults
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists role_mp_defaults_insert on public.role_module_permission_defaults;
create policy role_mp_defaults_insert
  on public.role_module_permission_defaults
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists role_mp_defaults_update on public.role_module_permission_defaults;
create policy role_mp_defaults_update
  on public.role_module_permission_defaults
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

drop policy if exists role_mp_defaults_delete on public.role_module_permission_defaults;
create policy role_mp_defaults_delete
  on public.role_module_permission_defaults
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

-- -----------------------------------------------------------------------------
-- 4. effective_module_permission(employee_id, module_key)
--
-- Resolution: super_admin (always 'admin') > per-employee override row >
-- role default > 'none'. Returns 'none' for inactive employees.
-- -----------------------------------------------------------------------------
create or replace function public.effective_module_permission(
  p_employee_id uuid,
  p_module_key  text
)
returns public.module_permission_level
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id    uuid;
  v_user_id    uuid;
  v_is_active  boolean;
  v_is_super   boolean;
  v_override   public.module_permission_level;
  v_default    public.module_permission_level;
begin
  if p_employee_id is null or p_module_key is null then
    return 'none'::module_permission_level;
  end if;

  select e.role_id, e.user_id, e.is_active
    into v_role_id, v_user_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true then
    return 'none'::module_permission_level;
  end if;

  if v_user_id is not null then
    select u.is_super_admin into v_is_super
    from public.users u where u.id = v_user_id;
    if v_is_super then
      return 'admin'::module_permission_level;
    end if;
  end if;

  -- Per-employee override row wins when present (even if it's 'none').
  select mp.permission_level into v_override
  from public.module_permissions mp
  where mp.employee_id = p_employee_id
    and mp.module_key  = p_module_key
  limit 1;

  if v_override is not null then
    return v_override;
  end if;

  -- Fallback to role default.
  select rmd.permission_level into v_default
  from public.role_module_permission_defaults rmd
  where rmd.role_id    = v_role_id
    and rmd.module_key = p_module_key
  limit 1;

  return coalesce(v_default, 'none'::module_permission_level);
end;
$$;

comment on function public.effective_module_permission(uuid, text) is
  'Resolves the effective permission level for (employee, module) using '
  'override → role default → none. Super admins always return ''admin''.';

revoke execute on function public.effective_module_permission(uuid, text) from public, anon;
grant  execute on function public.effective_module_permission(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. current_employee_module_permission(module_key)
--
-- Convenience wrapper for RLS / app code: resolves the level for the
-- currently authenticated user without needing to pass employee_id.
-- -----------------------------------------------------------------------------
create or replace function public.current_employee_module_permission(
  p_module_key text
)
returns public.module_permission_level
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp uuid;
begin
  if public.is_super_admin() then
    return 'admin'::module_permission_level;
  end if;

  v_emp := public.current_employee_id();
  if v_emp is null then
    return 'none'::module_permission_level;
  end if;

  return public.effective_module_permission(v_emp, p_module_key);
end;
$$;

comment on function public.current_employee_module_permission(text) is
  'Returns the effective permission level for the current authenticated user '
  'on the given module, or ''none'' if not authenticated / not an active employee.';

revoke execute on function public.current_employee_module_permission(text) from public, anon;
grant  execute on function public.current_employee_module_permission(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. has_module_permission(): rewrite to delegate to the new resolver.
--
-- Signature unchanged so existing RLS policies (migration 30) keep working.
-- Mapping:
--   'view'   -> level >= 'view'
--   'submit' -> level >= 'submit'
--   'admin'  -> level >= 'manage_settings'
-- -----------------------------------------------------------------------------
create or replace function public.has_module_permission(
  p_module_key text,
  p_perm_type  text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_level    public.module_permission_level;
  v_required public.module_permission_level;
begin
  v_level := public.current_employee_module_permission(p_module_key);

  if v_level = 'none'::module_permission_level then
    return false;
  end if;

  v_required := case p_perm_type
    when 'view'   then 'view'::module_permission_level
    when 'submit' then 'submit'::module_permission_level
    when 'admin'  then 'manage_settings'::module_permission_level
    else 'admin'::module_permission_level
  end;

  return v_level >= v_required;
end;
$$;

comment on function public.has_module_permission(text, text) is
  'Legacy wrapper. Delegates to current_employee_module_permission(). '
  'perm_type=''admin'' maps to level >= ''manage_settings''.';
