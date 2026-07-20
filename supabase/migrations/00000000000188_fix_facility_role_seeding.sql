-- =============================================================================
-- 00000000000188_fix_facility_role_seeding.sql
--
-- Migrations 55/87 consolidated the role model to four canonical roles
-- (super_admin 0, admin 1, manager 2, staff 3) and deleted the retired
-- `gm`/`supervisor` rows — but neither facility-creation seed path was ever
-- updated: both `seed_default_roles_for_facility()` (migration 5) and
-- `create_facility_with_roles()` (last replaced in migration 135) still
-- insert the old six-role set with the old hierarchy levels. Because the
-- roles AFTER INSERT trigger (migration 82) wires permission defaults for
-- any key that `canonical_role_permission_grants()` knows — and that
-- function still carries gm/supervisor ceilings — a facility created from
-- the super-admin console (src/app/admin/facility/actions.ts) comes back
-- with the retired roles fully live, regressing the consolidation and with
-- hierarchy levels inconsistent with every existing facility.
--
-- This migration:
--   1. Re-seeds both functions with only the four canonical roles at the
--      canonical hierarchy levels.
--   2. Adds a CHECK constraint rejecting the retired keys outright, so no
--      future seed/insert path can quietly reintroduce them. (Migration 87
--      already deleted every gm/supervisor row, so the constraint validates
--      against existing data; per-facility custom roles like `driver` use
--      other keys and are unaffected.)
--
-- The rls_isolation.sql harness gains a "FRS" section asserting the
-- create_facility_with_roles output and the constraint.
-- =============================================================================

create or replace function public.seed_default_roles_for_facility(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
  values
    (p_facility_id, 'super_admin', 'Super Admin',   0, true),
    (p_facility_id, 'admin',       'Administrator', 1, true),
    (p_facility_id, 'manager',     'Manager',       2, true),
    (p_facility_id, 'staff',       'Staff',         3, true)
  on conflict (facility_id, key) do nothing;
end;
$$;

comment on function public.seed_default_roles_for_facility(uuid) is
  'Seeds the four canonical system roles for a newly-created facility. Idempotent.';

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
    (v_facility_id, 'super_admin', 'Super Admin',   0, true),
    (v_facility_id, 'admin',       'Administrator', 1, true),
    (v_facility_id, 'manager',     'Manager',       2, true),
    (v_facility_id, 'staff',       'Staff',         3, true)
  on conflict (facility_id, key) do nothing;

  -- Seed scheduling defaults (settings + baseline compliance rules). Idempotent.
  perform public.seed_default_scheduling_config(v_facility_id);

  -- Seed the standard daily-report Operations Checklists catalog. Idempotent.
  perform public.seed_default_daily_report_checklists(v_facility_id);

  return v_facility_id;
end;
$$;

comment on function public.create_facility_with_roles(text, text, text, text, text, text) is
  'Atomically creates a facility, seeds its four canonical system roles, default scheduling config, and the standard daily-report checklist catalog. Restricted to platform super_admins. Returns the new facility UUID.';

-- Belt and suspenders: the retired keys can never come back through any path.
alter table public.roles
  add constraint roles_key_not_retired
  check (key not in ('gm', 'supervisor'));
