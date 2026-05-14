-- 00000000000054_simplify_permission_resolution.sql
--
-- Drops the department and facility permission default tiers introduced in
-- migration 43. Production audit at migration time showed 0 rows in either
-- table; neither tier was ever exposed in the admin UI. The resolution
-- chain collapses to:
--
--   super_admin -> employee override -> role default -> none
--
-- The effective_module_permission() and effective_module_permission_with_source()
-- functions are rewritten in-place (replacing the versions from migration 49)
-- so they no longer reference the dropped tables. Their signatures, return
-- types, and grants are preserved.

begin;

-- Audit triggers (added in migration 46) reference the tables we're dropping.
drop trigger if exists trg_audit_department_module_permission_defaults
  on public.department_module_permission_defaults;
drop trigger if exists trg_audit_facility_module_permission_defaults
  on public.facility_module_permission_defaults;

drop table if exists public.department_module_permission_defaults cascade;
drop table if exists public.facility_module_permission_defaults cascade;

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
  v_role_id     uuid;
  v_user_id     uuid;
  v_facility_id uuid;
  v_is_active   boolean;
  v_is_super    boolean;
  v_override    public.module_permission_level;
  v_role_def    public.module_permission_level;
begin
  if p_employee_id is null or p_module_key is null then
    return 'none'::module_permission_level;
  end if;

  select e.role_id, e.user_id, e.facility_id, e.is_active
    into v_role_id, v_user_id, v_facility_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true then
    return 'none'::module_permission_level;
  end if;

  if not public.is_super_admin() then
    if v_facility_id is null or v_facility_id <> public.current_facility_id() then
      return 'none'::module_permission_level;
    end if;
  end if;

  if v_user_id is not null then
    select u.is_super_admin into v_is_super
    from public.users u where u.id = v_user_id;
    if v_is_super then
      return 'admin'::module_permission_level;
    end if;
  end if;

  select mp.permission_level into v_override
  from public.module_permissions mp
  where mp.employee_id = p_employee_id
    and mp.module_key  = p_module_key
  limit 1;

  if v_override is not null then
    return v_override;
  end if;

  select rmd.permission_level into v_role_def
  from public.role_module_permission_defaults rmd
  where rmd.role_id    = v_role_id
    and rmd.module_key = p_module_key
  limit 1;

  return coalesce(v_role_def, 'none'::module_permission_level);
end;
$$;

comment on function public.effective_module_permission(uuid, text) is
  'Resolves (employee, module). Returns ''none'' when the target employee is '
  'not in the caller''s facility (unless caller is super_admin). Walks '
  'override -> role default -> none.';

revoke execute on function public.effective_module_permission(uuid, text) from public, anon;
grant  execute on function public.effective_module_permission(uuid, text) to authenticated;

create or replace function public.effective_module_permission_with_source(
  p_employee_id uuid,
  p_module_key  text,
  out level     public.module_permission_level,
  out source    text
)
returns record
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id     uuid;
  v_user_id     uuid;
  v_facility_id uuid;
  v_is_active   boolean;
  v_is_super    boolean;
  v_override    public.module_permission_level;
  v_role_def    public.module_permission_level;
begin
  level  := 'none'::module_permission_level;
  source := 'none';

  if p_employee_id is null or p_module_key is null then
    return;
  end if;

  select e.role_id, e.user_id, e.facility_id, e.is_active
    into v_role_id, v_user_id, v_facility_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true then
    return;
  end if;

  if not public.is_super_admin() then
    if v_facility_id is null or v_facility_id <> public.current_facility_id() then
      return;
    end if;
  end if;

  if v_user_id is not null then
    select u.is_super_admin into v_is_super
    from public.users u where u.id = v_user_id;
    if v_is_super then
      level  := 'admin'::module_permission_level;
      source := 'super_admin';
      return;
    end if;
  end if;

  select mp.permission_level into v_override
  from public.module_permissions mp
  where mp.employee_id = p_employee_id and mp.module_key = p_module_key
  limit 1;

  if v_override is not null then
    level  := v_override;
    source := 'override';
    return;
  end if;

  select rmd.permission_level into v_role_def
  from public.role_module_permission_defaults rmd
  where rmd.role_id = v_role_id and rmd.module_key = p_module_key
  limit 1;

  if v_role_def is not null then
    level  := v_role_def;
    source := 'role';
    return;
  end if;
end;
$$;

comment on function public.effective_module_permission_with_source(uuid, text) is
  'Like effective_module_permission() but also returns the tier that produced '
  'the level. Cross-facility callers (non-super_admin) get (none, none).';

revoke execute on function public.effective_module_permission_with_source(uuid, text)
  from public, anon;
grant  execute on function public.effective_module_permission_with_source(uuid, text)
  to authenticated;

commit;
