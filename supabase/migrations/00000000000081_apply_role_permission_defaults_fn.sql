-- Phase 2: deterministic seeding of user_permissions from role_permission_defaults.

-- Worker: seed one user's permissions from their role's defaults.
-- Idempotent. Never clobbers manual_override rows. Disables (not deletes) stale role_default
-- rows on role change. No-op for super_admin (bypass by users.is_super_admin flag).
-- Intentionally has NO internal authz guard: it is an internal worker, not granted to
-- authenticated, and only reached via guarded entry points (create_employee_complete,
-- update_employee_role, reapply_role_defaults_for_role) or service_role.
create or replace function public.apply_role_permission_defaults(
  p_user_id uuid,
  p_facility_id uuid,
  p_role_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_user_id is null or p_facility_id is null or p_role_id is null then
    raise exception 'apply_role_permission_defaults: user_id, facility_id and role_id are required';
  end if;

  -- super_admin bypasses resolution via the flag; seeding rows would be noise.
  if coalesce((select u.is_super_admin from public.users u where u.id = p_user_id), false) then
    return;
  end if;

  -- 1) Seed/refresh from defaults. ON CONFLICT update is filtered to role_default rows,
  --    so manual_override rows are preserved untouched.
  insert into public.user_permissions as up (user_id, facility_id, module_name, action, enabled, source)
  select p_user_id, p_facility_id, d.module_name, d.action, d.enabled, 'role_default'
  from public.role_permission_defaults d
  where d.facility_id = p_facility_id
    and d.role_id = p_role_id
  on conflict (user_id, facility_id, module_name, action)
  do update set
    enabled = excluded.enabled,
    source = 'role_default',
    updated_at = now()
  where up.source = 'role_default';

  -- 2) Role change: disable role_default rows the new role no longer grants.
  --    Preserve audit trail (disable, not delete). Manual overrides untouched.
  update public.user_permissions up
  set enabled = false, updated_at = now()
  where up.user_id = p_user_id
    and up.facility_id = p_facility_id
    and up.source = 'role_default'
    and up.enabled = true
    and not exists (
      select 1 from public.role_permission_defaults d
      where d.facility_id = p_facility_id
        and d.role_id = p_role_id
        and d.module_name = up.module_name
        and d.action = up.action
        and d.enabled = true
    );
end;
$$;

revoke all on function public.apply_role_permission_defaults(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_role_permission_defaults(uuid, uuid, uuid) to service_role;

comment on function public.apply_role_permission_defaults(uuid, uuid, uuid) is
  'Seeds public.user_permissions for one user from role_permission_defaults. Idempotent; preserves manual_override rows; disables stale role_default rows on role change; no-op for super_admin. Internal worker - call via guarded entry points only.';

-- Entry point: push edited role defaults to every current holder of that role (non-override rows only).
create or replace function public.reapply_role_defaults_for_role(
  p_facility_id uuid,
  p_role_id uuid
) returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_count integer := 0;
  v_user  uuid;
begin
  if not (public.is_super_admin() or public.is_facility_admin(p_facility_id)) then
    raise exception 'reapply_role_defaults_for_role: not authorized';
  end if;

  for v_user in
    select distinct e.user_id
    from public.employees e
    where e.facility_id = p_facility_id
      and e.role_id = p_role_id
      and e.user_id is not null
      and e.is_active = true
  loop
    perform public.apply_role_permission_defaults(v_user, p_facility_id, p_role_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.reapply_role_defaults_for_role(uuid, uuid) from public, anon;
grant execute on function public.reapply_role_defaults_for_role(uuid, uuid) to authenticated, service_role;

comment on function public.reapply_role_defaults_for_role(uuid, uuid) is
  'Admin-guarded. Re-applies role_permission_defaults to all active employees holding the role (preserves manual_override rows). Use after editing a role''s default matrix.';
