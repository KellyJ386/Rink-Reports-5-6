-- =============================================================================
-- 00000000000193_dasher_boards_module_registration.sql
-- Register module #11 "dasher_boards" in the permission + module-toggle model.
--
-- 1. user_permissions module_name CHECK gains 'dasher_boards' (without this no
--    permission rows can be inserted for the module).
-- 2. seed_default_facility_modules() gains the key; backfill facility_modules
--    for every existing facility (nav toggle, migration 144 pattern).
-- 3. canonical_role_permission_grants() gains the module's per-role ceilings;
--    role_permission_defaults re-seeded for existing facilities (targeted).
-- 4. user_permissions backfilled for existing ACTIVE employees from their
--    role's new defaults — targeted to dasher_boards only, so per-user
--    overrides admins made on other modules are never touched (contrast with
--    migration 171, which only handled zero-row accounts).
--
-- Role ceilings for dasher_boards (approved mapping of the module's tiers onto
-- the 4-role model; roles only seed defaults — authorization is resolved via
-- user_permissions):
--   super_admin / admin -> admin   ("facility_manager+": setup wizard, asset
--                                    editing, subtype/category/checklist admin)
--   manager             -> edit    ("supervisor+": A-severity ack, resolve)
--   staff               -> submit  (report issues, perform walks)
--   gm / supervisor     -> admin / edit (retired keys, inert; kept for matrix
--                                    consistency with migration 82)
--   driver              -> submit  (resurfacer operators report board impacts)
-- NOTE: the house matrix seeds manager as module-ADMIN on the other modules;
-- dasher_boards deliberately seeds manager at edit per the approved mapping
-- (admins can raise individual users in the permissions grid as needed).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. user_permissions CHECK constraint (live list verified before this write:
--    the 10 canonical modules + facility_paperwork + admin).
-- -----------------------------------------------------------------------------
alter table public.user_permissions
  drop constraint if exists user_permissions_module_name_check;

