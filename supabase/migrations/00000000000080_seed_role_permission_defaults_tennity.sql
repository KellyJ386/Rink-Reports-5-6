-- Phase 1 seed: Tennity facility role-default matrix.
-- Ceilings expand to cumulative per-action rows (admin => view+submit+edit+admin, etc).
-- super_admin rows seeded for completeness; the role is bypass-by-flag and the seeding
-- function no-ops for it. Idempotent UPSERT so re-running is safe.
--
-- Facility-scoped seed by design: the hardcoded facility id only matches in the
-- production project, so this is a no-op on fresh/local databases (no matching
-- facility or roles => zero inserts).
with facility as (
  select '4490bad7-ef1b-4544-8d7f-7aea49884550'::uuid as fid
),
ceilings(role_key, module_name, ceiling) as (
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
),
expanded as (
  select c.role_key, c.module_name, al.action
  from ceilings c
  join action_levels cl on cl.action = c.ceiling
  join action_levels al on al.lvl <= cl.lvl
)
insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
select f.fid, r.id, e.module_name, e.action, true
from expanded e
cross join facility f
join public.roles r on r.facility_id = f.fid and r.key = e.role_key
on conflict (facility_id, role_id, module_name, action)
  do update set enabled = excluded.enabled, updated_at = now();
