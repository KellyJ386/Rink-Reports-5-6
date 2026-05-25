-- Phase 2 follow-up: auto-seed role_permission_defaults for every facility.
--
-- The initial seed (migration 80) only covered the Tennity facility by id, so a
-- newly created facility would get roles but ZERO role defaults -- its employees
-- would then seed to an empty permission matrix. This makes the canonical matrix
-- the source of truth and seeds it for any facility, on every role-creation path,
-- via an AFTER INSERT trigger on public.roles (covers create_facility_with_roles,
-- seed_default_roles_for_facility, and the admin "seed roles" action alike).

-- Canonical per-role permission grants, already expanded to cumulative actions
-- (a 'submit' ceiling => view+submit, 'admin' => view+submit+edit+admin, etc).
-- Keyed by role KEY so it applies to any facility's matching roles. Validated to
-- reproduce the Tennity seed exactly (admin/gm/super_admin=40, manager=37,
-- supervisor=27, staff=17, driver=17).
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
      ('driver','communications','submit'::public.user_action)
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
  'Canonical per-role default permission grants (expanded to cumulative actions), keyed by role key. Source for seed_role_permission_defaults_for_facility() and the roles auto-seed trigger.';

-- Seed (idempotent) role_permission_defaults for every canonical role in a facility.
-- Admin-guarded so it can double as a manual re-seed primitive for ops.
create or replace function public.seed_role_permission_defaults_for_facility(
  p_facility_id uuid
) returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_count integer;
begin
  if not (public.is_super_admin() or public.is_facility_admin(p_facility_id)) then
    raise exception 'seed_role_permission_defaults_for_facility: not authorized';
  end if;

  insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
  select p_facility_id, r.id, g.module_name, g.action, true
  from public.canonical_role_permission_grants() g
  join public.roles r on r.facility_id = p_facility_id and r.key = g.role_key
  on conflict (facility_id, role_id, module_name, action)
    do update set enabled = excluded.enabled, updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.seed_role_permission_defaults_for_facility(uuid) from public, anon;
grant execute on function public.seed_role_permission_defaults_for_facility(uuid) to authenticated, service_role;

comment on function public.seed_role_permission_defaults_for_facility(uuid) is
  'Admin-guarded. Seeds role_permission_defaults for all canonical roles in a facility from canonical_role_permission_grants(). Idempotent (upsert).';

-- Path-independent auto-seed: whenever a role is created (facility creation,
-- default-role seeding, or the admin "seed roles" action), populate that role's
-- defaults from the canonical template. SECURITY DEFINER so it succeeds
-- regardless of which role inserted the row; ON CONFLICT DO NOTHING so it never
-- clobbers an already-tuned matrix. Custom (non-canonical) role keys seed nothing.
create or replace function public.trg_seed_role_permission_defaults()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
  select new.facility_id, new.id, g.module_name, g.action, true
  from public.canonical_role_permission_grants() g
  where g.role_key = new.key
  on conflict (facility_id, role_id, module_name, action) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_role_permission_defaults_after_insert on public.roles;
create trigger seed_role_permission_defaults_after_insert
  after insert on public.roles
  for each row execute function public.trg_seed_role_permission_defaults();
