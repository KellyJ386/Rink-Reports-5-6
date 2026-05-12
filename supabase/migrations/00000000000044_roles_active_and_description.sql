-- =============================================================================
-- 00000000000044_roles_active_and_description.sql
--
-- Phase 2 of the production permission model. Lets a facility manage its
-- own custom roles: rename, create, deactivate, reorder, copy.
--
-- Additive only. No data backfill needed beyond setting is_active=true for
-- existing rows (column default handles that).
-- =============================================================================

alter table public.roles
  add column if not exists is_active boolean not null default true;

alter table public.roles
  add column if not exists deactivated_at timestamptz;

alter table public.roles
  add column if not exists description text;

create index if not exists idx_roles_is_active
  on public.roles (facility_id, is_active);

-- -----------------------------------------------------------------------------
-- Helper: refuse to deactivate / hard-delete a role that still has active
-- employees assigned, unless the caller is a super_admin.
--
-- The UI calls deactivate_role(role_id, force=>true|false). Hard delete is
-- handled by the existing roles_delete RLS policy (super_admin only).
-- -----------------------------------------------------------------------------
create or replace function public.deactivate_role(
  p_role_id uuid,
  p_force   boolean default false
)
returns table (
  ok             boolean,
  employee_count integer,
  message        text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
  v_is_system   boolean;
  v_count       integer;
begin
  select r.facility_id, r.is_system into v_facility_id, v_is_system
  from public.roles r where r.id = p_role_id;

  if v_facility_id is null then
    return query select false, 0, 'Role not found'::text;
    return;
  end if;

  -- Authorisation: super_admin or facility-scoped admin/gm/super_admin.
  if not (
    public.is_super_admin()
    or (
      v_facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  ) then
    return query select false, 0, 'Not authorised'::text;
    return;
  end if;

  if v_is_system and not public.is_super_admin() then
    return query select false, 0, 'System roles cannot be deactivated by facility admins'::text;
    return;
  end if;

  select count(*)::int into v_count
  from public.employees e
  where e.role_id = p_role_id and e.is_active = true;

  if v_count > 0 and not p_force then
    return query select false, v_count,
      format('%s active employee(s) still assigned. Pass force=true to confirm.', v_count);
    return;
  end if;

  update public.roles
    set is_active = false, deactivated_at = now()
  where id = p_role_id;

  return query select true, v_count, 'Role deactivated'::text;
end;
$$;

comment on function public.deactivate_role(uuid, boolean) is
  'Marks a role inactive. Refuses unless force=true when active employees are '
  'still assigned. System roles can only be deactivated by platform super admins.';

revoke execute on function public.deactivate_role(uuid, boolean) from public, anon;
grant  execute on function public.deactivate_role(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Reactivation
-- -----------------------------------------------------------------------------
create or replace function public.reactivate_role(p_role_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
begin
  select r.facility_id into v_facility_id
  from public.roles r where r.id = p_role_id;

  if v_facility_id is null then
    return false;
  end if;

  if not (
    public.is_super_admin()
    or (
      v_facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  ) then
    return false;
  end if;

  update public.roles
    set is_active = true, deactivated_at = null
  where id = p_role_id;

  return true;
end;
$$;

revoke execute on function public.reactivate_role(uuid) from public, anon;
grant  execute on function public.reactivate_role(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Copy permission defaults from one role to another (within the same facility).
-- Used by the "Copy from existing role" button in the new roles UI.
-- -----------------------------------------------------------------------------
create or replace function public.copy_role_permission_defaults(
  p_source_role_id uuid,
  p_target_role_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src_facility uuid;
  v_tgt_facility uuid;
  v_copied       integer := 0;
begin
  select facility_id into v_src_facility from public.roles where id = p_source_role_id;
  select facility_id into v_tgt_facility from public.roles where id = p_target_role_id;

  if v_src_facility is null or v_tgt_facility is null then
    raise exception 'Source or target role not found';
  end if;

  if v_src_facility <> v_tgt_facility then
    raise exception 'Cannot copy across facilities';
  end if;

  if not (
    public.is_super_admin()
    or (
      v_tgt_facility = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  ) then
    raise exception 'Not authorised';
  end if;

  with src as (
    select module_key, permission_level
    from public.role_module_permission_defaults
    where role_id = p_source_role_id
  ),
  upsert as (
    insert into public.role_module_permission_defaults
      (facility_id, role_id, module_key, permission_level)
    select v_tgt_facility, p_target_role_id, module_key, permission_level
    from src
    on conflict (role_id, module_key)
    do update set permission_level = excluded.permission_level,
                  updated_at       = now()
    returning 1
  )
  select count(*)::int into v_copied from upsert;

  return v_copied;
end;
$$;

comment on function public.copy_role_permission_defaults(uuid, uuid) is
  'Copies all role_module_permission_defaults rows from source to target role. '
  'Requires both roles in the same facility and admin/gm/super_admin auth.';

revoke execute on function public.copy_role_permission_defaults(uuid, uuid) from public, anon;
grant  execute on function public.copy_role_permission_defaults(uuid, uuid) to authenticated;
