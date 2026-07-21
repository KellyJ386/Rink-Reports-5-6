-- =============================================================================
-- 00000000000198_restore_canonical_grants_paperwork.sql
--
-- Migration 193 (dasher_boards registration) restated
-- canonical_role_permission_grants() from the migration-82 body and thereby
-- clobbered two later amendments — exactly the failure mode the Schema Drift
-- oracle exists to catch (and did, on PR #283):
--   * the facility_paperwork ceilings added in migration 175 (new facilities
--     stopped seeding paperwork role defaults), and
--   * the search_path pin from migration 97 (CREATE OR REPLACE resets
--     proconfig unless restated).
-- This restates the FULL current matrix: migration 175's body + the
-- dasher_boards block from migration 193 + the search_path pin. No data
-- backfill is needed — 193 only replaced the function; existing
-- role_permission_defaults / user_permissions rows were untouched, and no
-- facility or role was created in the broken window.
-- =============================================================================

begin;

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
      ('driver','facility_paperwork','view'::public.user_action),
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
  'Canonical per-role default permission grants (expanded to cumulative actions), keyed by role key. Source for seed_role_permission_defaults_for_facility() and the roles auto-seed trigger. facility_paperwork added in migration 175; dasher_boards in migration 193; full matrix restated in 198 after 193 clobbered the 175 rows.';

-- Migration 192 also redefined has_module_edit_access() — the body matched the
-- pre-existing daily-assignment helper exactly, but CREATE OR REPLACE swapped
-- its comment. Restore a comment naming BOTH consumers.
comment on function public.has_module_edit_access(text) is
  'True if super admin OR the current user has an enabled `edit` grant on the '
  'named module at their current facility (public.user_permissions). The '
  'elevated-but-not-admin tier: daily-report assignment routing '
  '(assign/reassign + visibility bypass) and Dasher Boards ack/resolve.';

-- Safety net for the broken window (193 applied → 198 applied): re-seed any
-- facility whose roles are missing facility_paperwork defaults. Idempotent.
insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
select r.facility_id, r.id, g.module_name, g.action, true
from public.roles r
join public.canonical_role_permission_grants() g on g.role_key = r.key
where g.module_name = 'facility_paperwork'
on conflict (facility_id, role_id, module_name, action) do nothing;

commit;