alter table public.user_permissions
  add constraint user_permissions_module_name_check check (
    module_name in (
      'daily_reports', 'ice_depth', 'ice_operations',
      'incident_reports', 'accident_reports', 'refrigeration',
      'air_quality', 'scheduling', 'communications',
      'facility_paperwork', 'dasher_boards', 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- 2. facility_modules seeder + backfill (migration 144 pattern)
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_facility_modules(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.facility_modules (facility_id, module_key, enabled)
  select p_facility_id, k, true
  from (values
    ('daily_reports'),
    ('ice_depth'),
    ('ice_operations'),
    ('refrigeration'),
    ('air_quality'),
    ('incident_reports'),
    ('accident_reports'),
    ('scheduling'),
    ('communications'),
    ('facility_paperwork'),
    ('dasher_boards')
  ) as m(k)
  on conflict (facility_id, module_key) do nothing;
end;
$$;

comment on function public.seed_default_facility_modules(uuid) is
  'Seeds facility_modules with every canonical module enabled (incl. dasher_boards as of migration 193). Idempotent via on conflict do nothing on (facility_id, module_key).';

revoke execute on function public.seed_default_facility_modules(uuid) from public;
grant  execute on function public.seed_default_facility_modules(uuid) to service_role;

do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_facility_modules(f.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Canonical role grants: full matrix from migration 82 + dasher_boards rows.
-- -----------------------------------------------------------------------------
create or replace function public.canonical_role_permission_grants()
returns table(role_key text, module_name text, action public.user_action)
language sql
immutable
as $$
  with ceilings(role_key, module_name, ceiling) as (
    values
      -- admin (Control Center)
      ('super_admin','admin','admin'::public.user_action),
      ('admin','admin','admin'::public.user_action),
      ('gm','admin','admin'::public.user_action),
      ('manager','admin','view'::public.user_action),
      -- daily_reports
      ('super_admin','daily_reports','admin'::public.user_action),
      ('admin','daily_reports','admin'::public.user_action),
      ('gm','daily_reports','admin'::public.user_action),
      ('manager','daily_reports','admin'::public.user_action),
      ('supervisor','daily_reports','edit'::public.user_action),
      ('staff','daily_reports','submit'::public.user_action),
      ('driver','daily_reports','submit'::public.user_action),
      -- ice_depth
      ('super_admin','ice_depth','admin'::public.user_action),
      ('admin','ice_depth','admin'::public.user_action),
      ('gm','ice_depth','admin'::public.user_action),
      ('manager','ice_depth','admin'::public.user_action),
      ('supervisor','ice_depth','edit'::public.user_action),
      ('staff','ice_depth','submit'::public.user_action),
      ('driver','ice_depth','submit'::public.user_action),
      -- ice_operations
      ('super_admin','ice_operations','admin'::public.user_action),
      ('admin','ice_operations','admin'::public.user_action),
      ('gm','ice_operations','admin'::public.user_action),
      ('manager','ice_operations','admin'::public.user_action),
      ('supervisor','ice_operations','edit'::public.user_action),
      ('staff','ice_operations','submit'::public.user_action),
      ('driver','ice_operations','edit'::public.user_action),
      -- refrigeration
      ('super_admin','refrigeration','admin'::public.user_action),
      ('admin','refrigeration','admin'::public.user_action),
      ('gm','refrigeration','admin'::public.user_action),
      ('manager','refrigeration','admin'::public.user_action),
      ('supervisor','refrigeration','edit'::public.user_action),
      ('staff','refrigeration','submit'::public.user_action),
      ('driver','refrigeration','submit'::public.user_action),
      -- incident_reports
      ('super_admin','incident_reports','admin'::public.user_action),
      ('admin','incident_reports','admin'::public.user_action),
      ('gm','incident_reports','admin'::public.user_action),
      ('manager','incident_reports','admin'::public.user_action),
      ('supervisor','incident_reports','edit'::public.user_action),
      ('staff','incident_reports','submit'::public.user_action),
      ('driver','incident_reports','submit'::public.user_action),
      -- accident_reports
      ('super_admin','accident_reports','admin'::public.user_action),
      ('admin','accident_reports','admin'::public.user_action),
      ('gm','accident_reports','admin'::public.user_action),
      ('manager','accident_reports','admin'::public.user_action),
      ('supervisor','accident_reports','edit'::public.user_action),
      ('staff','accident_reports','submit'::public.user_action),
      ('driver','accident_reports','submit'::public.user_action),
      -- air_quality
      ('super_admin','air_quality','admin'::public.user_action),
      ('admin','air_quality','admin'::public.user_action),
      ('gm','air_quality','admin'::public.user_action),
      ('manager','air_quality','admin'::public.user_action),
      ('supervisor','air_quality','edit'::public.user_action),
      ('staff','air_quality','submit'::public.user_action),
      ('driver','air_quality','view'::public.user_action),
      -- scheduling
      ('super_admin','scheduling','admin'::public.user_action),
      ('admin','scheduling','admin'::public.user_action),
      ('gm','scheduling','admin'::public.user_action),
      ('manager','scheduling','admin'::public.user_action),
      ('supervisor','scheduling','edit'::public.user_action),
      ('staff','scheduling','view'::public.user_action),
      ('driver','scheduling','view'::public.user_action),
      -- communications
      ('super_admin','communications','admin'::public.user_action),
      ('admin','communications','admin'::public.user_action),
      ('gm','communications','admin'::public.user_action),
      ('manager','communications','admin'::public.user_action),
      ('supervisor','communications','edit'::public.user_action),
      ('staff','communications','submit'::public.user_action),
      ('driver','communications','submit'::public.user_action),
      -- dasher_boards (added migration 193; manager deliberately edit, not admin)
      ('super_admin','dasher_boards','admin'::public.user_action),
      ('admin','dasher_boards','admin'::public.user_action),
      ('gm','dasher_boards','admin'::public.user_action),
      ('manager','dasher_boards','edit'::public.user_action),
      ('supervisor','dasher_boards','edit'::public.user_action),
      ('staff','dasher_boards','submit'::public.user_action),
      ('driver','dasher_boards','submit'::public.user_action)
  ),
  action_levels(action, lvl) as (
    values
      ('view'::public.user_action, 1),
      ('submit'::public.user_action, 2),
      ('edit'::public.user_action, 3),
      ('admin'::public.user_action, 4)
  )
  select c.role_key, c.module_name, al.action
  from ceilings c
  join action_levels cl on cl.action = c.ceiling
  join action_levels al on al.lvl <= cl.lvl
$$;

comment on function public.canonical_role_permission_grants() is
  'Canonical per-role default permission grants (expanded to cumulative actions), keyed by role key. Source for seed_role_permission_defaults_for_facility() and the roles auto-seed trigger. dasher_boards added in migration 193.';

-- Targeted re-seed of role_permission_defaults for the new module only (direct
-- insert — the seed helper is auth-guarded and this runs as the migration role).
insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
select r.facility_id, r.id, g.module_name, g.action, true
from public.roles r
join public.canonical_role_permission_grants() g on g.role_key = r.key
where g.module_name = 'dasher_boards'
on conflict (facility_id, role_id, module_name, action) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Backfill user_permissions for existing ACTIVE employees (new module only).
-- -----------------------------------------------------------------------------
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled, source)
select distinct e.user_id, e.facility_id, g.module_name, g.action, true, 'role_default'
from public.employees e
join public.roles r on r.id = e.role_id
join public.canonical_role_permission_grants() g on g.role_key = r.key
where e.is_active
  and e.user_id is not null
  and e.facility_id is not null
  and g.module_name = 'dasher_boards'
on conflict (user_id, facility_id, module_name, action) do nothing;

commit;
