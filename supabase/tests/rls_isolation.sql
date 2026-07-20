-- =============================================================================
-- supabase/tests/rls_isolation.sql
--
-- Cross-facility isolation tests for the Rink Reports RLS model.
--
-- Run against a LOCAL supabase stack (never production). The script wraps
-- everything in a single transaction with `set local` so it can be rolled
-- back cleanly. Failures raise a NOTICE and increment a counter; a final
-- assert fails the transaction if any check failed.
--
-- Usage (from repo root):
--
--   supabase db reset                                 # fresh migrations
--   psql "$DATABASE_URL" -f supabase/tests/rls_isolation.sql
--
-- The script creates fixture rows in two facilities (A and B), then
-- impersonates a regular employee in facility A and verifies they cannot
-- read or write rows belonging to facility B. It does NOT exhaustively
-- test every table — it targets the surfaces that the Phase 1–5 work
-- newly exposed (department/facility permission defaults, custom roles,
-- notification routing rules, notification outbox) plus the most
-- security-sensitive existing tables (employees, module_permissions,
-- audit_logs, communication_messages).
-- =============================================================================

begin;

create temp table _rls_failures (msg text) on commit drop;

create or replace function pg_temp.expect_count(
  p_query text,
  p_expected int,
  p_label   text
) returns void
language plpgsql
as $$
declare
  v_actual int;
begin
  execute p_query into v_actual;
  if v_actual is distinct from p_expected then
    insert into _rls_failures (msg)
    values (format('FAIL: %s — expected %s, got %s. Query: %s',
                   p_label, p_expected, v_actual, p_query));
  else
    raise notice 'ok: %', p_label;
  end if;
end;
$$;

create or replace function pg_temp.expect_error(
  p_query text,
  p_label text
) returns void
language plpgsql
as $$
begin
  begin
    execute p_query;
    insert into _rls_failures (msg)
    values (format('FAIL: %s — expected an error but query succeeded: %s',
                   p_label, p_query));
  exception when others then
    raise notice 'ok (errored as expected): %', p_label;
  end;
end;
$$;

create or replace function pg_temp.expect_ok(
  p_query text,
  p_label text
) returns void
language plpgsql
as $$
begin
  begin
    execute p_query;
    raise notice 'ok: %', p_label;
  exception when others then
    insert into _rls_failures (msg)
    values (format('FAIL: %s — expected success but errored (%s): %s',
                   p_label, sqlerrm, p_query));
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Fixture: two facilities with one employee each, one routing rule each.
-- ---------------------------------------------------------------------------
-- Switch to service-role-equivalent: bypass RLS for setup. The `postgres`
-- role of the local stack has BYPASSRLS.
set local role postgres;

insert into public.facilities (id, name, slug)
values
  ('11111111-1111-1111-1111-111111111111', 'Facility A', 'fac-a'),
  ('22222222-2222-2222-2222-222222222222', 'Facility B', 'fac-b')
on conflict (id) do nothing;

-- Seed default roles if not already there.
select public.seed_default_roles_for_facility('11111111-1111-1111-1111-111111111111');
select public.seed_default_roles_for_facility('22222222-2222-2222-2222-222222222222');

-- Users that "own" each employee (auth.users surrogate).
insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@fac-a.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@fac-b.test')
on conflict (id) do nothing;

-- public.users.facility_id MUST be set: current_facility_id() reads from
-- users.facility_id, not employees.facility_id. Without this every RLS
-- policy that gates on facility_id = current_facility_id() returns 0 rows
-- for both Alice's own facility and the foreign one, which would mask real
-- bugs.
insert into public.users (id, facility_id, email, is_super_admin)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'alice@fac-a.test', false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222',
   'bob@fac-b.test',   false)
on conflict (id) do update
  set facility_id = excluded.facility_id;

insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select
  'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  r.id, 'Alice', 'Anderson', 'alice@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;

insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select
  'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  r.id, 'Bob', 'Baker', 'bob@fac-b.test', true
from public.roles r
where r.facility_id = '22222222-2222-2222-2222-222222222222'
  and r.key = 'staff'
on conflict (id) do nothing;

-- A routing rule in each facility so the cross-facility query targets are non-empty.
insert into public.communication_routing_rules (
  facility_id, source_module, timing, target_role_key
) values
  ('11111111-1111-1111-1111-111111111111', 'incident_reports', 'immediate', 'staff'),
  ('22222222-2222-2222-2222-222222222222', 'incident_reports', 'immediate', 'staff');

-- Grant alice view+submit on every module she'll be queried against. The
-- RLS resolvers (effective_module_permission, current_user_has_permission)
-- read from public.user_permissions as of migration 77. Seed both `view`
-- and `submit` actions per module so policies that gate on level >= submit
-- pass, and policies that gate on level >= view also pass.
--
-- 'incident_reports' is deliberately EXCLUDED: the H4 dispatch test below
-- asserts that dispatch_rules_for_submission rejects a caller lacking submit
-- on the source module, and it uses incident_reports as that module. Granting
-- it here would make alice pass the gate and break that negative assertion.
insert into public.user_permissions (
  user_id, facility_id, module_name, action, enabled
)
select
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  m,
  a::public.user_action,
  true
from unnest(array[
  'communications',
  'accident_reports',
  'daily_reports',
  'ice_depth',
  'ice_operations',
  'refrigeration',
  'air_quality',
  'scheduling'
]) as m
cross join unnest(array['view', 'submit']) as a
on conflict (user_id, facility_id, module_name, action) do nothing;

-- role_permission_defaults (migration 79): one row per facility so the
-- cross-facility isolation assertions below have non-empty targets. Seeded as
-- the postgres (BYPASSRLS) role.
insert into public.role_permission_defaults (
  facility_id, role_id, module_name, action, enabled
)
select r.facility_id, r.id, 'daily_reports', 'view'::public.user_action, true
from public.roles r
where r.facility_id in (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222'
  )
  and r.key = 'staff'
on conflict (facility_id, role_id, module_name, action) do nothing;

-- Grant the test runner (authenticated alice) the ability to record failures.
-- The temp table _rls_failures is created above as the postgres role; without
-- this grant, expect_count() / expect_error() lose their ability to log
-- failures and silently mask everything as "ok".
grant insert, select on _rls_failures to authenticated;
-- The RL block below runs assertions under the anon role; without this grant
-- expect_count()/expect_error() lose the ability to log failures and silently
-- mask everything as "ok".
grant insert, select on _rls_failures to anon;

