-- =============================================================================
-- 00000000000069_create_facility_with_roles.sql
--
-- Atomic helper called by the admin facility-creation UI (super_admin only).
-- Creates the facility row and seeds the six canonical system roles in a
-- single transaction so a network failure between the two steps can never
-- leave an orphaned facility with no roles.
--
-- The function is SECURITY DEFINER so it can bypass RLS and insert both rows
-- under the caller's authenticated session. The super_admin guard is enforced
-- inside the function body; no authenticated non-super_admin user can invoke
-- it even if they somehow call it directly.
-- =============================================================================

create or replace function public.create_facility_with_roles(
  p_name      text,
  p_slug      text,
  p_timezone  text,
  p_address   text    default null,
  p_zip_code  text    default null,
  p_phone     text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
begin
  -- Only platform super_admins may create facilities.
  if not public.is_super_admin() then
    raise exception 'create_facility_with_roles: caller is not a super_admin';
  end if;

  -- Basic input validation (mirrors what the server action does, but
  -- defence-in-depth inside the DB keeps the function safe when called
  -- directly via the API).
  if length(trim(p_name)) < 2 then
    raise exception 'create_facility_with_roles: name is too short';
  end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'create_facility_with_roles: invalid slug format';
  end if;

  -- Insert facility.
  insert into public.facilities (
    name, slug, timezone, address, zip_code, phone, is_active
  ) values (
    trim(p_name), lower(trim(p_slug)), coalesce(nullif(trim(p_timezone), ''), 'America/New_York'),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_zip_code, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    true
  )
  returning id into v_facility_id;

  -- Seed canonical system roles.
  insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
  values
    (v_facility_id, 'super_admin', 'Super Admin',    0, true),
    (v_facility_id, 'admin',       'Administrator',  1, true),
    (v_facility_id, 'gm',          'General Manager',2, true),
    (v_facility_id, 'manager',     'Manager',        3, true),
    (v_facility_id, 'supervisor',  'Supervisor',     4, true),
    (v_facility_id, 'staff',       'Staff',          5, true)
  on conflict (facility_id, key) do nothing;

  return v_facility_id;
end;
$$;

comment on function public.create_facility_with_roles(text, text, text, text, text, text) is
  'Atomically creates a facility and seeds its six canonical system roles. '
  'Restricted to platform super_admins. Returns the new facility UUID.';

revoke execute on function public.create_facility_with_roles(text, text, text, text, text, text)
  from public, anon;
grant  execute on function public.create_facility_with_roles(text, text, text, text, text, text)
  to authenticated;
