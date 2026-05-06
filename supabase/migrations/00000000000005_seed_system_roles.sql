-- =============================================================================
-- 00000000000005_seed_system_roles.sql
--
-- No facilities exist yet, so we cannot insert per-facility role rows.
-- Instead, this migration provides a helper that seeds the canonical six
-- system roles for a given facility. Call it from app code (or the facility
-- creation trigger you add later) right after inserting a facilities row.
--
-- Canonical roles (key, hierarchy_level, display_name):
--   super_admin  0  "Super Admin"
--   admin        1  "Administrator"
--   gm           2  "General Manager"
--   manager      3  "Manager"
--   supervisor   4  "Supervisor"
--   staff        5  "Staff"
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
    (p_facility_id, 'super_admin', 'Super Admin',     0, true),
    (p_facility_id, 'admin',       'Administrator',   1, true),
    (p_facility_id, 'gm',          'General Manager', 2, true),
    (p_facility_id, 'manager',     'Manager',         3, true),
    (p_facility_id, 'supervisor',  'Supervisor',      4, true),
    (p_facility_id, 'staff',       'Staff',           5, true)
  on conflict (facility_id, key) do nothing;
end;
$$;

comment on function public.seed_default_roles_for_facility(uuid) is
  'Seeds the six canonical system roles for a newly-created facility. Idempotent.';

-- Intentionally restricted: only service_role / postgres should call this in
-- normal operation. Authenticated end-users have no need for it.
revoke all on function public.seed_default_roles_for_facility(uuid) from public;
grant execute on function public.seed_default_roles_for_facility(uuid) to service_role;