-- An offline_sync_queue row in each facility so cross-facility checks have
-- non-empty targets (mig 31 + test for migration 59 follow-up isolation).
insert into public.offline_sync_queue (
  local_id, facility_id, employee_id, module_key, action, payload
) values
  ('11111111-1111-1111-1111-1111aaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'daily_reports', 'submit', '{}'::jsonb),
  ('22222222-2222-2222-2222-2222bbbbbbbb',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'daily_reports', 'submit', '{}'::jsonb)
on conflict (local_id) do nothing;

-- A communication_groups row in each facility — one staff-visible, one not —
-- so we can assert that the migration-59 column exists and is queryable.
insert into public.communication_groups (
  facility_id, name, slug, is_active, staff_can_message
) values
  ('11111111-1111-1111-1111-111111111111', 'Managers A', 'managers-a', true, true),
  ('11111111-1111-1111-1111-111111111111', 'Internal A', 'internal-a', true, false),
  ('22222222-2222-2222-2222-222222222222', 'Managers B', 'managers-b', true, true)
on conflict (facility_id, slug) do nothing;

-- Ice Operations: fuel types + a circle-check template in each facility, so
-- the migration-75 isolation checks below have non-empty targets.
insert into public.ice_operations_fuel_types
  (id, facility_id, name, slug, sort_order, is_active)
values
  ('aaaa1111-fffa-aaaa-aaaa-aaaa11110001',
   '11111111-1111-1111-1111-111111111111', 'Electric', 'electric', 1, true),
  ('bbbb2222-fffb-bbbb-bbbb-bbbb22220001',
   '22222222-2222-2222-2222-222222222222', 'Gas', 'gas', 1, true)
on conflict (facility_id, slug) do nothing;

insert into public.ice_operations_circle_check_templates
  (id, facility_id, fuel_type_id, name, sort_order, is_active)
values
  ('aaaa1111-ccca-aaaa-aaaa-aaaa11110002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-fffa-aaaa-aaaa-aaaa11110001',
   'Electric Daily', 0, true),
  ('bbbb2222-cccb-bbbb-bbbb-bbbb22220002',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-fffb-bbbb-bbbb-bbbb22220001',
   'Gas Daily', 0, true)
on conflict (facility_id, fuel_type_id) do nothing;

insert into public.ice_operations_circle_check_template_items
  (facility_id, template_id, label, sort_order, is_active)
values
  ('11111111-1111-1111-1111-111111111111',
   'aaaa1111-ccca-aaaa-aaaa-aaaa11110002', 'Battery charge OK', 1, true),
  ('22222222-2222-2222-2222-222222222222',
   'bbbb2222-cccb-bbbb-bbbb-bbbb22220002', 'Fuel level OK', 1, true);

-- Ice Depth: a rink (sheet of ice) in each facility, so the migration-83
-- isolation checks below have non-empty targets.
insert into public.ice_depth_rinks
  (id, facility_id, name, slug, sort_order, is_active, is_default)
values
  ('aaaa1111-dddd-aaaa-aaaa-aaaa11110003',
   '11111111-1111-1111-1111-111111111111', 'Main Rink A', 'main-rink', 0, true, true),
  ('bbbb2222-dddd-bbbb-bbbb-bbbb22220003',
   '22222222-2222-2222-2222-222222222222', 'Main Rink B', 'main-rink', 0, true, true)
on conflict (facility_id, slug) do nothing;

-- Facility Paperwork (migration 85): a document in each facility, so the
-- cross-facility browse + admin-write isolation checks below have non-empty
-- targets.
insert into public.facility_documents
  (id, facility_id, title, category, storage_path, file_name)
values
  ('aaaa1111-eeee-aaaa-aaaa-aaaa11110004',
   '11111111-1111-1111-1111-111111111111', 'EAP A', 'emergency_action_plan',
   '11111111-1111-1111-1111-111111111111/aaaa1111-eeee-aaaa-aaaa-aaaa11110004/eap.pdf',
   'eap.pdf'),
  ('bbbb2222-eeee-bbbb-bbbb-bbbb22220004',
   '22222222-2222-2222-2222-222222222222', 'EAP B', 'emergency_action_plan',
   '22222222-2222-2222-2222-222222222222/bbbb2222-eeee-bbbb-bbbb-bbbb22220004/eap.pdf',
   'eap.pdf')
on conflict (id) do nothing;

-- Daily Reports per-area submit boundary (migration 89, has_area_submit_access):
-- two areas in facility A (alice granted can_submit on one, not the other) plus
-- one in facility B, each with a template so a submission INSERT has a valid
-- target. The daily_report_submissions INSERT policy ANDs has_area_submit_access
-- onto the module-level submit check, so a module-submitter can only write to an
-- area they hold can_submit on.
insert into public.daily_report_areas (id, facility_id, name, slug, sort_order, is_active)
values
  ('aaaa1111-da01-aaaa-aaaa-aaaa11110011',
   '11111111-1111-1111-1111-111111111111', 'Granted Area', 'granted-area', 1, true),
  ('aaaa1111-da02-aaaa-aaaa-aaaa11110012',
   '11111111-1111-1111-1111-111111111111', 'No-Grant Area', 'nogrant-area', 2, true),
  ('bbbb2222-db01-bbbb-bbbb-bbbb22220011',
   '22222222-2222-2222-2222-222222222222', 'B Area', 'b-area', 1, true)
on conflict (id) do nothing;

insert into public.daily_report_templates (id, facility_id, area_id, name)
values
  ('aaaa1111-d701-aaaa-aaaa-aaaa11110013',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-da01-aaaa-aaaa-aaaa11110011', 'Granted Template'),
  ('aaaa1111-d702-aaaa-aaaa-aaaa11110014',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-da02-aaaa-aaaa-aaaa11110012', 'No-Grant Template'),
  ('bbbb2222-d701-bbbb-bbbb-bbbb22220012',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-db01-bbbb-bbbb-bbbb22220011', 'B Template')
on conflict (id) do nothing;

-- Alice gets can_submit on the granted area only.
insert into public.module_area_permissions
  (facility_id, employee_id, module_key, area_id, can_view, can_submit)
values
  ('11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'daily_reports', 'aaaa1111-da01-aaaa-aaaa-aaaa11110011', true, true)
on conflict (employee_id, module_key, area_id) do nothing;

-- Ice-depth layout + measurement point in Facility A, so the positive
-- session-INSERT assertion below (alice submits her OWN reading) and the
-- depth >= 0 / low < high CHECK assertions (migration 138) have valid FK
-- targets. Seeded as postgres (BYPASSRLS).
insert into public.ice_depth_layouts (id, facility_id, name, slug, sort_order, is_active, is_default)
values ('aaaa1111-1ae0-aaaa-aaaa-aaaa11110072',
        '11111111-1111-1111-1111-111111111111', 'A Sheet', 'a-sheet', 1, true, true)
on conflict (id) do nothing;

insert into public.ice_depth_points
  (id, facility_id, layout_id, point_number, label, x_position, y_position, sort_order, is_active)
values ('aaaa1111-1c01-aaaa-aaaa-aaaa11110073',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-1ae0-aaaa-aaaa-aaaa11110072',
        1, 'Center', 0.5, 0.5, 1, true)
on conflict (id) do nothing;

-- NOTE (migrations 91 + 99): The config-table SELECT policies (ice_depth, communications,
-- ice_operations, refrigeration, ...) gate on public.has_module_access(<module>).
-- BEFORE migration 90 that helper read the deprecated module_permissions.can_view
-- table, NOT the user_permissions grid seeded above — so this test used to seed
-- Alice module_permissions rows here purely to make those SELECTs pass. That seed
-- documented the split-brain bug migration 90 removes: has_module_access /
-- has_module_admin_access / has_area_access / has_area_submit_access now read
-- public.user_permissions for the module-level check. The user_permissions grant
-- seeded above (view + submit on ice_depth, communications, ice_operations, ...)
-- is therefore sufficient on its own; the manual module_permissions seed is gone.
-- The positive own-facility SELECT assertions in the "M-helpers" block below
-- (and the existing fuel-type / rink / routing-rule / groups checks) confirm that
-- access now flows through user_permissions. Alice has no `admin` action seeded,
-- so admin-only writes (insert into facility B) remain denied.

-- Departments (Employee Schedule module): one per facility so the
-- cross-facility isolation + admin-write-gate assertions below have
-- non-empty targets. SELECT is open to any in-facility role; INSERT/UPDATE
-- require an admin-tier role (admin/gm/super_admin), and Alice is staff.
insert into public.departments (id, facility_id, name, slug, sort_order, is_active)
values
  ('aaaa1111-de70-aaaa-aaaa-aaaa11110001',
   '11111111-1111-1111-1111-111111111111', 'Ice Crew A', 'ice-crew-a', 0, true),
  ('bbbb2222-de70-bbbb-bbbb-bbbb22220001',
   '22222222-2222-2222-2222-222222222222', 'Ice Crew B', 'ice-crew-b', 0, true)
on conflict (id) do nothing;

-- Job areas + per-area certification requirements (scheduling remediation):
-- one of each per facility so the cross-facility isolation assertions below
-- have non-empty targets. Seeded as postgres (BYPASSRLS).
insert into public.employee_job_areas (id, facility_id, name, slug, sort_order, is_active)
values
  ('aaaa1111-30b0-aaaa-aaaa-aaaa11110002',
   '11111111-1111-1111-1111-111111111111', 'Front Desk A', 'front-desk-a', 0, true),
  ('bbbb2222-30b0-bbbb-bbbb-bbbb22220002',
   '22222222-2222-2222-2222-222222222222', 'Front Desk B', 'front-desk-b', 0, true)
on conflict (id) do nothing;

-- Certification catalog (migration 169): requirements now reference a type
-- row (NOT NULL), so seed the catalog first.
insert into public.certification_types (id, facility_id, name)
values
  ('aaaa1111-ce7c-aaaa-aaaa-aaaa11110001',
   '11111111-1111-1111-1111-111111111111', 'CPR'),
  ('bbbb2222-ce7c-bbbb-bbbb-bbbb22220001',
   '22222222-2222-2222-2222-222222222222', 'CPR')
on conflict (id) do nothing;

insert into public.job_area_certification_requirements
  (id, facility_id, job_area_id, cert_name, certification_type_id, is_active)
values
  ('aaaa1111-ce70-aaaa-aaaa-aaaa11110003',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-30b0-aaaa-aaaa-aaaa11110002', 'CPR',
   'aaaa1111-ce7c-aaaa-aaaa-aaaa11110001', true),
  ('bbbb2222-ce70-bbbb-bbbb-bbbb22220003',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-30b0-bbbb-bbbb-bbbb22220002', 'CPR',
   'bbbb2222-ce7c-bbbb-bbbb-bbbb22220001', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1z. Facility-B submission + scheduling + communication fixtures.
--
-- The crown-jewel data: one row per user-data table in Facility B, so the
-- cross-tenant SELECT negatives in sections 2L/2M have non-empty targets. A
-- leak would surface as count() > 0 when impersonating a Facility-A user.
-- Minimal config (an air-quality location, an ice-depth layout) is seeded
-- here because the base harness only stamped daily-report + refrigeration
-- config into Facility B. Seeded as postgres (BYPASSRLS).
-- ---------------------------------------------------------------------------

-- Config rows needed as FK targets for the B-side submissions below.
-- Air quality now references the shared facility_spaces list (migration 143).
insert into public.facility_spaces (id, facility_id, name, slug, sort_order, is_active)
values ('bbbb2222-a91c-bbbb-bbbb-bbbb22220071',
        '22222222-2222-2222-2222-222222222222', 'B Rink Air', 'b-rink-air', 1, true)
on conflict (id) do nothing;

insert into public.ice_depth_layouts (id, facility_id, name, slug, sort_order, is_active, is_default)
values ('bbbb2222-1ae0-bbbb-bbbb-bbbb22220072',
        '22222222-2222-2222-2222-222222222222', 'B Sheet', 'b-sheet', 1, true, true)
on conflict (id) do nothing;

-- B-side submission rows (Bob is the employee). refrigeration_reports for B
-- already exists in the refrigeration fixture (bbbb2222-7e00-...).
insert into public.daily_report_submissions (id, facility_id, area_id, template_id)
values ('bbbb2222-5b11-bbbb-bbbb-bbbb22220073',
        '22222222-2222-2222-2222-222222222222',
        'bbbb2222-db01-bbbb-bbbb-bbbb22220011',
        'bbbb2222-d701-bbbb-bbbb-bbbb22220012')
on conflict (id) do nothing;

insert into public.incident_reports (
  id, facility_id, employee_id, reporter_name, reporter_phone, description
) values ('bbbb2222-13c1-bbbb-bbbb-bbbb22220074',
          '22222222-2222-2222-2222-222222222222',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'Bob Baker', '555-0100', 'B-facility incident')
on conflict (id) do nothing;

insert into public.accident_reports (
  id, facility_id, employee_id, injured_person_name, injured_person_contact, description
) values ('bbbb2222-acc1-bbbb-bbbb-bbbb22220075',
          '22222222-2222-2222-2222-222222222222',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'Skater B', '555-0101', 'B-facility accident')
on conflict (id) do nothing;

insert into public.air_quality_reports (id, facility_id, employee_id, location_id)
values ('bbbb2222-a9c1-bbbb-bbbb-bbbb22220076',
        '22222222-2222-2222-2222-222222222222',
        'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'bbbb2222-a91c-bbbb-bbbb-bbbb22220071')
on conflict (id) do nothing;

-- B-side Air Quality compliance config (migration 147). The facilities insert
-- trigger normally seeds this; insert explicitly so the cross-facility
-- isolation assertions below have a target regardless of trigger ordering.
insert into public.facility_air_quality_config (facility_id, compliance_profile_id)
values ('22222222-2222-2222-2222-222222222222',
        (select id from public.air_quality_compliance_profiles
          where jurisdiction = 'USIRA'))
on conflict (facility_id) do nothing;

insert into public.ice_operations_submissions (id, facility_id, employee_id, operation_type)
values ('bbbb2222-1c01-bbbb-bbbb-bbbb22220077',
        '22222222-2222-2222-2222-222222222222',
        'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ice_make')
on conflict (id) do nothing;

insert into public.ice_depth_sessions (
  id, facility_id, layout_id, employee_id,
  measurement_unit_snapshot, low_threshold_snapshot, high_threshold_snapshot
) values ('bbbb2222-1de1-bbbb-bbbb-bbbb22220078',
          '22222222-2222-2222-2222-222222222222',
          'bbbb2222-1ae0-bbbb-bbbb-bbbb22220072',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'inches', 1.0, 2.0)
on conflict (id) do nothing;

insert into public.communication_messages (id, facility_id, body)
values ('bbbb2222-c0a1-bbbb-bbbb-bbbb22220079',
        '22222222-2222-2222-2222-222222222222', 'B-facility broadcast')
on conflict (id) do nothing;

insert into public.communication_recipients (id, facility_id, message_id, employee_id)
values ('bbbb2222-c0a2-bbbb-bbbb-bbbb22220080',
        '22222222-2222-2222-2222-222222222222',
        'bbbb2222-c0a1-bbbb-bbbb-bbbb22220079',
        'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (id) do nothing;

-- A-side message + recipient so a Facility-A communications admin has a
-- non-empty own-facility positive to assert against (proving migration 182's
-- fix didn't over-restrict legitimate admin reads).
insert into public.communication_messages (id, facility_id, body)
values ('aaaa1111-c0a1-aaaa-aaaa-aaaa11110079',
        '11111111-1111-1111-1111-111111111111', 'A-facility broadcast')
on conflict (id) do nothing;

insert into public.communication_recipients (id, facility_id, message_id, employee_id)
values ('aaaa1111-c0a2-aaaa-aaaa-aaaa11110080',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-c0a1-aaaa-aaaa-aaaa11110079',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict (id) do nothing;

insert into public.communication_alerts (id, facility_id, source_module, severity, title)
values ('bbbb2222-c0a3-bbbb-bbbb-bbbb22220081',
        '22222222-2222-2222-2222-222222222222',
        'air_quality', 'warn', 'B-facility alert')
on conflict (id) do nothing;

-- B-side scheduling rows. A department + shift give the swap request a valid
-- requester_shift_id FK.
insert into public.departments (id, facility_id, name, slug, sort_order, is_active)
values ('bbbb2222-de71-bbbb-bbbb-bbbb22220082',
        '22222222-2222-2222-2222-222222222222', 'B Crew', 'b-crew', 1, true)
on conflict (id) do nothing;

insert into public.schedule_shifts (id, facility_id, department_id, starts_at, ends_at)
values ('bbbb2222-5511-bbbb-bbbb-bbbb22220083',
        '22222222-2222-2222-2222-222222222222',
        'bbbb2222-de71-bbbb-bbbb-bbbb22220082',
        now(), now() + interval '4 hours')
on conflict (id) do nothing;

insert into public.schedule_availability (
  id, facility_id, employee_id, day_of_week, start_time, end_time
) values ('bbbb2222-a011-bbbb-bbbb-bbbb22220084',
          '22222222-2222-2222-2222-222222222222',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, '08:00', '12:00')
on conflict (id) do nothing;

insert into public.schedule_time_off_requests (
  id, facility_id, employee_id, starts_at, ends_at
) values ('bbbb2222-7011-bbbb-bbbb-bbbb22220085',
          '22222222-2222-2222-2222-222222222222',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          now(), now() + interval '1 day')
on conflict (id) do nothing;

insert into public.schedule_notifications (
  id, facility_id, employee_id, notification_type
) values ('bbbb2222-7711-bbbb-bbbb-bbbb22220086',
          '22222222-2222-2222-2222-222222222222',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'shift_reminder')
on conflict (id) do nothing;

insert into public.schedule_swap_requests (
  id, facility_id, requester_employee_id, requester_shift_id
) values ('bbbb2222-5711-bbbb-bbbb-bbbb22220087',
          '22222222-2222-2222-2222-222222222222',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'bbbb2222-5511-bbbb-bbbb-bbbb22220083')
on conflict (id) do nothing;

-- Carol: a SCHEDULING ADMIN in Facility A. She exists to prove that
-- module-admin rights are facility-scoped — the bug fixed in migration 133
-- let a Facility-A scheduling admin read Facility-B availability/time-off/
-- notification/swap rows, because those policies had a bare
-- has_module_admin_access('scheduling') branch with no facility_id match.
insert into auth.users (id, email)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'carol@fac-a.test')
on conflict (id) do nothing;

insert into public.users (id, facility_id, email, is_super_admin)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', 'carol@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;

insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select
  'aaaa1111-ca01-aaaa-aaaa-aaaa11110099'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  r.id, 'Carol', 'Chen', 'carol@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;

insert into public.user_permissions (
  user_id, facility_id, module_name, action, enabled
) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'scheduling', 'admin', true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'scheduling', 'view', true),
  -- Communications admin too, so the communication_recipients_select policy's
  -- admin branch is actually exercised (migration 182 cross-tenant fix).
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'communications', 'admin', true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'communications', 'view', true)
on conflict (user_id, facility_id, module_name, action) do nothing;

-- A-side scheduling rows so Carol's OWN-facility positive assertions are
-- non-empty (proves the migration-129 fix didn't over-restrict admins).
insert into public.schedule_availability (
  id, facility_id, employee_id, day_of_week, start_time, end_time
) values ('aaaa1111-a011-aaaa-aaaa-aaaa11110090',
          '11111111-1111-1111-1111-111111111111',
          'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 3, '09:00', '17:00')
on conflict (id) do nothing;

-- Wage rows in BOTH facilities (migration 167). employee_wages has NO staff
-- RLS branch — staff Alice must read zero rows even in her own facility (her
-- own wage included), while scheduling-admin Carol reads only Facility A.
insert into public.employee_wages (employee_id, facility_id, hourly_rate)
values
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 21.50),
  ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 19.00)
on conflict (employee_id) do nothing;

-- ICS calendar tokens (migration 168): owner-only credential. Seed one for
-- Carol (SAME facility as Alice) and one for Bob (facility B) — Alice must
-- read neither, but can manage her own.
insert into public.schedule_ics_tokens (employee_id, facility_id, token)
values
  ('aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
   '11111111-1111-1111-1111-111111111111',
   'carol-token-0000000000000000000000000000'),
  ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222',
   'bob-token-000000000000000000000000000000')
on conflict (employee_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Impersonate Alice (Facility A) via JWT claims and run cross-tenant checks.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
-- Impersonate Alice. Set BOTH the plural `request.jwt.claims` (read by the
-- hosted/newer auth.uid()) and the singular `request.jwt.claim.sub` (read by
-- older Supabase-CLI local stacks whose auth.uid() does NOT fall back to the
-- plural JSON). Without the singular form, auth.uid() resolves to NULL on those
-- stacks, current_facility_id() returns NULL, and every own-facility positive
-- assertion below reads 0 rows while the cross-facility negatives pass trivially.
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- ---------------------------------------------------------------------------
-- M-helpers (migration 90): the module-level RLS helpers now read
-- public.user_permissions, not the deprecated module_permissions table.
--
-- Alice's access to these config / settings tables comes SOLELY from the
-- user_permissions grant seeded in the fixture (view + submit on ice_depth,
-- communications, ice_operations). Before migration 90 these SELECTs only
-- passed because of a manual module_permissions seed (now removed). After
-- migration 90 they must pass via user_permissions alone. The cross-facility
-- negatives for the same tables live further down and must keep passing.
-- ---------------------------------------------------------------------------

-- ice_depth config (ice_depth_rinks SELECT is gated on has_module_access('ice_depth')).
select pg_temp.expect_count(
  $$select count(*) from public.ice_depth_rinks
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'M-helpers: alice CAN SELECT ice_depth config via user_permissions (view)');

-- communications config: groups + routing rules gate on has_module_access('communications').
select pg_temp.expect_count(
  $$select count(*) from public.communication_groups
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  2, 'M-helpers: alice CAN SELECT communication_groups via user_permissions (view)');

select pg_temp.expect_count(
  $$select count(*) from public.communication_routing_rules
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'M-helpers: alice CAN SELECT communication_routing_rules via user_permissions (view)');

-- ice_operations config: fuel types gate on has_module_access('ice_operations').
select pg_temp.expect_count(
  $$select count(*) from public.ice_operations_fuel_types
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'M-helpers: alice CAN SELECT ice_operations_fuel_types via user_permissions (view)');

-- Regression (migration 123): has_module_access() grants module READ for ANY
-- enabled action, not just `view`. A submit-capable operator must be able to
-- load a module's config to fill in the form; before migration 123 a `submit`
-- grant without `view` passed the page's submit gate yet read zero config rows
-- ("Not configured yet"). Temporarily disable alice's refrigeration `view`
-- grant (leaving `submit` enabled) and confirm the read gate still opens, then
-- restore it so the remaining assertions are unaffected.
reset role;
update public.user_permissions
   set enabled = false
 where user_id     = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and facility_id = '11111111-1111-1111-1111-111111111111'
   and module_name = 'refrigeration'
   and action      = 'view';
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from (select 1 where public.has_module_access('refrigeration')) t$$,
  1, 'M-helpers: submit-only (view disabled) grant STILL opens the module read gate (migration 123)');

reset role;
update public.user_permissions
   set enabled = true
 where user_id     = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and facility_id = '11111111-1111-1111-1111-111111111111'
   and module_name = 'refrigeration'
   and action      = 'view';
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Negative: Alice has NO admin grant, so has_module_admin_access() stays false
-- and an admin-only own-facility config write (a rink in her own facility) is
-- still denied. This pins that migration 90 did not over-grant by reading view.
select pg_temp.expect_error(
  $$insert into public.ice_depth_rinks
      (facility_id, name, slug)
    values
      ('11111111-1111-1111-1111-111111111111', 'Admin Only Rink', 'admin-only')$$,
  'M-helpers: staff alice (no admin grant) CANNOT INSERT a rink into her own facility');

-- Alice sees her own employee row but not Bob's.
select pg_temp.expect_count(
  $$select count(*) from public.employees where id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  1, 'alice can SELECT her own employee row');

select pg_temp.expect_count(
  $$select count(*) from public.employees where id = 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  0, 'alice CANNOT SELECT bob (different facility)');

-- Wages (migration 167): employee_wages has NO staff branch — staff Alice
-- reads ZERO rows even in her own facility, including her own wage, and
-- cannot write one.
select pg_temp.expect_count(
  $$select count(*) from public.employee_wages
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  0, 'wages: staff alice CANNOT SELECT any employee_wages in her own facility');

select pg_temp.expect_count(
  $$select count(*) from public.employee_wages
    where employee_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  0, 'wages: staff alice CANNOT SELECT even her OWN wage row');

select pg_temp.expect_error(
  $$insert into public.employee_wages (employee_id, facility_id, hourly_rate)
    values ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '11111111-1111-1111-1111-111111111111', 99)$$,
  'wages: staff alice CANNOT INSERT a wage row (admin-only)');

-- ICS tokens (migration 168): owner-only. Alice sees neither Carol's token
-- (SAME facility — this is the credential-leak case) nor Bob's, can create
-- her own, and cannot mint one for another employee.
select pg_temp.expect_count(
  $$select count(*) from public.schedule_ics_tokens$$,
  0, 'ics: alice CANNOT SELECT any other employee''s calendar token (incl. same-facility)');

select pg_temp.expect_ok(
  $$insert into public.schedule_ics_tokens (employee_id, facility_id, token)
    values ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '11111111-1111-1111-1111-111111111111',
            'alice-token-00000000000000000000000000')$$,
  'ics: alice CAN create her own calendar token');

select pg_temp.expect_count(
  $$select count(*) from public.schedule_ics_tokens
    where employee_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  1, 'ics: alice sees exactly her own token');

-- Policy probe (not a constraint error): updating Carol's token must simply
-- match 0 rows under the USING clause.
select pg_temp.expect_count(
  $$with u as (
     update public.schedule_ics_tokens
        set token = 'hijacked-token-00000000000000000000000'
      where employee_id = 'aaaa1111-ca01-aaaa-aaaa-aaaa11110099'
     returning 1
   ) select count(*) from u$$,
  0, 'ics: alice CANNOT UPDATE another employee''s token (0 rows)');

-- Roles: Alice can see her facility's roles, not Bob's.
select pg_temp.expect_count(
  $$select count(*) from public.roles where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  4, 'alice can SELECT roles in her facility (4 canonical system roles)');

select pg_temp.expect_count(
  $$select count(*) from public.roles where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT roles in facility B');

-- Routing rules: Alice sees facility A's rule, not facility B's.
select pg_temp.expect_count(
  $$select count(*) from public.communication_routing_rules
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'alice can SELECT routing rule in her facility');

select pg_temp.expect_count(
  $$select count(*) from public.communication_routing_rules
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT routing rule in facility B');

-- Departments: Alice (staff) can read her facility's departments, not B's.
-- The SELECT policy is open to any in-facility role (no module gate), which is
-- what lets the Employee Schedule department filter populate for every user.
select pg_temp.expect_count(
  $$select count(*) from public.departments
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'departments: alice can SELECT her own facility''s departments');

select pg_temp.expect_count(
  $$select count(*) from public.departments
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'departments: alice CANNOT SELECT departments in facility B');

-- Admin-write gate: staff Alice cannot create or rename a department even in
-- her own facility (INSERT/UPDATE require admin/gm/super_admin).
select pg_temp.expect_error(
  $$insert into public.departments (facility_id, name, slug)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky Dept', 'sneaky')$$,
  'departments: staff alice CANNOT INSERT a department in her own facility');

select pg_temp.expect_count(
  $$with up as (
      update public.departments set name = 'Renamed'
      where id = 'aaaa1111-de70-aaaa-aaaa-aaaa11110001' returning 1
    ) select count(*) from up$$,
  0, 'departments: staff alice CANNOT UPDATE a department (admin-gated, 0 rows)');

-- Job-area certification requirements (scheduling remediation): SELECT is
-- gated on scheduling module access (Alice has it) AND same-facility.
select pg_temp.expect_count(
  $$select count(*) from public.job_area_certification_requirements
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'cert requirements: alice can SELECT her own facility''s requirements');

select pg_temp.expect_count(
  $$select count(*) from public.job_area_certification_requirements
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'cert requirements: alice CANNOT SELECT requirements in facility B');

-- Admin-write gate: staff Alice (scheduling view/submit, not admin) cannot add
-- a requirement even in her own facility. (Valid type id so the failure is
-- the RLS policy, not the NOT NULL constraint.)
select pg_temp.expect_error(
  $$insert into public.job_area_certification_requirements
      (facility_id, job_area_id, cert_name, certification_type_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-30b0-aaaa-aaaa-aaaa11110002', 'Sneaky Cert',
            'aaaa1111-ce7c-aaaa-aaaa-aaaa11110001')$$,
  'cert requirements: staff alice CANNOT INSERT a requirement');

-- Certification catalog (migration 169): readable in-facility (both editors
-- need name suggestions), write is admin-gated, facility-scoped.
select pg_temp.expect_count(
  $$select count(*) from public.certification_types
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'cert types: alice can SELECT her own facility''s catalog');

select pg_temp.expect_count(
  $$select count(*) from public.certification_types
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'cert types: alice CANNOT SELECT facility-B catalog');

select pg_temp.expect_error(
  $$insert into public.certification_types (facility_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky Type')$$,
  'cert types: staff alice CANNOT INSERT a catalog entry');

-- Employee invites + certifications: empty for now, but RLS must scope.
select pg_temp.expect_count(
  $$select count(*) from public.employee_invites
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT employee_invites in facility B');

select pg_temp.expect_count(
  $$select count(*) from public.employee_certifications
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT employee_certifications in facility B');

-- Notification outbox: empty for now, but RLS must scope.
select pg_temp.expect_count(
  $$select count(*) from public.notification_outbox
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT outbox rows in facility B');

-- Ice Operations (migration 75): fuel types and circle-check templates +
-- template items must scope by facility.
select pg_temp.expect_count(
  $$select count(*) from public.ice_operations_fuel_types
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'ice_ops: alice can SELECT her own facility''s fuel types');

select pg_temp.expect_count(
  $$select count(*) from public.ice_operations_fuel_types
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ice_ops: alice CANNOT SELECT fuel types in facility B');

select pg_temp.expect_count(
  $$select count(*) from public.ice_operations_circle_check_templates
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ice_ops: alice CANNOT SELECT circle-check templates in facility B');

select pg_temp.expect_count(
  $$select count(*) from public.ice_operations_circle_check_template_items
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ice_ops: alice CANNOT SELECT template items in facility B');

-- Cross-tenant write attempt: insert a fuel type tagged for facility B must
-- be denied even though Alice can write to her own facility's config.
select pg_temp.expect_error(
  $$insert into public.ice_operations_fuel_types
      (facility_id, name, slug)
    values
      ('22222222-2222-2222-2222-222222222222', 'Propane', 'propane')$$,
  'ice_ops: alice CANNOT INSERT a fuel type into facility B');

-- Ice Depth rinks (migration 83): physical sheets of ice must scope by
-- facility. A regression dropping the facility_id check would expose — or let
-- a tenant rewrite — another facility's rink list and default.
select pg_temp.expect_count(
  $$select count(*) from public.ice_depth_rinks
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'ice_depth: alice can SELECT her own facility''s rinks');

select pg_temp.expect_count(
  $$select count(*) from public.ice_depth_rinks
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ice_depth: alice CANNOT SELECT rinks in facility B');

-- Air Quality compliance config (migration 147): the per-facility profile
-- choice + stricter overrides must scope by facility. A regression dropping the
-- facility_id check would expose — or let a tenant rewrite — another facility's
-- compliance posture. The global compliance profiles (migration 146) are
-- reference data and intentionally readable by every authenticated user.
select pg_temp.expect_count(
  $$select count(*) from public.facility_air_quality_config
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'air_quality: alice CANNOT SELECT facility B compliance config');

select pg_temp.expect_error(
  $$insert into public.facility_air_quality_config (facility_id)
    values ('22222222-2222-2222-2222-222222222222')$$,
  'air_quality: alice CANNOT INSERT a compliance config for facility B');

select pg_temp.expect_count(
  $$select count(*) from public.air_quality_compliance_profiles
    where jurisdiction = 'USIRA'$$,
  1, 'air_quality: global compliance profiles are readable cross-tenant');

select pg_temp.expect_error(
  $$insert into public.ice_depth_rinks
      (facility_id, name, slug)
    values
      ('22222222-2222-2222-2222-222222222222', 'Sneaky Rink', 'sneaky')$$,
  'ice_depth: alice CANNOT INSERT a rink into facility B');

-- Ice Depth sessions: the INSERT policy (migration 71) lets a module-submitter
-- record a reading in their OWN facility. The cross-facility negative is pinned
-- in section 2L; this positive case ensures the submit gate does not
-- over-restrict legitimate staff (the regression that would silently break the
-- entire staff submission flow). employee attribution is enforced in app code
-- (submit.ts), not this policy.
select pg_temp.expect_ok(
  $$insert into public.ice_depth_sessions
      (facility_id, layout_id, employee_id,
       measurement_unit_snapshot, low_threshold_snapshot, high_threshold_snapshot)
    values
      ('11111111-1111-1111-1111-111111111111',
       'aaaa1111-1ae0-aaaa-aaaa-aaaa11110072',
       'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'inches', 1.0, 2.0)$$,
  'ice_depth: alice CAN INSERT a session in her own facility (submit gate)');

-- ---------------------------------------------------------------------------
-- Facility Paperwork (migration 85): documents are browsable by any employee
-- in the owning facility, never across facilities. Admin writes are gated to
-- super_admin / facility admin — staff Alice must not be able to insert.
-- ---------------------------------------------------------------------------
select pg_temp.expect_count(
  $$select count(*) from public.facility_documents
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'paperwork: alice can SELECT her own facility''s documents');

select pg_temp.expect_count(
  $$select count(*) from public.facility_documents
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'paperwork: alice CANNOT SELECT documents in facility B');

select pg_temp.expect_error(
  $$insert into public.facility_documents
      (facility_id, title, category, storage_path, file_name)
    values
      ('22222222-2222-2222-2222-222222222222', 'Sneaky', 'other',
       '22222222-2222-2222-2222-222222222222/forged/x.pdf', 'x.pdf')$$,
  'paperwork: staff alice CANNOT INSERT a document into facility B');

select pg_temp.expect_error(
  $$insert into public.facility_documents
      (facility_id, title, category, storage_path, file_name)
    values
      ('11111111-1111-1111-1111-111111111111', 'Sneaky', 'other',
       '11111111-1111-1111-1111-111111111111/forged/x.pdf', 'x.pdf')$$,
  'paperwork: staff alice (non-admin) CANNOT INSERT a document into her own facility');

-- ---------------------------------------------------------------------------
-- role_permission_defaults (migration 79): editable per-role default matrix.
-- A regression dropping the facility_id check would leak — or let a tenant
-- rewrite — another facility's role-to-permission configuration.
-- ---------------------------------------------------------------------------
-- Alice sees her own facility's role defaults. (These are auto-seeded by the
-- migration-82 trigger when roles are created, plus the explicit fixture row
-- above.) Assert a specific cell so the count is stable regardless of how many
-- canonical rows the trigger seeds.
select pg_temp.expect_count(
  $$select count(*) from public.role_permission_defaults
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and module_name = 'daily_reports'
      and action = 'view'
      and role_id = (
        select id from public.roles
        where facility_id = '11111111-1111-1111-1111-111111111111'
          and key = 'staff'
      )$$,
  1, 'role_defaults: alice can SELECT her own facility''s role defaults');

-- Alice cannot see facility B's role defaults.
select pg_temp.expect_count(
  $$select count(*) from public.role_permission_defaults
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'role_defaults: alice CANNOT SELECT role defaults in facility B');

-- Cross-tenant write attempt: tagging a row for facility B must be denied by
-- the with-check (facility_id = current_facility_id()). role_id is taken from
-- Alice's own (visible) facility so the subquery is non-empty and the failure
-- is unambiguously the facility-isolation policy, not an empty insert.
select pg_temp.expect_error(
  $$insert into public.role_permission_defaults
      (facility_id, role_id, module_name, action, enabled)
    select '22222222-2222-2222-2222-222222222222', r.id,
           'daily_reports', 'admin'::public.user_action, true
    from public.roles r
    where r.facility_id = '11111111-1111-1111-1111-111111111111'
      and r.key = 'staff'$$,
  'role_defaults: alice CANNOT INSERT role defaults into facility B');

-- The admin-guarded seeder (migration 82) must reject a non-admin caller. Alice
-- is staff, so it must raise rather than seed any facility's defaults.
select pg_temp.expect_error(
  $$select public.seed_role_permission_defaults_for_facility(
      '22222222-2222-2222-2222-222222222222')$$,
  'role_defaults: staff alice CANNOT invoke seed_role_permission_defaults_for_facility');

-- ---------------------------------------------------------------------------
-- M-offline: offline_sync_queue cross-facility isolation (mig 31).
--
-- The sync queue holds report payloads captured offline. A regression in
-- the SELECT/INSERT policies (e.g. dropping the facility_id check) would
-- let a tenant see or write another tenant's pending submissions.
-- ---------------------------------------------------------------------------
-- Alice sees her own queued row.
select pg_temp.expect_count(
  $$select count(*) from public.offline_sync_queue
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'offline: alice can SELECT her own facility''s queue rows');

-- Alice cannot see Bob's queued row.
select pg_temp.expect_count(
  $$select count(*) from public.offline_sync_queue
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'offline: alice CANNOT SELECT queue rows in facility B');

-- Alice cannot insert a queue row tagged for facility B.
select pg_temp.expect_error(
  $$insert into public.offline_sync_queue (
      local_id, facility_id, employee_id, module_key, action, payload
    ) values (
      gen_random_uuid(),
      '22222222-2222-2222-2222-222222222222',
      'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'daily_reports', 'submit', '{}'::jsonb
    )$$,
  'offline: alice CANNOT INSERT queue rows tagged with facility B');

-- Alice cannot insert a queue row on behalf of another employee, even within
-- her own facility (with-check requires employee_id maps to auth.uid()).
select pg_temp.expect_error(
  $$insert into public.offline_sync_queue (
      local_id, facility_id, employee_id, module_key, action, payload
    ) values (
      gen_random_uuid(),
      '11111111-1111-1111-1111-111111111111',
      'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'daily_reports', 'submit', '{}'::jsonb
    )$$,
  'offline: alice CANNOT INSERT queue rows for a foreign employee');

-- ---------------------------------------------------------------------------
-- M59: communication_groups.staff_can_message column exists and is
-- query-filterable. The application-layer compose page + send action
-- (see src/app/reports/communications/) enforce that non-admin staff only
-- target staff_can_message=true groups; this test just guards the column
-- against accidental removal.
-- ---------------------------------------------------------------------------
select pg_temp.expect_count(
  $$select count(*) from public.communication_groups
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and staff_can_message = true$$,
  1, 'M59: alice can SELECT staff-visible groups in her facility');

select pg_temp.expect_count(
  $$select count(*) from public.communication_groups
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'M59: alice CANNOT SELECT groups in facility B');

-- Audit logs: Alice cannot read facility B's audit_logs.
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT audit_logs from facility B');

-- ---------------------------------------------------------------------------
-- Daily Reports per-area submit boundary (migration 89, has_area_submit_access).
-- Alice holds module-level daily submit (seeded above) but per-area can_submit
-- only on the granted area, so the area check is the deciding factor.
-- ---------------------------------------------------------------------------
-- Cross-facility: alice cannot submit into facility B's area.
select pg_temp.expect_error(
  $$insert into public.daily_report_submissions (facility_id, area_id, template_id)
    values ('22222222-2222-2222-2222-222222222222',
            'bbbb2222-db01-bbbb-bbbb-bbbb22220011',
            'bbbb2222-d701-bbbb-bbbb-bbbb22220012')$$,
  'daily: alice CANNOT submit into facility B area (cross-facility)');

-- Same-facility, no per-area grant: module submit is not enough on its own.
select pg_temp.expect_error(
  $$insert into public.daily_report_submissions (facility_id, area_id, template_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da02-aaaa-aaaa-aaaa11110012',
            'aaaa1111-d702-aaaa-aaaa-aaaa11110014')$$,
  'daily: alice CANNOT submit into own-facility area without a can_submit grant');

-- Granted area: the insert is allowed.
select pg_temp.expect_ok(
  $$insert into public.daily_report_submissions (facility_id, area_id, template_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013')$$,
  'daily: alice CAN submit into own-facility area she is granted');

-- ---------------------------------------------------------------------------
-- Daily Reports append-only (migration 161): the partial unique index from
-- migration 156 was dropped, so a SECOND same-day submission into the same
-- (facility, area, template) with the SAME non-null business_date is now
-- allowed. Each correction is a new, independent row. (Both rows below carry a
-- non-null business_date precisely so the old `where business_date is not null`
-- index would have rejected the second one — proving the index is gone.)
-- UPDATE/DELETE remain admin-only (migration 7); staff corrections no longer
-- depend on a silently-denied admin-only UPDATE, they are just new INSERTs.
-- ---------------------------------------------------------------------------
select pg_temp.expect_ok(
  $$insert into public.daily_report_submissions
      (id, facility_id, area_id, template_id, business_date)
    values ('aaaa1111-5b11-aaaa-aaaa-aaaa11110097',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013',
            current_date)$$,
  'daily: alice CAN submit a first same-day row (append-only)');

select pg_temp.expect_ok(
  $$insert into public.daily_report_submissions
      (id, facility_id, area_id, template_id, business_date)
    values ('aaaa1111-5b11-aaaa-aaaa-aaaa11110098',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013',
            current_date)$$,
  'daily: alice CAN submit a SECOND same-day row (append-only; unique-per-day index dropped)');

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions
    where id in ('aaaa1111-5b11-aaaa-aaaa-aaaa11110097',
                 'aaaa1111-5b11-aaaa-aaaa-aaaa11110098')$$,
  2, 'daily: both same-day submissions coexist (append-only)');

-- INSERT into facility B should fail. The user_permissions write policy
-- (migration 77) restricts to super_admin or facility admin; alice is neither.
select pg_temp.expect_error(
  $$insert into public.user_permissions (
      user_id, facility_id, module_name, action, enabled
    ) values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '22222222-2222-2222-2222-222222222222',
      'daily_reports',
      'view',
      true
    )$$,
  'alice CANNOT INSERT user_permissions into facility B');

-- ---------------------------------------------------------------------------
-- M2: effective_module_permission resolvers are tenant-scoped.
--
-- After migration 49, the resolvers return 'none' (and source='none') when
-- the target employee is outside the caller's facility. Previously they
-- computed across tenants and were an enumeration oracle.
-- ---------------------------------------------------------------------------
select pg_temp.expect_count(
  $$select case
      when public.effective_module_permission(
        'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
        'daily_reports'
      ) = 'none'::module_permission_level then 1 else 0 end$$,
  1, 'M2: effective_module_permission returns ''none'' cross-facility');

select pg_temp.expect_count(
  $$select case
      when (public.effective_module_permission_with_source(
              'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
              'daily_reports')).source = 'none' then 1 else 0 end$$,
  1, 'M2: _with_source returns source=''none'' cross-facility');

-- Sanity check: same-facility resolution still works (returns something,
-- even if that something is 'none' due to no defaults set up).
select pg_temp.expect_count(
  $$select case
      when public.effective_module_permission(
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
        'daily_reports'
      ) is not null then 1 else 0 end$$,
  1, 'M2: same-facility resolution returns a value');

-- ---------------------------------------------------------------------------
-- H4: dispatch_rules_for_submission is caller-gated.
--
-- After migration 49 the function requires the caller to be either a
-- super_admin OR acting inside p_facility_id AND holding submit-or-higher
-- on p_source_module. Cross-facility calls must error; calls with no
-- submit permission must error.
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $$select public.dispatch_rules_for_submission(
      '22222222-2222-2222-2222-222222222222'::uuid,  -- facility B
      'incident_reports', null, null, null, 'Spam', 'Spam body')$$,
  'H4: dispatch rejects cross-facility call');

-- Alice's 'staff' role has no submit-on-incident_reports default (the role
-- defaults table is empty in the test fixture), so this should also error.
select pg_temp.expect_error(
  $$select public.dispatch_rules_for_submission(
      '11111111-1111-1111-1111-111111111111'::uuid,  -- alice's own facility
      'incident_reports', null, null, null, 'Spam', 'Spam body')$$,
  'H4: dispatch rejects own-facility call without submit permission');

-- ---------------------------------------------------------------------------
-- M1: notification_outbox direct INSERT / UPDATE blocked for authenticated.
--
-- The dispatcher and drainer are SECURITY DEFINER; the cron route uses the
-- service-role key. No authenticated client should be able to write rows
-- directly. Migration 49 set both policies' check clauses to false.
-- ---------------------------------------------------------------------------
-- The with-check=false policy raises a row-level-security violation rather
-- than silently inserting zero rows, so expect_error catches both the
-- "still locked" state and a regression that loosens the policy.
select pg_temp.expect_error(
  $$insert into public.notification_outbox (
      facility_id, source_module, recipient_employee_id,
      subject, body, scheduled_for, status
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'incident_reports',
      'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'forged', 'forged body', now(), 'pending'
    )$$,
  'M1: direct INSERT into notification_outbox blocked for authenticated');

-- ---------------------------------------------------------------------------
-- M5: drain_notification_outbox restricted to super_admin / service role.
--
-- This assertion is intentionally NOT executed inside this test harness.
-- The drain function gates on `session_user IN ('postgres','service_role')
-- OR is_super_admin()`. Inside the rls-isolation harness we impersonate
-- alice via `set local role authenticated`, which changes `current_user`
-- but NOT `session_user` — `session_user` remains the bootstrapping
-- postgres role with BYPASSRLS, so the gate's first OR-clause matches
-- and the function runs without raising. Switching `session_user`
-- requires `SET SESSION AUTHORIZATION`, which itself requires superuser
-- and can't be safely toggled mid-script.
--
-- M5 coverage instead lives at the route layer (the cron route checks
-- CRON_SECRET before invoking the RPC) and at the migration layer
-- (revoke execute on function ... from public, anon).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- H3: communication_group_members cross-facility group_id (RLS only).
--
-- The application-layer guard lives in addEmployeeToGroup(). The RLS
-- policy enforces the row's own facility_id matches the caller; a
-- cross-facility group_id paired with the caller's own facility_id is
-- still RLS-permitted (the violated invariant is the application's).
-- We verify the RLS gate by asserting Alice cannot write rows tagged
-- with facility B at all.
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $$insert into public.communication_group_members (
      facility_id, group_id, employee_id
    ) values (
      '22222222-2222-2222-2222-222222222222',
      gen_random_uuid(),
      'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    )$$,
  'H3: cross-facility group-membership INSERT blocked by RLS');

-- Note on M5 positive coverage: previously included a `set local role
-- postgres` + drain() call to verify the new p_facility_id parameter is
-- accepted. That test was brittle because `session_user` (which the
-- function gates on) is not changed by `set role`, only by
-- `SET SESSION AUTHORIZATION` which requires superuser. Coverage of the
-- new parameter is achieved by the production cron route invocation in
-- staging; the migration itself verifies the function's signature exists.

-- ---------------------------------------------------------------------------
-- M6: requires_acknowledgement propagation (migration 63).
--
-- The original drain_notification_outbox() hard-coded
-- requires_acknowledgement=false. Migration 63 adds the column to routing
-- rules + outbox and recreates both SECURITY DEFINER functions to thread
-- the value through. Without this assertion a regression of drain would
-- silently revert ack-required messages to opt-out.
--
-- Everything here runs as `postgres` (BYPASSRLS, and drain gates on
-- session_user IN ('postgres','service_role')). We seed the outbox rows
-- directly rather than via dispatch — see the note at the insert below.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

-- Two rules in facility A: one ack-required, one not. They supply the rule_id
-- FKs referenced by the seeded outbox rows below.
insert into public.communication_routing_rules (
  id, facility_id, source_module, timing, target_role_key,
  requires_acknowledgement
) values
  ('ccccaaaa-1111-1111-1111-cccccccccccc',
   '11111111-1111-1111-1111-111111111111',
   'accident_reports', 'immediate', 'staff', true),
  ('ccccaaaa-2222-2222-2222-cccccccccccc',
   '11111111-1111-1111-1111-111111111111',
   'daily_reports',    'immediate', 'staff', false);

-- Seed two pending outbox rows the way dispatch would (one ack-required, one
-- opt-out), then drain them. We INSERT the outbox rows directly rather than
-- calling dispatch_rules_for_submission(): after migration 86 restored its
-- authz gate, dispatch requires a resolvable auth.uid() (super_admin, or a
-- facility member holding submit), which this `set local role`-based harness
-- does not reliably provide in a nested post-role-switch context. H4 above
-- already covers dispatch's gate; this case pins the drain half — that
-- requires_acknowledgement flows outbox -> communication_messages. The rule_id
-- FKs reference the two rules inserted just above. A subject + body are
-- supplied because communication_messages.body is NOT NULL.
insert into public.notification_outbox (
  facility_id, rule_id, source_module, source_record_id,
  recipient_employee_id, subject, body, requires_acknowledgement,
  scheduled_for, status
) values
  ('11111111-1111-1111-1111-111111111111',
   'ccccaaaa-1111-1111-1111-cccccccccccc',
   'accident_reports', 'dddd0001-1111-1111-1111-dddddddddddd',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Accident report', 'An accident report was submitted.', true,
   now(), 'pending'),
  ('11111111-1111-1111-1111-111111111111',
   'ccccaaaa-2222-2222-2222-cccccccccccc',
   'daily_reports', 'dddd0002-2222-2222-2222-dddddddddddd',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Daily report', 'A daily report was submitted.', false,
   now(), 'pending');

select pg_temp.expect_count(
  $$select count(*) from public.notification_outbox
     where source_record_id = 'dddd0001-1111-1111-1111-dddddddddddd'::uuid
       and requires_acknowledgement = true$$,
  1,
  'M6: ack-required outbox row stored requires_acknowledgement=true');

select pg_temp.expect_count(
  $$select count(*) from public.notification_outbox
     where source_record_id = 'dddd0002-2222-2222-2222-dddddddddddd'::uuid
       and requires_acknowledgement = false$$,
  1,
  'M6: opt-out outbox row stored requires_acknowledgement=false');

-- `select *` is the SQL-script equivalent of plpgsql's `perform`.
select * from public.drain_notification_outbox(
  p_max_rows    := 100,
  p_facility_id := '11111111-1111-1111-1111-111111111111'::uuid
);

-- Scope the count to the two messages this section drains (by their unique
-- subjects). Section 1z seeds an unrelated Facility-B broadcast into
-- communication_messages, so an unscoped count-by-flag is no longer
-- unambiguous; matching on subject keeps the assertion about THIS drain.
select pg_temp.expect_count(
  $$select count(*) from public.communication_messages
     where requires_acknowledgement = true
       and subject = 'Accident report'$$,
  1,
  'M6: drained message from ack-required rule has requires_acknowledgement=true');

select pg_temp.expect_count(
  $$select count(*) from public.communication_messages
     where requires_acknowledgement = false
       and subject = 'Daily report'$$,
  1,
  'M6: drained message from opt-out rule has requires_acknowledgement=false');

reset role;

-- ---------------------------------------------------------------------------
-- RL: rate limiting (migration 92).
--
-- The public lead form (src/app/api/information-requests/route.ts) calls
-- public.check_rate_limit() via the anon client. Verify:
--   (a) anon CAN call the function and is blocked after p_max within a window;
--   (b) anon CANNOT touch public.rate_limit_counters directly (the only policy
--       targets service_role (migration 180); anon/authenticated have none, so
--       direct access is denied — reachable only through the SECURITY DEFINER
--       function).
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

-- (a) First p_max (=3) calls in a fresh window are allowed; the next is blocked.
-- A unique identifier keeps this independent of any other test's hits.
select pg_temp.expect_count(
  $$select case when public.check_rate_limit('rls_test', 'rl-ident-1', 3, 600)
      then 1 else 0 end$$,
  1, 'RL: anon call #1 allowed');
select pg_temp.expect_count(
  $$select case when public.check_rate_limit('rls_test', 'rl-ident-1', 3, 600)
      then 1 else 0 end$$,
  1, 'RL: anon call #2 allowed');
select pg_temp.expect_count(
  $$select case when public.check_rate_limit('rls_test', 'rl-ident-1', 3, 600)
      then 1 else 0 end$$,
  1, 'RL: anon call #3 allowed (at the cap)');
select pg_temp.expect_count(
  $$select case when public.check_rate_limit('rls_test', 'rl-ident-1', 3, 600)
      then 1 else 0 end$$,
  0, 'RL: anon call #4 BLOCKED (over the cap)');

-- (b) anon cannot read or write the counters table directly. The only policy on
-- the table targets service_role (migration 180), so anon has no applicable
-- policy: SELECT returns 0 rows (no error) and INSERT is blocked.
select pg_temp.expect_count(
  $$select count(*) from public.rate_limit_counters$$,
  0, 'RL: anon CANNOT SELECT rate_limit_counters directly (no anon policy)');

select pg_temp.expect_error(
  $$insert into public.rate_limit_counters
      (bucket, identifier, window_start, hits)
    values ('rls_test', 'forged', now(), 1)$$,
  'RL: anon CANNOT INSERT into rate_limit_counters directly');

-- ---------------------------------------------------------------------------
-- IR: public lead-form INSERT policy (migration 180).
--
-- The information_requests_insert policy admits anonymous writes (the public
-- splash form uses the anon key) but only at the initial status = 'new'. Verify
-- a well-formed 'new' lead is accepted and that a forged insert trying to seed a
-- later pipeline status is rejected by the WITH CHECK.
-- ---------------------------------------------------------------------------
select pg_temp.expect_count(
  $$with ins as (
      insert into public.information_requests
        (name, email, company, address_line1, address_line2, address_city,
         address_region, address_postal, address_country, note)
      values ('Reg Test', 'ir-new@example.com', 'Rink Co', '1 Ice Way', '',
              'Anytown', 'NY', '00000', 'US', 'hi')
      returning 1)
    select count(*) from ins$$,
  1, 'IR: anon CAN INSERT a status=new lead (default status)');

select pg_temp.expect_error(
  $$insert into public.information_requests
      (name, email, company, address_line1, address_line2, address_city,
       address_region, address_postal, address_country, note, status)
    values ('Forged', 'ir-forge@example.com', 'Rink Co', '1 Ice Way', '',
            'Anytown', 'NY', '00000', 'US', 'hi', 'closed')$$,
  'IR: anon CANNOT INSERT a lead with a forged non-new status');

reset role;

-- ---------------------------------------------------------------------------
-- AU: identity/permission audit triggers (migration 93).
--
-- An UPDATE to user_permissions must append a row to audit_logs via the new
-- trg_audit_user_permissions trigger. Run as postgres (BYPASSRLS) so the
-- update lands on a seeded row and the audit_logs read is unfiltered; the
-- trigger function is SECURITY DEFINER and resolves facility_id from the row.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

-- Baseline: how many audit rows already exist for user_permissions updates in
-- facility A. The fixture seeds several user_permissions rows; flip one and
-- assert the audit row count grows by exactly one.
do $$
declare
  v_before int;
  v_after  int;
begin
  select count(*) into v_before
  from public.audit_logs
  where entity_type = 'user_permissions'
    and action = 'update'
    and facility_id = '11111111-1111-1111-1111-111111111111';

  update public.user_permissions
     set enabled = enabled  -- no-op value but still fires the AFTER UPDATE trigger
   where user_id     = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and facility_id = '11111111-1111-1111-1111-111111111111'
     and module_name = 'daily_reports'
     and action      = 'view';

  select count(*) into v_after
  from public.audit_logs
  where entity_type = 'user_permissions'
    and action = 'update'
    and facility_id = '11111111-1111-1111-1111-111111111111';

  if v_after = v_before + 1 then
    raise notice 'ok: AU: user_permissions UPDATE wrote one audit_logs row';
  else
    insert into _rls_failures (msg)
    values (format(
      'FAIL: AU: user_permissions UPDATE audit — expected %s, got %s',
      v_before + 1, v_after));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Profile management (migration 100): can_edit_user_profile, users self-update
-- + the privilege-escalation guard trigger, and profile_audit_log RLS.
-- The preceding block ran as postgres, so re-impersonate Alice (staff,
-- facility A). Bob is staff in facility B.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Alice may edit her own profile, never Bob's (cross-facility).
select pg_temp.expect_count(
  $$select (public.can_edit_user_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))::int$$,
  1, 'profile: alice CAN edit her own profile');
select pg_temp.expect_count(
  $$select (public.can_edit_user_profile('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))::int$$,
  0, 'profile: alice CANNOT edit Bob (cross-facility)');

-- Self-service update succeeds (RLS allows id = auth.uid()).
select pg_temp.expect_count(
  $$with u as (
      update public.users set city = 'Selfville'
      where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      returning 1
    ) select count(*)::int from u$$,
  1, 'profile: alice CAN self-update her users row');

-- Cross-facility update is filtered to zero rows by RLS.
select pg_temp.expect_count(
  $$with u as (
      update public.users set city = 'Hackville'
      where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      returning 1
    ) select count(*)::int from u$$,
  0, 'profile: alice CANNOT update Bob''s users row');

-- Privilege escalation on self is blocked by the guard trigger.
select pg_temp.expect_error(
  $$update public.users set is_super_admin = true
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'profile: alice CANNOT escalate is_super_admin on herself');

-- Audit-log insert for a target she cannot edit is denied by WITH CHECK.
select pg_temp.expect_error(
  $$insert into public.profile_audit_log (edited_by, target_user_id, changed_fields)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '{}'::jsonb)$$,
  'profile: alice CANNOT write a profile_audit_log row for Bob');

-- Hierarchy: a manager in facility A may edit staff (alice) but still cannot
-- escalate their privilege.
set local role postgres;
insert into auth.users (id, email)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'mona@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', 'mona@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'cccc3333-cccc-cccc-cccc-cccccccccccc'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
       r.id, 'Mona', 'Manager', 'mona@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'manager'
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select (public.can_edit_user_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))::int$$,
  1, 'profile: manager CAN edit staff (alice) in same facility');
select pg_temp.expect_count(
  $$with u as (
      update public.users set city = 'Manorville'
      where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      returning 1
    ) select count(*)::int from u$$,
  1, 'profile: manager CAN update staff users row');
select pg_temp.expect_error(
  $$update public.users set is_super_admin = true
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'profile: manager CANNOT escalate staff is_super_admin');

-- ---------------------------------------------------------------------------
-- INC: Incident Report redesign isolation (migrations 101-104).
--
-- Covers the new tenant-isolation surfaces:
--   facility_spaces       (shared list; SELECT for any same-facility user,
--                          writes for facility admins only)
--   incident_activities   (module-gated like incident_types)
--   incident_reports      (submitter ownership + 24h edit window)
--   incident_report_spaces / incident_witnesses (parent-window gated)
--   incident_change_log   (admin-only read; append-only)
--
-- Self-contained: seeds its own fixtures and grants Alice VIEW-only on
-- incident_reports. Submit stays withheld, so the H4 dispatch negative above
-- (which already ran) is unaffected; admin stays withheld, so admin-only
-- writes/reads remain denied.
-- ---------------------------------------------------------------------------
set local role postgres;

-- VIEW-only grant: enables has_module_access('incident_reports') for Alice
-- without granting submit (H4) or admin (write gates).
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'incident_reports', 'view'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;

-- Facility spaces: two in A, one in B.
insert into public.facility_spaces (id, facility_id, name, slug, sort_order, is_active)
values
  ('aaaa1111-0a01-aaaa-aaaa-aaaa11110021',
   '11111111-1111-1111-1111-111111111111', 'Space A1', 'space-a1', 1, true),
  ('aaaa1111-0a02-aaaa-aaaa-aaaa11110022',
   '11111111-1111-1111-1111-111111111111', 'Space A2', 'space-a2', 2, true),
  ('bbbb2222-0b01-bbbb-bbbb-bbbb22220021',
   '22222222-2222-2222-2222-222222222222', 'Space B1', 'space-b1', 1, true)
on conflict (id) do nothing;

-- Incident activities: one in each facility.
insert into public.incident_activities (id, facility_id, key, display_name, sort_order, is_active)
values
  ('aaaa1111-0ac1-aaaa-aaaa-aaaa11110031',
   '11111111-1111-1111-1111-111111111111', 'act-a', 'Activity A', 1, true),
  ('bbbb2222-0bc1-bbbb-bbbb-bbbb22220031',
   '22222222-2222-2222-2222-222222222222', 'act-b', 'Activity B', 1, true)
on conflict (id) do nothing;

-- One incident report per facility, owned by that facility's staff member.
insert into public.incident_reports
  (id, facility_id, employee_id, reporter_name, reporter_phone, description)
values
  ('aaaa1111-1c01-aaaa-aaaa-aaaa11110041',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Alice Anderson', '555-0001', 'Incident in facility A'),
  ('bbbb2222-1c01-bbbb-bbbb-bbbb22220041',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Bob Baker', '555-0002', 'Incident in facility B')
on conflict (id) do nothing;

-- Link each report to a space in its own facility.
insert into public.incident_report_spaces (facility_id, incident_id, space_id)
values
  ('11111111-1111-1111-1111-111111111111',
   'aaaa1111-1c01-aaaa-aaaa-aaaa11110041',
   'aaaa1111-0a01-aaaa-aaaa-aaaa11110021'),
  ('22222222-2222-2222-2222-222222222222',
   'bbbb2222-1c01-bbbb-bbbb-bbbb22220041',
   'bbbb2222-0b01-bbbb-bbbb-bbbb22220021')
on conflict (incident_id, space_id) do nothing;

-- One witness per report (name + at least one contact).
insert into public.incident_witnesses
  (id, facility_id, incident_id, name, phone, sort_order)
values
  ('aaaa1111-1d01-aaaa-aaaa-aaaa11110051',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-1c01-aaaa-aaaa-aaaa11110041', 'Wanda Witness', '555-1111', 0),
  ('bbbb2222-1d01-bbbb-bbbb-bbbb22220051',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-1c01-bbbb-bbbb-bbbb22220041', 'Walt Witness', '555-2222', 0)
on conflict (id) do nothing;

-- One change-log entry per report.
insert into public.incident_change_log (facility_id, incident_id, employee_id, action)
values
  ('11111111-1111-1111-1111-111111111111',
   'aaaa1111-1c01-aaaa-aaaa-aaaa11110041',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'create'),
  ('22222222-2222-2222-2222-222222222222',
   'bbbb2222-1c01-bbbb-bbbb-bbbb22220041',
   'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'create');

-- Re-impersonate Alice (Facility A staff, now with incident VIEW).
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- facility_spaces: shared list — readable within facility, not across.
select pg_temp.expect_count(
  $$select count(*) from public.facility_spaces
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  2, 'INC: alice CAN SELECT facility_spaces in her facility');
select pg_temp.expect_count(
  $$select count(*) from public.facility_spaces
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'INC: alice CANNOT SELECT facility_spaces in facility B');
-- Writes are facility-admin only; staff alice is denied even in her own facility.
select pg_temp.expect_error(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky', 'sneaky')$$,
  'INC: staff alice (no admin) CANNOT INSERT a facility_space in her facility');
select pg_temp.expect_error(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('22222222-2222-2222-2222-222222222222', 'Cross', 'cross')$$,
  'INC: alice CANNOT INSERT a facility_space into facility B');

-- incident_activities: module-gated read; admin-gated write.
select pg_temp.expect_count(
  $$select count(*) from public.incident_activities
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'INC: alice CAN SELECT incident_activities in her facility (via view)');
select pg_temp.expect_count(
  $$select count(*) from public.incident_activities
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'INC: alice CANNOT SELECT incident_activities in facility B');
select pg_temp.expect_error(
  $$insert into public.incident_activities (facility_id, key, display_name)
    values ('11111111-1111-1111-1111-111111111111', 'x', 'X')$$,
  'INC: staff alice (no admin) CANNOT INSERT incident_activities');

-- incident_reports: submitter sees own row, not the foreign facility's.
select pg_temp.expect_count(
  $$select count(*) from public.incident_reports
    where id = 'aaaa1111-1c01-aaaa-aaaa-aaaa11110041'$$,
  1, 'INC: alice CAN SELECT her own incident_report');
select pg_temp.expect_count(
  $$select count(*) from public.incident_reports
    where id = 'bbbb2222-1c01-bbbb-bbbb-bbbb22220041'$$,
  0, 'INC: alice CANNOT SELECT facility B incident_report');

-- incident_report_spaces: read + write gated on the parent report.
select pg_temp.expect_count(
  $$select count(*) from public.incident_report_spaces
    where incident_id = 'aaaa1111-1c01-aaaa-aaaa-aaaa11110041'$$,
  1, 'INC: alice CAN SELECT spaces on her own report');
select pg_temp.expect_count(
  $$select count(*) from public.incident_report_spaces
    where incident_id = 'bbbb2222-1c01-bbbb-bbbb-bbbb22220041'$$,
  0, 'INC: alice CANNOT SELECT spaces on facility B report');
-- Within her 24h window, alice may add a space to her own report.
select pg_temp.expect_ok(
  $$insert into public.incident_report_spaces (facility_id, incident_id, space_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-1c01-aaaa-aaaa-aaaa11110041',
            'aaaa1111-0a02-aaaa-aaaa-aaaa11110022')$$,
  'INC: alice CAN add a space to her own report within the edit window');
-- She cannot attach anything to facility B's report.
select pg_temp.expect_error(
  $$insert into public.incident_report_spaces (facility_id, incident_id, space_id)
    values ('11111111-1111-1111-1111-111111111111',
            'bbbb2222-1c01-bbbb-bbbb-bbbb22220041',
            'aaaa1111-0a02-aaaa-aaaa-aaaa11110022')$$,
  'INC: alice CANNOT add a space to facility B''s report');

-- incident_witnesses: read + write gated on the parent report.
select pg_temp.expect_count(
  $$select count(*) from public.incident_witnesses
    where incident_id = 'aaaa1111-1c01-aaaa-aaaa-aaaa11110041'$$,
  1, 'INC: alice CAN SELECT witnesses on her own report');
select pg_temp.expect_count(
  $$select count(*) from public.incident_witnesses
    where incident_id = 'bbbb2222-1c01-bbbb-bbbb-bbbb22220041'$$,
  0, 'INC: alice CANNOT SELECT witnesses on facility B report');
select pg_temp.expect_ok(
  $$insert into public.incident_witnesses
      (facility_id, incident_id, name, email, sort_order)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-1c01-aaaa-aaaa-aaaa11110041',
            'Second Witness', 'sw@example.com', 1)$$,
  'INC: alice CAN add a witness to her own report within the edit window');
select pg_temp.expect_error(
  $$insert into public.incident_witnesses
      (facility_id, incident_id, name, phone, sort_order)
    values ('11111111-1111-1111-1111-111111111111',
            'bbbb2222-1c01-bbbb-bbbb-bbbb22220041',
            'Forged Witness', '555-9999', 1)$$,
  'INC: alice CANNOT add a witness to facility B''s report');

-- incident_change_log: admin-only read — staff submitter sees nothing.
select pg_temp.expect_count(
  $$select count(*) from public.incident_change_log
    where incident_id = 'aaaa1111-1c01-aaaa-aaaa-aaaa11110041'$$,
  0, 'INC: staff alice CANNOT read incident_change_log (admin-only)');

-- facility_spaces write broadening (migration 105): an Incident Reports module
-- admin may manage spaces. Granted at the very end so it doesn't affect the
-- admin-denied assertions above. Cross-facility isolation must still hold.
set local role postgres;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'incident_reports', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_ok(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('11111111-1111-1111-1111-111111111111', 'Admin Space', 'admin-space')$$,
  'INC: incident-module admin CAN insert a facility_space in own facility');
select pg_temp.expect_error(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('22222222-2222-2222-2222-222222222222', 'Cross Admin', 'cross-admin')$$,
  'INC: incident-module admin still CANNOT insert a facility_space in facility B');

-- facility_spaces write broadening (migration 141): facility_spaces is now a
-- shared list, so an Air Quality (or Accident Reports) module admin may manage
-- it too — not just an incident admin. Use Erin, who holds ONLY air_quality
-- admin in facility A (no facility-admin, no incident admin), to prove the new
-- branch specifically. Cross-facility isolation must still hold.
set local role postgres;
insert into auth.users (id, email)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'erin@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        '11111111-1111-1111-1111-111111111111', 'erin@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'eeee4444-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
       r.id, 'Erin', 'Evans', 'erin@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        '11111111-1111-1111-1111-111111111111',
        'air_quality', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true);

select pg_temp.expect_ok(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('11111111-1111-1111-1111-111111111111', 'AQ Admin Space', 'aq-admin-space')$$,
  'AQ: air_quality-module admin CAN insert a facility_space in own facility (migration 141)');
select pg_temp.expect_error(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('22222222-2222-2222-2222-222222222222', 'AQ Cross', 'aq-cross')$$,
  'AQ: air_quality-module admin still CANNOT insert a facility_space in facility B');

-- facility_spaces write broadening (migration 141), accident_reports branch.
-- Frank holds ONLY accident_reports admin in facility A (no facility-admin, no
-- incident/air_quality admin) — proves the third consuming-module branch.
set local role postgres;
insert into auth.users (id, email)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'frank@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff',
        '11111111-1111-1111-1111-111111111111', 'frank@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'ffff4444-ffff-ffff-ffff-ffffffffffff'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
       r.id, 'Frank', 'Foster', 'frank@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff',
        '11111111-1111-1111-1111-111111111111',
        'accident_reports', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true);

select pg_temp.expect_ok(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('11111111-1111-1111-1111-111111111111', 'ACC Admin Space', 'acc-admin-space')$$,
  'ACC: accident_reports-module admin CAN insert a facility_space in own facility (migration 141)');
select pg_temp.expect_error(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('22222222-2222-2222-2222-222222222222', 'ACC Cross', 'acc-cross')$$,
  'ACC: accident_reports-module admin still CANNOT insert a facility_space in facility B');

-- Negative bound (migration 141): the broadening is limited to facility admins
-- and admins of the three consuming modules. Gwen holds ONLY refrigeration admin
-- (a NON-consuming module) and is plain staff, so she must NOT be able to manage
-- the shared list even in her own facility.
set local role postgres;
insert into auth.users (id, email)
values ('99999999-9999-9999-9999-999999999999', 'gwen@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('99999999-9999-9999-9999-999999999999',
        '11111111-1111-1111-1111-111111111111', 'gwen@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select '99994444-9999-9999-9999-999999999999'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       '99999999-9999-9999-9999-999999999999'::uuid,
       r.id, 'Gwen', 'Gray', 'gwen@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('99999999-9999-9999-9999-999999999999',
        '11111111-1111-1111-1111-111111111111',
        'refrigeration', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

select pg_temp.expect_error(
  $$insert into public.facility_spaces (facility_id, name, slug)
    values ('11111111-1111-1111-1111-111111111111', 'Gwen Space', 'gwen-space')$$,
  'SPACES: a non-consuming-module admin (refrigeration only) CANNOT manage facility_spaces (migration 141 bound)');

-- ---------------------------------------------------------------------------
-- INC-RPC: atomic incident persist functions (migration 173).
--
-- submit_incident_report / update_incident_report are SECURITY INVOKER, so
-- they must confer NO authority beyond the equivalent row-by-row writes:
-- same-facility submitters can persist atomically, cross-facility calls die
-- at the RLS layer, and a mid-persist constraint failure rolls back the
-- whole call (no partial children, no lost witnesses).
--
-- Ivy is a fresh facility-A staffer holding only incident_reports view+submit
-- (no admin anywhere), so these assertions are independent of the grants the
-- earlier sections stacked onto Alice.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into auth.users (id, email)
values ('dddd0000-dddd-dddd-dddd-dddddddddddd', 'ivy@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('dddd0000-dddd-dddd-dddd-dddddddddddd',
        '11111111-1111-1111-1111-111111111111', 'ivy@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'dddd4444-dddd-dddd-dddd-dddddddddddd'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'dddd0000-dddd-dddd-dddd-dddddddddddd'::uuid,
       r.id, 'Ivy', 'Iverson', 'ivy@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values
  ('dddd0000-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111',
   'incident_reports', 'view'::public.user_action, true),
  ('dddd0000-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111',
   'incident_reports', 'submit'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"dddd0000-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'dddd0000-dddd-dddd-dddd-dddddddddddd', true);

-- Atomic create in own facility: report + linked space + witness + change log.
select pg_temp.expect_ok(
  $$select public.submit_incident_report(
      '11111111-1111-1111-1111-111111111111',
      'dddd4444-dddd-dddd-dddd-dddddddddddd',
      null, null,
      'aaaa1111-0ac1-aaaa-aaaa-aaaa11110031', null,
      null, 'Cleared the area', now(),
      'Ivy Iverson', '555-0009', 'INC-RPC atomic create',
      false, 1, false,
      array['aaaa1111-0a01-aaaa-aaaa-aaaa11110021']::uuid[],
      '[{"name":"Wes Witness","phone":"555-3333","email":null,"statement":null}]'::jsonb
    )$$,
  'INC-RPC: submitter CAN create atomically in own facility');
select pg_temp.expect_count(
  $$select count(*)::int from public.incident_report_spaces s
    join public.incident_reports r on r.id = s.incident_id
    where r.description = 'INC-RPC atomic create'$$,
  1, 'INC-RPC: linked space landed with the report');
select pg_temp.expect_count(
  $$select count(*)::int from public.incident_witnesses w
    join public.incident_reports r on r.id = w.incident_id
    where r.description = 'INC-RPC atomic create'$$,
  1, 'INC-RPC: witness landed with the report');

-- Cross-facility create dies at the incident_reports INSERT policy.
select pg_temp.expect_error(
  $$select public.submit_incident_report(
      '22222222-2222-2222-2222-222222222222',
      'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      null, null, null, null,
      null, null, now(),
      'Ivy Iverson', '555-0009', 'INC-RPC forged cross-facility',
      false, null, false, '{}'::uuid[], '[]'::jsonb
    )$$,
  'INC-RPC: submitter CANNOT create for facility B through the function');

-- In-window edit of her own report: full witness/space replace + change log.
select pg_temp.expect_ok(
  $$select public.update_incident_report(
      (select id from public.incident_reports
        where description = 'INC-RPC atomic create'),
      null, null, null, null,
      'Lobby', null, now(), 'INC-RPC atomic create (edited)',
      false, 2, true,
      array['aaaa1111-0a02-aaaa-aaaa-aaaa11110022']::uuid[],
      '[{"name":"Nora New","phone":null,"email":"nora@x.test","statement":"saw it"}]'::jsonb
    )$$,
  'INC-RPC: submitter CAN edit own report within the window');
select pg_temp.expect_count(
  $$select count(*)::int from public.incident_witnesses w
    join public.incident_reports r on r.id = w.incident_id
    where r.description = 'INC-RPC atomic create (edited)'
      and w.name = 'Nora New'$$,
  1, 'INC-RPC: edit replaced the witness list');

-- Editing another facility's report dies at the RLS select (row invisible).
select pg_temp.expect_error(
  $$select public.update_incident_report(
      'bbbb2222-1c01-bbbb-bbbb-bbbb22220041',
      null, null, null, null,
      null, null, now(), 'forged edit',
      false, null, false, '{}'::uuid[], '[]'::jsonb
    )$$,
  'INC-RPC: submitter CANNOT edit facility B''s report through the function');

-- Atomicity: a witness violating the contact-present constraint aborts the
-- WHOLE edit — the previously saved witness must survive untouched (the old
-- app-side delete-then-insert path would have lost it here).
select pg_temp.expect_error(
  $$select public.update_incident_report(
      (select id from public.incident_reports
        where description = 'INC-RPC atomic create (edited)'),
      null, null, null, null,
      'Lobby', null, now(), 'INC-RPC should not persist',
      false, 2, true, '{}'::uuid[],
      '[{"name":"No Contact","phone":null,"email":null,"statement":null}]'::jsonb
    )$$,
  'INC-RPC: constraint-violating edit fails as a unit');
select pg_temp.expect_count(
  $$select count(*)::int from public.incident_witnesses w
    join public.incident_reports r on r.id = w.incident_id
    where r.description = 'INC-RPC atomic create (edited)'
      and w.name = 'Nora New'$$,
  1, 'INC-RPC: failed edit rolled back — prior witness intact');

-- ---------------------------------------------------------------------------
-- SPACES: schema guards for the facility_spaces FK retargets / table drop
-- (migrations 142 + 143). These read catalogs only, so run as postgres.
-- ---------------------------------------------------------------------------
set local role postgres;

-- 142: accidents now reference the shared list; the old 'location' dropdown
-- rows are gone and the FK points at facility_spaces.
select pg_temp.expect_count(
  $$select count(*)::int from public.accident_dropdowns where category = 'location'$$,
  0, 'ACC: legacy location accident_dropdowns removed (migration 142)');
select pg_temp.expect_count(
  $$select count(*)::int from pg_constraint c
      join pg_class ft on ft.oid = c.confrelid
    where c.conname = 'accident_reports_location_dropdown_id_fkey'
      and ft.relname = 'facility_spaces'$$,
  1, 'ACC: location_dropdown_id FK retargeted to facility_spaces (migration 142)');

-- 143: air_quality_locations is dropped and the three AQ FKs point at
-- facility_spaces.
select pg_temp.expect_count(
  $$select count(*)::int from pg_class
    where relname = 'air_quality_locations'
      and relnamespace = 'public'::regnamespace$$,
  0, 'AQ: air_quality_locations table dropped (migration 143)');
select pg_temp.expect_count(
  $$select count(*)::int from pg_constraint c
      join pg_class ft on ft.oid = c.confrelid
    where c.conname in (
            'air_quality_equipment_location_id_fkey',
            'air_quality_reports_location_id_fkey')
      and ft.relname = 'facility_spaces'$$,
  2, 'AQ: equipment/reports location FKs retargeted to facility_spaces (migration 143)');

-- 153: the legacy air_quality_thresholds table and the readings.threshold_id FK
-- are retired — the compliance engine is the single source of truth.
select pg_temp.expect_count(
  $$select count(*)::int from pg_class
    where relname = 'air_quality_thresholds'
      and relnamespace = 'public'::regnamespace$$,
  0, 'AQ: air_quality_thresholds table dropped (migration 153)');
select pg_temp.expect_count(
  $$select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name = 'air_quality_readings'
      and column_name = 'threshold_id'$$,
  0, 'AQ: air_quality_readings.threshold_id column dropped (migration 153)');

-- ---------------------------------------------------------------------------
-- REFRIG: Refrigeration hardening (migrations 110-114).
--
-- Covers:
--   * report_values INSERT now requires >= submit (migration 114): a view-only
--     user can no longer write child value rows, while a submit user can.
--   * followup_notes INSERT relaxed to >= submit (migration 114): submit-level
--     operators can record corrective actions (previously admin-only).
--   * duplicate active threshold / field rejection via the partial unique
--     indexes from migration 11 (item 5 invariant). Run as postgres so the
--     failure is the unique index, not RLS.
--
-- Self-contained: seeds its own section/field/threshold/reports plus a
-- VIEW-only user (Dave) in facility A. Alice already holds refrigeration
-- view+submit from the top-of-file grant.
-- ---------------------------------------------------------------------------
set local role postgres;

-- VIEW-only user in facility A (refrigeration view, NO submit).
insert into auth.users (id, email)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'dave@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd',
        '11111111-1111-1111-1111-111111111111', 'dave@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'dddd4444-dddd-dddd-dddd-dddddddddddd'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
       r.id, 'Dave', 'Davis', 'dave@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd',
        '11111111-1111-1111-1111-111111111111',
        'refrigeration', 'view'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;

-- Config: one section + numeric field + active threshold in facility A.
insert into public.refrigeration_sections (id, facility_id, name, slug, sort_order, is_active)
values ('aaaa1111-5ec0-aaaa-aaaa-aaaa11110060',
        '11111111-1111-1111-1111-111111111111', 'Compressors Test', 'compressors-test', 1, true)
on conflict (id) do nothing;
insert into public.refrigeration_fields
  (id, facility_id, section_id, equipment_id, key, label, field_type, unit, sort_order, is_active)
values ('aaaa1111-f1d0-aaaa-aaaa-aaaa11110061',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-5ec0-aaaa-aaaa-aaaa11110060', null,
        'suction_pressure', 'Suction pressure', 'numeric', 'psig', 1, true)
on conflict (id) do nothing;
insert into public.refrigeration_thresholds
  (id, facility_id, field_id, equipment_id, min_value, max_value, severity, is_active)
values ('aaaa1111-7780-aaaa-aaaa-aaaa11110062',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-f1d0-aaaa-aaaa-aaaa11110061', null, 10, 20, 'warn', true)
on conflict (id) do nothing;

-- One report per facility to attach value rows / notes to.
insert into public.refrigeration_reports (id, facility_id, employee_id)
values
  ('aaaa1111-7e00-aaaa-aaaa-aaaa11110063',
   '11111111-1111-1111-1111-111111111111', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbb2222-7e00-bbbb-bbbb-bbbb22220063',
   '22222222-2222-2222-2222-222222222222', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (id) do nothing;

-- Duplicate-rejection (item 5 invariant) — as postgres so the unique index,
-- not RLS, is what raises.
select pg_temp.expect_error(
  $$insert into public.refrigeration_fields
      (facility_id, section_id, equipment_id, key, label, field_type)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-5ec0-aaaa-aaaa-aaaa11110060', null,
            'suction_pressure', 'Dup key', 'numeric')$$,
  'REFRIG: duplicate active field key in a section is rejected (unique index)');
select pg_temp.expect_error(
  $$insert into public.refrigeration_thresholds
      (facility_id, field_id, equipment_id, min_value, max_value, severity)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-f1d0-aaaa-aaaa-aaaa11110061', null, 5, 9, 'high')$$,
  'REFRIG: second active threshold for one field/equipment is rejected (unique index)');

-- Alice (Facility A staff, refrigeration submit).
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_ok(
  $$insert into public.refrigeration_reports (facility_id, employee_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'REFRIG: alice (submit) CAN INSERT a report in her facility');
select pg_temp.expect_ok(
  $$insert into public.refrigeration_report_values
      (facility_id, report_id, label_snapshot, field_type_snapshot, value_numeric)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-7e00-aaaa-aaaa-aaaa11110063',
            'Suction pressure', 'numeric', 15)$$,
  'REFRIG: alice (submit) CAN INSERT report values (>= submit, migration 114)');
select pg_temp.expect_ok(
  $$insert into public.refrigeration_followup_notes
      (facility_id, report_id, body, is_admin_note)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-7e00-aaaa-aaaa-aaaa11110063',
            'Corrective action taken', false)$$,
  'REFRIG: alice (submit) CAN INSERT a follow-up note (relaxed to submit, migration 114)');
select pg_temp.expect_error(
  $$insert into public.refrigeration_report_values
      (facility_id, report_id, label_snapshot, field_type_snapshot, value_numeric)
    values ('22222222-2222-2222-2222-222222222222',
            'bbbb2222-7e00-bbbb-bbbb-bbbb22220063',
            'Cross tenant', 'numeric', 15)$$,
  'REFRIG: alice CANNOT INSERT report values tagged facility B');

-- Dave (Facility A, refrigeration VIEW only).
set local role authenticated;
set local request.jwt.claims to '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true);

select pg_temp.expect_count(
  $$select count(*) from public.refrigeration_fields
    where id = 'aaaa1111-f1d0-aaaa-aaaa-aaaa11110061'$$,
  1, 'REFRIG: view-only dave CAN SELECT refrigeration config (view retained)');
select pg_temp.expect_error(
  $$insert into public.refrigeration_report_values
      (facility_id, report_id, label_snapshot, field_type_snapshot, value_numeric)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-7e00-aaaa-aaaa-aaaa11110063',
            'View only', 'numeric', 15)$$,
  'REFRIG: view-only dave CANNOT INSERT report values (migration 114 tightening)');
select pg_temp.expect_error(
  $$insert into public.refrigeration_followup_notes
      (facility_id, report_id, body)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-7e00-aaaa-aaaa-aaaa11110063', 'No permission')$$,
  'REFRIG: view-only dave CANNOT INSERT a follow-up note (requires submit)');

reset role;

-- ---------------------------------------------------------------------------
-- 2L. Cross-facility SELECT isolation on the crown-jewel data: every report
-- submission, communication, scheduling, and notification table. Impersonate
-- Alice (staff in Facility A, holding view+submit on every module) and assert
-- she reads ZERO of the Facility-B rows seeded in section 1z. Before this
-- block these high-volume tables had no isolation coverage at all — only the
-- config/permission tables did.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B daily_report_submissions');
select pg_temp.expect_count(
  $$select count(*) from public.incident_reports
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B incident_reports');
select pg_temp.expect_count(
  $$select count(*) from public.accident_reports
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B accident_reports');
select pg_temp.expect_count(
  $$select count(*) from public.refrigeration_reports
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B refrigeration_reports');
select pg_temp.expect_count(
  $$select count(*) from public.air_quality_reports
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B air_quality_reports');
select pg_temp.expect_count(
  $$select count(*) from public.ice_operations_submissions
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B ice_operations_submissions');
select pg_temp.expect_count(
  $$select count(*) from public.ice_depth_sessions
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B ice_depth_sessions');
select pg_temp.expect_count(
  $$select count(*) from public.communication_messages
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B communication_messages');
select pg_temp.expect_count(
  $$select count(*) from public.communication_recipients
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B communication_recipients');
select pg_temp.expect_count(
  $$select count(*) from public.communication_alerts
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B communication_alerts');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B schedule_shifts');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_availability
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B schedule_availability');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_time_off_requests
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B schedule_time_off_requests');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_swap_requests
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B schedule_swap_requests');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_notifications
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B schedule_notifications');

reset role;

-- ---------------------------------------------------------------------------
-- 2M. Module-admin rights are facility-scoped (regression for migration 133).
--
-- Impersonate Carol, a SCHEDULING ADMIN in Facility A. The four tables fixed
-- in migration 133 (availability, time_off, notifications, swap_requests) had
-- a bare has_module_admin_access('scheduling') branch that ignored the row's
-- facility — so a Facility-A admin could read Facility-B rows. Assert she
-- reads ZERO Facility-B rows, AND a positive that she still sees her own
-- facility (proving the fix didn't over-restrict legitimate admin access).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select count(*) from public.schedule_availability
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO-ADMIN: facility-A scheduling admin CANNOT SELECT facility-B availability (migration 133)');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_time_off_requests
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO-ADMIN: facility-A scheduling admin CANNOT SELECT facility-B time_off (migration 133)');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_notifications
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO-ADMIN: facility-A scheduling admin CANNOT SELECT facility-B notifications (migration 133)');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_swap_requests
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO-ADMIN: facility-A scheduling admin CANNOT SELECT facility-B swap_requests (migration 133)');

-- Positive: the admin DOES see her own facility's scheduling rows.
select pg_temp.expect_count(
  $$select count(*) from public.schedule_availability
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'ISO-ADMIN: scheduling admin STILL sees own-facility availability (fix is not over-broad)');

-- Wages (migration 167): the scheduling admin reads her OWN facility's wage
-- rows and zero cross-facility rows.
select pg_temp.expect_count(
  $$select count(*) from public.employee_wages
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'ISO-ADMIN: scheduling admin CAN SELECT own-facility employee_wages');
select pg_temp.expect_count(
  $$select count(*) from public.employee_wages
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO-ADMIN: facility-A scheduling admin CANNOT SELECT facility-B employee_wages');

-- Certification catalog (migration 169): the scheduling admin can create a
-- type in her own facility (positive) and reads zero cross-facility rows.
select pg_temp.expect_ok(
  $$insert into public.certification_types (facility_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Forklift')$$,
  'ISO-ADMIN: scheduling admin CAN INSERT a certification type in her facility');
select pg_temp.expect_count(
  $$select count(*) from public.certification_types
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO-ADMIN: facility-A scheduling admin CANNOT SELECT facility-B certification types');

-- Communications recipients (migration 189): the SELECT policy's admin branch
-- (has_module_admin_access('communications')) used to lack a facility_id match,
-- so a Facility-A communications admin could read Facility-B recipient rosters.
-- Carol also holds communications admin, so this exercises that exact branch.
select pg_temp.expect_count(
  $$select count(*) from public.communication_recipients
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO-ADMIN: facility-A communications admin CANNOT SELECT facility-B communication_recipients (migration 189)');
-- Positive: she DOES still read her own facility's recipients (fix not
-- over-broad). Pinned to the fixture row rather than a facility-wide count so
-- other sections' recipient fixtures can't skew the assertion.
select pg_temp.expect_count(
  $$select count(*) from public.communication_recipients
    where id = 'aaaa1111-c0a2-aaaa-aaaa-aaaa11110080'$$,
  1, 'ISO-ADMIN: communications admin STILL sees own-facility communication_recipients');

reset role;

-- ---------------------------------------------------------------------------
-- 2k. purge_module_data authorization gate (migration 132).
--
-- SECURITY DEFINER manual-purge worker for the admin Retention module. It
-- bypasses RLS, so its internal gate (super admin or is_facility_admin) is
-- the only thing standing between a regular employee and a cross-tenant (or
-- own-tenant) bulk delete. Assert both directions fail for non-admins.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.purge_module_data(
      '11111111-1111-1111-1111-111111111111', 'daily_reports')$$,
  'PURGE: staff alice CANNOT manually purge her own facility (admin-only)');
select pg_temp.expect_error(
  $$select public.purge_module_data(
      '22222222-2222-2222-2222-222222222222', 'daily_reports')$$,
  'PURGE: staff alice CANNOT manually purge facility B (cross-tenant)');

reset role;

-- ---------------------------------------------------------------------------
-- 2l. System-state purge functions (migration 134).
--
-- purge_old_notification_outbox / purge_old_offline_sync_queue are SECURITY
-- DEFINER bulk-deleters with no internal caller gate — the EXECUTE grant
-- (service_role only) IS the gate. Assert anon/authenticated cannot call
-- them, and that service_role can.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.purge_old_notification_outbox()$$,
  'PURGE-134: authenticated CANNOT execute purge_old_notification_outbox');
select pg_temp.expect_error(
  $$select public.purge_old_offline_sync_queue()$$,
  'PURGE-134: authenticated CANNOT execute purge_old_offline_sync_queue');

reset role;
set local role anon;

select pg_temp.expect_error(
  $$select public.purge_old_notification_outbox()$$,
  'PURGE-134: anon CANNOT execute purge_old_notification_outbox');
select pg_temp.expect_error(
  $$select public.purge_old_offline_sync_queue()$$,
  'PURGE-134: anon CANNOT execute purge_old_offline_sync_queue');

reset role;
set local role service_role;

select pg_temp.expect_ok(
  $$select public.purge_old_notification_outbox()$$,
  'PURGE-134: service_role CAN execute purge_old_notification_outbox');
select pg_temp.expect_ok(
  $$select public.purge_old_offline_sync_queue()$$,
  'PURGE-134: service_role CAN execute purge_old_offline_sync_queue');

reset role;

-- ---------------------------------------------------------------------------
-- 2m. Ice-depth nightly purge worker + integrity constraints (migration 138).
--
-- purge_old_ice_depth_sessions() is a SECURITY DEFINER bulk-deleter wired into
-- the run-retention-purge cron. Like the migration-134 workers, the EXECUTE
-- grant (service_role only) IS the gate. The CHECK constraints are the DB
-- floor under the app-layer guards in compute.ts / the admin settings form.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.purge_old_ice_depth_sessions()$$,
  'PURGE-138: authenticated CANNOT execute purge_old_ice_depth_sessions');

reset role;
set local role anon;

select pg_temp.expect_error(
  $$select public.purge_old_ice_depth_sessions()$$,
  'PURGE-138: anon CANNOT execute purge_old_ice_depth_sessions');

reset role;
set local role service_role;

select pg_temp.expect_ok(
  $$select public.purge_old_ice_depth_sessions()$$,
  'PURGE-138: service_role CAN execute purge_old_ice_depth_sessions');

reset role;

-- Integrity CHECKs run as postgres (BYPASSRLS) so only the constraint — not a
-- policy — can reject the write.
select pg_temp.expect_error(
  $$insert into public.ice_depth_settings (facility_id, low_threshold, high_threshold)
    values ('11111111-1111-1111-1111-111111111111', 2.0, 1.0)$$,
  'INTEGRITY-138: ice_depth_settings rejects low_threshold >= high_threshold');

select pg_temp.expect_error(
  $$insert into public.ice_depth_measurements
      (facility_id, session_id, point_number_snapshot, x_snapshot, y_snapshot,
       depth_value, severity)
    select '11111111-1111-1111-1111-111111111111', s.id, 1, 0.5, 0.5, -1, 'low'
      from public.ice_depth_sessions s
     where s.facility_id = '11111111-1111-1111-1111-111111111111'
     limit 1$$,
  'INTEGRITY-138: ice_depth_measurements rejects negative depth_value');

-- ---------------------------------------------------------------------------
-- 2m. Daily-checklist seeder (migration 135).
--
-- seed_default_daily_report_checklists is SECURITY DEFINER and writes a
-- caller-chosen facility's daily-report config, so its EXECUTE grant
-- (service_role / definer-internal only) is the gate. Also assert the seed
-- itself lands the full catalog for a brand-new facility — the D4 regression
-- this exists to prevent is "new facility, zero checklists".
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.seed_default_daily_report_checklists(
      '11111111-1111-1111-1111-111111111111')$$,
  'SEED-135: authenticated CANNOT execute seed_default_daily_report_checklists');

reset role;
set local role anon;

select pg_temp.expect_error(
  $$select public.seed_default_daily_report_checklists(
      '11111111-1111-1111-1111-111111111111')$$,
  'SEED-135: anon CANNOT execute seed_default_daily_report_checklists');

reset role;

insert into public.facilities (id, name, slug, timezone)
values ('33333333-3333-4333-8333-333333333333', 'Seed Test Rink', 'seed-test-rink', 'America/Chicago');

set local role service_role;
select pg_temp.expect_ok(
  $$select public.seed_default_daily_report_checklists(
      '33333333-3333-4333-8333-333333333333')$$,
  'SEED-135: service_role CAN execute the checklist seeder');
reset role;

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_areas
    where facility_id = '33333333-3333-4333-8333-333333333333'$$,
  17, 'SEED-135: new facility gets all 17 checklist areas');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_templates
    where facility_id = '33333333-3333-4333-8333-333333333333'$$,
  51, 'SEED-135: new facility gets all 51 phase templates');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_checklist_items
    where facility_id = '33333333-3333-4333-8333-333333333333'$$,
  506, 'SEED-135: new facility gets all 506 checklist items');

-- Migration 139 renamed the middle phase Operational -> Daily: each of the 17
-- areas seeds Opening / Daily / Closing, and no 'Operational' template remains.
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_templates
    where facility_id = '33333333-3333-4333-8333-333333333333'
      and name = 'Daily'$$,
  17, 'SEED-139: new facility seeds a Daily phase for every area');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_templates
    where facility_id = '33333333-3333-4333-8333-333333333333'
      and name = 'Operational'$$,
  0, 'SEED-139: no legacy Operational phase remains after rename');

-- ---------------------------------------------------------------------------
-- 2M-bis. Facility-bootstrap seeders locked down (migration 160).
--
-- seed_default_facility_air_quality_config(uuid) (migration 147) and
-- seed_default_facility_modules(uuid) (migration 144) are SECURITY DEFINER
-- facility-bootstrap helpers that were reachable over /rest/v1/rpc by
-- anon/authenticated until migration 160 revoked EXECUTE from those roles.
-- Like the other seeders, the EXECUTE grant (service_role only) IS the gate.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.seed_default_facility_air_quality_config(
      '11111111-1111-1111-1111-111111111111')$$,
  'SEED-160: authenticated CANNOT execute seed_default_facility_air_quality_config');
select pg_temp.expect_error(
  $$select public.seed_default_facility_modules(
      '11111111-1111-1111-1111-111111111111')$$,
  'SEED-160: authenticated CANNOT execute seed_default_facility_modules');

reset role;
set local role anon;

select pg_temp.expect_error(
  $$select public.seed_default_facility_air_quality_config(
      '11111111-1111-1111-1111-111111111111')$$,
  'SEED-160: anon CANNOT execute seed_default_facility_air_quality_config');
select pg_temp.expect_error(
  $$select public.seed_default_facility_modules(
      '11111111-1111-1111-1111-111111111111')$$,
  'SEED-160: anon CANNOT execute seed_default_facility_modules');

reset role;
set local role service_role;

select pg_temp.expect_ok(
  $$select public.seed_default_facility_air_quality_config(
      '33333333-3333-4333-8333-333333333333')$$,
  'SEED-160: service_role CAN execute seed_default_facility_air_quality_config');
select pg_temp.expect_ok(
  $$select public.seed_default_facility_modules(
      '33333333-3333-4333-8333-333333333333')$$,
  'SEED-160: service_role CAN execute seed_default_facility_modules');

reset role;

-- ---------------------------------------------------------------------------
-- 2N. Scheduling write-side gates (migration 136).
--
-- The swap-request UPDATE policy used to contain a bare "requester = me" /
-- "target = me" term that nullified its own status restriction, letting staff
-- set ANY status (including manager_approved). Draft shifts were readable by
-- any view-holder. Notification INSERT was open to any same-facility user.
-- Assert the tightened policies: staff transitions are limited to their role
-- (requester -> cancelled, target -> accepted/denied), drafts are admin-only,
-- notification inserts require scheduling admin, and the new SECURITY DEFINER
-- RPCs refuse non-admin callers.
-- ---------------------------------------------------------------------------
reset role;

-- Alice gets scheduling view+submit (NOT admin) so the staff-side positive
-- assertions exercise the module-access path.
insert into public.user_permissions (
  user_id, facility_id, module_name, action, enabled
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'scheduling', 'view', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'scheduling', 'submit', true)
on conflict (user_id, facility_id, module_name, action) do nothing;

insert into public.departments (id, facility_id, name, slug, sort_order, is_active)
values ('aaaa1111-de71-aaaa-aaaa-aaaa11110091',
        '11111111-1111-1111-1111-111111111111', 'A Crew', 'a-crew', 1, true)
on conflict (id) do nothing;

-- One published shift each for Carol and Alice, plus one draft.
insert into public.schedule_shifts (id, facility_id, department_id, employee_id, starts_at, ends_at, status)
values
  ('aaaa1111-5511-aaaa-aaaa-aaaa11110092',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
   'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
   now() + interval '1 day', now() + interval '1 day 4 hours', 'published'),
  ('aaaa1111-5512-aaaa-aaaa-aaaa11110093',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
   null,
   now() + interval '2 days', now() + interval '2 days 4 hours', 'draft'),
  ('aaaa1111-5513-aaaa-aaaa-aaaa11110094',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '3 days', now() + interval '3 days 4 hours', 'published')
on conflict (id) do nothing;

-- Swap 1: Carol -> Alice (Alice is the target). Swap 2: Alice is requester.
insert into public.schedule_swap_requests (
  id, facility_id, requester_employee_id, requester_shift_id,
  target_employee_id, status
) values
  ('aaaa1111-5711-aaaa-aaaa-aaaa11110095',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
   'aaaa1111-5511-aaaa-aaaa-aaaa11110092',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending'),
  ('aaaa1111-5712-aaaa-aaaa-aaaa11110096',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aaaa1111-5513-aaaa-aaaa-aaaa11110094',
   null, 'pending')
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Draft visibility: staff see published, never drafts.
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
    where id in ('aaaa1111-5511-aaaa-aaaa-aaaa11110092',
                 'aaaa1111-5513-aaaa-aaaa-aaaa11110094')$$,
  2, 'SCHED-136: staff CAN see published shifts in own facility');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
    where id = 'aaaa1111-5512-aaaa-aaaa-aaaa11110093'$$,
  0, 'SCHED-136: staff CANNOT see draft shifts (publish is the gate)');

-- Swap status transitions: neither role may self-approve.
select pg_temp.expect_error(
  $$update public.schedule_swap_requests
       set status = 'manager_approved'
     where id = 'aaaa1111-5711-aaaa-aaaa-aaaa11110095'$$,
  'SCHED-136: swap TARGET cannot set manager_approved');
select pg_temp.expect_error(
  $$update public.schedule_swap_requests
       set status = 'manager_approved'
     where id = 'aaaa1111-5712-aaaa-aaaa-aaaa11110096'$$,
  'SCHED-136: swap REQUESTER cannot set manager_approved');
select pg_temp.expect_ok(
  $$update public.schedule_swap_requests
       set status = 'accepted', accepted_at = now()
     where id = 'aaaa1111-5711-aaaa-aaaa-aaaa11110095'$$,
  'SCHED-136: swap target CAN accept a pending swap');
select pg_temp.expect_ok(
  $$update public.schedule_swap_requests
       set status = 'cancelled'
     where id = 'aaaa1111-5712-aaaa-aaaa-aaaa11110096'$$,
  'SCHED-136: swap requester CAN cancel their own swap');

-- Notification forgery: plain staff cannot insert.
select pg_temp.expect_error(
  $$insert into public.schedule_notifications (facility_id, employee_id, notification_type)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-ca01-aaaa-aaaa-aaaa11110099', 'shift_reminder')$$,
  'SCHED-136: staff CANNOT forge schedule_notifications');

-- New RPCs refuse non-admin callers.
select pg_temp.expect_error(
  $$select public.scheduling_apply_swap('aaaa1111-5711-aaaa-aaaa-aaaa11110095')$$,
  'SCHED-136: staff CANNOT execute scheduling_apply_swap');
select pg_temp.expect_error(
  $$select public.scheduling_approve_publish_request('aaaa1111-5711-aaaa-aaaa-aaaa11110095')$$,
  'SCHED-136: staff CANNOT execute scheduling_approve_publish_request');

reset role;

-- Scheduling admin (Carol) positives: drafts visible, notifications writable.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
    where id = 'aaaa1111-5512-aaaa-aaaa-aaaa11110093'$$,
  1, 'SCHED-136: scheduling admin STILL sees draft shifts');
select pg_temp.expect_ok(
  $$insert into public.schedule_notifications (facility_id, employee_id, notification_type)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'shift_reminder')$$,
  'SCHED-136: scheduling admin CAN insert schedule_notifications');

reset role;

-- ---------------------------------------------------------------------------
-- 2O. Migration-137 SECURITY DEFINER gates.
--
-- scheduling_decide_open_claim is admin-gated; scheduling_notify_swap_request
-- may only fire for the CALLER'S OWN live swap (returns false otherwise, and
-- must insert nothing).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.scheduling_decide_open_claim(
      'aaaa1111-5711-aaaa-aaaa-aaaa11110095', true)$$,
  'SCHED-137: staff CANNOT execute scheduling_decide_open_claim');

-- Alice is the TARGET (not requester) of swap ...95 — the helper must refuse.
select pg_temp.expect_count(
  $$select case when public.scheduling_notify_swap_request(
      'aaaa1111-5711-aaaa-aaaa-aaaa11110095') then 1 else 0 end$$,
  0, 'SCHED-137: non-requester CANNOT fire swap_request_received');

reset role;

select pg_temp.expect_count(
  $$select count(*) from public.schedule_notifications
    where swap_id = 'aaaa1111-5711-aaaa-aaaa-aaaa11110095'
      and notification_type = 'swap_request_received'$$,
  0, 'SCHED-137: refused notify helper inserted nothing');

-- ---------------------------------------------------------------------------
-- 2P. Migration-140 double-booking EXCLUDE constraint
--     (schedule_shifts_no_double_booking).
--
-- A GiST exclusion constraint must make it physically impossible to commit two
-- overlapping assigned (draft/published) shifts for the SAME employee, while
-- still allowing two shifts that merely TOUCH ('[)' bounds: one shift's ends_at
-- == the next shift's starts_at). Exercised as postgres (BYPASSRLS) — table
-- constraints fire regardless of role — reusing Alice's employee + department
-- in Facility A. Far-future timestamps avoid colliding with the day+1/+2/+3
-- shift fixtures seeded above.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

-- Baseline assigned shift for Alice (10:00–14:00 on a far-future day).
insert into public.schedule_shifts (id, facility_id, department_id, employee_id, starts_at, ends_at, status)
values ('aaaa1111-5514-aaaa-aaaa-aaaa11110097',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        now() + interval '30 days' + interval '10 hours',
        now() + interval '30 days' + interval '14 hours',
        'published')
on conflict (id) do nothing;

-- Overlapping (12:00–16:00) assigned shift for the SAME employee must be
-- rejected by the exclusion constraint (sqlstate 23P01).
select pg_temp.expect_error(
  $$insert into public.schedule_shifts
      (facility_id, department_id, employee_id, starts_at, ends_at, status)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            now() + interval '30 days' + interval '12 hours',
            now() + interval '30 days' + interval '16 hours',
            'published')$$,
  'SCHED-140: overlapping assigned shift for same employee is rejected (exclusion 23P01)');

-- Pin that the rejection is specifically the exclusion_violation (23P01), not an
-- unrelated error masquerading as one.
do $$
begin
  begin
    insert into public.schedule_shifts
      (facility_id, department_id, employee_id, starts_at, ends_at, status)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            now() + interval '30 days' + interval '12 hours',
            now() + interval '30 days' + interval '16 hours',
            'published');
    insert into _rls_failures (msg)
    values ('FAIL: SCHED-140: overlapping insert unexpectedly succeeded');
  exception
    when exclusion_violation then
      raise notice 'ok (23P01 as expected): SCHED-140 overlap raises exclusion_violation';
    when others then
      insert into _rls_failures (msg)
      values (format('FAIL: SCHED-140: overlap raised %s, expected 23P01', sqlstate));
  end;
end$$;

-- A touching (14:00–18:00) assigned shift — starts exactly when the baseline
-- ends — must SUCCEED: '[)' half-open bounds do not treat boundary contact as
-- an overlap.
select pg_temp.expect_ok(
  $$insert into public.schedule_shifts
      (facility_id, department_id, employee_id, starts_at, ends_at, status)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            now() + interval '30 days' + interval '14 hours',
            now() + interval '30 days' + interval '18 hours',
            'published')$$,
  'SCHED-140: touching shift (ends_at == next starts_at) is allowed');

reset role;

-- ---------------------------------------------------------------------------
-- 2Q. Publish-lock + cert-override audit (migration 148).
--
-- Publish-lock: once a shift is published it is frozen at the DB boundary —
-- a direct UPDATE/DELETE from an end-user role ('authenticated') is rejected,
-- while drafts stay editable and the governed SECURITY DEFINER cancel RPC
-- still works. Cert-override: missing/expired required certs hard-block
-- (scheduling_assignment_violations emits cert_missing:*), the override is
-- manager-gated and audited, and the audit log is admin-read-only.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

-- A job area in Facility A that requires the "CPR" cert. Alice (staff) holds
-- no CPR, so she is "missing"; Carol holds an EXPIRED CPR (treated as missing).
insert into public.employee_job_areas (id, facility_id, name, slug)
values ('aaaa1111-30b1-aaaa-aaaa-aaaa11110098',
        '11111111-1111-1111-1111-111111111111', 'Zamboni', 'zamboni')
on conflict (id) do nothing;
insert into public.job_area_certification_requirements
  (facility_id, job_area_id, cert_name, certification_type_id)
values ('11111111-1111-1111-1111-111111111111',
        'aaaa1111-30b1-aaaa-aaaa-aaaa11110098', 'CPR',
        'aaaa1111-ce7c-aaaa-aaaa-aaaa11110001')
on conflict do nothing;
insert into public.employee_certifications (facility_id, employee_id, name, expires_at)
values ('11111111-1111-1111-1111-111111111111',
        'aaaa1111-ca01-aaaa-aaaa-aaaa11110099', 'CPR', '2020-01-01')
on conflict do nothing;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

-- Cert gate: missing (Alice) and expired (Carol) both surface cert_missing:CPR.
select pg_temp.expect_count(
  $$select count(*) from (
      select unnest(public.scheduling_assignment_violations(
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        now() + interval '10 days', now() + interval '10 days 4 hours', 0,
        'aaaa1111-30b1-aaaa-aaaa-aaaa11110098', null)) as code
    ) c where code = 'cert_missing:CPR'$$,
  1, 'SCHED-148: missing required cert hard-blocks (cert_missing:CPR)');
select pg_temp.expect_count(
  $$select count(*) from (
      select unnest(public.scheduling_assignment_violations(
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
        now() + interval '11 days', now() + interval '11 days 4 hours', 0,
        'aaaa1111-30b1-aaaa-aaaa-aaaa11110098', null)) as code
    ) c where code = 'cert_missing:CPR'$$,
  1, 'SCHED-148: EXPIRED required cert is treated as missing');

-- Override is manager-gated and audited; the audit log is admin-read-only.
select pg_temp.expect_ok(
  $$select public.scheduling_log_cert_override(
      'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'aaaa1111-30b1-aaaa-aaaa-aaaa11110098',
      array['cert_missing:CPR'], null, 'covered by lead')$$,
  'SCHED-148: facility manager CAN log a cert override');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_assignment_overrides
     where employee_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and missing_certs @> array['CPR']$$,
  1, 'SCHED-148: override writes an audit row (employee + missing cert)');

-- Publish-lock: direct UPDATE / DELETE of a published shift is rejected.
select pg_temp.expect_error(
  $$update public.schedule_shifts set notes = 'tampered'
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'$$,
  'SCHED-148: direct UPDATE of a published shift is rejected (publish-lock)');
select pg_temp.expect_error(
  $$delete from public.schedule_shifts
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'$$,
  'SCHED-148: direct DELETE of a published shift is rejected (publish-lock)');
-- A draft shift stays editable.
select pg_temp.expect_ok(
  $$update public.schedule_shifts set notes = 'draft edit ok'
     where id = 'aaaa1111-5512-aaaa-aaaa-aaaa11110093'$$,
  'SCHED-148: a DRAFT shift is still directly editable');

-- Publish-lock CREATE leg (migration 164 — publish-lock-bypass regression):
-- a direct INSERT of a status='published' shift from an end-user role mints a
-- locked shift outright, skipping the two-person publish-request approval. The
-- create-leg of the original bypass — must be rejected at the DB boundary even
-- for an authorized scheduling admin (Carol). The matching app-layer fix forces
-- createGridShift to status='draft'; this probe guards the DB backstop and fails
-- if either guard is ever removed.
select pg_temp.expect_error(
  $$insert into public.schedule_shifts
      (facility_id, department_id, starts_at, ends_at, status)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            now() + interval '60 days', now() + interval '60 days 4 hours',
            'published')$$,
  'SCHED-164: direct INSERT of a PUBLISHED shift is rejected (publish-lock create-leg)');
-- A brand-new DRAFT shift can still be inserted directly (the legitimate path).
select pg_temp.expect_ok(
  $$insert into public.schedule_shifts
      (facility_id, department_id, starts_at, ends_at, status)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            now() + interval '61 days', now() + interval '61 days 4 hours',
            'draft')$$,
  'SCHED-164: a brand-new DRAFT shift can still be inserted directly');
-- Defaulting the status (omitting it) must also yield an allowed draft insert,
-- so the guard can never be sidestepped by simply leaving status unset.
select pg_temp.expect_ok(
  $$insert into public.schedule_shifts
      (facility_id, department_id, starts_at, ends_at)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            now() + interval '62 days', now() + interval '62 days 4 hours')$$,
  'SCHED-164: an INSERT that omits status defaults to draft and is allowed');
-- The governed cancel RPC can transition a published shift.
select pg_temp.expect_ok(
  $$select public.scheduling_admin_cancel_shift('aaaa1111-5513-aaaa-aaaa-aaaa11110094')$$,
  'SCHED-148: published shift can be cancelled via the governed RPC');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5513-aaaa-aaaa-aaaa11110094' and status = 'cancelled'$$,
  1, 'SCHED-148: governed cancel actually cancelled the published shift');
-- Cancelling a shift notifies the affected employee (migration 150). Shift ...94
-- was assigned to Alice; the cancel above should have queued her a notification.
select pg_temp.expect_count(
  $$select count(*) from public.schedule_notifications
     where shift_id = 'aaaa1111-5513-aaaa-aaaa-aaaa11110094'
       and employee_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and notification_type = 'shift_changed'$$,
  1, 'SCHED-150: cancelling a shift notifies the affected employee');

-- Governed republish-edit (migration 149): a manager edits a published shift
-- through the audited RPC; the publish-lock would reject a direct write.
select pg_temp.expect_count(
  $$select count(*) from (
      select (public.scheduling_admin_edit_published_shift(
        'aaaa1111-5511-aaaa-aaaa-aaaa11110092',
        'aaaa1111-ca01-aaaa-aaaa-aaaa11110099', null,
        now() + interval '1 day', now() + interval '1 day 5 hours', 0,
        null, 'republished', false, null))->>'ok' as ok) r
    where ok = 'true'$$,
  1, 'SCHED-149: manager CAN republish-edit a published shift');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'
       and notes = 'republished'
       and published_by_employee_id = 'aaaa1111-ca01-aaaa-aaaa-aaaa11110099'$$,
  1, 'SCHED-149: republish-edit applied the change + re-stamped publish metadata');
-- Editing a published shift into a cert-required area for someone lacking the
-- cert hard-blocks unless overridden.
select pg_temp.expect_count(
  $$select count(*) from (
      select (public.scheduling_admin_edit_published_shift(
        'aaaa1111-5511-aaaa-aaaa-aaaa11110092',
        'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
        'aaaa1111-30b1-aaaa-aaaa-aaaa11110098',
        now() + interval '1 day', now() + interval '1 day 5 hours', 0,
        null, 'rp', false, null))->>'error' as err) r
    where err = 'cert_blocked'$$,
  1, 'SCHED-149: republish-edit hard-blocks a missing/expired cert');
select pg_temp.expect_count(
  $$select count(*) from (
      select (public.scheduling_admin_edit_published_shift(
        'aaaa1111-5511-aaaa-aaaa-aaaa11110092',
        'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
        'aaaa1111-30b1-aaaa-aaaa-aaaa11110098',
        now() + interval '1 day', now() + interval '1 day 5 hours', 0,
        null, 'rp', true, 'lead approved'))->>'ok' as ok) r
    where ok = 'true'$$,
  1, 'SCHED-149: manager CAN override a cert gap on republish-edit');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_assignment_overrides
     where employee_id = 'aaaa1111-ca01-aaaa-aaaa-aaaa11110099'
       and missing_certs @> array['CPR']$$,
  1, 'SCHED-149: republish-edit cert override is audited');
-- The edit RPC is published-only; a draft is left to the normal path.
select pg_temp.expect_count(
  $$select count(*) from (
      select (public.scheduling_admin_edit_published_shift(
        'aaaa1111-5512-aaaa-aaaa-aaaa11110093', null, null,
        now() + interval '2 days', now() + interval '2 days 4 hours', 0,
        null, null, false, null))->>'error' as err) r
    where err = 'not_published'$$,
  1, 'SCHED-149: edit RPC refuses a non-published (draft) shift');

-- ---------------------------------------------------------------------------
-- Drag-and-drop move regression (admin scheduling grid keyboard/pointer DnD).
--
-- A drag-move persists by writing starts_at/ends_at via updateGridShift. That
-- is a DIRECT end-user write, so the publish-lock must reject relocating a
-- PUBLISHED shift even for an authorized scheduling admin (Carol) — the client
-- affordance is UX only; the DB trigger is the boundary. And a cross-facility
-- drag-move must be scoped away by RLS (0 rows), never silently applied.
-- Guards the new drag-persistence path added alongside the dnd-kit refit.
-- (Role here is still Carol / facility A, authenticated, from section 2Q.)
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $$update public.schedule_shifts
       set starts_at = now() + interval '5 days',
           ends_at   = now() + interval '5 days 4 hours'
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'$$,
  'SCHED-DND: direct drag-move (starts_at/ends_at) of a PUBLISHED shift is rejected (publish-lock)');
-- Time edit invariant: end must be after start. The saved-shift time editor
-- (and the move/resize paths) all persist starts_at/ends_at; a direct write with
-- ends_at <= starts_at is rejected by the schedule_shifts_time_order_chk CHECK,
-- so a bypassed client guard can't persist an inverted shift. Targets the
-- editable DRAFT shift (Carol can update it; the CHECK still fires).
select pg_temp.expect_error(
  $$update public.schedule_shifts
       set ends_at = starts_at - interval '1 hour'
     where id = 'aaaa1111-5512-aaaa-aaaa-aaaa11110093'$$,
  'SCHED-DND: a time edit with end <= start is rejected (time-order CHECK)');
-- Cross-facility drag-move: Carol (facility A) targets a facility-B shift. RLS's
-- USING clause filters it out, so the statement runs but touches 0 rows.
select pg_temp.expect_ok(
  $$update public.schedule_shifts
       set starts_at = now() + interval '5 days'
     where id = 'bbbb2222-5511-bbbb-bbbb-bbbb22220083'$$,
  'SCHED-DND: cross-facility drag-move runs but RLS scopes it to 0 rows');

reset role;

-- Verify (as owner) the facility-B shift was NOT relocated by the cross-facility
-- move above — its start is still its seeded value (~now), not now()+5 days.
set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'bbbb2222-5511-bbbb-bbbb-bbbb22220083'
       and starts_at < now() + interval '1 day'$$,
  1, 'SCHED-DND: facility-B shift was NOT relocated by a cross-facility drag-move');
