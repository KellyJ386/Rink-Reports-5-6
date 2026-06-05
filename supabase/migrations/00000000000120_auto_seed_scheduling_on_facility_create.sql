-- =============================================================================
-- 00000000000120_auto_seed_scheduling_on_facility_create.sql
-- Scheduling remediation L4: seed scheduling config when a facility is created.
--
-- create_facility_with_roles() now also calls seed_default_scheduling_config()
-- so a new facility gets its schedule_settings row + baseline compliance rules
-- automatically (previously this only happened when an admin clicked the manual
-- "Seed defaults" button). The seed helper is idempotent, so this is safe for
-- facilities that are later re-seeded.
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

  if length(trim(p_name)) < 2 then
    raise exception 'create_facility_with_roles: name is too short';
  end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'create_facility_with_roles: invalid slug format';
  end if;

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

  insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
  values
    (v_facility_id, 'super_admin', 'Super Admin',    0, true),
    (v_facility_id, 'admin',       'Administrator',  1, true),
    (v_facility_id, 'gm',          'General Manager',2, true),
    (v_facility_id, 'manager',     'Manager',        3, true),
    (v_facility_id, 'supervisor',  'Supervisor',     4, true),
    (v_facility_id, 'staff',       'Staff',          5, true)
  on conflict (facility_id, key) do nothing;

  -- Seed scheduling defaults (settings + baseline compliance rules). Idempotent.
  perform public.seed_default_scheduling_config(v_facility_id);

  return v_facility_id;
end;
$$;

comment on function public.create_facility_with_roles(text, text, text, text, text, text) is
  'Atomically creates a facility, seeds its six canonical system roles, and seeds default scheduling config. Restricted to platform super_admins. Returns the new facility UUID.';

revoke execute on function public.create_facility_with_roles(text, text, text, text, text, text)
  from public, anon;
grant  execute on function public.create_facility_with_roles(text, text, text, text, text, text)
  to authenticated;
