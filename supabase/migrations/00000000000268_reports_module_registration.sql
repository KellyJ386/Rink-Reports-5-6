-- =============================================================================
-- 00000000000268_reports_module_registration.sql
-- Register module #13 "reports" in the permission + module-toggle model.
--
-- This lands BEFORE the reporting data layer and UI on purpose. Registering the
-- module afterwards would ship a window in which any authenticated account
-- could read facility-wide compliance aggregates, which is the exact inverse of
-- what the module is for.
--
-- Follows the migration 193 / 249 registration pattern:
--   1. user_permissions module_name CHECK gains 'reports' (without this no
--      permission row for the module can be inserted at all).
--   2. seed_default_facility_modules() gains the key; facility_modules
--      backfilled for every existing facility (migration 144 pattern).
--   3. canonical_role_permission_grants() gains the module's per-role ceilings;
--      role_permission_defaults re-seeded for existing facilities (targeted).
--   4. user_permissions backfilled for existing ACTIVE employees from their
--      role's new defaults — targeted to 'reports' only, so per-user overrides
--      admins made on other modules are never touched.
--
-- ROLE CEILINGS (approved 2026-08-28):
--   super_admin / admin -> admin
--   manager             -> admin   (runs, exports and configures reports)
--   staff / driver      -> NO ROWS (i.e. none)
--
-- staff and driver are absent by design, not by omission. A ceiling of 'none'
-- in this model is the absence of rows; there is nothing to insert. The whole
-- point of gating this module is that a front desk employee cannot pull the
-- facility's annual incident summary.
--
-- WHY facility_modules DEFAULTS TO ENABLED. seed_default_facility_modules()
-- seeds every canonical module with enabled = true and 'reports' is seeded the
-- same way, for two reasons: the per-facility module toggle drives NAV
-- VISIBILITY only (getEnabledModuleKeys fails open when a facility has no
-- rows), and authorization is resolved through user_permissions, where staff
-- and driver hold nothing. An enabled row therefore exposes the module to
-- exactly the admins and managers who are meant to have it.
--
-- The nav entry and the route itself are NOT part of this migration — they land
-- with the reporting UI, on its own module-gated route outside /admin (a
-- /admin/* page would gate on requireAdmin, which managers fail: they hold
-- 'view' on the admin module, not 'admin', so the very people meant to run the
-- monthly report could not open it). 'reports' is likewise deliberately absent
-- from TOGGLEABLE_MODULE_KEYS until that nav entry exists, so the admin module
-- screen does not show a toggle that controls nothing.
--
-- THE 193/198 TRAP. canonical_role_permission_grants() is a WHOLE-MATRIX
-- restatement — create or replace rewrites every row, so a module left out of
-- the restated VALUES list is silently deleted from the seed matrix. Migration
-- 198 exists for no other reason than to repair migration 193 having dropped
-- facility_paperwork this way. The body below was generated from the LIVE
-- function definition with only the reports rows appended, and the migration
-- asserts at the end that no pre-existing grant was lost, so the same mistake
-- fails loudly here instead of surfacing months later as a role that silently
-- stopped seeding a module.
-- =============================================================================

begin;

-- Snapshot the matrix before it is restated, so the assertion at the bottom can
-- prove nothing was dropped. ON COMMIT DROP: this is scaffolding, not schema.
create temp table _canon_before on commit drop as
  select role_key, module_name, action from public.canonical_role_permission_grants();

-- -----------------------------------------------------------------------------
-- 1. user_permissions CHECK constraint.
--    Live list verified against the running database before this write: the 12
--    canonical modules + admin (13 values). Restated in full below plus
--    'reports' (14) — Postgres has no "add a value" for an enumerated CHECK, so
--    this is DROP + ADD with the whole list, and omitting one silently NARROWS
--    the domain.
-- -----------------------------------------------------------------------------
alter table public.user_permissions
  drop constraint if exists user_permissions_module_name_check;

alter table public.user_permissions
  add constraint user_permissions_module_name_check check (
    module_name in (
      'daily_reports', 'ice_depth', 'ice_operations',
      'incident_reports', 'accident_reports', 'refrigeration',
      'air_quality', 'scheduling', 'communications',
      'facility_paperwork', 'dasher_boards', 'rink_scheduling',
      'reports', 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- 2. facility_modules seeder + backfill (migration 144 pattern).
--    The facilities_seed_modules trigger already calls this on facility insert,
--    so updating the function is all that is needed for facilities created
--    from here on.
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
    ('rink_scheduling'),
    ('reports')
  ) as m(k)
  on conflict (facility_id, module_key) do nothing;
end;
$$;

comment on function public.seed_default_facility_modules(uuid) is
  'Seeds facility_modules with every canonical module enabled (incl. reports as of migration 268). Idempotent via on conflict do nothing on (facility_id, module_key).';

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
-- 3. Canonical role grants: the full live matrix + the reports rows.
--    The roles auto-seed trigger (seed_role_permission_defaults_after_insert)
--    and seed_role_permission_defaults_for_facility() both read this function,
--    so a role or facility created after this migration picks up reports with
--    no further work.
-- -----------------------------------------------------------------------------
create or replace function public.canonical_role_permission_grants()
returns table(role_key text, module_name text, action public.user_action)
language sql
immutable
-- Migration 97 (security_hardening_v3) pinned this function's search_path.
-- `create or replace` REPLACES the attribute list, so omitting this line
-- silently un-hardens the function — the same shape of loss as dropping a
-- module from the VALUES list below, and just as invisible in review. The
-- assertion after the body checks it survived.
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
      -- rink_scheduling (added migration 249). manager stops at edit: rate
      -- cards and module settings are the admin tier, matching the module
      -- spec's org_admin-only row. staff and driver are read-only.
      ('super_admin','rink_scheduling','admin'::public.user_action),
      ('admin','rink_scheduling','admin'::public.user_action),
      ('manager','rink_scheduling','edit'::public.user_action),
      ('staff','rink_scheduling','view'::public.user_action),
      ('driver','rink_scheduling','view'::public.user_action),
      -- reports (added migration 268). The reporting layer aggregates every
      -- other module's data into facility-wide compliance numbers, so the
      -- ceiling is deliberately NOT the house default.
      --
      -- staff and driver get NO ROWS AT ALL — that is how 'none' is expressed
      -- in this model, and it is the point of the module: a front desk
      -- employee must not be able to pull the facility's annual incident
      -- summary. Do not "fix" their absence by adding a view row.
      --
      -- manager sits at admin (approved 2026-08-28): facility managers are the
      -- people who actually run and export the monthly report. Under the
      -- Phase 6 export gate ('edit' or higher) this is what lets them produce
      -- the PDF, and admin additionally lets them configure report settings.
      ('super_admin','reports','admin'::public.user_action),
      ('admin','reports','admin'::public.user_action),
      ('manager','reports','admin'::public.user_action)
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
  'Canonical per-role default permission grants (expanded to cumulative actions), keyed by role key. Source for seed_role_permission_defaults_for_facility() and the roles auto-seed trigger. reports added in migration 268.';

-- The 193/198 guard: prove the restatement above is purely additive. Anything
-- that was in the matrix before this migration must still be in it.
do $$
declare
  v_lost   int;
  v_sample text;
begin
  select count(*), coalesce(min(role_key || '/' || module_name || '/' || action::text), '')
    into v_lost, v_sample
  from (
    select role_key, module_name, action from _canon_before
    except
    select role_key, module_name, action from public.canonical_role_permission_grants()
  ) q;

  if v_lost > 0 then
    raise exception
      'migration 268 DROPPED % pre-existing grant(s) from canonical_role_permission_grants() (e.g. %). '
      'Restate the WHOLE matrix — migration 198 existed only to repair migration 193 making exactly this mistake.',
      v_lost, v_sample;
  end if;

  raise notice 'migration 268: canonical grant matrix is purely additive (% grants before, % after)',
    (select count(*) from _canon_before),
    (select count(*) from public.canonical_role_permission_grants());
end $$;

-- The same trap one level up: `create or replace` rewrites a function's
-- ATTRIBUTES too, so a restatement can silently drop the search_path pinning
-- that migration 97 applied, or flip volatility. Rows being additive says
-- nothing about either.
do $$
declare
  v_config text;
  v_vol    "char";
begin
  select coalesce(array_to_string(proconfig, ','), '(none)'), provolatile
    into v_config, v_vol
  from pg_proc
  where proname = 'canonical_role_permission_grants'
    and pronamespace = 'public'::regnamespace;

  if v_config not like '%search_path=public, pg_temp%' then
    raise exception
      'migration 268: canonical_role_permission_grants() lost its pinned search_path (now %). '
      'Migration 97 hardened it; create or replace must restate `set search_path = public, pg_temp`.',
      v_config;
  end if;

  if v_vol <> 'i' then
    raise exception
      'migration 268: canonical_role_permission_grants() is no longer IMMUTABLE (volatility %)', v_vol;
  end if;

  raise notice 'migration 268: function attributes preserved (immutable, %)', v_config;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Targeted re-seed of role_permission_defaults for the new module only.
--    Direct insert rather than the seed helper, which is auth-guarded and would
--    reject the migration role.
-- -----------------------------------------------------------------------------
insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
select r.facility_id, r.id, g.module_name, g.action, true
from public.roles r
join public.canonical_role_permission_grants() g on g.role_key = r.key
where g.module_name = 'reports'
on conflict (facility_id, role_id, module_name, action) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Backfill user_permissions for existing ACTIVE employees (new module only).
--    Scoped to module_name = 'reports' so overrides on other modules are never
--    disturbed. staff and driver contribute no rows (no canonical grants), so
--    this grants the module to admins and managers only.
-- -----------------------------------------------------------------------------
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled, source)
select distinct e.user_id, e.facility_id, g.module_name, g.action, true, 'role_default'
from public.employees e
join public.roles r on r.id = e.role_id
join public.canonical_role_permission_grants() g on g.role_key = r.key
where e.is_active
  and e.user_id is not null
  and e.facility_id is not null
  and g.module_name = 'reports'
on conflict (user_id, facility_id, module_name, action) do nothing;

-- Report what the registration actually granted, so the deploy log carries it.
do $$
declare
  r record;
begin
  raise notice 'migration 268: facility_modules rows for reports: %',
    (select count(*) from public.facility_modules where module_key = 'reports');
  raise notice 'migration 268: role_permission_defaults rows for reports: %',
    (select count(*) from public.role_permission_defaults where module_name = 'reports');
  for r in
    select coalesce(ro.key, '(no role)') as role_key, count(distinct up.user_id) as users
    from public.user_permissions up
    left join public.employees e on e.user_id = up.user_id and e.facility_id = up.facility_id
    left join public.roles ro on ro.id = e.role_id
    where up.module_name = 'reports'
    group by 1 order by 1
  loop
    raise notice 'migration 268: reports granted to % user(s) with role %', r.users, r.role_key;
  end loop;
end $$;

commit;