reset role;

-- ---------------------------------------------------------------------------
-- Publish-transition guard (migration 181 — publish-lock bypass, final leg).
--
-- Migrations 148/164 froze published shifts (UPDATE/DELETE) and rejected
-- INSERTing a row born 'published', but the UPDATE leg only checked
-- OLD.status: an end-user role could still UPDATE a draft straight to
-- 'published', minting a locked shift while skipping the two-person
-- publish-request approval, its re-validation, the publish audit event,
-- open-shift seeding, and notifications. Migration 181 rejects any end-user
-- transition INTO 'published'; the governed approve RPC (SECURITY DEFINER,
-- runs as the table owner) is unaffected. Attacker here is Carol — an
-- AUTHORIZED scheduling admin — because the guard must hold even for her.
-- ---------------------------------------------------------------------------
set local role postgres;
-- Fixtures: an unassigned draft in a far-future window nothing else uses, and
-- a pending publish request from ALICE covering it (so Carol, the approver,
-- is not self-approving).
insert into public.schedule_shifts (id, facility_id, department_id, starts_at, ends_at, status)
values ('aaaa1111-5514-aaaa-aaaa-aaaa11110181',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
        now() + interval '90 days', now() + interval '90 days 4 hours', 'draft')
on conflict (id) do nothing;
insert into public.schedule_publish_requests (
  id, facility_id, requested_by_employee_id, range_starts_at, range_ends_at, status
) values ('aaaa1111-5811-aaaa-aaaa-aaaa11110181',
          '11111111-1111-1111-1111-111111111111',
          'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          now() + interval '89 days', now() + interval '92 days', 'pending')
on conflict (id) do nothing;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

-- Draft self-publish via direct UPDATE must be rejected at the DB boundary.
select pg_temp.expect_error(
  $$update public.schedule_shifts set status = 'published'
     where id = 'aaaa1111-5514-aaaa-aaaa-aaaa11110181'$$,
  'SCHED-181: direct UPDATE of a DRAFT to published is rejected (publish-transition guard)');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5514-aaaa-aaaa-aaaa11110181' and status = 'draft'$$,
  1, 'SCHED-181: the draft is still a draft after the rejected self-publish');
