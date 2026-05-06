-- =============================================================================
-- 00000000000003_helper_functions.sql
-- Auth / authorization helper functions used by RLS policies and app code.
--
-- All functions are SECURITY DEFINER with explicit search_path to prevent
-- search_path hijacking. Read-only helpers are marked STABLE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- current_user_id() -> uuid
-- -----------------------------------------------------------------------------
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid();
$$;

comment on function public.current_user_id() is
  'Returns the current authenticated user id (auth.uid()).';

-- -----------------------------------------------------------------------------
-- current_user_record() -> public.users
-- -----------------------------------------------------------------------------
create or replace function public.current_user_record()
returns public.users
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.* from public.users u where u.id = auth.uid();
$$;

comment on function public.current_user_record() is
  'Returns the public.users row for the current authenticated user, or NULL.';

-- -----------------------------------------------------------------------------
-- current_employee_id() -> uuid
-- -----------------------------------------------------------------------------
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id
  from public.employees e
  where e.user_id = auth.uid()
    and e.is_active = true
  limit 1;
$$;

comment on function public.current_employee_id() is
  'Returns the active employee id linked to the current auth user (or NULL).';

-- -----------------------------------------------------------------------------
-- current_facility_id() -> uuid
-- -----------------------------------------------------------------------------
create or replace function public.current_facility_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.facility_id
  from public.users u
  where u.id = auth.uid();
$$;

comment on function public.current_facility_id() is
  'Returns the home facility_id of the current user. NULL for super admins.';

-- -----------------------------------------------------------------------------
-- is_super_admin() -> bool
-- -----------------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.is_super_admin from public.users u where u.id = auth.uid()),
    false
  );
$$;

comment on function public.is_super_admin() is
  'True if the current user has the cross-tenant super_admin flag.';

-- -----------------------------------------------------------------------------
-- current_user_role() -> text
-- -----------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.key
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.user_id = auth.uid()
    and e.is_active = true
  limit 1;
$$;

comment on function public.current_user_role() is
  'Role key (e.g. ''gm'', ''manager'') for the current user, derived via employees -> roles.';

-- -----------------------------------------------------------------------------
-- has_module_access(module_key) -> bool
-- -----------------------------------------------------------------------------
create or replace function public.has_module_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.module_permissions mp
      join public.employees e on e.id = mp.employee_id
      where e.user_id = auth.uid()
        and e.is_active = true
        and mp.module_key = p_module_key
        and mp.can_view = true
    );
$$;

comment on function public.has_module_access(text) is
  'True if super admin OR current employee has can_view on the named module.';

-- -----------------------------------------------------------------------------
-- has_module_admin_access(module_key) -> bool
-- -----------------------------------------------------------------------------
create or replace function public.has_module_admin_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.module_permissions mp
      join public.employees e on e.id = mp.employee_id
      where e.user_id = auth.uid()
        and e.is_active = true
        and mp.module_key = p_module_key
        and mp.can_admin = true
    );
$$;

comment on function public.has_module_admin_access(text) is
  'True if super admin OR current employee has can_admin on the named module.';

-- -----------------------------------------------------------------------------
-- has_area_access(module_key, area_id) -> bool
-- -----------------------------------------------------------------------------
create or replace function public.has_area_access(p_module_key text, p_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_super_admin()
    or public.has_module_admin_access(p_module_key)
    or exists (
      select 1
      from public.module_area_permissions map
      join public.employees e on e.id = map.employee_id
      where e.user_id = auth.uid()
        and e.is_active = true
        and map.module_key = p_module_key
        and map.area_id = p_area_id
        and map.can_view = true
    );
$$;

comment on function public.has_area_access(text, uuid) is
  'True if super admin, module admin, OR explicit area-level view grant exists.';

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant execute on function public.current_user_id()                  to authenticated;
grant execute on function public.current_user_record()              to authenticated;
grant execute on function public.current_employee_id()              to authenticated;
grant execute on function public.current_facility_id()              to authenticated;
grant execute on function public.is_super_admin()                   to authenticated;
grant execute on function public.current_user_role()                to authenticated;
grant execute on function public.has_module_access(text)            to authenticated;
grant execute on function public.has_module_admin_access(text)      to authenticated;
grant execute on function public.has_area_access(text, uuid)        to authenticated;
