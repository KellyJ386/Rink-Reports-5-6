-- =============================================================================
-- 00000000000247_rink_scheduling_module_registration.sql
-- Register module #12 'rink_scheduling' in the permission + module-toggle model.
-- Mirrors migration 193 (dasher_boards), the most recent worked example.
--
-- 1. user_permissions.module_name CHECK gains 'rink_scheduling'. Without this
--    no permission row for the module can exist, so every has_module_* helper
--    returns false and the whole module is invisible.
-- 2. seed_default_facility_modules() gains the key; facility_modules is
--    backfilled for every existing facility (nav toggle, migration 144).
-- 3. canonical_role_permission_grants() gains the module's per-role ceilings;
--    role_permission_defaults re-seeded (targeted to this module only).
-- 4. user_permissions backfilled for existing ACTIVE employees, again targeted
--    so per-user overrides on other modules are never disturbed.
--
-- ROLE CEILINGS, AND WHY THEY LOOK LIKE THIS
-- The module spec names five tiers; three of those role keys do not exist here
-- ('gm' and 'supervisor' are retired and CHECK-forbidden since migration 188,
-- and there is no org tier above facility). The spec's tiers therefore map onto
-- the four permission ACTIONS, which is the model this codebase actually
-- resolves authorization through — roles only seed defaults:
--
--   spec org_admin        -> admin   : rate cards, module settings
--   spec facility_manager -> edit    : confirm/edit/cancel, series, customers,
--                                      invoices, payments, AR, setup config,
--                                      display tokens, gap notifications
--   spec supervisor       -> submit  : tentative bookings, locker room assign
--   spec staff            -> view    : read the calendar
--
-- Mapped onto live role keys:
--   super_admin -> admin
--   admin       -> admin   (the org_admin tier: rates + settings)
--   manager     -> edit    (the facility_manager tier: day-to-day operations
--                           and billing, but NOT rate cards or module settings —
--                           deliberate, mirroring how dasher_boards seeds
--                           manager at edit rather than admin)
--   staff       -> view    (see the schedule; no writes)
--   driver      -> view    (resurfacer operators read the ice schedule to plan
--                           floods; they never book or bill)
--
-- A facility that wants a true supervisor tier grants `submit` to a custom role
-- or to an individual in the permissions grid — the same mechanism every other
-- module uses. Nothing here is hardcoded to any one facility.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. user_permissions CHECK constraint.
--    DROP + ADD with the WHOLE list restated — Postgres has no "add a value",
--    and omitting one silently NARROWS the domain (CLAUDE.md calls this the
--    sharp edge). Live list verified against migration 193 before this write:
--    the 10 canonical modules + facility_paperwork + dasher_boards + admin.
-- -----------------------------------------------------------------------------
alter table public.user_permissions
  drop constraint if exists user_permissions_module_name_check;