-- Non-status edits to a draft stay open (the guard is transition-scoped).
select pg_temp.expect_ok(
  $$update public.schedule_shifts set notes = 'still editable'
     where id = 'aaaa1111-5514-aaaa-aaaa-aaaa11110181'$$,
  'SCHED-181: a DRAFT shift remains directly editable (non-status fields)');
-- The governed two-person path still publishes under the new guard: Alice
-- requested, Carol approves; the DEFINER RPC takes the trigger's governed
-- bypass and flips the draft.
select pg_temp.expect_count(
  $$select count(*) from (
      select (public.scheduling_approve_publish_request(
        'aaaa1111-5811-aaaa-aaaa-aaaa11110181'))->>'ok' as ok) r
    where ok = 'true'$$,
  1, 'SCHED-181: governed approve-publish RPC still publishes (two-person path)');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5514-aaaa-aaaa-aaaa11110181' and status = 'published'$$,
  1, 'SCHED-181: the approved draft is now published');
reset role;

-- Staff (Alice): cannot override and cannot read the override audit log.
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$select public.scheduling_log_cert_override(
      'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'aaaa1111-30b1-aaaa-aaaa-aaaa11110098',
      array['cert_missing:CPR'], null, 'sneaky')$$,
  'SCHED-148: staff CANNOT log a cert override (manager-gated)');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_assignment_overrides$$,
  0, 'SCHED-148: staff CANNOT read the cert-override audit log');
