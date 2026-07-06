-- =============================================================================
-- 00000000000175_facility_paperwork_permission_model.sql
--
-- The facility_paperwork module is enabled in facility_modules but was never
-- wired into the permission model (2026-07-06 admin-area review):
--
--   1. user_permissions.module_name_check (migration 77) does not allow
--      'facility_paperwork', so no per-user grant can be written for it —
--      the admin permissions UI and apply_role_permission_defaults() both
--      trip the constraint.
--   2. canonical_role_permission_grants() (migration 82) has no
--      facility_paperwork ceilings, so role creation seeds nothing for it.
--
-- Net effect: current_user_has_permission('facility_paperwork', ...) could
-- only ever be true via the super-admin bypass.
--
-- Order matters here: the CHECK must be widened BEFORE any
-- role_permission_defaults rows exist for the module, because
-- apply_role_permission_defaults() copies ALL of a role's default rows into
-- user_permissions in one INSERT ... SELECT — a facility_paperwork default
-- row behind the old constraint breaks re-seeding for every module.
-- =============================================================================

begin;

-- 1. Allow the module in per-user permissions.
alter table public.user_permissions
  drop constraint user_permissions_module_name_check;
alter table public.user_permissions
  add constraint user_permissions_module_name_check check (
    module_name in (
      'daily_reports', 'ice_depth', 'ice_operations',
      'incident_reports', 'accident_reports', 'refrigeration',
      'air_quality', 'scheduling', 'communications',
      'facility_paperwork', 'admin'
    )
  );

-- 2. Add facility_paperwork ceilings to the canonical matrix.
--    Document library: admins (and managers, consistent with every other
--    module where manager == admin ceiling) manage documents; supervisors,
--    staff, and drivers read them. Full function body restated because
--    CREATE OR REPLACE resets proconfig — the search_path pin from
--    migration 97 is re-specified inline.
create or replace function public.canonical_role_permission_grants()
returns table(role_key text, module_name text, action public.user_action)
language sql
immutable
set search_path = public, pg_temp
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
      -- facility_paperwork (document library: manage for admin-tier roles,
      -- read for everyone else; facility_documents RLS writes stay gated on
      -- is_facility_admin regardless)
      ('super_admin','facility_paperwork','admin'::public.user_action),
      ('admin','facility_paperwork','admin'::public.user_action),
      ('gm','facility_paperwork','admin'::public.user_action),
      ('manager','facility_paperwork','admin'::public.user_action),
      ('supervisor','facility_paperwork','view'::public.user_action),
      ('staff','facility_paperwork','view'::public.user_action),
      ('driver','facility_paperwork','view'::public.user_action)
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

-- 3. Backfill role defaults for existing facilities/roles (same expansion the
--    role-creation trigger from migration 82 performs for new roles).
insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
select r.facility_id, r.id, g.module_name, g.action, true
from public.roles r
join public.canonical_role_permission_grants() g on g.role_key = r.key
where g.module_name = 'facility_paperwork'
on conflict (facility_id, role_id, module_name, action) do nothing;

-- 4. Propagate to users who have active employee records. Preserves
--    manual_override rows and skips super-admins (both by design of
--    apply_role_permission_defaults, migration 77).
do $$
declare rec record;
begin
  for rec in
    select e.user_id, e.facility_id, e.role_id
    from public.employees e
    where e.user_id is not null and e.is_active
  loop
    perform public.apply_role_permission_defaults(rec.user_id, rec.facility_id, rec.role_id);
  end loop;
end $$;

commit;