alter table public.user_permissions
  add constraint user_permissions_module_name_check check (
    module_name in (
      'daily_reports', 'ice_depth', 'ice_operations',
      'incident_reports', 'accident_reports', 'refrigeration',
      'air_quality', 'scheduling', 'communications',
      'facility_paperwork', 'dasher_boards', 'rink_scheduling', 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- 2. facility_modules seeder + backfill (migration 144 pattern).
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
    ('dasher_boards'),
    ('rink_scheduling')
  ) as m(k)
  on conflict (facility_id, module_key) do nothing;
end;
$$;

comment on function public.seed_default_facility_modules(uuid) is
  'Seeds facility_modules with every canonical module enabled (incl. rink_scheduling as of migration 247). Idempotent via on conflict do nothing on (facility_id, module_key).';

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
-- 3. Canonical role grants: the migration-212 matrix (retired keys already
--    stripped) plus rink_scheduling. Restated in full — create or replace
--    needs the entire body, and a dropped row here silently revokes a default.
-- -----------------------------------------------------------------------------
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
      ('manager','admin','view'::public.user_action),
      -- daily_reports
      ('super_admin','daily_reports','admin'::public.user_action),
      ('admin','daily_reports','admin'::public.user_action),
      ('manager','daily_reports','admin'::public.user_action),
      ('staff','daily_reports','submit'::public.user_action),
      ('driver','daily_reports','submit'::public.user_action),
      -- ice_depth
      ('super_admin','ice_depth','admin'::public.user_action),
      ('admin','ice_depth','admin'::public.user_action),
      ('manager','ice_depth','admin'::public.user_action),
      ('staff','ice_depth','submit'::public.user_action),
      ('driver','ice_depth','submit'::public.user_action),
      -- ice_operations
      ('super_admin','ice_operations','admin'::public.user_action),
      ('admin','ice_operations','admin'::public.user_action),
      ('manager','ice_operations','admin'::public.user_action),
      ('staff','ice_operations','submit'::public.user_action),
      ('driver','ice_operations','edit'::public.user_action),
      -- refrigeration
      ('super_admin','refrigeration','admin'::public.user_action),
      ('admin','refrigeration','admin'::public.user_action),
      ('manager','refrigeration','admin'::public.user_action),
      ('staff','refrigeration','submit'::public.user_action),
      ('driver','refrigeration','submit'::public.user_action),
      -- incident_reports
      ('super_admin','incident_reports','admin'::public.user_action),
      ('admin','incident_reports','admin'::public.user_action),
      ('manager','incident_reports','admin'::public.user_action),
      ('staff','incident_reports','submit'::public.user_action),
      ('driver','incident_reports','submit'::public.user_action),
      -- accident_reports
      ('super_admin','accident_reports','admin'::public.user_action),
      ('admin','accident_reports','admin'::public.user_action),
      ('manager','accident_reports','admin'::public.user_action),
      ('staff','accident_reports','submit'::public.user_action),
      ('driver','accident_reports','submit'::public.user_action),
      -- air_quality
      ('super_admin','air_quality','admin'::public.user_action),
      ('admin','air_quality','admin'::public.user_action),
      ('manager','air_quality','admin'::public.user_action),
      ('staff','air_quality','submit'::public.user_action),
      ('driver','air_quality','view'::public.user_action),
      -- scheduling
      ('super_admin','scheduling','admin'::public.user_action),
      ('admin','scheduling','admin'::public.user_action),
      ('manager','scheduling','admin'::public.user_action),
      ('staff','scheduling','view'::public.user_action),
      ('driver','scheduling','view'::public.user_action),
      -- communications
      ('super_admin','communications','admin'::public.user_action),
      ('admin','communications','admin'::public.user_action),
      ('manager','communications','admin'::public.user_action),
      ('staff','communications','submit'::public.user_action),
      ('driver','communications','submit'::public.user_action),
      -- facility_paperwork (document library: manage for admin-tier roles,
      -- read for everyone else; facility_documents RLS writes stay gated on
      -- is_facility_admin regardless)
      ('super_admin','facility_paperwork','admin'::public.user_action),
      ('admin','facility_paperwork','admin'::public.user_action),
      ('manager','facility_paperwork','admin'::public.user_action),
      ('staff','facility_paperwork','view'::public.user_action),
      ('driver','facility_paperwork','view'::public.user_action),
      -- dasher_boards (added migration 193; manager deliberately edit, not admin)
      ('super_admin','dasher_boards','admin'::public.user_action),
      ('admin','dasher_boards','admin'::public.user_action),
      ('manager','dasher_boards','edit'::public.user_action),
      ('staff','dasher_boards','submit'::public.user_action),
      ('driver','dasher_boards','submit'::public.user_action),
      -- rink_scheduling (added migration 247). manager stops at edit: rate
      -- cards and module settings are the admin tier, matching the module
      -- spec's org_admin-only row. staff and driver are read-only.
      ('super_admin','rink_scheduling','admin'::public.user_action),
      ('admin','rink_scheduling','admin'::public.user_action),
      ('manager','rink_scheduling','edit'::public.user_action),
      ('staff','rink_scheduling','view'::public.user_action),
      ('driver','rink_scheduling','view'::public.user_action)
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
  'Canonical per-role default permission grants (expanded to cumulative actions), keyed by role key. Source for seed_role_permission_defaults_for_facility() and the roles auto-seed trigger. rink_scheduling added in migration 247.';

-- Targeted re-seed of role_permission_defaults for the new module only.
insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
select r.facility_id, r.id, g.module_name, g.action, true
from public.roles r
join public.canonical_role_permission_grants() g on g.role_key = r.key
where g.module_name = 'rink_scheduling'
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
  and g.module_name = 'rink_scheduling'
on conflict (user_id, facility_id, module_name, action) do nothing;

commit;