select pg_temp.expect_error(
  $$select public.scheduling_admin_edit_published_shift(
      'aaaa1111-5511-aaaa-aaaa-aaaa11110092', null, null,
      now(), now() + interval '1 hour', 0, null, null, false, null)$$,
  'SCHED-149: staff CANNOT republish-edit a published shift');

-- ---------------------------------------------------------------------------
-- facility_dropdown_options (migration 155): generic per-facility picker lists.
--   SELECT: any same-facility authenticated user; never across facilities.
--   INSERT/UPDATE/DELETE: facility admin (is_facility_admin) only.
--   Auto-seed: the AFTER INSERT trigger on facilities seeds the canonical
--   'facility_timezone' set (11 zones) for every facility.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Auto-seed fired on facility creation: A has the canonical timezone set.
select pg_temp.expect_count(
  $$select count(*) from public.facility_dropdown_options
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'facility_timezone'$$,
  11, 'FDO: facility A auto-seeded 11 facility_timezone options on create');
-- Cross-facility SELECT isolation: alice cannot see facility B's options.
select pg_temp.expect_count(
  $$select count(*) from public.facility_dropdown_options
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'FDO: alice CANNOT SELECT facility_dropdown_options in facility B');
-- Staff (no facility admin) cannot write even in her own facility.
select pg_temp.expect_error(
  $$insert into public.facility_dropdown_options (facility_id, domain, key, display_name)
    values ('11111111-1111-1111-1111-111111111111', 'facility_timezone', 'America/Sneaky', 'Sneaky')$$,
  'FDO: staff alice (no admin) CANNOT INSERT a facility_dropdown_option');

-- Grant alice facility-admin (admin/admin) in facility A only, then re-check.
set local role postgres;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'admin', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_ok(
  $$insert into public.facility_dropdown_options (facility_id, domain, key, display_name)
    values ('11111111-1111-1111-1111-111111111111', 'facility_timezone', 'Europe/London', 'London')$$,
  'FDO: facility admin CAN INSERT a facility_dropdown_option in own facility');
select pg_temp.expect_error(
  $$insert into public.facility_dropdown_options (facility_id, domain, key, display_name)
    values ('22222222-2222-2222-2222-222222222222', 'facility_timezone', 'Europe/Paris', 'Paris')$$,
  'FDO: facility admin still CANNOT INSERT into facility B');
-- domain CHECK rejects non-whitelisted domains (defense in depth vs the app guard).
select pg_temp.expect_error(
  $$insert into public.facility_dropdown_options (facility_id, domain, key, display_name)
    values ('11111111-1111-1111-1111-111111111111', 'refrigeration_field_type', 'x', 'X')$$,
  'FDO: domain CHECK rejects a non-whitelisted domain');

-- ---------------------------------------------------------------------------
-- D-01 (migration 165): the super-admin immutability guard must hold even for
-- FACILITY ADMINS. Pre-165, guard_users_profile_update() early-returned for any
-- is_facility_admin(), so a facility admin could raw-PostgREST
--   update public.users set is_super_admin = true
-- on any same-facility user (or themselves) and mint a cross-tenant super-admin.
--
-- Actor: Fred — a genuine facility admin in facility A (fresh, unused identity;
-- the ffffffff/dddddddd ids are already claimed by staff-role Frank/Dave
-- fixtures elsewhere in this file). He needs BOTH
--   (a) an `admin`-role employees row, so current_user_role() = 'admin' and the
--       users_update RLS USING/CHECK admin-branch lets his UPDATE reach the
--       target row (rather than being filtered to zero rows by RLS), AND
--   (b) an admin/admin user_permissions grant, so is_facility_admin() is true
--       and the OLD (buggy) guard would have taken its facility-admin exemption.
-- Target: Mona (manager, same facility A, non-admin) and Fred himself. Both
-- escalations MUST raise post-165.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into auth.users (id, email)
values ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'fred@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
        '11111111-1111-1111-1111-111111111111', 'fred@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'a0a06666-a0a0-a0a0-a0a0-a0a0a0a0a0a0'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'::uuid,
       r.id, 'Fred', 'Admin', 'fred@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'admin'
on conflict (id) do nothing;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
        '11111111-1111-1111-1111-111111111111',
        'admin', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);

-- Sanity: Fred really is a facility admin (RLS write path is open to him) — an
-- allowed privileged edit (no-op is_active write on a same-facility user)
-- succeeds, proving the escalation failures below are the guard, not RLS
-- filtering the row to zero.
select pg_temp.expect_ok(
  $$update public.users set is_active = is_active
    where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'D-01: facility admin CAN perform an allowed privileged users update (control)');

select pg_temp.expect_error(
  $$update public.users set is_super_admin = true
    where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'D-01: facility admin CANNOT escalate is_super_admin on a same-facility user');

select pg_temp.expect_error(
  $$update public.users set is_super_admin = true
    where id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'$$,
  'D-01: facility admin CANNOT self-escalate is_super_admin');

reset role;

-- ---------------------------------------------------------------------------
-- COMM-170: communications security remediation (migration 170) and
-- COMM-171: role-default permission backfill (migration 171).
--
-- Self-contained section: seeds its own fixtures as postgres, then runs
-- assertion blocks as alice (staff), dana (communications admin), and erin
-- (role-fallback admin with no user_permissions — the account shape
-- migration 171 exists to repair).
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

-- Vera gets VIEW-ONLY (no submit) on refrigeration. Before migration 170,
-- communication_alerts INSERT accepted mere view access on the row's
-- source_module; the view-only assertion below proves view is no longer
-- enough. (Neither alice nor carol can serve as the view-only subject — by
-- this point in the harness alice has accumulated submit or admin on every
-- module she can see, and the migration-189 section made carol a
-- communications admin, which passes the alerts INSERT policy outright.)
insert into auth.users (id, email)
values ('ceeeeeee-cccc-4ccc-8ccc-cccccc000170', 'vera@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('ceeeeeee-cccc-4ccc-8ccc-cccccc000170',
        '11111111-1111-1111-1111-111111111111', 'vera@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'aaaa1111-ce17-aaaa-aaaa-aaaa11110170'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'ceeeeeee-cccc-4ccc-8ccc-cccccc000170'::uuid,
       r.id, 'Vera', 'Viewer', 'vera@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;
insert into public.user_permissions (
  user_id, facility_id, module_name, action, enabled
) values (
  'ceeeeeee-cccc-4ccc-8ccc-cccccc000170',
  '11111111-1111-1111-1111-111111111111',
  'refrigeration', 'view'::public.user_action, true
) on conflict (user_id, facility_id, module_name, action) do nothing;

-- A-side message SENT BY alice with carol as recipient (sender-receipt SELECT),
-- and a system message where alice is the RECIPIENT (read_at / delivery-column
-- trigger assertions).
insert into public.communication_messages (id, facility_id, sender_employee_id, body)
values ('aaaa1111-c0c1-aaaa-aaaa-aaaa11110201',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice-authored message')
on conflict (id) do nothing;

insert into public.communication_recipients (id, facility_id, message_id, employee_id)
values ('aaaa1111-c0c2-aaaa-aaaa-aaaa11110202',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-c0c1-aaaa-aaaa-aaaa11110201',
        'aaaa1111-ca01-aaaa-aaaa-aaaa11110099')
on conflict (id) do nothing;

insert into public.communication_messages (id, facility_id, sender_employee_id, body)
values ('aaaa1111-c0c3-aaaa-aaaa-aaaa11110203',
        '11111111-1111-1111-1111-111111111111', null, 'System message to alice')
on conflict (id) do nothing;

insert into public.communication_recipients (id, facility_id, message_id, employee_id)
values ('aaaa1111-c0c4-aaaa-aaaa-aaaa11110204',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-c0c3-aaaa-aaaa-aaaa11110203',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict (id) do nothing;

-- Dana: a COMMUNICATIONS ADMIN in facility A (mirrors the Carol pattern).
insert into auth.users (id, email)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'dana@fac-a.test')
on conflict (id) do nothing;

insert into public.users (id, facility_id, email, is_super_admin)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd',
        '11111111-1111-1111-1111-111111111111', 'dana@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;

insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select
  'aaaa1111-d0d0-aaaa-aaaa-aaaa11110205'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  r.id, 'Dana', 'Delgado', 'dana@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;

insert into public.user_permissions (
  user_id, facility_id, module_name, action, enabled
) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'communications', 'admin', true),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'communications', 'view', true)
on conflict (user_id, facility_id, module_name, action) do nothing;

-- B-side rows for the six tables that previously had NO cross-facility
-- isolation assertion: templates, recurring reminders, acknowledgements,
-- communication audit log, group members, notification outbox.
insert into public.communication_templates (id, facility_id, name, slug, body)
values ('bbbb2222-c0c5-bbbb-bbbb-bbbb22220210',
        '22222222-2222-2222-2222-222222222222',
        'B Template', 'b-template', 'B facility template body')
on conflict (id) do nothing;

insert into public.communication_recurring_reminders (
  id, facility_id, name, schedule_cron, template_id, target_role_key
) values ('bbbb2222-c0c6-bbbb-bbbb-bbbb22220211',
          '22222222-2222-2222-2222-222222222222',
          'B Reminder', '0 9 * * *',
          'bbbb2222-c0c5-bbbb-bbbb-bbbb22220210', 'staff')
on conflict (id) do nothing;

insert into public.communication_acknowledgements (
  id, facility_id, alert_id, employee_id
) values ('bbbb2222-c0c7-bbbb-bbbb-bbbb22220212',
          '22222222-2222-2222-2222-222222222222',
          'bbbb2222-c0a3-bbbb-bbbb-bbbb22220081',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (id) do nothing;

insert into public.communication_audit_log (
  id, facility_id, entity_type, entity_id, action, actor_employee_id
) values ('bbbb2222-c0c8-bbbb-bbbb-bbbb22220213',
          '22222222-2222-2222-2222-222222222222',
          'message', 'bbbb2222-c0a1-bbbb-bbbb-bbbb22220079',
          'message_sent', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (id) do nothing;

insert into public.communication_group_members (facility_id, group_id, employee_id)
select '22222222-2222-2222-2222-222222222222', g.id,
       'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
from public.communication_groups g
where g.facility_id = '22222222-2222-2222-2222-222222222222'
  and g.slug = 'managers-b'
on conflict (group_id, employee_id) do nothing;

insert into public.notification_outbox (
  id, facility_id, source_module, recipient_employee_id,
  subject, body, scheduled_for, status
) values ('bbbb2222-c0c9-bbbb-bbbb-bbbb22220214',
          '22222222-2222-2222-2222-222222222222',
          'incident_reports', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'B outbox row', 'B outbox body', now(), 'pending')
on conflict (id) do nothing;

-- --- Block 1: alice (staff, view+submit) -----------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Recipient self-service still works: read_at is hers to set...
select pg_temp.expect_ok(
  $$update public.communication_recipients
    set read_at = now()
    where id = 'aaaa1111-c0c4-aaaa-aaaa-aaaa11110204'$$,
  'COMM-170a: recipient CAN update read_at on their own row');

-- ...but the delivery-state columns are not (mig 170 trigger).
select pg_temp.expect_error(
  $$update public.communication_recipients
    set email_status = 'sent'
    where id = 'aaaa1111-c0c4-aaaa-aaaa-aaaa11110204'$$,
  'COMM-170a: recipient CANNOT update email_status on their own row');

select pg_temp.expect_error(
  $$update public.communication_recipients
    set email_attempts = 99
    where id = 'aaaa1111-c0c4-aaaa-aaaa-aaaa11110204'$$,
  'COMM-170a: recipient CANNOT update email_attempts on their own row');

-- Sender receipts: alice authored aaaa...0201, carol is the recipient — the
-- mig-170 SELECT extension lets the sender read that recipient row.
select pg_temp.expect_count(
  $$select count(*) from public.communication_recipients
    where message_id = 'aaaa1111-c0c1-aaaa-aaaa-aaaa11110201'$$,
  1, 'COMM-170e: message sender CAN read the recipient rows of their message');

-- Alerts INSERT now needs submit-or-higher on the source module: submit
-- passes here (alice); view-only is rejected in the carol block below.
select pg_temp.expect_ok(
  $$insert into public.communication_alerts (
      facility_id, source_module, severity, title
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'air_quality', 'warn', 'Legit alert from a submitter'
    )$$,
  'COMM-170b: submit on source module CAN insert an alert');

-- Audit-log INSERT binds actor_employee_id to the caller.
select pg_temp.expect_error(
  $$insert into public.communication_audit_log (
      facility_id, entity_type, entity_id, action, actor_employee_id
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'message', gen_random_uuid(), 'message_sent',
      'aaaa1111-ca01-aaaa-aaaa-aaaa11110099'
    )$$,
  'COMM-170c: audit-log INSERT with a forged actor_employee_id is rejected');

select pg_temp.expect_ok(
  $$insert into public.communication_audit_log (
      facility_id, entity_type, entity_id, action, actor_employee_id
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'message', gen_random_uuid(), 'message_sent',
      'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    )$$,
  'COMM-170c: audit-log INSERT with the caller''s own actor_employee_id succeeds');

-- Cross-facility isolation for the six previously-unasserted tables.
select pg_temp.expect_count(
  $$select count(*) from public.communication_templates
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B communication_templates');
select pg_temp.expect_count(
  $$select count(*) from public.communication_recurring_reminders
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B communication_recurring_reminders');
select pg_temp.expect_count(
  $$select count(*) from public.communication_acknowledgements
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B communication_acknowledgements');
select pg_temp.expect_count(
  $$select count(*) from public.communication_audit_log
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B communication_audit_log');
select pg_temp.expect_count(
  $$select count(*) from public.communication_group_members
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B communication_group_members');
select pg_temp.expect_count(
  $$select count(*) from public.notification_outbox
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'ISO: alice CANNOT SELECT facility-B notification_outbox');

-- --- Block 1b: vera (view-only on refrigeration, no comms rights) -----------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"ceeeeeee-cccc-4ccc-8ccc-cccccc000170","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'ceeeeeee-cccc-4ccc-8ccc-cccccc000170', true);

select pg_temp.expect_error(
  $$insert into public.communication_alerts (
      facility_id, source_module, severity, title
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'refrigeration', 'critical', 'Forged alert'
    )$$,
  'COMM-170b: view-only on source module CANNOT insert an alert');

-- --- Block 2: dana (communications admin) ----------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true);

-- Outbox writes now key off has_module_admin_access('communications') instead
-- of the retired role-name list (mig 170d): a comms admin can queue a row...
select pg_temp.expect_ok(
  $$insert into public.notification_outbox (
      facility_id, source_module, recipient_employee_id,
      subject, body, scheduled_for, status
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'communications', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'Scheduled broadcast', 'Body', now() + interval '1 hour', 'pending'
    )$$,
  'COMM-170d: communications admin CAN insert a notification_outbox row');

-- ...and cancel it (the scheduled-broadcast cancel path is a status UPDATE
-- under the admin's own session).
select pg_temp.expect_ok(
  $$update public.notification_outbox
    set status = 'cancelled'
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and subject = 'Scheduled broadcast'
      and status = 'pending'$$,
  'COMM-170d: communications admin CAN cancel their pending outbox rows');

-- ...and the Deliveries-tab retry path (reset email delivery state) still
-- works because the mig-170 trigger exempts comms admins.
select pg_temp.expect_ok(
  $$update public.communication_recipients
    set email_status = 'pending', email_attempts = 0
    where id = 'aaaa1111-c0c4-aaaa-aaaa-aaaa11110204'$$,
  'COMM-170a: communications admin CAN reset email delivery state (retry path)');

-- --- Block 3: hana (role-fallback admin, migration 171) ---------------------
reset role;
set local role postgres;

-- role_permission_defaults for the admin role in facility A, mirroring the
-- production seed (migration 80): communications admin.
insert into public.role_permission_defaults (
  facility_id, role_id, module_name, action, enabled
)
select r.facility_id, r.id, 'communications', 'admin'::public.user_action, true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'admin'
on conflict (facility_id, role_id, module_name, action) do nothing;

insert into auth.users (id, email)
values ('e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'hana@fac-a.test')
on conflict (id) do nothing;

insert into public.users (id, facility_id, email, is_super_admin)
values ('e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
        '11111111-1111-1111-1111-111111111111', 'hana@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;

insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select
  'aaaa1111-e1e1-aaaa-aaaa-aaaa11110206'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1'::uuid,
  r.id, 'Hana', 'Holm', 'hana@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'admin'
on conflict (id) do nothing;

-- Simulate a pre-migration-77 account for Hana: strip whatever the auto-seed trigger
-- chain just granted, leaving an admin-role employee with ZERO
-- user_permissions rows — exactly the account shape that passed requireAdmin
-- via its role fallback but failed every has_module_admin_access RLS write.
delete from public.user_permissions
 where user_id = 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';

set local role authenticated;
set local request.jwt.claims to '{"sub":"e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', true);

select pg_temp.expect_error(
  $$insert into public.communication_templates (facility_id, name, slug, body)
    values ('11111111-1111-1111-1111-111111111111',
            'Hana pre-backfill', 'hana-pre-backfill', 'body')$$,
  'COMM-171: role-fallback admin with no user_permissions CANNOT write (the bug)');

-- Run the migration-171 backfill logic against hana's account shape.
reset role;
set local role postgres;

do $$
declare
  v_emp record;
begin
  for v_emp in
    select e.user_id, e.facility_id, e.role_id
      from public.employees e
     where e.is_active
       and e.user_id is not null
       and e.role_id is not null
       and e.facility_id is not null
       and not exists (
         select 1
           from public.user_permissions up
          where up.user_id = e.user_id
            and up.facility_id = e.facility_id
       )
  loop
    perform public.apply_role_permission_defaults(
      v_emp.user_id, v_emp.facility_id, v_emp.role_id
    );
  end loop;
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', true);

select pg_temp.expect_ok(
  $$insert into public.communication_templates (facility_id, name, slug, body)
    values ('11111111-1111-1111-1111-111111111111',
            'Hana post-backfill', 'hana-post-backfill', 'body')$$,
  'COMM-171: after the backfill the same admin CAN write communications config');

reset role;

-- ---------------------------------------------------------------------------
-- DAR: Daily-report area assignment & routing (migrations 182/183).
--
-- The date-scoped visibility layer (D10/D4): with routing enabled, a staff
-- user may read/write a day's tab only if an active assignment names them or
-- the area is open (no active assignment) that date. Module admins and `edit`
-- holders bypass. Also proves: revert-to-open on supersede, multi-assignee,
-- flag-off = pre-feature behavior, legacy NULL-business_date rows stay open,
-- the NULL-date INSERT bypass is closed by the stamping trigger, snapshot
-- immutability (even for admins), supersede-only assignments (no DELETE),
-- and cross-facility isolation on all five routing tables.
--
-- Personas (facility A unless noted):
--   alice (existing)  staff; daily view+submit; can_submit on Granted Area.
--   zoe   (new)       staff; daily view+submit; NO per-area rows.
--   sam   (new)       staff role but daily view+submit+EDIT (supervisor-tier).
--   mona  (existing)  manager; seeded daily admin here for determinism.
--   bob   (existing)  facility B staff.
-- ---------------------------------------------------------------------------
set local role postgres;

insert into auth.users (id, email)
values
  ('dada1111-0000-4000-8000-000000000001', 'zoe@fac-a.test'),
  ('ed17ed17-0000-4000-8000-000000000001', 'sam@fac-a.test')
on conflict (id) do nothing;

insert into public.users (id, facility_id, email, is_super_admin)
values
  ('dada1111-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'zoe@fac-a.test', false),
  ('ed17ed17-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'sam@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;

insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'dada1111-0000-4000-8000-000000000002'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'dada1111-0000-4000-8000-000000000001'::uuid,
       r.id, 'Zoe', 'Zamora', 'zoe@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111' and r.key = 'staff'
on conflict (id) do nothing;

insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'ed17ed17-0000-4000-8000-000000000002'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'ed17ed17-0000-4000-8000-000000000001'::uuid,
       r.id, 'Sam', 'Shiftlead', 'sam@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111' and r.key = 'staff'
on conflict (id) do nothing;

-- zoe: plain staff grants. sam: staff + the `edit` routing tier. mona: daily
-- admin (+ scheduling view so the job-area-map with-check can see the target).
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values
  ('dada1111-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'daily_reports', 'view',   true),
  ('dada1111-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'daily_reports', 'submit', true),
  ('ed17ed17-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'daily_reports', 'view',   true),
  ('ed17ed17-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'daily_reports', 'submit', true),
  ('ed17ed17-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'daily_reports', 'edit',   true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'daily_reports', 'view',   true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'daily_reports', 'submit', true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'daily_reports', 'admin',  true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', 'scheduling',    'view',   true)
on conflict (user_id, facility_id, module_name, action)
do update set enabled = true;

-- Routing flag ON in both facilities (fac B row doubles as the cross-facility
-- SELECT target).
insert into public.daily_report_settings (facility_id, assignment_routing_enabled)
values
  ('11111111-1111-1111-1111-111111111111', true),
  ('22222222-2222-2222-2222-222222222222', true)
on conflict (facility_id) do update set assignment_routing_enabled = true;

-- Active assignment: Granted Area today -> zoe ONLY. Plus a facility-B row
-- (bob) as the cross-facility target.
insert into public.report_area_assignments
  (id, facility_id, report_date, area_id, employee_id, source)
values
  ('da5a0000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', current_date,
   'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
   'dada1111-0000-4000-8000-000000000002', 'manual'),
  ('da5a0000-0000-4000-8000-00000000000b',
   '22222222-2222-2222-2222-222222222222', current_date,
   'bbbb2222-db01-bbbb-bbbb-bbbb22220011',
   'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'manual')
on conflict (id) do nothing;

-- A restricted-day submission by zoe (SELECT-negative target for alice), and a
-- legacy NULL-business_date row (must STAY visible: pre-feature data is open).
-- The stamping trigger fills business_date on INSERT, so the legacy shape is
-- produced by nulling it afterwards as postgres.
insert into public.daily_report_submissions
  (id, facility_id, area_id, template_id, employee_id, business_date)
values
  ('da5b0000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
   'aaaa1111-d701-aaaa-aaaa-aaaa11110013',
   'dada1111-0000-4000-8000-000000000002', current_date),
  ('da5b0000-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
   'aaaa1111-d701-aaaa-aaaa-aaaa11110013',
   null, current_date)
on conflict (id) do nothing;

update public.daily_report_submissions
   set business_date = null
 where id = 'da5b0000-0000-4000-8000-000000000002';

-- Snapshot fixtures (yesterday) in both facilities; default-owner and
-- job-area-map rows in facility B as cross-facility SELECT targets.
insert into public.daily_area_assignment_snapshots
  (id, facility_id, business_date, area_id, assignees, completed)
values
  ('da5c0000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', current_date - 1,
   'aaaa1111-da01-aaaa-aaaa-aaaa11110011', '[]'::jsonb, false),
  ('da5c0000-0000-4000-8000-000000000002',
   '22222222-2222-2222-2222-222222222222', current_date - 1,
   'bbbb2222-db01-bbbb-bbbb-bbbb22220011', '[]'::jsonb, false)
on conflict (id) do nothing;

insert into public.area_default_owners (facility_id, area_id, employee_id)
values ('22222222-2222-2222-2222-222222222222',
        'bbbb2222-db01-bbbb-bbbb-bbbb22220011',
        'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (area_id, employee_id) do nothing;

insert into public.daily_area_job_area_map (facility_id, area_id, job_area_id)
values ('22222222-2222-2222-2222-222222222222',
        'bbbb2222-db01-bbbb-bbbb-bbbb22220011',
        'bbbb2222-30b0-bbbb-bbbb-bbbb22220002')
on conflict (area_id, job_area_id) do nothing;

-- ---- alice (staff, NOT assigned): blocked from the restricted area+date ----
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$insert into public.daily_report_submissions
      (facility_id, area_id, template_id, business_date)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013', current_date)$$,
  'DAR: unassigned alice CANNOT submit into an area assigned to zoe today');

select pg_temp.expect_error(
  $$insert into public.daily_report_submissions
      (facility_id, area_id, template_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013')$$,
  'DAR: omitting business_date does NOT bypass the gate (stamping trigger)');

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions
    where id = 'da5b0000-0000-4000-8000-000000000001'$$,
  0, 'DAR: unassigned alice CANNOT SELECT zoe''s restricted-day submission');

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions
    where id = 'da5b0000-0000-4000-8000-000000000002'$$,
  1, 'DAR: legacy NULL-business_date row REMAINS visible to alice (pre-feature open)');

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_settings
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'DAR: alice can SELECT her own facility''s routing settings');

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_settings
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DAR: alice CANNOT SELECT facility B routing settings');

select pg_temp.expect_count(
  $$with u as (
      update public.daily_report_settings
         set assignment_routing_enabled = false
       where facility_id = '11111111-1111-1111-1111-111111111111'
      returning 1
    ) select count(*)::int from u$$,
  0, 'DAR: staff alice CANNOT flip the routing flag (admin-only write)');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and superseded_at is null$$,
  1, 'DAR: alice can SELECT her facility''s assignment map (module view)');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DAR: alice CANNOT SELECT assignments in facility B');

select pg_temp.expect_error(
  $$insert into public.report_area_assignments
      (facility_id, report_date, area_id, employee_id, source)
    values ('11111111-1111-1111-1111-111111111111', current_date,
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual')$$,
  'DAR: staff alice CANNOT self-assign (INSERT requires edit/admin)');

select pg_temp.expect_count(
  $$with u as (
      update public.report_area_assignments
         set superseded_at = now()
       where id = 'da5a0000-0000-4000-8000-000000000001'
      returning 1
    ) select count(*)::int from u$$,
  0, 'DAR: staff alice CANNOT supersede an assignment (UPDATE requires edit/admin)');

select pg_temp.expect_count(
  $$select count(*) from public.area_default_owners
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DAR: alice CANNOT SELECT default owners in facility B');

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_job_area_map
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DAR: alice CANNOT SELECT the job-area map in facility B');

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_assignment_snapshots
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DAR: alice CANNOT SELECT snapshots in facility B');

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_assignment_snapshots
    where id = 'da5c0000-0000-4000-8000-000000000001'$$,
  1, 'DAR: alice CAN SELECT her facility''s snapshot for an area she can access');

select pg_temp.expect_error(
  $$insert into public.daily_area_assignment_snapshots
      (facility_id, business_date, area_id, assignees, completed)
    values ('11111111-1111-1111-1111-111111111111', current_date,
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011', '[]'::jsonb, false)$$,
  'DAR: staff alice CANNOT INSERT a snapshot');

-- ---- zoe (assigned staff): the restricted area+date works for her ----------
set local role authenticated;
set local request.jwt.claims to '{"sub":"dada1111-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'dada1111-0000-4000-8000-000000000001', true);

select pg_temp.expect_ok(
  $$insert into public.daily_report_submissions
      (id, facility_id, area_id, template_id, business_date)
    values ('da5b0000-0000-4000-8000-000000000003',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013', current_date)$$,
  'DAR: assigned zoe CAN submit into the restricted area today');

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions
    where id = 'da5b0000-0000-4000-8000-000000000001'$$,
  1, 'DAR: assigned zoe CAN SELECT the restricted-day submission');

-- ---- multi-assignee (D2): adding alice restores her access -----------------
set local role postgres;
insert into public.report_area_assignments
  (id, facility_id, report_date, area_id, employee_id, source)
values ('da5a0000-0000-4000-8000-000000000002',
        '11111111-1111-1111-1111-111111111111', current_date,
        'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual')
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_ok(
  $$insert into public.daily_report_submissions
      (id, facility_id, area_id, template_id, business_date)
    values ('da5b0000-0000-4000-8000-000000000004',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013', current_date)$$,
  'DAR: co-assigned alice CAN submit (multiple assignees all have access)');

-- ---- supersede: alice loses access; superseding ALL rows reopens the area --
set local role postgres;
update public.report_area_assignments set superseded_at = now()
 where id = 'da5a0000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$insert into public.daily_report_submissions
      (facility_id, area_id, template_id, business_date)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013', current_date)$$,
  'DAR: alice loses access the moment her assignment is superseded (zoe still active)');

set local role postgres;
update public.report_area_assignments set superseded_at = now()
 where id = 'da5a0000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_ok(
  $$insert into public.daily_report_submissions
      (id, facility_id, area_id, template_id, business_date)
    values ('da5b0000-0000-4000-8000-000000000005',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013', current_date)$$,
  'DAR: last active assignment superseded -> area reverts to OPEN (D4)');

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions
    where id = 'da5b0000-0000-4000-8000-000000000001'$$,
  1, 'DAR: alice regains SELECT on the day''s rows once the area is open again');

-- ---- sam (edit tier): bypasses the gate and can manage assignments ---------
set local role postgres;
insert into public.report_area_assignments
  (id, facility_id, report_date, area_id, employee_id, source)
values ('da5a0000-0000-4000-8000-000000000003',
        '11111111-1111-1111-1111-111111111111', current_date,
        'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
        'dada1111-0000-4000-8000-000000000002', 'manual')
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"ed17ed17-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'ed17ed17-0000-4000-8000-000000000001', true);

select pg_temp.expect_ok(
  $$insert into public.daily_report_submissions
      (id, facility_id, area_id, template_id, business_date)
    values ('da5b0000-0000-4000-8000-000000000006',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013', current_date)$$,
  'DAR: edit-tier sam CAN submit into a restricted area he is not assigned to');

select pg_temp.expect_ok(
  $$insert into public.report_area_assignments
      (id, facility_id, report_date, area_id, employee_id, source, assigned_by)
    values ('da5a0000-0000-4000-8000-000000000004',
            '11111111-1111-1111-1111-111111111111', current_date,
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual',
            'ed17ed17-0000-4000-8000-000000000002')$$,
  'DAR: edit-tier sam CAN assign a coworker to an area');

select pg_temp.expect_count(
  $$with u as (
      update public.report_area_assignments
         set superseded_at = now()
       where id = 'da5a0000-0000-4000-8000-000000000004'
      returning 1
    ) select count(*)::int from u$$,
  1, 'DAR: edit-tier sam CAN supersede an assignment');

select pg_temp.expect_error(
  $$insert into public.report_area_assignments
      (facility_id, report_date, area_id, employee_id, source)
    values ('22222222-2222-2222-2222-222222222222', current_date,
            'bbbb2222-db01-bbbb-bbbb-bbbb22220011',
            'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'manual')$$,
  'DAR: edit-tier sam CANNOT assign into facility B');

-- No DELETE policy exists, so the row is invisible to DELETE: it silently
-- matches 0 rows (RLS filters, it does not raise). Assert 0 rows affected AND
-- that the row survives.
select pg_temp.expect_count(
  $$with d as (
      delete from public.report_area_assignments
       where id = 'da5a0000-0000-4000-8000-000000000004'
      returning 1
    ) select count(*)::int from d$$,
  0, 'DAR: assignments are supersede-only — DELETE affects 0 rows even for the edit tier');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where id = 'da5a0000-0000-4000-8000-000000000004'$$,
  1, 'DAR: the assignment row survives the denied DELETE');

-- ---- mona (module admin): unaffected reads, config writes, no snapshot writes
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions
    where id = 'da5b0000-0000-4000-8000-000000000001'$$,
  1, 'DAR: module-admin mona sees restricted-day rows (supervisor+ unaffected)');

select pg_temp.expect_ok(
  $$insert into public.area_default_owners (facility_id, area_id, employee_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'dada1111-0000-4000-8000-000000000002')$$,
  'DAR: module-admin mona CAN configure default owners');

select pg_temp.expect_ok(
  $$insert into public.daily_area_job_area_map (facility_id, area_id, job_area_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-30b0-aaaa-aaaa-aaaa11110002')$$,
  'DAR: module-admin mona CAN map an area to a scheduling job area');

select pg_temp.expect_error(
  $$insert into public.daily_area_job_area_map (facility_id, area_id, job_area_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'bbbb2222-30b0-bbbb-bbbb-bbbb22220002')$$,
  'DAR: mona CANNOT map to a facility-B job area (endpoint facility match)');

select pg_temp.expect_error(
  $$insert into public.daily_area_assignment_snapshots
      (facility_id, business_date, area_id, assignees, completed)
    values ('11111111-1111-1111-1111-111111111111', current_date,
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011', '[]'::jsonb, false)$$,
  'DAR: snapshots reject INSERT even from a module admin (day-close path only)');

select pg_temp.expect_count(
  $$with u as (
      update public.daily_area_assignment_snapshots
         set completed = true
       where id = 'da5c0000-0000-4000-8000-000000000001'
      returning 1
    ) select count(*)::int from u$$,
  0, 'DAR: snapshots reject UPDATE even from a module admin (immutable)');

select pg_temp.expect_error(
  $$insert into public.report_area_assignments
      (facility_id, report_date, area_id, employee_id, source)
    values ('22222222-2222-2222-2222-222222222222', current_date,
            'bbbb2222-db01-bbbb-bbbb-bbbb22220011',
            'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'manual')$$,
  'DAR: module-admin mona CANNOT assign into facility B');

select pg_temp.expect_count(
  $$with u as (
      update public.daily_report_settings
         set assignment_routing_enabled = false
       where facility_id = '11111111-1111-1111-1111-111111111111'
      returning 1
    ) select count(*)::int from u$$,
  1, 'DAR: module-admin mona CAN toggle the routing flag');

-- ---- flag OFF (mona just disabled it): pre-feature behavior returns --------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_ok(
  $$insert into public.daily_report_submissions
      (id, facility_id, area_id, template_id, business_date)
    values ('da5b0000-0000-4000-8000-000000000007',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013', current_date)$$,
  'DAR: flag OFF -> unassigned alice can submit despite zoe''s active assignment');

-- Flag back ON: the restriction resumes (proves the flag is live, not cached).
set local role postgres;
update public.daily_report_settings set assignment_routing_enabled = true
 where facility_id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$insert into public.daily_report_submissions
      (facility_id, area_id, template_id, business_date)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'aaaa1111-d701-aaaa-aaaa-aaaa11110013', current_date)$$,
  'DAR: flag back ON -> the restriction resumes for unassigned alice');

reset role;

-- ---------------------------------------------------------------------------
-- DAR-3: resolution engine + assignment notifications (migration 184).
--
-- Proves: the engine reads PUBLISHED shifts only (a draft shift produces no
-- assignment), first-materialization-wins idempotency (re-run = 0, existing
-- areas untouched), the default-owner branch, notification recipient
-- isolation, staff cannot forge notifications, and the caller gate rejects a
-- user without daily_reports access. Continues the DAR fixtures: granted-area
-- already has assignment history (must be skipped); mona mapped granted-area
-- to Front Desk A earlier; routing is ON for facility A.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Bridge the second area (nogrant-area, no assignment rows yet) to Front Desk
-- A, then give zoe a PUBLISHED shift and alice a DRAFT shift on that job area
-- today. postgres bypasses the publish-lock trigger (by design).
insert into public.daily_area_job_area_map (facility_id, area_id, job_area_id)
values ('11111111-1111-1111-1111-111111111111',
        'aaaa1111-da02-aaaa-aaaa-aaaa11110012',
        'aaaa1111-30b0-aaaa-aaaa-aaaa11110002')
on conflict (area_id, job_area_id) do nothing;

insert into public.schedule_shifts
  (id, facility_id, department_id, employee_id, job_area_id,
   starts_at, ends_at, status, published_at)
values
  ('da5d0000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-de70-aaaa-aaaa-aaaa11110001',
   'dada1111-0000-4000-8000-000000000002',
   'aaaa1111-30b0-aaaa-aaaa-aaaa11110002',
   current_date + time '10:00', current_date + time '18:00',
   'published', now()),
  ('da5d0000-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-de70-aaaa-aaaa-aaaa11110001',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aaaa1111-30b0-aaaa-aaaa-aaaa11110002',
   current_date + time '11:00', current_date + time '17:00',
   'draft', null)
on conflict (id) do nothing;

-- ---- alice (plain staff, module view) triggers materialization -------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select public.resolve_daily_area_assignments(current_date)$$,
  1, 'DAR3: staff-triggered resolution materializes exactly the published-shift assignee');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where area_id = 'aaaa1111-da02-aaaa-aaaa-aaaa11110012'
      and report_date = current_date
      and employee_id = 'dada1111-0000-4000-8000-000000000002'
      and source = 'schedule'
      and superseded_at is null$$,
  1, 'DAR3: zoe''s PUBLISHED shift became a schedule-derived assignment');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where area_id = 'aaaa1111-da02-aaaa-aaaa-aaaa11110012'
      and report_date = current_date
      and employee_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  0, 'DAR3: alice''s DRAFT shift produced NO assignment (published-only filter)');

select pg_temp.expect_count(
  $$select public.resolve_daily_area_assignments(current_date)$$,
  0, 'DAR3: re-running the resolution is a no-op (first materialization wins)');

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_assignment_notifications
    where employee_id = 'dada1111-0000-4000-8000-000000000002'$$,
  0, 'DAR3: alice (plain staff) CANNOT read zoe''s assignment notification');

select pg_temp.expect_error(
  $$insert into public.daily_report_assignment_notifications
      (facility_id, employee_id, area_id, report_date, notification_type)
    values ('11111111-1111-1111-1111-111111111111',
            'dada1111-0000-4000-8000-000000000002',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011', current_date, 'assigned')$$,
  'DAR3: staff alice CANNOT forge an assignment notification');

-- ---- zoe: sees exactly her own notification and can mark it read -----------
set local role authenticated;
set local request.jwt.claims to '{"sub":"dada1111-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'dada1111-0000-4000-8000-000000000001', true);

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_assignment_notifications
    where employee_id = 'dada1111-0000-4000-8000-000000000002'
      and area_id = 'aaaa1111-da02-aaaa-aaaa-aaaa11110012'
      and notification_type = 'assigned'
      and (payload->>'source') = 'schedule'$$,
  1, 'DAR3: zoe sees her schedule-derived assignment notification');

select pg_temp.expect_count(
  $$with u as (
      update public.daily_report_assignment_notifications
         set read_at = now()
       where employee_id = 'dada1111-0000-4000-8000-000000000002'
         and read_at is null
      returning 1
    ) select count(*)::int from u$$,
  1, 'DAR3: zoe can mark her own notification read');

-- ---- default branch: a fresh area with a standing default owner ------------
set local role postgres;

insert into public.daily_report_areas (id, facility_id, name, slug, sort_order, is_active)
values ('aaaa1111-da03-aaaa-aaaa-aaaa11110015',
        '11111111-1111-1111-1111-111111111111', 'Default Area', 'default-area', 3, true)
on conflict (id) do nothing;

insert into public.area_default_owners (facility_id, area_id, employee_id)
values ('11111111-1111-1111-1111-111111111111',
        'aaaa1111-da03-aaaa-aaaa-aaaa11110015',
        'dada1111-0000-4000-8000-000000000002')
on conflict (area_id, employee_id) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select public.resolve_daily_area_assignments(current_date)$$,
  1, 'DAR3: re-run picks up ONLY the new area, via its default owner');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where area_id = 'aaaa1111-da03-aaaa-aaaa-aaaa11110015'
      and report_date = current_date
      and employee_id = 'dada1111-0000-4000-8000-000000000002'
      and source = 'default'
      and superseded_at is null$$,
  1, 'DAR3: the default-owner branch materialized with source = default');

-- ---- caller gate: a user without daily_reports access is rejected ----------
-- Bob's employee insert auto-seeded staff role defaults (migration 82), which
-- include daily_reports view — so first disable his daily grants (nothing
-- after this block impersonates bob).
set local role postgres;
update public.user_permissions
   set enabled = false
 where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
   and module_name = 'daily_reports';

set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);

select pg_temp.expect_error(
  $$select public.resolve_daily_area_assignments(current_date)$$,
  'DAR3: a caller without daily_reports access CANNOT run the resolution engine');

reset role;

-- ---------------------------------------------------------------------------
-- DAR-5: day close — snapshot freeze + past-date assignment lock (mig 185).
--
-- Fixture: two days ago (a closed day; current_date-1 already carries the
-- DAR snapshot fixture for the granted area, so -2 keeps this section's
-- NOT-EXISTS paths unambiguous): granted area assigned to zoe AND completed
-- (submission that day); nogrant area assigned to alice, NOT completed;
-- default-area untouched (open) -> must get NO snapshot row.
-- ---------------------------------------------------------------------------
set local role postgres;

insert into public.report_area_assignments
  (id, facility_id, report_date, area_id, employee_id, source)
values
  ('da5e0000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', current_date - 2,
   'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
   'dada1111-0000-4000-8000-000000000002', 'manual'),
  ('da5e0000-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111', current_date - 2,
   'aaaa1111-da02-aaaa-aaaa-aaaa11110012',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual')
on conflict (id) do nothing;

insert into public.daily_report_submissions
  (id, facility_id, area_id, template_id, employee_id, business_date)
values ('da5e0000-5b11-4000-8000-000000000003',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
        'aaaa1111-d701-aaaa-aaaa-aaaa11110013',
        'dada1111-0000-4000-8000-000000000002', current_date - 2)
on conflict (id) do nothing;

-- ---- past-date lock: even the edit tier cannot touch a closed day ----------
set local role authenticated;
set local request.jwt.claims to '{"sub":"ed17ed17-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'ed17ed17-0000-4000-8000-000000000001', true);

select pg_temp.expect_error(
  $$insert into public.report_area_assignments
      (facility_id, report_date, area_id, employee_id, source)
    values ('11111111-1111-1111-1111-111111111111', current_date - 1,
            'aaaa1111-da03-aaaa-aaaa-aaaa11110015',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual')$$,
  'DAR5: edit-tier sam CANNOT create an assignment for a past day');

select pg_temp.expect_error(
  $$update public.report_area_assignments
       set superseded_at = now()
     where id = 'da5e0000-0000-4000-8000-000000000001'$$,
  'DAR5: edit-tier sam CANNOT supersede a past day''s assignment (locked)');

select pg_temp.expect_error(
  $$select public.snapshot_daily_assignment_days(
      '11111111-1111-1111-1111-111111111111')$$,
  'DAR5: authenticated users CANNOT invoke the snapshot writer directly');

select pg_temp.expect_error(
  $$select public.snapshot_closed_daily_assignment_days()$$,
  'DAR5: authenticated users CANNOT invoke the cron snapshot wrapper');

-- ---- snapshot freeze -------------------------------------------------------
set local role postgres;

select pg_temp.expect_count(
  $$select public.snapshot_daily_assignment_days(
      '11111111-1111-1111-1111-111111111111')$$,
  2, 'DAR5: snapshot writer freezes exactly the two assigned areas of the closed day');

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_assignment_snapshots
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and business_date = current_date - 2
      and area_id = 'aaaa1111-da01-aaaa-aaaa-aaaa11110011'
      and completed = true
      and jsonb_array_length(assignees) = 1
      and assignees->0->>'employee_id' = 'dada1111-0000-4000-8000-000000000002'
      and completed_by->0->>'employee_id' = 'dada1111-0000-4000-8000-000000000002'$$,
  1, 'DAR5: completed area snapshot carries assignees + completed_by');

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_assignment_snapshots
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and business_date = current_date - 2
      and area_id = 'aaaa1111-da02-aaaa-aaaa-aaaa11110012'
      and completed = false
      and completed_by is null
      and assignees->0->>'employee_id' = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  1, 'DAR5: incomplete area snapshot records "assigned, not completed"');

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_assignment_snapshots
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and business_date = current_date - 2
      and area_id = 'aaaa1111-da03-aaaa-aaaa-aaaa11110015'$$,
  0, 'DAR5: an OPEN (unassigned) closed day gets NO snapshot row');

-- Immutability: later tampering with the day's rows must not alter the frozen
-- record. Supersede zoe's row as postgres (service paths bypass the lock),
-- re-run, and confirm the snapshot is untouched.
update public.report_area_assignments set superseded_at = now()
 where id = 'da5e0000-0000-4000-8000-000000000001';

select pg_temp.expect_count(
  $$select public.snapshot_daily_assignment_days(
      '11111111-1111-1111-1111-111111111111')$$,
  0, 'DAR5: re-running the snapshot writer is a no-op (insert-only)');

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_assignment_snapshots
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and business_date = current_date - 2
      and area_id = 'aaaa1111-da01-aaaa-aaaa-aaaa11110011'
      and jsonb_array_length(assignees) = 1$$,
  1, 'DAR5: the frozen record survives later changes to the day''s rows');

select pg_temp.expect_ok(
  $$select public.snapshot_closed_daily_assignment_days()$$,
  'DAR5: the cron wrapper runs for a service path');

-- ---- staff read model: snapshots respect the standing area layer -----------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_assignment_snapshots
    where business_date = current_date - 2
      and area_id = 'aaaa1111-da01-aaaa-aaaa-aaaa11110011'$$,
  1, 'DAR5: alice sees the snapshot for an area she holds standing access to');

select pg_temp.expect_count(
  $$select count(*) from public.daily_area_assignment_snapshots
    where business_date = current_date - 2
      and area_id = 'aaaa1111-da02-aaaa-aaaa-aaaa11110012'$$,
  0, 'DAR5: alice CANNOT see the snapshot for an area outside her standing access');

reset role;

-- ---------------------------------------------------------------------------
-- DAR-7: explicit "re-sync from schedule" (migration 187).
--
-- Continues the DAR fixtures for TODAY: nogrant-area is mapped to Front Desk
-- A and carries zoe's schedule-derived active assignment (from DAR-3);
-- granted-area carries zoe's MANUAL active assignment. Proves: re-sync adds a
-- newly published assignee, is idempotent, removes an assignee whose shift is
-- cancelled, never touches manual assignments, and is gated to the
-- edit/admin tier with past dates rejected.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Alice gets a PUBLISHED shift on Front Desk A today (her DAR-3 shift was a
-- draft and must stay invisible to the sync). 17:30-23:00 avoids the
-- no-double-booking exclusion constraint (migration 140) against her
-- 11:00-17:00 draft.
insert into public.schedule_shifts
  (id, facility_id, department_id, employee_id, job_area_id,
   starts_at, ends_at, status, published_at)
values ('da5f0000-0000-4000-8000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-de70-aaaa-aaaa-aaaa11110001',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'aaaa1111-30b0-aaaa-aaaa-aaaa11110002',
        current_date + time '17:30', current_date + time '23:00',
        'published', now())
on conflict (id) do nothing;

-- ---- gates first ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.resync_daily_area_assignments(current_date)$$,
  'DAR7: plain staff CANNOT invoke the schedule re-sync');

set local role authenticated;
set local request.jwt.claims to '{"sub":"ed17ed17-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'ed17ed17-0000-4000-8000-000000000001', true);

select pg_temp.expect_error(
  $$select public.resync_daily_area_assignments(current_date - 1)$$,
  'DAR7: re-sync rejects a past (closed) date');

-- ---- add: newly published shift flows in ------------------------------------
select pg_temp.expect_count(
  $$select public.resync_daily_area_assignments(current_date)$$,
  1, 'DAR7: re-sync picks up alice''s newly published shift (1 change)');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where area_id = 'aaaa1111-da02-aaaa-aaaa-aaaa11110012'
      and report_date = current_date
      and employee_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and source = 'schedule'
      and superseded_at is null$$,
  1, 'DAR7: alice is now schedule-assigned to the mapped area');

select pg_temp.expect_count(
  $$select public.resync_daily_area_assignments(current_date)$$,
  0, 'DAR7: re-running the re-sync is a no-op');

-- ---- remove: cancelled shift flows out; manual rows untouched ---------------
set local role postgres;
update public.schedule_shifts set status = 'cancelled'
 where id = 'da5d0000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims to '{"sub":"ed17ed17-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'ed17ed17-0000-4000-8000-000000000001', true);

select pg_temp.expect_count(
  $$select public.resync_daily_area_assignments(current_date)$$,
  1, 'DAR7: cancelling zoe''s shift removes her on the next re-sync (1 change)');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where area_id = 'aaaa1111-da02-aaaa-aaaa-aaaa11110012'
      and report_date = current_date
      and employee_id = 'dada1111-0000-4000-8000-000000000002'
      and superseded_at is null$$,
  0, 'DAR7: zoe''s schedule-derived assignment is superseded');

select pg_temp.expect_count(
  $$select count(*) from public.report_area_assignments
    where area_id = 'aaaa1111-da01-aaaa-aaaa-aaaa11110011'
      and report_date = current_date
      and source = 'manual'
      and superseded_at is null$$,
  1, 'DAR7: the MANUAL assignment on the granted area is untouched by re-sync');

-- zoe received an 'unassigned' notification from the removal.
set local role authenticated;
set local request.jwt.claims to '{"sub":"dada1111-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'dada1111-0000-4000-8000-000000000001', true);

select pg_temp.expect_count(
  $$select count(*) from public.daily_report_assignment_notifications
    where employee_id = 'dada1111-0000-4000-8000-000000000002'
      and area_id = 'aaaa1111-da02-aaaa-aaaa-aaaa11110012'
      and notification_type = 'unassigned'$$,
  1, 'DAR7: the removed assignee got an unassigned notification');

reset role;

-- ---------------------------------------------------------------------------
-- SCHED-188: recurring series facility fence (migration 188).
--
-- Migration 15's recurring_parent_id was a bare single-column self-FK: it
-- only checked that the parent id existed SOMEWHERE in schedule_shifts, not
-- that it belonged to the same facility as the child. Migration 188 replaces
-- it with a composite FK (recurring_parent_id, facility_id) ->
-- schedule_shifts(id, facility_id), so a child can only reference a parent in
-- its OWN facility. Reuses Carol (scheduling admin, Facility A) and the
-- B-side shift fixture (bbbb2222-5511-bbbb-bbbb-bbbb22220083) seeded above.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

-- Facility-A root shift for a would-be recurring series. Far-future window,
-- draft/unassigned, so it doesn't collide with other fixtures or trip the
-- publish-lock / double-booking constraints.
insert into public.schedule_shifts (id, facility_id, department_id, starts_at, ends_at, status)
values ('aaaa1111-5515-aaaa-aaaa-aaaa11110188',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
        now() + interval '150 days', now() + interval '150 days 4 hours', 'draft')
on conflict (id) do nothing;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

-- A Facility-A draft shift whose recurring_parent_id points at a FACILITY-B
-- shift must be rejected by the composite FK (RLS's with-check only looks at
-- the new row's OWN facility_id, so this is the FK doing the fencing, not RLS).
select pg_temp.expect_error(
  $$insert into public.schedule_shifts
      (facility_id, department_id, starts_at, ends_at, status, recurring_parent_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            now() + interval '151 days', now() + interval '151 days 4 hours', 'draft',
            'bbbb2222-5511-bbbb-bbbb-bbbb22220083')$$,
  'SCHED-188: Facility-A child pointing at a Facility-B recurring_parent_id is rejected (composite FK)');

-- A Facility-A draft shift whose recurring_parent_id points at a FACILITY-A
-- shift (the root seeded above) succeeds — the same-facility case is
-- unaffected by the fence.
select pg_temp.expect_ok(
  $$insert into public.schedule_shifts
      (id, facility_id, department_id, starts_at, ends_at, status, recurring_parent_id)
    values ('aaaa1111-5516-aaaa-aaaa-aaaa11110188',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            now() + interval '151 days', now() + interval '151 days 4 hours', 'draft',
            'aaaa1111-5515-aaaa-aaaa-aaaa11110188')$$,
  'SCHED-188: Facility-A child pointing at a Facility-A recurring_parent_id succeeds');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5516-aaaa-aaaa-aaaa11110188'
       and recurring_parent_id = 'aaaa1111-5515-aaaa-aaaa-aaaa11110188'$$,
  1, 'SCHED-188: the Facility-A child row was actually persisted with its parent link');

-- "Delete the whole series" (root OR any occurrence pointing at it), scoped to
-- Carol's own facility: deletes both the root and the child seeded above.
select pg_temp.expect_count(
  $$with d as (
      delete from public.schedule_shifts
       where facility_id = public.current_facility_id()
         and (id = 'aaaa1111-5515-aaaa-aaaa-aaaa11110188'
              or recurring_parent_id = 'aaaa1111-5515-aaaa-aaaa-aaaa11110188')
      returning 1
    )
    select count(*) from d$$,
  2, 'SCHED-188: facility-scoped series delete removes the Facility-A root + child (2 rows)');

-- Same delete shape, but the "root" id belongs to FACILITY B. Even though
-- Carol is a scheduling admin, the delete's facility_id = current_facility_id()
-- clause (Facility A) means the Facility-B row is never in the deletable set —
-- the statement runs (no error) but affects 0 rows.
select pg_temp.expect_count(
  $$with d as (
      delete from public.schedule_shifts
       where facility_id = public.current_facility_id()
         and (id = 'bbbb2222-5511-bbbb-bbbb-bbbb22220083'
              or recurring_parent_id = 'bbbb2222-5511-bbbb-bbbb-bbbb22220083')
      returning 1
    )
    select count(*) from d$$,
  0, 'SCHED-188: series delete against a Facility-B root id (as a Facility-A admin) affects 0 rows');

reset role;
set local role postgres;

-- Confirm (as owner) the Facility-A series is actually gone and the
-- Facility-B fixture shift was left untouched by the scoped-away delete above.
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id in ('aaaa1111-5515-aaaa-aaaa-aaaa11110188', 'aaaa1111-5516-aaaa-aaaa-aaaa11110188')$$,
  0, 'SCHED-188: Facility-A series root + child are gone after the scoped delete');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'bbbb2222-5511-bbbb-bbbb-bbbb22220083'$$,
  1, 'SCHED-188: Facility-B fixture shift untouched by the cross-facility delete attempt');

reset role;
-- FRS: facility role seeding is canonical (migration 188).
--
-- Migrations 55/87 retired gm/supervisor, but the seed functions kept
-- inserting the six-role set until migration 188. Assert the seed now yields
-- exactly the four canonical roles at the canonical hierarchy levels, and
-- that the retired keys are rejected outright by the roles_key_not_retired
-- constraint (any path — seed function or direct insert).
-- ---------------------------------------------------------------------------
insert into public.facilities (id, name, slug, timezone)
values ('f125e88f-0000-4000-8000-000000000188', 'FRS Seed Test Facility',
        'frs-seed-test-facility', 'America/New_York');

select public.seed_default_roles_for_facility('f125e88f-0000-4000-8000-000000000188');

select pg_temp.expect_count(
  $$select count(*) from public.roles
    where facility_id = 'f125e88f-0000-4000-8000-000000000188'$$,
  4, 'FRS1: seed_default_roles_for_facility creates exactly four roles');

select pg_temp.expect_count(
  $$select count(*) from public.roles
    where facility_id = 'f125e88f-0000-4000-8000-000000000188'
      and (key, hierarchy_level) in
          (('super_admin', 0), ('admin', 1), ('manager', 2), ('staff', 3))$$,
  4, 'FRS2: seeded roles are the canonical keys at the canonical levels');

select pg_temp.expect_count(
  $$select count(*) from public.roles
    where facility_id = 'f125e88f-0000-4000-8000-000000000188'
      and key in ('gm', 'supervisor')$$,
  0, 'FRS3: retired gm/supervisor roles are not seeded');

select pg_temp.expect_error(
  $$insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
    values ('f125e88f-0000-4000-8000-000000000188', 'gm', 'General Manager', 2, true)$$,
  'FRS4: inserting a gm role is rejected by roles_key_not_retired');

select pg_temp.expect_error(
  $$insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
    values ('f125e88f-0000-4000-8000-000000000188', 'supervisor', 'Supervisor', 4, true)$$,
  'FRS5: inserting a supervisor role is rejected by roles_key_not_retired');

-- Custom per-facility keys stay allowed (the constraint only blocks retired ones).
select pg_temp.expect_ok(
  $$insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
    values ('f125e88f-0000-4000-8000-000000000188', 'driver', 'Driver', 4, false)$$,
  'FRS6: custom role keys are still accepted');

-- ---------------------------------------------------------------------------
-- 3. Surface results.
-- ---------------------------------------------------------------------------
reset role;

do $$
declare
  v_failed int;
  v_row    text;
begin
  select count(*) into v_failed from _rls_failures;
  if v_failed > 0 then
    raise warning 'RLS isolation: % FAILURE(S)', v_failed;
    for v_row in select msg from _rls_failures loop
      raise warning '%', v_row;
    end loop;
    raise exception 'RLS isolation tests failed: % case(s) failed', v_failed;
  else
    raise notice 'RLS isolation tests passed.';
  end if;
end$$;

rollback;
