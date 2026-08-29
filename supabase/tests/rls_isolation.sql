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

-- Pin the session timezone to the fixture facilities' timezone
-- (facilities.timezone defaults to America/New_York; the fixtures below
-- don't override it). The daily-report triggers under test (migrations
-- 183/185) compute "today" as `now() at time zone f.timezone`, while the
-- fixtures seed dates with `current_date`, which uses the SESSION timezone
-- (UTC in CI). Between 00:00 and 04:00/05:00 UTC — i.e. every evening in
-- Eastern time — those two calendars disagree by one day, and nine
-- assertions (DAR stamping/past-day/resolution/re-sync) failed only during
-- that window. Pinning the session zone makes `current_date` agree with the
-- facility-local date at any wall-clock hour.
set local time zone 'America/New_York';

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

-- Audit logs: a cross-facility INSERT is RLS-denied. This is the exact
-- failure mode the app helper (src/lib/audit/log.ts) must SURFACE, not
-- swallow — it once discarded the insert error entirely (B2 review item),
-- so a denial here produced a silent hole in the audit trail.
select pg_temp.expect_error(
  $$insert into public.audit_logs (facility_id, action, entity_type)
    values ('22222222-2222-2222-2222-222222222222',
            'test.cross_facility', 'employees')$$,
  'alice CANNOT INSERT an audit_logs row into facility B');

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
-- RL: rate limiting (migration 92; hardened in migration 216).
--
-- check_rate_limit() is now SERVICE-ROLE ONLY: the login action and public
-- lead-form route call it through the service-role client (migration 216
-- closed a client-callable counter-forgery/lockout oracle). Verify:
--   (a) service_role CAN call it and is blocked after p_max within a window;
--   (b) anon CANNOT call it at all (grant revoked);
--   (c) anon cannot touch public.rate_limit_counters directly.
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;

-- (a) First p_max (=3) calls in a fresh window are allowed; the next is blocked.
select pg_temp.expect_count(
  $$select case when public.check_rate_limit('rls_test', 'rl-ident-1', 3, 600)
      then 1 else 0 end$$,
  1, 'RL: service_role call #1 allowed');
select pg_temp.expect_count(
  $$select case when public.check_rate_limit('rls_test', 'rl-ident-1', 3, 600)
      then 1 else 0 end$$,
  1, 'RL: service_role call #2 allowed');
select pg_temp.expect_count(
  $$select case when public.check_rate_limit('rls_test', 'rl-ident-1', 3, 600)
      then 1 else 0 end$$,
  1, 'RL: service_role call #3 allowed (at the cap)');
select pg_temp.expect_count(
  $$select case when public.check_rate_limit('rls_test', 'rl-ident-1', 3, 600)
      then 1 else 0 end$$,
  0, 'RL: service_role call #4 BLOCKED (over the cap)');
reset role;

-- (b) anon can no longer call the function (migration 216 revoke).
set local role anon;
select pg_temp.expect_error(
  $$select public.check_rate_limit('rls_test', 'rl-ident-2', 3, 600)$$,
  'RL: anon CANNOT call check_rate_limit (service-role only since migration 216)');

-- (c) anon cannot read or write the counters table directly. The only policy on
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
-- REFRIG-EDIT: report-value UPDATE gate (migration 238).
--
-- The recompute-on-edit flow lets facility refrigeration ADMINS correct a
-- submitted reading (and recompute dependent computed values). UPDATE was
-- super-admin only before; migration 238 widens it to
-- has_module_admin_access('refrigeration') WITHIN the caller's facility.
-- Bounds proven here:
--   * Gwen (refrigeration admin, facility A) CAN update an A value row;
--   * Gwen CANNOT touch a facility-B value row (0 rows under USING);
--   * Alice (submit, not admin) and Dave (view) still CANNOT update.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Deterministic value rows to edit: one per facility.
insert into public.refrigeration_report_values
  (id, facility_id, report_id, label_snapshot, field_type_snapshot, value_numeric)
values
  ('aaaa1111-ed17-aaaa-aaaa-aaaa11110065',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-7e00-aaaa-aaaa-aaaa11110063', 'Editable reading', 'numeric', 15),
  ('bbbb2222-ed17-bbbb-bbbb-bbbb22220065',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-7e00-bbbb-bbbb-bbbb22220063', 'Foreign reading', 'numeric', 15)
on conflict (id) do nothing;

-- Gwen (facility A, refrigeration admin — seeded in the SPACES block).
set local role authenticated;
set local request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

select pg_temp.expect_count(
  $$with u as (
     update public.refrigeration_report_values
        set value_numeric = 16
      where id = 'aaaa1111-ed17-aaaa-aaaa-aaaa11110065'
     returning 1
   ) select count(*) from u$$,
  1, 'REFRIG-EDIT: gwen (module admin) CAN UPDATE a report value in her facility (migration 238)');
select pg_temp.expect_count(
  $$with u as (
     update public.refrigeration_report_values
        set value_numeric = 999
      where id = 'bbbb2222-ed17-bbbb-bbbb-bbbb22220065'
     returning 1
   ) select count(*) from u$$,
  0, 'REFRIG-EDIT: gwen CANNOT UPDATE a facility-B report value (0 rows)');

-- Alice (facility A, submit but NOT refrigeration admin).
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$with u as (
     update public.refrigeration_report_values
        set value_numeric = 999
      where id = 'aaaa1111-ed17-aaaa-aaaa-aaaa11110065'
     returning 1
   ) select count(*) from u$$,
  0, 'REFRIG-EDIT: alice (submit, not admin) CANNOT UPDATE report values (0 rows)');

-- Dave (facility A, view only).
set local role authenticated;
set local request.jwt.claims to '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true);

select pg_temp.expect_count(
  $$with u as (
     update public.refrigeration_report_values
        set value_numeric = 999
      where id = 'aaaa1111-ed17-aaaa-aaaa-aaaa11110065'
     returning 1
   ) select count(*) from u$$,
  0, 'REFRIG-EDIT: view-only dave CANNOT UPDATE report values (0 rows)');

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
-- 2k2. Audit-retention floor + configurable window (migration 215).
--
-- The audit-log retention window moved from a hard-coded 7 years to the
-- per-facility retention_settings row — with a lock: the audit_logs floor row
-- in retention_module_floors (2555 days) makes the migration-208
-- retention_settings_enforce_floor trigger reject any value below 7 years
-- (0 = keep forever remains allowed), and both purge paths clamp with
-- greatest(keep_days, 2555) as defense in depth. Probe the lock and the
-- window arithmetic at the DB boundary.
-- ---------------------------------------------------------------------------
set local role postgres;

-- The lock: a sub-floor audit retention row is rejected by the floor trigger
-- even for the table owner.
select pg_temp.expect_error(
  $$insert into public.retention_settings (facility_id, module_key, keep_days)
    values ('11111111-1111-1111-1111-111111111111', 'audit_logs', 365)$$,
  'RET-215: audit_logs retention below 2555 days is rejected (floor trigger)');
-- 0 (= forever) and >= 2555 are allowed.
select pg_temp.expect_ok(
  $$insert into public.retention_settings (facility_id, module_key, keep_days)
    values ('11111111-1111-1111-1111-111111111111', 'audit_logs', 3650)
    on conflict (facility_id, module_key) do update set keep_days = 3650$$,
  'RET-215: a 10-year audit retention window is accepted');
-- Non-audit modules keep their own floors (daily_reports floor = 30).
select pg_temp.expect_ok(
  $$insert into public.retention_settings (facility_id, module_key, keep_days)
    values ('11111111-1111-1111-1111-111111111111', 'daily_reports', 30)
    on conflict (facility_id, module_key) do update set keep_days = 30$$,
  'RET-215: non-audit modules keep their own floor');

-- Window arithmetic: with a 10-year window configured, an 8-year-old audit
-- row SURVIVES the nightly worker; a 9-year-old row under the default
-- 7-year fallback (facility B, no settings row) is deleted.
insert into public.audit_logs (id, facility_id, action, entity_type, created_at)
values
  ('a2121111-0001-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'ret212.probe', 'retention_probe', now() - interval '8 years'),
  ('a2122222-0002-4bbb-8bbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222',
   'ret212.probe', 'retention_probe', now() - interval '9 years')
-- audit_logs PK is (id, created_at) since the partitioning pilot (migration 219).
on conflict (id, created_at) do nothing;
reset role;

set local role service_role;
select pg_temp.expect_ok(
  $$select public.purge_old_audit_logs()$$,
  'RET-215: service_role runs the nightly audit purge');
reset role;

set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs
     where id = 'a2121111-0001-4aaa-8aaa-aaaaaaaaaaaa'$$,
  1, 'RET-215: 8-year-old row SURVIVES under the configured 10-year window');
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs
     where id = 'a2122222-0002-4bbb-8bbb-bbbbbbbbbbbb'$$,
  0, 'RET-215: 9-year-old row leaves audit_logs under the default 7-year fallback (staged for destruction, migration 213)');
-- Clean up the settings rows so later sections see defaults. (The surviving
-- 8-year probe row is left in place — audit_logs is append-only at the
-- trigger level since migration 214; section 2k3's purge run sweeps it into
-- its staged batch, which that section's probes account for.)
delete from public.retention_settings
 where facility_id = '11111111-1111-1111-1111-111111111111'
   and module_key in ('audit_logs', 'daily_reports');
reset role;

-- ---------------------------------------------------------------------------
-- 2k3. Two-phase audit destruction (migration 213).
--
-- The retention purge now STAGES expired audit rows into a quarantine
-- (audit_logs_pending_destruction, per-facility audit_destruction_batches)
-- instead of deleting them. Destruction requires approval by TWO DIFFERENT
-- facility admins; one admin can cancel, which restores every row with its
-- original id and created_at. Probes: staging, RLS visibility, the
-- self-second-approval refusal, the destroy, the restore, and that direct
-- writes to the quarantine are RLS-inert even for admins.
--
-- Cast: Fred (facility-A admin, a0a0a0a0-…, seeded in the FDO section
-- below — seeded here too, idempotently, since this section runs first)
-- plus a second admin Gina, because the two-person rule needs two of them.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Fred (idempotent copy of the FDO fixture) + Gina, both facility-A admins.
insert into auth.users (id, email) values
  ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'fred@fac-a.test'),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'gina@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin) values
  ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
   '11111111-1111-1111-1111-111111111111', 'fred@fac-a.test', false),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   '11111111-1111-1111-1111-111111111111', 'gina@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select x.emp_id, '11111111-1111-1111-1111-111111111111'::uuid, x.user_id,
       r.id, x.first_name, 'Admin', x.email, true
from (values
  ('a0a06666-a0a0-a0a0-a0a0-a0a0a0a0a0a0'::uuid,
   'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'::uuid, 'Fred', 'fred@fac-a.test'),
  ('a1a17777-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid,
   'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, 'Gina', 'gina@fac-a.test')
) as x(emp_id, user_id, first_name, email)
join public.roles r
  on r.facility_id = '11111111-1111-1111-1111-111111111111' and r.key = 'admin'
on conflict (id) do nothing;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values
  ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
   '11111111-1111-1111-1111-111111111111', 'admin', 'admin'::public.user_action, true),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   '11111111-1111-1111-1111-111111111111', 'admin', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;

-- An expired audit row to stage.
insert into public.audit_logs (id, facility_id, action, entity_type, created_at)
values ('a2131111-0001-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'a3.probe', 'destruction_probe', now() - interval '8 years')
on conflict (id, created_at) do nothing;
reset role;

set local role service_role;
select pg_temp.expect_ok(
  $$select public.purge_old_audit_logs()$$,
  'A3: nightly purge stages expired audit rows');
reset role;

-- Staging moved the row out of the live log and into the quarantine.
set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs
     where id = 'a2131111-0001-4aaa-8aaa-aaaaaaaaaaaa'$$,
  0, 'A3: expired row left audit_logs');
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs_pending_destruction
     where original_id = 'a2131111-0001-4aaa-8aaa-aaaaaaaaaaaa'$$,
  1, 'A3: expired row is quarantined, not deleted');
-- Pin this batch's id where every later probe (any role) can read it.
create temp table _a3_ctx on commit drop as
select batch_id from public.audit_logs_pending_destruction
 where original_id = 'a2131111-0001-4aaa-8aaa-aaaaaaaaaaaa';
grant select on _a3_ctx to public;
reset role;

-- Staff: quarantine is invisible and the approve RPC's admin gate raises.
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_count(
  $$select count(*) from public.audit_destruction_batches$$,
  0, 'A3: staff alice CANNOT SELECT destruction batches');
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs_pending_destruction$$,
  0, 'A3: staff alice CANNOT SELECT quarantined audit rows');
select pg_temp.expect_error(
  $$select public.approve_audit_destruction((select batch_id from _a3_ctx))$$,
  'A3: staff alice CANNOT approve destruction (admin gate raises)');
reset role;

-- Admin #1 (Fred): sees the batch, first approval sticks, self-second refused,
-- and nothing is destroyed on one signature. Direct quarantine writes are
-- RLS-inert even for him.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);
select pg_temp.expect_count(
  $$select count(*) from public.audit_destruction_batches
     where id = (select batch_id from _a3_ctx)$$,
  1, 'A3: facility admin Fred CAN SELECT the staged batch');
select pg_temp.expect_count(
  $$select count(*) from (
      select public.approve_audit_destruction((select batch_id from _a3_ctx)) as r) x
    where (x.r->>'ok') = 'true' and (x.r->>'state') = 'pending_second_approval'$$,
  1, 'A3: first approval recorded (pending second)');
select pg_temp.expect_count(
  $$select count(*) from (
      select public.approve_audit_destruction((select batch_id from _a3_ctx)) as r) x
    where (x.r->>'ok') = 'false'$$,
  1, 'A3: the SAME admin cannot give the second approval');
select pg_temp.expect_ok(
  $$delete from public.audit_logs_pending_destruction
     where batch_id = (select batch_id from _a3_ctx)$$,
  'A3: direct DELETE of quarantined rows runs (RLS scopes it to 0 rows)');
reset role;

set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs_pending_destruction
     where original_id = 'a2131111-0001-4aaa-8aaa-aaaaaaaaaaaa'$$,
  1, 'A3: one signature destroyed nothing (and direct DELETE touched 0 rows)');
reset role;

-- Admin #2 (Gina): the second, different signature destroys the batch.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', true);
select pg_temp.expect_count(
  $$select count(*) from (
      select public.approve_audit_destruction((select batch_id from _a3_ctx)) as r) x
    where (x.r->>'ok') = 'true' and (x.r->>'state') = 'destroyed'$$,
  1, 'A3: a DIFFERENT admin''s second approval destroys the batch');
reset role;

set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs_pending_destruction
     where batch_id = (select batch_id from _a3_ctx)$$,
  0, 'A3: quarantined rows are gone after the second approval');
select pg_temp.expect_count(
  $$select count(*) from public.audit_destruction_batches
     where id = (select batch_id from _a3_ctx) and status = 'destroyed'
       and approved_by_1 is distinct from approved_by_2$$,
  1, 'A3: batch is destroyed with two distinct approvers on record');
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs
     where entity_id = (select batch_id from _a3_ctx)
       and action in ('audit_destruction.approve_first', 'audit_destruction.execute')$$,
  2, 'A3: both destruction steps self-audited');

-- Cancel path: stage another expired row, then restore it.
insert into public.audit_logs (id, facility_id, action, entity_type, created_at)
values ('a2132222-0002-4bbb-8bbb-bbbbbbbbbbbb',
        '11111111-1111-1111-1111-111111111111',
        'a3.probe2', 'destruction_probe', now() - interval '8 years')
on conflict (id, created_at) do nothing;
reset role;
set local role service_role;
select pg_temp.expect_ok(
  $$select public.purge_old_audit_logs()$$,
  'A3: purge stages the second probe row');
reset role;
set local role postgres;
create temp table _a3_ctx2 on commit drop as
select batch_id from public.audit_logs_pending_destruction
 where original_id = 'a2132222-0002-4bbb-8bbb-bbbbbbbbbbbb';
grant select on _a3_ctx2 to public;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);
select pg_temp.expect_count(
  $$select count(*) from (
      select public.cancel_audit_destruction((select batch_id from _a3_ctx2)) as r) x
    where (x.r->>'ok') = 'true' and (x.r->>'restored_count')::int >= 1$$,
  1, 'A3: a single admin can CANCEL a staged batch');
reset role;

set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs
     where id = 'a2132222-0002-4bbb-8bbb-bbbbbbbbbbbb'
       and created_at < now() - interval '7 years'$$,
  1, 'A3: cancel restored the row with its ORIGINAL id and created_at');
select pg_temp.expect_count(
  $$select count(*) from public.audit_destruction_batches
     where id = (select batch_id from _a3_ctx2) and status = 'cancelled'$$,
  1, 'A3: cancelled batch is closed');
-- The restored probe row is deliberately left in place: audit_logs is
-- append-only at the trigger level (migration 214), and the I2 section
-- verifies the facility-A chain INCLUDING this restore.
reset role;

-- ---------------------------------------------------------------------------
-- 2k4. Audit-log hash chain (migration 214) — the numbered logbook.
--
-- Every audit_logs insert is chained (prev_hash/row_hash under a
-- per-facility advisory lock); verify_audit_chain() recomputes every hash
-- and walks the linkage, bridging retention-staged/destroyed spans via the
-- batches' archived hash metadata. UPDATE/DELETE raise for everyone —
-- including service_role — outside the governed staging bypass.
--
-- By this point in the file facility A's chain has real history: fixture
-- DML audits, a destroyed batch, a cancelled batch with a tail-restored
-- row. Verifying it here exercises genesis, bridges, and restores at once.
-- ---------------------------------------------------------------------------
set local role postgres;
-- Chained columns are being populated by the insert trigger.
select pg_temp.expect_count(
  $$select count(*) from public.audit_logs
     where facility_id = '11111111-1111-1111-1111-111111111111'
       and (row_hash is null or seq is null)$$,
  0, 'I2: every facility-A audit row carries seq + row_hash');
reset role;

-- Staff cannot run verification (admin gate raises).
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$select public.verify_audit_chain('11111111-1111-1111-1111-111111111111')$$,
  'I2: staff alice CANNOT run verify_audit_chain');
reset role;

-- Admin: both facilities verify clean — across the destroyed batch (bridge),
-- the cancelled batch (bridge + tail restore), and facility B's staged batch.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);
select pg_temp.expect_count(
  $$select count(*) from (
      select public.verify_audit_chain('11111111-1111-1111-1111-111111111111') as r) x
    where (x.r->>'ok') = 'true' and (x.r->>'checked')::int > 0$$,
  1, 'I2: facility-A chain verifies (incl. destroyed + cancelled batch bridges)');
reset role;

-- Append-only: even service_role cannot UPDATE or DELETE audit rows.
set local role service_role;
select pg_temp.expect_error(
  $$update public.audit_logs set after = '{"tampered":true}'::jsonb
     where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  'I2: service_role CANNOT UPDATE audit rows (append-only trigger)');
select pg_temp.expect_error(
  $$delete from public.audit_logs
     where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  'I2: service_role CANNOT DELETE audit rows (append-only trigger)');
reset role;

-- Tamper detection: a payload edit by someone who CAN bypass the guard
-- (owner-level, bypass GUC — i.e. exactly the attacker the chain exists
-- for) breaks verification, and restoring the value heals it.
set local role postgres;
select set_config('rr.audit_chain_bypass', 'on', true);
update public.audit_logs
   set after = after || '{"__tampered":true}'::jsonb
 where id = (
   select id from public.audit_logs
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and after is not null
    order by seq desc limit 1);
select set_config('rr.audit_chain_bypass', '', true);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);
select pg_temp.expect_count(
  $$select count(*) from (
      select public.verify_audit_chain('11111111-1111-1111-1111-111111111111') as r) x
    where (x.r->>'ok') = 'false'
      and (x.r->>'reason') like 'row_hash mismatch%'$$,
  1, 'I2: a tampered payload is DETECTED by verify_audit_chain');
reset role;

set local role postgres;
select set_config('rr.audit_chain_bypass', 'on', true);
update public.audit_logs
   set after = after - '__tampered'
 where facility_id = '11111111-1111-1111-1111-111111111111'
   and after ? '__tampered';
select set_config('rr.audit_chain_bypass', '', true);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);
select pg_temp.expect_count(
  $$select count(*) from (
      select public.verify_audit_chain('11111111-1111-1111-1111-111111111111') as r) x
    where (x.r->>'ok') = 'true'$$,
  1, 'I2: restoring the payload heals verification');
reset role;

-- Partitioning pilot (migration 222, hardened in 241): audit_logs is
-- RANGE-partitioned by created_at. Parent RLS applies ONLY to queries that
-- name the parent — row security is a per-relation flag, so a query naming a
-- partition directly (which PostgREST allows: GET /rest/v1/audit_logs_y2026)
-- is governed by the partition's own RLS state. Migration 222 shipped with
-- RLS on the parent only, leaving every partition readable cross-facility;
-- 241 enables RLS on each partition and revokes anon/authenticated direct
-- access. Assert both the parent path and the direct-partition path.
set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from pg_class
     where relname = 'audit_logs'
       and relnamespace = 'public'::regnamespace
       and relkind = 'p'$$,
  1, 'PART-222: audit_logs is a partitioned table');
-- Every partition of audit_logs must carry its own RLS flag (migration 241).
select pg_temp.expect_count(
  $$select count(*) from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'public.audit_logs'::regclass
       and not c.relrowsecurity$$,
  0, 'PART-241: every audit_logs partition has RLS enabled');
-- META (would have caught PART-241 at CI time, and catches every future
-- table or partition added without RLS): no ordinary or partitioned table
-- in public may lack row level security.
select pg_temp.expect_count(
  $$select count(*) from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity$$,
  0, 'META: every table in schema public has row level security enabled');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$insert into public.audit_logs (facility_id, action, entity_type)
    values ('22222222-2222-2222-2222-222222222222', 'part.probe', 'employees')$$,
  'PART-222: cross-facility INSERT still blocked on the partitioned table');
-- Direct-partition reads are fully closed to authenticated (revoke + RLS).
-- Facility B's audit rows live in the current-year partition and the default
-- partition is the catch-all — neither may be readable by naming it directly.
select pg_temp.expect_error(
  $$select count(*) from public.audit_logs_y2026$$,
  'PART-241: direct SELECT on a yearly partition is denied');
select pg_temp.expect_error(
  $$select count(*) from public.audit_logs_default$$,
  'PART-241: direct SELECT on the default partition is denied');
reset role;
-- anon has no privilege on audit_logs at all (migration 241 revoked the only
-- anon table grant in the schema, from 222).
set local role anon;
select pg_temp.expect_error(
  $$select count(*) from public.audit_logs$$,
  'PART-241: anon cannot SELECT audit_logs');
reset role;

-- Cron sweep (migration 218): verify_all_audit_chains verifies every facility
-- and reports breaks. Its service-role/super-admin negative gate can't be
-- exercised here — like drain_notification_outbox (M5 above), the gate keys
-- on session_user, which SET ROLE doesn't change (it stays postgres in this
-- harness); the EXECUTE revoke + the CRON_SECRET route are the real gate.
-- Positive coverage:
set local role service_role;
select pg_temp.expect_count(
  $$select count(*) from (select public.verify_all_audit_chains() as r) x
    where (x.r->>'ok') = 'true'
      and (x.r->>'checked_facilities')::int >= 2$$,
  1, 'I2-cron: service_role sweep verifies every facility clean');
-- A bypass-level tamper is caught by the sweep too (not just the per-facility
-- verifier). Set the append-only bypass, corrupt a row, sweep, then heal.
select set_config('rr.audit_chain_bypass', 'on', true);
update public.audit_logs
   set after = after || '{"__swept":true}'::jsonb
 where id = (
   select id from public.audit_logs
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and after is not null
    order by seq desc limit 1);
select set_config('rr.audit_chain_bypass', '', true);
select pg_temp.expect_count(
  $$select count(*) from (select public.verify_all_audit_chains() as r) x
    where (x.r->>'ok') = 'false'
      and jsonb_array_length(x.r->'broken') = 1
      and (x.r->'broken'->0->>'facility_id') = '11111111-1111-1111-1111-111111111111'$$,
  1, 'I2-cron: the sweep flags the tampered facility (and only it)');
select set_config('rr.audit_chain_bypass', 'on', true);
update public.audit_logs
   set after = after - '__swept'
 where facility_id = '11111111-1111-1111-1111-111111111111'
   and after ? '__swept';
select set_config('rr.audit_chain_bypass', '', true);
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

-- ---------------------------------------------------------------------------
-- Cert expiry is measured against the SHIFT, not against today (migration 209).
--
-- The assertion immediately above seeds expires_at = '2020-01-01'. A 2020 expiry
-- precedes every future shift date, so it passes whether expiry is compared to
-- current_date or to the shift — it looks like coverage of the expiry rule but
-- discriminates nothing. The three cases below are the ones that actually pin
-- the behaviour. Dana holds a CPR expiring in 7 days.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

insert into public.employees (id, facility_id, user_id, first_name, last_name, role_id, is_active)
select 'aaaa1111-da7a-aaaa-aaaa-aaaa11110077',
       '11111111-1111-1111-1111-111111111111',
       null, 'Dana', 'Expiry',
       (select id from public.roles
         where facility_id = '11111111-1111-1111-1111-111111111111'
           and key = 'staff' limit 1),
       true
on conflict (id) do nothing;

insert into public.employee_certifications (facility_id, employee_id, name, expires_at)
values ('11111111-1111-1111-1111-111111111111',
        'aaaa1111-da7a-aaaa-aaaa-aaaa11110077', 'CPR',
        (now() + interval '7 days')::date)
on conflict do nothing;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

-- (a) THE BUG. Shift is 21 days out; the cert lapses in 7. Comparing against
--     current_date wrongly passes this. Fails before migration 209.
select pg_temp.expect_count(
  $$select count(*) from (
      select unnest(public.scheduling_assignment_violations(
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-da7a-aaaa-aaaa-aaaa11110077',
        now() + interval '21 days', now() + interval '21 days 4 hours', 0,
        'aaaa1111-30b1-aaaa-aaaa-aaaa11110098', null)) as code
    ) c where code = 'cert_missing:CPR'$$,
  1, 'SCHED-209: cert expiring BEFORE the shift date hard-blocks');

-- (b) The negative case, so the rule cannot be satisfied by blanket-blocking
--     every cert that carries an expiry date at all.
select pg_temp.expect_count(
  $$select count(*) from (
      select unnest(public.scheduling_assignment_violations(
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-da7a-aaaa-aaaa-aaaa11110077',
        now() + interval '3 days', now() + interval '3 days 4 hours', 0,
        'aaaa1111-30b1-aaaa-aaaa-aaaa11110098', null)) as code
    ) c where code = 'cert_missing:CPR'$$,
  0, 'SCHED-209: cert still valid on the shift date does NOT block');

-- (c) The boundary. A shift STRADDLING the expiry blocks, because the predicate
--     keys off the shift END. This is the deliberate product decision recorded
--     in migration 209's header; if anyone "simplifies" it back to the shift
--     start, this assertion is what fails.
select pg_temp.expect_count(
  $$select count(*) from (
      select unnest(public.scheduling_assignment_violations(
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-da7a-aaaa-aaaa-aaaa11110077',
        (now() + interval '7 days')::date - interval '4 hours',
        (now() + interval '7 days')::date + interval '30 hours', 0,
        'aaaa1111-30b1-aaaa-aaaa-aaaa11110098', null)) as code
    ) c where code = 'cert_missing:CPR'$$,
  1, 'SCHED-209: cert lapsing MID-SHIFT hard-blocks (measured at shift end)');

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

-- Publish-lock: direct UPDATE / DELETE of a published shift is blocked.
-- Since migration 256 the RLS USING fence (status <> 'published') scopes
-- published rows out of direct writes BEFORE the trigger can fire, so the
-- statement runs and affects 0 rows (same semantics as a cross-facility
-- write) instead of raising — assert the row is untouched.
select pg_temp.expect_ok(
  $$update public.schedule_shifts set notes = 'tampered'
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'$$,
  'SCHED-148: direct UPDATE of a published shift runs but RLS scopes it to 0 rows');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092' and notes = 'tampered'$$,
  0, 'SCHED-148: the published shift was NOT modified by the direct UPDATE');
select pg_temp.expect_ok(
  $$delete from public.schedule_shifts
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'$$,
  'SCHED-148: direct DELETE of a published shift runs but RLS scopes it to 0 rows');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'$$,
  1, 'SCHED-148: the published shift was NOT deleted by the direct DELETE');
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
-- Since migration 256 the RLS fence scopes the published row away before the
-- trigger fires: the drag-move runs, affects 0 rows, and the shift stays where
-- SCHED-149's governed republish-edit put it (now() + 1 day).
select pg_temp.expect_ok(
  $$update public.schedule_shifts
       set starts_at = now() + interval '5 days',
           ends_at   = now() + interval '5 days 4 hours'
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'$$,
  'SCHED-DND: direct drag-move of a PUBLISHED shift runs but RLS scopes it to 0 rows');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5511-aaaa-aaaa-aaaa11110092'
       and starts_at > now() + interval '4 days'$$,
  0, 'SCHED-DND: the published shift was NOT relocated by the direct drag-move');
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

-- ---------------------------------------------------------------------------
-- Publish-lock RLS backstop (migration 256) — PLRB-256.
--
-- 256 made the schedule_shifts write policies status-aware, so the lock no
-- longer rests on trg_schedule_shifts_publish_lock alone. Three regressions
-- pinned here, all as Carol (an AUTHORIZED scheduling admin):
--   1. Setting the trigger's bypass GUC (rr.publish_lock_bypass) as an
--      authenticated role must change NOTHING — migration 226 role-gated the
--      GUC arm, and the 245 RLS fence holds independently of the trigger.
--      Until now that gate had no test: reverting 226 failed nothing.
--   2. A cancelled shift cannot be flipped straight to published.
--   3. A publish REQUEST cannot be decided 'published' by direct PATCH —
--      only 'rejected'. Approvals must run scheduling_approve_publish_request
--      (re-validation, publish-events audit row, open-shift seeding,
--      notifications); a direct decision used to silently skip all of it.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.schedule_shifts (id, facility_id, department_id, starts_at, ends_at, status)
values ('aaaa1111-5515-aaaa-aaaa-aaaa11110245',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
        now() + interval '100 days', now() + interval '100 days 4 hours', 'draft')
on conflict (id) do nothing;
insert into public.schedule_publish_requests (
  id, facility_id, requested_by_employee_id, range_starts_at, range_ends_at, status
) values ('aaaa1111-5812-aaaa-aaaa-aaaa11110245',
          '11111111-1111-1111-1111-111111111111',
          'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          now() + interval '99 days', now() + interval '101 days', 'pending')
on conflict (id) do nothing;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

-- 1. The bypass GUC is inert for authenticated callers: every leg of the lock
--    holds exactly as it does without it.
select set_config('rr.publish_lock_bypass', 'on', true);
select pg_temp.expect_error(
  $$insert into public.schedule_shifts
      (facility_id, department_id, starts_at, ends_at, status)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
            now() + interval '102 days', now() + interval '102 days 4 hours',
            'published')$$,
  'PLRB-256: INSERT of a published shift still rejected with the bypass GUC set');
select pg_temp.expect_error(
  $$update public.schedule_shifts set status = 'published'
     where id = 'aaaa1111-5515-aaaa-aaaa-aaaa11110245'$$,
  'PLRB-256: draft->published flip still rejected with the bypass GUC set');
select pg_temp.expect_ok(
  $$update public.schedule_shifts set notes = 'guc-tamper'
     where id = 'aaaa1111-5514-aaaa-aaaa-aaaa11110181'$$,
  'PLRB-256: published-row UPDATE with the bypass GUC set still scopes to 0 rows');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5514-aaaa-aaaa-aaaa11110181' and notes = 'guc-tamper'$$,
  0, 'PLRB-256: the published shift is untouched despite the bypass GUC');
select set_config('rr.publish_lock_bypass', '', true);

-- 2. A cancelled shift cannot be re-published by direct UPDATE (the WITH
--    CHECK fence rejects any row landing in status=published).
select pg_temp.expect_error(
  $$update public.schedule_shifts set status = 'published'
     where id = 'aaaa1111-5513-aaaa-aaaa-aaaa11110094'$$,
  'PLRB-256: cancelled->published direct flip is rejected');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5513-aaaa-aaaa-aaaa11110094' and status = 'cancelled'$$,
  1, 'PLRB-256: the cancelled shift is still cancelled');

-- 3. Publish requests: a decider cannot mark a request published directly —
--    only the governed RPC may — but recording a rejection still works.
select pg_temp.expect_error(
  $$update public.schedule_publish_requests
       set status = 'published',
           decided_by_employee_id = 'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
           decided_at = now()
     where id = 'aaaa1111-5812-aaaa-aaaa-aaaa11110245'$$,
  'PLRB-256: direct PATCH of a publish request to published is rejected');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_publish_requests
     where id = 'aaaa1111-5812-aaaa-aaaa-aaaa11110245' and status = 'pending'$$,
  1, 'PLRB-256: the publish request is still pending after the rejected PATCH');
select pg_temp.expect_ok(
  $$update public.schedule_publish_requests
       set status = 'rejected',
           decided_by_employee_id = 'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
           decided_at = now()
     where id = 'aaaa1111-5812-aaaa-aaaa-aaaa11110245'$$,
  'PLRB-256: a decider can still record a REJECTION by direct update');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_publish_requests
     where id = 'aaaa1111-5812-aaaa-aaaa-aaaa11110245' and status = 'rejected'
       and decided_by_employee_id = 'aaaa1111-ca01-aaaa-aaaa-aaaa11110099'$$,
  1, 'PLRB-256: the rejection landed with the decider stamped');
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
-- SCHED-188: recurring series facility fence (migration 190, formerly numbered 188).
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
-- Dasher Boards (module #11): facility isolation, permission tiers, and the
-- completed-walk immutability lock (migrations 191–194).
--
-- The lock is asserted at BOTH layers (the Employee Scheduling lesson):
--   * RLS: an authenticated caller's UPDATE on a completed walk matches 0 rows.
--   * Trigger: even a BYPASSRLS role (direct SQL) gets an exception.
-- ---------------------------------------------------------------------------
set local role postgres;

-- The fixture facilities were inserted AFTER migration 194 applied, so the
-- facilities AFTER INSERT trigger must have seeded the module's config.
-- 6 = the 4 door subtypes from migration 194 plus Penalty + Emergency added
-- when migration 257 completed the standard gate taxonomy.
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_asset_subtypes
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and asset_type = 'door'$$,
  6, 'DB0a: facilities trigger seeded 6 door subtypes for a new facility');

-- 35 = the 20 repair categories from migration 194 plus the cleaning set added
-- when migration 204 redefined the seed function (3x "Needs cleaning",
-- "Film/residue", "Debris/buildup"), plus the corner_radius (5) and post_gap
-- (3) sets added by migration 257, plus "Hardware tightening" (board) and
-- "Replacement" (glass) from migration 261. The 204 expectation was left at
-- 20 when it landed, which made the whole suite red on main from 2026-07-24
-- onward — update this count in the SAME PR as any seed change.
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_issue_categories
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  35, 'DB0b: facilities trigger seeded 35 issue categories for a new facility');

select pg_temp.expect_count(
  $$select count(*) from public.facility_modules
    where module_key = 'dasher_boards'
      and facility_id in ('11111111-1111-1111-1111-111111111111',
                          '22222222-2222-2222-2222-222222222222')$$,
  2, 'DB0c: dasher_boards is enabled in facility_modules for new facilities');

-- Rinks, assets, checklist items, and walks in both facilities.
insert into public.dasher_boards_rinks (id, facility_id, name, slug) values
  ('dab0000a-0000-4000-8000-00000000000a',
   '11111111-1111-1111-1111-111111111111', 'Rink A', 'rink-a'),
  ('dab0000b-0000-4000-8000-00000000000b',
   '22222222-2222-2222-2222-222222222222', 'Rink B', 'rink-b');

insert into public.dasher_boards_assets
  (id, facility_id, rink_id, asset_type, label, sequence_position) values
  ('dabb000a-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'board_panel', 'B1', 1),
  ('dabb000b-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'dab0000b-0000-4000-8000-00000000000b', 'board_panel', 'B1', 1);

insert into public.dasher_boards_assets
  (id, facility_id, rink_id, asset_type, label, parent_board_id) values
  ('dabb000a-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'glass_panel', 'G1',
   'dabb000a-0000-4000-8000-000000000001');

insert into public.dasher_boards_checklist_items
  (id, facility_id, rink_id, label, cadence) values
  ('dabc000a-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'Weekly torque check', 'weekly'),
  ('dabc000b-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'dab0000b-0000-4000-8000-00000000000b', 'Weekly torque check', 'weekly');

-- Bob's open issue in facility B (the cross-facility read target).
insert into public.dasher_boards_issues
  (id, facility_id, rink_id, asset_id, description, severity, reported_by) values
  ('dabb000b-0000-4000-8000-000000000010',
   '22222222-2222-2222-2222-222222222222',
   'dab0000b-0000-4000-8000-00000000000b',
   'dabb000b-0000-4000-8000-000000000001',
   'Cracked facing', 'b', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Walks: alice has one OPEN and one COMPLETED walk on rink A; bob has a
-- completed walk on rink B.
insert into public.dasher_boards_inspections
  (id, facility_id, rink_id, inspector_id, started_at, completed_at) values
  ('dabd000a-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '1 hour', null),
  ('dabd000a-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() - interval '1 day', now() - interval '23 hours'),
  ('dabd000b-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'dab0000b-0000-4000-8000-00000000000b',
   'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   now() - interval '1 day', now() - interval '23 hours');

-- Alice: view + submit on dasher_boards (deliberately NOT edit, NOT admin).
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
select
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'dasher_boards', a::public.user_action, true
from unnest(array['view', 'submit']) as a
on conflict (user_id, facility_id, module_name, action) do nothing;

-- Impersonate Alice (staff-tier: view+submit).
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_rinks
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'DB1: alice CAN read her own facility''s dasher rinks');

select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_rinks
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DB2: alice CANNOT read facility B''s dasher rinks');

select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_assets
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DB3: alice CANNOT read facility B''s perimeter assets');

select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_issues
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DB4: alice CANNOT read facility B''s issues');

select pg_temp.expect_count(
  $$select (case when public.has_module_submit_access('dasher_boards') then 1 else 0 end)
        + (case when public.has_module_edit_access('dasher_boards') then 0 else 10 end)
        + (case when public.has_module_admin_access('dasher_boards') then 0 else 100 end)$$,
  111, 'DB5: helper tiers — alice has submit but NOT edit and NOT admin');

select pg_temp.expect_error(
  $$insert into public.dasher_boards_rinks (facility_id, name, slug)
    values ('11111111-1111-1111-1111-111111111111', 'Rogue Rink', 'rogue-rink')$$,
  'DB6: alice (no admin grant) CANNOT create a rink');

select pg_temp.expect_count(
  $$with u as (
      update public.dasher_boards_assets
         set label = 'HACKED'
       where id = 'dabb000a-0000-4000-8000-000000000001'
       returning 1)
    select count(*) from u$$,
  0, 'DB7: alice (no admin grant) CANNOT edit perimeter assets (0 rows match)');

select pg_temp.expect_ok(
  $$insert into public.dasher_boards_issues
      (id, facility_id, rink_id, asset_id, description, severity, reported_by)
    values
      ('dabb000a-0000-4000-8000-000000000020',
       '11111111-1111-1111-1111-111111111111',
       'dab0000a-0000-4000-8000-00000000000a',
       'dabb000a-0000-4000-8000-000000000001',
       'Loose kickplate', 'b', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'DB8: alice (submit grant) CAN report an issue as herself');

select pg_temp.expect_error(
  $$insert into public.dasher_boards_issues
      (facility_id, rink_id, asset_id, description, severity, reported_by)
    values
      ('11111111-1111-1111-1111-111111111111',
       'dab0000a-0000-4000-8000-00000000000a',
       'dabb000a-0000-4000-8000-000000000001',
       'Spoofed reporter', 'b', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'DB9: alice CANNOT report an issue as someone else');

select pg_temp.expect_error(
  $$insert into public.dasher_boards_issues
      (facility_id, rink_id, asset_id, description, severity, reported_by)
    values
      ('11111111-1111-1111-1111-111111111111',
       'dab0000a-0000-4000-8000-00000000000a',
       'dabb000a-0000-4000-8000-000000000001',
       'Severity A no supervisor', 'a', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'DB10: a severity-A issue without a supervisor is rejected (check constraint)');

select pg_temp.expect_ok(
  $$update public.dasher_boards_issues
       set description = 'Loose kickplate (left corner)'
     where id = 'dabb000a-0000-4000-8000-000000000020'$$,
  'DB11: alice CAN edit the description of her own unresolved issue');

select pg_temp.expect_error(
  $$update public.dasher_boards_issues
       set supervisor_ack_at = now()
     where id = 'dabb000a-0000-4000-8000-000000000020'$$,
  'DB12: alice (no edit grant) CANNOT acknowledge — ack fields are guarded');

select pg_temp.expect_count(
  $$with u as (
      update public.dasher_boards_inspections
         set notes = 'tampered'
       where id = 'dabd000a-0000-4000-8000-000000000002'
       returning 1)
    select count(*) from u$$,
  0, 'DB13: RLS layer — alice''s UPDATE on her COMPLETED walk matches 0 rows');

select pg_temp.expect_ok(
  $$insert into public.dasher_boards_checklist_responses
      (facility_id, inspection_id, item_id, status)
    values
      ('11111111-1111-1111-1111-111111111111',
       'dabd000a-0000-4000-8000-000000000001',
       'dabc000a-0000-4000-8000-000000000001', 'pass')$$,
  'DB14: alice CAN answer a checklist item on her OPEN walk');

select pg_temp.expect_error(
  $$insert into public.dasher_boards_checklist_responses
      (facility_id, inspection_id, item_id, status)
    values
      ('11111111-1111-1111-1111-111111111111',
       'dabd000a-0000-4000-8000-000000000002',
       'dabc000a-0000-4000-8000-000000000001', 'pass')$$,
  'DB15: alice CANNOT answer against her COMPLETED walk');

select pg_temp.expect_error(
  $$insert into public.dasher_boards_inspections (facility_id, rink_id, inspector_id)
    values ('22222222-2222-2222-2222-222222222222',
            'dab0000b-0000-4000-8000-00000000000b',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'DB16: alice CANNOT start a walk on facility B''s rink');

select pg_temp.expect_ok(
  $$update public.dasher_boards_inspections
       set completed_at = now()
     where id = 'dabd000a-0000-4000-8000-000000000001'$$,
  'DB17: alice CAN complete her own open walk');

select pg_temp.expect_count(
  $$with u as (
      update public.dasher_boards_inspections
         set completed_at = null
       where id = 'dabd000a-0000-4000-8000-000000000001'
       returning 1)
    select count(*) from u$$,
  0, 'DB18: RLS layer — the just-completed walk cannot be re-opened by alice');

-- Trigger layer: even a BYPASSRLS role issuing direct SQL is rejected.
set local role postgres;

select pg_temp.expect_error(
  $$update public.dasher_boards_inspections
       set notes = 'tampered via direct SQL'
     where id = 'dabd000b-0000-4000-8000-000000000001'$$,
  'DB19: trigger layer — direct-SQL UPDATE of a completed walk raises');

select pg_temp.expect_error(
  $$delete from public.dasher_boards_inspections
     where id = 'dabd000b-0000-4000-8000-000000000001'$$,
  'DB20: trigger layer — direct-SQL DELETE of a completed walk raises');

select pg_temp.expect_error(
  $$update public.dasher_boards_checklist_responses
       set status = 'flag'
     where inspection_id = 'dabd000a-0000-4000-8000-000000000001'$$,
  'DB21: trigger layer — responses under a completed walk are immutable');

-- These admin-tier asset corrections run in a trusted/service context (the
-- suite simulates it via the postgres BYPASSRLS role). Flip the guard's
-- documented service bypass so the BEFORE UPDATE dasher_boards_assets_guard
-- (migration 202) treats them as exempt — the same way a super_admin/service
-- caller is exempt — rather than applying the edit-tier column freeze that
-- (correctly) restricts managers below (DB30+).
set local rr.dasher_boards_guard_bypass = 'on';

-- Label permanence: relabel retires the old label forever.
select pg_temp.expect_ok(
  $$update public.dasher_boards_assets
       set label = 'B1X'
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DB22a: relabeling an asset succeeds (admin-tier operation)');

select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_retired_labels
    where rink_id = 'dab0000a-0000-4000-8000-00000000000a'
      and label = 'B1'$$,
  1, 'DB22b: the old label was auto-recorded as retired');

select pg_temp.expect_error(
  $$insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, label, sequence_position)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a', 'board_panel', 'B1', 2)$$,
  'DB22c: a retired label can never be reused on the rink');

-- Panel-spec generalization (migration 257): board panels now ACCEPT the
-- panel spec (the former glass-only restriction was deliberately dropped so
-- any segment can carry material/dimensions), and the material domain gained
-- hdpe/other while keeping the original three values.
select pg_temp.expect_ok(
  $$update public.dasher_boards_assets
       set glass_width_in = 48, glass_material = 'hdpe'
     where id = 'dabb000b-0000-4000-8000-000000000001'$$,
  'DB23a: board_panel rows accept panel spec writes (migration 257)');

select pg_temp.expect_error(
  $$update public.dasher_boards_assets
       set glass_material = 'plywood'
     where id = 'dabb000b-0000-4000-8000-000000000001'$$,
  'DB23b: material domain still rejects values outside the widened list');

-- End of the trusted-context asset corrections; restore normal guard
-- enforcement for the edit-tier assertions below.
set local rr.dasher_boards_guard_bypass = 'off';

-- Hardening (migration 197): hard deletes retire labels too.
insert into public.dasher_boards_assets
  (id, facility_id, rink_id, asset_type, label, sequence_position) values
  ('dabb000a-0000-4000-8000-000000000077',
   '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'board_panel', 'B77', 77);
delete from public.dasher_boards_assets
  where id = 'dabb000a-0000-4000-8000-000000000077';

select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_retired_labels
    where rink_id = 'dab0000a-0000-4000-8000-00000000000a' and label = 'B77'$$,
  1, 'DB26a: a hard-deleted asset''s label is auto-retired');

select pg_temp.expect_error(
  $$insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, label, sequence_position)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a', 'board_panel', 'B77', 78)$$,
  'DB26b: a hard-deleted label can never be reused');

-- Hardening (migration 197): severity A requires action_taken AND supervisor.
select pg_temp.expect_error(
  $$insert into public.dasher_boards_issues
      (facility_id, rink_id, asset_id, description, severity, reported_by, supervisor_id)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a',
            'dabb000a-0000-4000-8000-000000000001',
            'A with supervisor but no action taken', 'a',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'DB27: severity A without action_taken is rejected (check constraint)');

-- Hardening (migration 197): a reporter whose submit grant is revoked can no
-- longer edit their own open issues.
update public.user_permissions set enabled = false
 where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and module_name = 'dasher_boards' and action = 'submit';

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$with u as (
      update public.dasher_boards_issues
         set description = 'edited after revocation'
       where id = 'dabb000a-0000-4000-8000-000000000020'
       returning 1)
    select count(*) from u$$,
  0, 'DB28: revoked reporter CANNOT edit their own open issue (0 rows)');

set local role postgres;
update public.user_permissions set enabled = true
 where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and module_name = 'dasher_boards' and action = 'submit';

-- SECURITY INVOKER RPCs (migration 195): the caller's RLS gates apply inside.
-- An EMPTY rink in alice's facility isolates the RLS insert gate — on a
-- populated rink the RPC would reject for the wrong reason (assets exist).
insert into public.dasher_boards_rinks (id, facility_id, name, slug) values
  ('dab0000c-0000-4000-8000-00000000000c',
   '11111111-1111-1111-1111-111111111111', 'Rink A2', 'rink-a2');

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.dasher_boards_generate_perimeter(
      'dab0000c-0000-4000-8000-00000000000c', 5)$$,
  'DB24: alice (no admin grant) CANNOT generate a perimeter via the RPC');

select pg_temp.expect_count(
  $$select public.dasher_boards_shift_positions(
      'dab0000a-0000-4000-8000-00000000000a', 1, 1)$$,
  0, 'DB25: alice (no admin grant) shift RPC is a 0-row no-op under RLS');

-- Seed helper is internal-only (service_role); no client role may call it
-- directly via RPC (migration 194's revoke was public-only and missed
-- anon/authenticated — closed in migration 201; regression probe here so it
-- can't silently reopen).
select pg_temp.expect_error(
  $$select public.seed_default_dasher_boards_config('11111111-1111-1111-1111-111111111111')$$,
  'DB29: authenticated CANNOT execute seed_default_dasher_boards_config');
set local role anon;
select pg_temp.expect_error(
  $$select public.seed_default_dasher_boards_config('11111111-1111-1111-1111-111111111111')$$,
  'DB29: anon CANNOT execute seed_default_dasher_boards_config');

-- ---------------------------------------------------------------------------
-- DB30–33: edit-tier (manager) spec writes (migration 202).
--
-- Managers hold the dasher_boards `edit` grant (canonical_role_permission_grants,
-- migration 198). They may set the glass replacement spec on a glass/door row,
-- but NOT any structural/identity column, and cannot insert/delete assets.
-- Enforced by the admin-OR-edit UPDATE policy + the dasher_boards_assets_guard
-- column freeze. mona is the facility-A manager persona.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
select 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'dasher_boards', a::public.user_action, true
from unnest(array['view', 'submit', 'edit']) as a
on conflict (user_id, facility_id, module_name, action) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select (case when public.has_module_edit_access('dasher_boards') then 1 else 0 end)
        + (case when public.has_module_admin_access('dasher_boards') then 0 else 10 end)$$,
  11, 'DB30: helper tiers — mona has edit but NOT admin');

-- CAN set the glass replacement spec on a glass panel (the whole point).
select pg_temp.expect_ok(
  $$update public.dasher_boards_assets
       set glass_width_in = 68, glass_height_in = 72,
           glass_thickness_in = 0.625, glass_material = 'tempered',
           spec_notes = 'set by manager'
     where id = 'dabb000a-0000-4000-8000-000000000002'$$,
  'DB31: manager (edit) CAN set the glass replacement spec');

-- CANNOT change structural/identity columns — the column guard raises.
select pg_temp.expect_error(
  $$update public.dasher_boards_assets set label = 'B1Z'
     where id = 'dabb000a-0000-4000-8000-000000000002'$$,
  'DB32a: manager (edit) CANNOT relabel an asset (column guard)');
select pg_temp.expect_error(
  $$update public.dasher_boards_assets set is_active = false
     where id = 'dabb000a-0000-4000-8000-000000000002'$$,
  'DB32b: manager (edit) CANNOT toggle is_active (column guard)');

-- CANNOT insert or delete assets — those stay admin-only at the RLS layer.
select pg_temp.expect_error(
  $$insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, label, sequence_position)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a', 'board_panel', 'B88', 88)$$,
  'DB33a: manager (edit) CANNOT insert an asset');
select pg_temp.expect_count(
  $$with d as (
      delete from public.dasher_boards_assets
      where id = 'dabb000a-0000-4000-8000-000000000002' returning 1)
    select count(*) from d$$,
  0, 'DB33b: manager (edit) DELETE of an asset is a 0-row no-op under RLS');

-- Audit trail (migration 203 fix 12): a manager may write the spec_updated
-- event for their allowed spec write, but not forge a structural-change event.
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_asset_events (facility_id, asset_id, event_type)
    values ('11111111-1111-1111-1111-111111111111',
            'dabb000a-0000-4000-8000-000000000002', 'spec_updated')$$,
  'DB34a: manager (edit) CAN record a spec_updated audit event');
select pg_temp.expect_error(
  $$insert into public.dasher_boards_asset_events (facility_id, asset_id, event_type)
    values ('11111111-1111-1111-1111-111111111111',
            'dabb000a-0000-4000-8000-000000000002', 'relabeled')$$,
  'DB34b: manager (edit) CANNOT record a non-spec audit event');

set local role postgres;

-- Migration 203 integrity triggers/guards (fire for everyone; tested directly).
-- Fix 11: the degenerate downward shift from position 1 is rejected.
select pg_temp.expect_error(
  $$select public.dasher_boards_shift_positions(
      'dab0000a-0000-4000-8000-00000000000a', 1, -1)$$,
  'DB35: shift_positions rejects a shift that would settle a row at position 0');

-- Fix 10: a glass panel cannot parent a board in a DIFFERENT rink.
select pg_temp.expect_error(
  $$insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, label, parent_board_id)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a', 'glass_panel', 'GX',
            'dabb000b-0000-4000-8000-000000000001')$$,
  'DB36: glass parent must be a board panel in the same rink');

-- Fix 9: an issue cannot name a supervisor from another facility.
select pg_temp.expect_error(
  $$insert into public.dasher_boards_issues
      (facility_id, rink_id, asset_id, description, severity, supervisor_id)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a',
            'dabb000a-0000-4000-8000-000000000001', 'x', 'b',
            'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'DB37: issue supervisor must belong to the issue''s facility');

-- Fix 6: the offline idempotency key blocks a duplicate (rink, source_local_id).
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_issues
      (facility_id, rink_id, asset_id, description, severity, source_local_id)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a',
            'dabb000a-0000-4000-8000-000000000001', 'x', 'c',
            'dddddddd-0000-4000-8000-00000000d001')$$,
  'DB38a: first issue with a source_local_id inserts');
select pg_temp.expect_error(
  $$insert into public.dasher_boards_issues
      (facility_id, rink_id, asset_id, description, severity, source_local_id)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a',
            'dabb000a-0000-4000-8000-000000000001', 'y', 'c',
            'dddddddd-0000-4000-8000-00000000d001')$$,
  'DB38b: a duplicate (rink, source_local_id) is rejected');

-- ---------------------------------------------------------------------------
-- DB39-43: staff condition logging (migration 204).
-- Staff (submit) may mark B/C issues fixed and pick cleaning categories;
-- severity-A resolution stays supervisor-only, staff cannot acknowledge, and a
-- non-reporter cannot rewrite an issue's content.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.dasher_boards_issues
  (id, facility_id, rink_id, asset_id, description, severity, reported_by,
   supervisor_id, action_taken)
values
  ('dabf0001-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'dabb000a-0000-4000-8000-000000000001',
   'needs cleaning', 'c', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, null),
  ('dabf0002-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'dabb000a-0000-4000-8000-000000000001',
   'panel scuff', 'b', 'cccc3333-cccc-cccc-cccc-cccccccccccc', null, null),
  ('dabf0003-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'dabb000a-0000-4000-8000-000000000001',
   'sharp edge', 'a', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'cccc3333-cccc-cccc-cccc-cccccccccccc', 'taped the edge');

-- Cleaning categories are seeded per asset type (board/glass/door from
-- migration 204; corner_radius joined in migration 257).
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_issue_categories
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and label = 'Needs cleaning'$$,
  4, 'DB39: default cleaning categories seeded (board/glass/door/corner)');

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Staff CAN mark a B/C issue fixed.
select pg_temp.expect_ok(
  $$update public.dasher_boards_issues
       set resolved_by = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
           resolved_at = now()
     where id = 'dabf0001-0000-4000-8000-000000000001'$$,
  'DB40: staff (submit) CAN mark a C issue fixed');

-- Staff CANNOT resolve a severity-A issue (guard raises even on their own A).
select pg_temp.expect_error(
  $$update public.dasher_boards_issues
       set resolved_by = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
           resolved_at = now()
     where id = 'dabf0003-0000-4000-8000-000000000003'$$,
  'DB41: staff (submit) CANNOT resolve a severity-A issue');

-- Staff CANNOT acknowledge (set supervisor_ack_at), even on their own issue.
select pg_temp.expect_error(
  $$update public.dasher_boards_issues set supervisor_ack_at = now()
     where id = 'dabf0003-0000-4000-8000-000000000003'$$,
  'DB42: staff (submit) CANNOT acknowledge an issue');

-- A non-reporter staff CANNOT rewrite an issue's content (guard path 2).
select pg_temp.expect_error(
  $$update public.dasher_boards_issues set description = 'hijacked'
     where id = 'dabf0002-0000-4000-8000-000000000002'$$,
  'DB43: staff CANNOT edit the content of an issue they did not report');

-- ---------------------------------------------------------------------------
-- DB44-46: per-asset Pass/Fail checks (migration 205).
-- The walk's inspector (submit) records checks while the walk is open; a
-- non-owner cannot, and checks are immutable once the walk is completed.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.dasher_boards_inspections
  (id, facility_id, rink_id, inspector_id, started_at)
values
  ('dabf1001-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()),
  ('dabf1002-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'dab0000a-0000-4000-8000-00000000000a', 'cccc3333-cccc-cccc-cccc-cccccccccccc', now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Staff CAN record a check on their own open walk.
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_asset_checks
      (facility_id, inspection_id, asset_id, status, note, checked_by)
    values ('11111111-1111-1111-1111-111111111111',
            'dabf1001-0000-4000-8000-000000000001',
            'dabb000a-0000-4000-8000-000000000001', 'pass', 'looks good',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'DB44: staff CAN record a Pass/Fail check on their own open walk');

-- Staff CANNOT record a check on a walk they do not own.
select pg_temp.expect_error(
  $$insert into public.dasher_boards_asset_checks
      (facility_id, inspection_id, asset_id, status, checked_by)
    values ('11111111-1111-1111-1111-111111111111',
            'dabf1002-0000-4000-8000-000000000002',
            'dabb000a-0000-4000-8000-000000000001', 'pass',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'DB45: staff CANNOT record a check on a walk they do not own');

-- Complete the walk, then the check is frozen. Tested at the trigger layer via
-- direct SQL (postgres BYPASSRLS), mirroring DB21 — for a submit user the
-- completed walk simply falls out of the UPDATE policy (0 rows).
set local role postgres;
update public.dasher_boards_inspections
   set completed_at = now()
 where id = 'dabf1001-0000-4000-8000-000000000001';

select pg_temp.expect_error(
  $$update public.dasher_boards_asset_checks set status = 'fail'
     where inspection_id = 'dabf1001-0000-4000-8000-000000000001'
       and asset_id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DB46: trigger layer — asset checks are immutable once the walk is completed');

-- ---------------------------------------------------------------------------
-- DB47-51: glass DISPLAY numbering (migration 233).
--
-- The scheme lives on the rink; the per-panel override (display_number) lives
-- on the asset. Both are SETUP decisions, so both are admin-only: staff cannot
-- touch either, and the edit tier — which may write the glass replacement spec
-- — is frozen out of display_number by the assets column guard. The partial
-- unique index is what stops two panels claiming the same number.
--
-- Personas: alice = staff (view+submit, no admin); mona = manager (edit, no
-- admin); bob = facility B.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Defaults leave every existing rink numbering-OFF, so nothing that shipped
-- before this migration changes what it prints.
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_rinks
    where id = 'dab0000a-0000-4000-8000-00000000000a'
      and glass_numbering_enabled = false
      and glass_number_prefix = 'G'
      and glass_number_start = 1
      and glass_number_direction = 'follow_boards'
      and glass_number_anchor_offset is null
      and glass_number_include_doors$$,
  1, 'DB47: glass numbering defaults to OFF with the historical G/1 scheme');

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$with u as (
      update public.dasher_boards_rinks
         set glass_numbering_enabled = true, glass_number_prefix = 'X'
       where id = 'dab0000a-0000-4000-8000-00000000000a'
       returning 1)
    select count(*) from u$$,
  0, 'DB48a: staff (no admin grant) CANNOT change the rink numbering scheme');

select pg_temp.expect_count(
  $$with u as (
      update public.dasher_boards_assets
         set display_number = '99'
       where id = 'dabb000a-0000-4000-8000-000000000002'
       returning 1)
    select count(*) from u$$,
  0, 'DB48b: staff (no admin grant) CANNOT set a panel''s display number');

-- Cross-facility: facility B's session cannot renumber facility A's glass.
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);

select pg_temp.expect_count(
  $$with u as (
      update public.dasher_boards_rinks
         set glass_numbering_enabled = true
       where id = 'dab0000a-0000-4000-8000-00000000000a'
       returning 1)
    select count(*) from u$$,
  0, 'DB49a: facility B CANNOT change facility A''s numbering scheme');

select pg_temp.expect_count(
  $$with u as (
      update public.dasher_boards_assets
         set display_number = '99'
       where id = 'dabb000a-0000-4000-8000-000000000002'
       returning 1)
    select count(*) from u$$,
  0, 'DB49b: facility B CANNOT set a display number on facility A''s glass');

-- Edit tier (mona, granted `edit` back in DB30): the column guard must freeze
-- display_number the same way it freezes label/is_active. Without this the new
-- column would be silently writable — the guard enumerates what it blocks.
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_error(
  $$update public.dasher_boards_assets set display_number = '12A'
     where id = 'dabb000a-0000-4000-8000-000000000002'$$,
  'DB50a: manager (edit) CANNOT set a display number (column guard)');

select pg_temp.expect_error(
  $$insert into public.dasher_boards_asset_events (facility_id, asset_id, event_type)
    values ('11111111-1111-1111-1111-111111111111',
            'dabb000a-0000-4000-8000-000000000002', 'renumbered')$$,
  'DB50b: manager (edit) CANNOT record a renumbered audit event');

set local role postgres;

-- Two panels may never display the same number (partial unique index), while
-- NULL — "use the computed number" — stays repeatable across the whole rink.
set local rr.dasher_boards_guard_bypass = 'on';

select pg_temp.expect_ok(
  $$update public.dasher_boards_assets set display_number = '12A'
     where id = 'dabb000a-0000-4000-8000-000000000002'$$,
  'DB51a: admin-tier CAN set a panel''s display number');

select pg_temp.expect_error(
  $$update public.dasher_boards_assets set display_number = '12A'
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DB51b: a second panel CANNOT claim the same display number');

select pg_temp.expect_error(
  $$update public.dasher_boards_assets set display_number = ' bad/value!'
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DB51c: a malformed display number is rejected (check constraint)');

-- Clearing back to NULL is always allowed, on any number of panels.
select pg_temp.expect_ok(
  $$update public.dasher_boards_assets set display_number = null
     where rink_id = 'dab0000a-0000-4000-8000-00000000000a'$$,
  'DB51d: display numbers clear back to the computed scheme');

set local rr.dasher_boards_guard_bypass = 'off';

-- ---------------------------------------------------------------------------
-- OVR: rink-diagram overlays (migration 199; re-scoped to one rink per
-- marker/config by migration 206).
--
-- Door TYPES stay facility-level (shared naming/color vocabulary); door
-- MARKERS and the logo CONFIG now belong to one physical rink
-- (ice_depth_rinks) — a facility with multiple sheets of ice gets
-- independent door layouts per sheet. Any enabled ice_depth grant may READ
-- (own facility only); only module admins may WRITE. This section is the
-- standing regression probe required by the feature spec (same
-- authorization-at-UI-only failure class as the scheduling publish-lock
-- bypass): a plain staff session must be unable to write door types /
-- markers / config or touch the rink-logos storage bucket, via ANY direct
-- call path — PLUS the new per-rink isolation: a marker/config on one rink
-- must not appear when a query is scoped to a sibling rink in the SAME
-- facility.
--
-- Personas: alice = staff (ice_depth view+submit, NO admin). mona gains an
-- ice_depth admin grant HERE for the positive write assertions (her earlier
-- sections don't depend on her lacking it).
-- ---------------------------------------------------------------------------
set local role postgres;

-- The facilities AFTER INSERT trigger must have auto-seeded the four standard
-- door types for both fixture facilities.
select pg_temp.expect_count(
  $$select count(*) from public.facility_door_types
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  4, 'OVR: facility A auto-seeded 4 standard door types on creation');
select pg_temp.expect_count(
  $$select count(*) from public.facility_door_types
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  4, 'OVR: facility B auto-seeded 4 standard door types on creation');

-- A second rink in facility A (facility A already has "Main Rink A" from the
-- migration-83 fixture above) so per-rink isolation has a same-facility
-- sibling to test against — not just cross-facility isolation.
insert into public.ice_depth_rinks
  (id, facility_id, name, slug, sort_order, is_active, is_default)
values
  ('aaaa1111-dd02-aaaa-aaaa-aaaa11110063',
   '11111111-1111-1111-1111-111111111111', 'Oval Rink A', 'oval-rink', 1, true, false)
on conflict (facility_id, slug) do nothing;

-- Fixture: one marker + one config row on Main Rink A, plus a rink-logos
-- storage object per facility for the read-scoping check.
insert into public.facility_door_markers
  (id, facility_id, rink_id, door_type_id, label, position_x, position_y)
values
  ('aaaa1111-0d01-aaaa-aaaa-aaaa11110061',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-dddd-aaaa-aaaa-aaaa11110003',
   (select id from public.facility_door_types
     where facility_id = '11111111-1111-1111-1111-111111111111'
       and name = 'Zamboni Door'),
   'West Zamboni', 0.2, 0.1),
  ('bbbb2222-0d01-bbbb-bbbb-bbbb22220061',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-dddd-bbbb-bbbb-bbbb22220003',
   (select id from public.facility_door_types
     where facility_id = '22222222-2222-2222-2222-222222222222'
       and name = 'Zamboni Door'),
   'B Zamboni', 0.8, 0.9)
on conflict (id) do nothing;

insert into public.facility_rink_diagram_config (facility_id, rink_id, logo_storage_path)
values
  ('11111111-1111-1111-1111-111111111111',
   'aaaa1111-dddd-aaaa-aaaa-aaaa11110003',
   '11111111-1111-1111-1111-111111111111/rink-logo-a.png'),
  ('22222222-2222-2222-2222-222222222222',
   'bbbb2222-dddd-bbbb-bbbb-bbbb22220003',
   '22222222-2222-2222-2222-222222222222/rink-logo-b.png')
on conflict (rink_id) do nothing;

insert into storage.objects (bucket_id, name)
select 'rink-logos', v.name
from (values
  ('11111111-1111-1111-1111-111111111111/rink-logo-a.png'),
  ('22222222-2222-2222-2222-222222222222/rink-logo-b.png')
) as v(name)
where not exists (
  select 1 from storage.objects o
   where o.bucket_id = 'rink-logos' and o.name = v.name
);

-- Composite FK (door_type_id, facility_id): a marker can never reference a
-- door type belonging to another facility, even via a BYPASSRLS writer.
select pg_temp.expect_error(
  $$insert into public.facility_door_markers
      (facility_id, rink_id, door_type_id, position_x, position_y)
    values
      ('11111111-1111-1111-1111-111111111111',
       'aaaa1111-dddd-aaaa-aaaa-aaaa11110003',
       (select id from public.facility_door_types
         where facility_id = '22222222-2222-2222-2222-222222222222'
           and name = 'Access Door'),
       0.5, 0.5)$$,
  'OVR: composite FK rejects a marker pointing at a foreign facility''s door type');

-- Composite FK (rink_id, facility_id): a marker can never reference a RINK
-- belonging to another facility either — the new invariant from migration 206.
select pg_temp.expect_error(
  $$insert into public.facility_door_markers
      (facility_id, rink_id, door_type_id, position_x, position_y)
    values
      ('11111111-1111-1111-1111-111111111111',
       'bbbb2222-dddd-bbbb-bbbb-bbbb22220003',
       (select id from public.facility_door_types
         where facility_id = '11111111-1111-1111-1111-111111111111'
           and name = 'Access Door'),
       0.5, 0.5)$$,
  'OVR: composite FK rejects a marker pointing at a foreign facility''s rink');

-- Per-rink isolation, SAME facility: Main Rink A's marker/config must not
-- appear when a query is scoped to its sibling Oval Rink A — proves the
-- data model separates rinks, not just facilities.
select pg_temp.expect_count(
  $$select count(*) from public.facility_door_markers
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and rink_id = 'aaaa1111-dd02-aaaa-aaaa-aaaa11110063'$$,
  0, 'OVR: Main Rink A''s marker does NOT appear when scoped to sibling Oval Rink A');
select pg_temp.expect_count(
  $$select count(*) from public.facility_rink_diagram_config
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and rink_id = 'aaaa1111-dd02-aaaa-aaaa-aaaa11110063'$$,
  0, 'OVR: Main Rink A''s logo config does NOT appear when scoped to sibling Oval Rink A');

-- ---- alice (staff: view+submit, NO admin) ----------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Reads: own facility visible (report overlays render for staff)...
select pg_temp.expect_count(
  $$select count(*) from public.facility_door_types
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  4, 'OVR: staff alice CAN SELECT her own facility''s door types');
select pg_temp.expect_count(
  $$select count(*) from public.facility_door_markers
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and rink_id = 'aaaa1111-dddd-aaaa-aaaa-aaaa11110003'$$,
  1, 'OVR: staff alice CAN SELECT her own rink''s door markers');
select pg_temp.expect_count(
  $$select count(*) from public.facility_rink_diagram_config
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and rink_id = 'aaaa1111-dddd-aaaa-aaaa-aaaa11110003'$$,
  1, 'OVR: staff alice CAN SELECT her own rink''s diagram config');

-- ...foreign facility invisible.
select pg_temp.expect_count(
  $$select count(*) from public.facility_door_types
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'OVR: alice CANNOT SELECT facility-B door types');
select pg_temp.expect_count(
  $$select count(*) from public.facility_door_markers
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'OVR: alice CANNOT SELECT facility-B door markers');
select pg_temp.expect_count(
  $$select count(*) from public.facility_rink_diagram_config
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'OVR: alice CANNOT SELECT facility-B diagram config');

-- Writes: every path denied for staff — INSERTs raise...
select pg_temp.expect_error(
  $$insert into public.facility_door_types (facility_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Evil Door')$$,
  'OVR: staff alice CANNOT INSERT a door type (own facility)');
select pg_temp.expect_error(
  $$insert into public.facility_door_markers
      (facility_id, rink_id, door_type_id, position_x, position_y)
    values
      ('11111111-1111-1111-1111-111111111111',
       'aaaa1111-dddd-aaaa-aaaa-aaaa11110003',
       (select id from public.facility_door_types
         where facility_id = '11111111-1111-1111-1111-111111111111'
           and name = 'Access Door'),
       0.5, 0.5)$$,
  'OVR: staff alice CANNOT INSERT a door marker (own facility)');
select pg_temp.expect_error(
  $$insert into public.facility_rink_diagram_config (facility_id, rink_id)
    values
      ('11111111-1111-1111-1111-111111111111',
       'aaaa1111-dd02-aaaa-aaaa-aaaa11110063')$$,
  'OVR: staff alice CANNOT INSERT diagram config');

-- ...UPDATE / DELETE silently match zero rows.
select pg_temp.expect_count(
  $$with u as (
      update public.facility_door_markers set label = 'hacked'
      where id = 'aaaa1111-0d01-aaaa-aaaa-aaaa11110061'
      returning 1)
    select count(*) from u$$,
  0, 'OVR: staff alice UPDATE of a door marker matches 0 rows');
select pg_temp.expect_count(
  $$with u as (
      update public.facility_rink_diagram_config set logo_visible = false
      where rink_id = 'aaaa1111-dddd-aaaa-aaaa-aaaa11110003'
      returning 1)
    select count(*) from u$$,
  0, 'OVR: staff alice UPDATE of diagram config matches 0 rows');
select pg_temp.expect_count(
  $$with d as (
      delete from public.facility_door_markers
      where id = 'aaaa1111-0d01-aaaa-aaaa-aaaa11110061'
      returning 1)
    select count(*) from d$$,
  0, 'OVR: staff alice DELETE of a door marker matches 0 rows');

-- Storage: reads are path-scoped to the caller's facility; writes are
-- service-role only (staff cannot upload/overwrite the logo object).
select pg_temp.expect_count(
  $$select count(*) from storage.objects
    where bucket_id = 'rink-logos'
      and name = '11111111-1111-1111-1111-111111111111/rink-logo-a.png'$$,
  1, 'OVR: alice CAN read her own facility''s rink-logo object row');
select pg_temp.expect_count(
  $$select count(*) from storage.objects
    where bucket_id = 'rink-logos'
      and name = '22222222-2222-2222-2222-222222222222/rink-logo-b.png'$$,
  0, 'OVR: alice CANNOT read facility-B''s rink-logo object row');
select pg_temp.expect_error(
  $$insert into storage.objects (bucket_id, name)
    values ('rink-logos',
            '11111111-1111-1111-1111-111111111111/evil.png')$$,
  'OVR: staff alice CANNOT INSERT into the rink-logos bucket');
select pg_temp.expect_count(
  $$with d as (
      delete from storage.objects
      where bucket_id = 'rink-logos'
        and name = '11111111-1111-1111-1111-111111111111/rink-logo-a.png'
      returning 1)
    select count(*) from d$$,
  0, 'OVR: staff alice DELETE of a rink-logo object matches 0 rows');

-- Seed helper is internal-only (service_role); no client role may call it.
select pg_temp.expect_error(
  $$select public.seed_default_door_types('11111111-1111-1111-1111-111111111111')$$,
  'OVR: authenticated CANNOT execute seed_default_door_types');
set local role anon;
select pg_temp.expect_error(
  $$select public.seed_default_door_types('11111111-1111-1111-1111-111111111111')$$,
  'OVR: anon CANNOT execute seed_default_door_types');

-- ---- mona (module admin): the write gate opens with the admin grant,
-- across EITHER of her facility's rinks -------------------------------------
set local role postgres;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111',
        'ice_depth', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$with i as (
      insert into public.facility_door_markers
        (facility_id, rink_id, door_type_id, position_x, position_y)
      values
        ('11111111-1111-1111-1111-111111111111',
         'aaaa1111-dddd-aaaa-aaaa-aaaa11110003',
         (select id from public.facility_door_types
           where facility_id = '11111111-1111-1111-1111-111111111111'
             and name = 'Player Gate'),
         0.4, 0.6)
      returning 1)
    select count(*) from i$$,
  1, 'OVR: module-admin mona CAN INSERT a door marker on Main Rink A');
select pg_temp.expect_count(
  $$with i as (
      insert into public.facility_door_markers
        (facility_id, rink_id, door_type_id, position_x, position_y)
      values
        ('11111111-1111-1111-1111-111111111111',
         'aaaa1111-dd02-aaaa-aaaa-aaaa11110063',
         (select id from public.facility_door_types
           where facility_id = '11111111-1111-1111-1111-111111111111'
             and name = 'Player Gate'),
         0.3, 0.3)
      returning 1)
    select count(*) from i$$,
  1, 'OVR: module-admin mona CAN INSERT a door marker on the sibling Oval Rink A too');
select pg_temp.expect_count(
  $$with u as (
      update public.facility_rink_diagram_config set logo_opacity = 0.2
      where rink_id = 'aaaa1111-dddd-aaaa-aaaa-aaaa11110003'
      returning 1)
    select count(*) from u$$,
  1, 'OVR: module-admin mona CAN UPDATE diagram config on her rink');
select pg_temp.expect_error(
  $$insert into public.facility_door_markers
      (facility_id, rink_id, door_type_id, position_x, position_y)
    values
      ('22222222-2222-2222-2222-222222222222',
       'bbbb2222-dddd-bbbb-bbbb-bbbb22220003',
       (select id from public.facility_door_types
         where facility_id = '22222222-2222-2222-2222-222222222222'
           and name = 'Player Gate'),
       0.4, 0.6)$$,
  'OVR: module-admin mona CANNOT INSERT a door marker into facility B''s rink');

set local role postgres;

-- ---------------------------------------------------------------------------
-- 2W. One violation policy for every scheduling door (migration 211).
--
-- Cert gaps (cert_missing:*) block every write path unconditionally;
-- advisory codes (overtime, time-off, overlap, …) block only when
-- schedule_settings.block_on_violations is on — the SAME policy the
-- app-layer grid gate applies. Before migration 211 the governed RPCs
-- (publish, open-shift assign, claim decide, swap, self-claim) blocked on
-- ANY code, so a draft that was legal to save (warn-and-confirm) made the
-- whole week unpublishable. These probes exercise the policy helper directly
-- and the publish RPC end-to-end, at the DB boundary.
--
-- Fixtures reuse §2Q's cast: Alice (staff, employee aaaa…aaaa, holds no CPR)
-- and Carol (scheduling admin, employee aaaa1111-ca01-…-0099, approver).
-- Zamboni job area aaaa1111-30b1-…-0098 requires CPR (SCHED-148 fixtures).
-- Windows sit 100+ days out so nothing else collides.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Approved time-off for Alice covering windows W1 (+100d) and W3 (+110d).
insert into public.schedule_time_off_requests
  (id, facility_id, employee_id, starts_at, ends_at, status)
values
  ('aaaa1111-7011-aaaa-aaaa-aaaa11110211',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '100 days', now() + interval '101 days', 'approved'),
  ('aaaa1111-7012-aaaa-aaaa-aaaa11110211',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '110 days', now() + interval '111 days', 'approved')
on conflict (id) do nothing;

-- W1: assigned draft over Alice's time-off (advisory only — no job area).
-- W2 (+105d): assigned draft on the CPR-requiring Zamboni area (cert gap).
-- W3: same shape as W1, used for the toggle-ON probe.
insert into public.schedule_shifts
  (id, facility_id, department_id, job_area_id, employee_id, starts_at, ends_at, status)
values
  ('aaaa1111-5521-aaaa-aaaa-aaaa11110211',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-de71-aaaa-aaaa-aaaa11110091', null,
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '100 days 2 hours', now() + interval '100 days 6 hours', 'draft'),
  ('aaaa1111-5522-aaaa-aaaa-aaaa11110211',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
   'aaaa1111-30b1-aaaa-aaaa-aaaa11110098',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '105 days 2 hours', now() + interval '105 days 6 hours', 'draft'),
  ('aaaa1111-5523-aaaa-aaaa-aaaa11110211',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-de71-aaaa-aaaa-aaaa11110091', null,
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '110 days 2 hours', now() + interval '110 days 6 hours', 'draft')
on conflict (id) do nothing;

-- One pending publish request (from Alice; Carol approves) per window.
insert into public.schedule_publish_requests
  (id, facility_id, requested_by_employee_id, range_starts_at, range_ends_at, status)
values
  ('aaaa1111-5821-aaaa-aaaa-aaaa11110211',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '100 days', now() + interval '101 days', 'pending'),
  ('aaaa1111-5822-aaaa-aaaa-aaaa11110211',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '105 days', now() + interval '106 days', 'pending'),
  ('aaaa1111-5823-aaaa-aaaa-aaaa11110211',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '110 days', now() + interval '111 days', 'pending')
on conflict (id) do nothing;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

-- Policy helper, toggle OFF (facility A has no schedule_settings row here;
-- absent row = default false): advisory codes filtered out, cert codes kept.
select pg_temp.expect_count(
  $$select coalesce(array_length(public.scheduling_blocking_violations(
      '11111111-1111-1111-1111-111111111111',
      array['time_off','overtime','double_booked']), 1), 0)$$,
  0, 'SCHED-214: toggle OFF — advisory codes do not block');
select pg_temp.expect_count(
  $$select count(*) from unnest(public.scheduling_blocking_violations(
      '11111111-1111-1111-1111-111111111111',
      array['time_off','cert_missing:CPR','overtime'])) as c
    where c = 'cert_missing:CPR'$$,
  1, 'SCHED-214: toggle OFF — cert_missing still blocks (and only it)');
select pg_temp.expect_count(
  $$select coalesce(array_length(public.scheduling_blocking_violations(
      '11111111-1111-1111-1111-111111111111',
      array['time_off','cert_missing:CPR','overtime']), 1), 0)$$,
  1, 'SCHED-214: toggle OFF — blocking set is exactly the cert codes');

-- Publish door, toggle OFF: W1 (advisory time_off) publishes, and the RPC
-- reports the advisory codes it waved through.
select pg_temp.expect_count(
  $$select count(*) from (
      select public.scheduling_approve_publish_request(
        'aaaa1111-5821-aaaa-aaaa-aaaa11110211') as r) x
    where (x.r->>'ok') = 'true'
      and (x.r->>'advisory_count')::int >= 1
      and x.r->'advisory_warnings' ? 'time_off'$$,
  1, 'SCHED-214: toggle OFF — advisory violation publishes WITH a warning summary');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5521-aaaa-aaaa-aaaa11110211' and status = 'published'$$,
  1, 'SCHED-214: the advisory-flagged shift is published');

-- Publish door, toggle OFF: W2 (cert gap) still hard-blocks.
select pg_temp.expect_count(
  $$select count(*) from (
      select public.scheduling_approve_publish_request(
        'aaaa1111-5822-aaaa-aaaa-aaaa11110211') as r) x
    where (x.r->>'ok') = 'false'$$,
  1, 'SCHED-214: toggle OFF — cert gap still blocks publish');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5522-aaaa-aaaa-aaaa11110211' and status = 'draft'$$,
  1, 'SCHED-214: the cert-gapped shift stays draft');

reset role;

-- Toggle ON: the same advisory codes now block everywhere.
set local role postgres;
insert into public.schedule_settings (facility_id, block_on_violations)
values ('11111111-1111-1111-1111-111111111111', true);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select count(*) from unnest(public.scheduling_blocking_violations(
      '11111111-1111-1111-1111-111111111111',
      array['time_off','overtime'])) as c$$,
  2, 'SCHED-214: toggle ON — advisory codes DO block');
select pg_temp.expect_count(
  $$select count(*) from (
      select public.scheduling_approve_publish_request(
        'aaaa1111-5823-aaaa-aaaa-aaaa11110211') as r) x
    where (x.r->>'ok') = 'false'$$,
  1, 'SCHED-214: toggle ON — advisory violation blocks publish');
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'aaaa1111-5523-aaaa-aaaa-aaaa11110211' and status = 'draft'$$,
  1, 'SCHED-214: toggle ON — the advisory-flagged shift stays draft');

reset role;

-- Leave the toggle as we found it (no schedule_settings row for facility A)
-- so later sections see the default policy.
set local role postgres;
delete from public.schedule_settings
 where facility_id = '11111111-1111-1111-1111-111111111111';
reset role;

-- ---------------------------------------------------------------------------
-- 2Y. Daily-report corrections (migration 215) — the paper-logbook rule.
--
-- A locked (past-day) submission can be corrected by its ORIGINAL SUBMITTER
-- or a daily-reports module admin, through one SECURITY DEFINER RPC: a new
-- submission supersedes the original, which is stamped but never edited or
-- deleted. Probes reuse the DAR cast (zoe = staff submitter, sam = edit-tier
-- staff who is NOT the submitter, mona = daily module admin fixtures exist
-- above; Fred = facility admin) and the migration-183 area/template
-- fixtures.
-- ---------------------------------------------------------------------------
set local role postgres;

-- A locked submission: zoe submitted YESTERDAY (facility-local) with 2 items.
insert into public.daily_report_submissions
  (id, facility_id, area_id, template_id, employee_id, submitted_at, business_date)
values ('c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
        'aaaa1111-d701-aaaa-aaaa-aaaa11110013',
        'dada1111-0000-4000-8000-000000000002',
        now() - interval '1 day', current_date - 1)
on conflict (id) do nothing;
insert into public.daily_report_submission_items
  (id, facility_id, submission_id, label_snapshot, is_checked)
values
  ('c0121500-0002-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa', 'Nets secured', true),
  ('c0121500-0003-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa', 'Ice depth logged', false)
on conflict (id) do nothing;
reset role;

-- Non-owner, non-admin (sam, edit tier): the RPC's gate raises.
set local role authenticated;
set local request.jwt.claims to '{"sub":"ed17ed17-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'ed17ed17-0000-4000-8000-000000000001', true);
select pg_temp.expect_error(
  $$select public.supersede_daily_report_submission(
      'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa', 'not mine',
      '[]'::jsonb)$$,
  'I3: non-owner staff CANNOT file a correction (RPC gate raises)');
reset role;

-- Owner (zoe): direct UPDATE of the locked row is still RLS-inert, the
-- reason is mandatory, and the governed supersede works.
set local role authenticated;
set local request.jwt.claims to '{"sub":"dada1111-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'dada1111-0000-4000-8000-000000000001', true);
select pg_temp.expect_ok(
  $$update public.daily_report_submissions
       set correction_reason = 'sneaky edit'
     where id = 'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'I3: owner''s direct UPDATE runs (RLS scopes it to 0 rows — migration 161 lesson)');
select pg_temp.expect_count(
  $$select count(*) from (
      select public.supersede_daily_report_submission(
        'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa', '   ', '[]'::jsonb) as r) x
    where (x.r->>'ok') = 'false'$$,
  1, 'I3: a blank correction reason is rejected');
select pg_temp.expect_count(
  $$select count(*) from (
      select public.supersede_daily_report_submission(
        'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa',
        'Wrong ice depth recorded',
        '[{"checklist_item_id": null, "label_snapshot": "Nets secured", "is_checked": true},
          {"checklist_item_id": null, "label_snapshot": "Ice depth logged", "is_checked": true}]'::jsonb) as r) x
    where (x.r->>'ok') = 'true' and (x.r->>'item_count')::int = 2$$,
  1, 'I3: the ORIGINAL SUBMITTER can correct their own locked report');
select pg_temp.expect_count(
  $$select count(*) from (
      select public.supersede_daily_report_submission(
        'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa', 'again', '[]'::jsonb) as r) x
    where (x.r->>'ok') = 'false'$$,
  1, 'I3: a submission cannot be superseded twice');
reset role;

-- Ledger shape (as owner-bypassing postgres): the line-through happened, the
-- direct-edit attempt did NOT land, the correction belongs to the ORIGINAL
-- day, and both versions exist.
set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions
     where id = 'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa'
       and superseded_at is not null
       and superseded_by is not null
       and correction_reason is null$$,
  1, 'I3: original is stamped superseded, otherwise untouched');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submissions c
      join public.daily_report_submissions o on o.superseded_by = c.id
     where o.id = 'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa'
       and c.supersedes_id = o.id
       and c.business_date = o.business_date
       and c.correction_reason = 'Wrong ice depth recorded'
       and c.employee_id = 'dada1111-0000-4000-8000-000000000002'
       and c.corrected_by = 'dada1111-0000-4000-8000-000000000002'$$,
  1, 'I3: correction links both ways, keeps the original business_date, and names the corrector');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_submission_items i
      join public.daily_report_submissions o
        on o.superseded_by = i.submission_id
     where o.id = 'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa'
       and i.is_checked$$,
  2, 'I3: the correction carries the corrected item states');
reset role;

-- A daily-reports module admin (mona) can correct someone ELSE''s submission:
-- file a second-generation correction against zoe''s correction.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
select pg_temp.expect_count(
  $$select count(*) from (
      select public.supersede_daily_report_submission(
        (select superseded_by from public.daily_report_submissions
          where id = 'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa'),
        'Admin follow-up correction', '[]'::jsonb) as r) x
    where (x.r->>'ok') = 'true'$$,
  1, 'I3: a daily-reports module admin can correct someone else''s submission');
reset role;

-- GAP (migration 217): a submit-holder cannot inject child items into a
-- submission they do NOT own. Alice holds daily submit + access to zoe's area
-- but is not the submitter of zoe's report, so the tightened
-- daily_report_submission_items INSERT policy rejects her. (Before 217 the
-- child insert only needed view-level access — a cross-user integrity hole.)
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$insert into public.daily_report_submission_items
      (facility_id, submission_id, label_snapshot, is_checked)
    values ('11111111-1111-1111-1111-111111111111',
            'c0121500-0001-4aaa-8aaa-aaaaaaaaaaaa', 'Injected row', true)$$,
  'GAP-220: a submit-holder CANNOT add items to another user''s submission');
reset role;

-- Positive path preserved: the OWNER can still add items to their OWN
-- submission (this is exactly what every module's submit.ts does).
set local role postgres;
insert into public.daily_report_submissions
  (id, facility_id, area_id, template_id, employee_id, business_date)
values ('c0217000-0001-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
        'aaaa1111-d701-aaaa-aaaa-aaaa11110013',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date)
on conflict (id) do nothing;
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_ok(
  $$insert into public.daily_report_submission_items
      (facility_id, submission_id, label_snapshot, is_checked)
    values ('11111111-1111-1111-1111-111111111111',
            'c0217000-0001-4aaa-8aaa-aaaaaaaaaaaa', 'Own item', true)$$,
  'GAP-220: the OWNER can still add items to their own submission');
reset role;

-- ---------------------------------------------------------------------------
-- GAP-220 (migration 220), remaining siblings. The child-insert submit gate was
-- verified above for daily_report_submission_items; the same tightening covers
-- three more measurement/child tables that previously accepted a view-level
-- insert against ANOTHER user's parent. Alice holds view+submit on every module
-- (fixture near the top) but is NOT the owner of zoe's reports, so the tightened
-- child INSERT policies must reject her while still admitting her OWN child rows.
--
-- Parents (one zoe-owned, one alice-owned per module) are minted as the postgres
-- BYPASSRLS role, exactly as the daily positive above does.
-- ---------------------------------------------------------------------------
set local role postgres;

-- air_quality: zoe's report (foreign) + alice's report (own). location_id is the
-- shared facility_spaces "Space A1" seeded for facility A.
insert into public.air_quality_reports (id, facility_id, employee_id, location_id)
values
  ('c0220a91-0001-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'dada1111-0000-4000-8000-000000000002',
   'aaaa1111-0a01-aaaa-aaaa-aaaa11110021'),
  ('c0220a91-0002-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aaaa1111-0a01-aaaa-aaaa-aaaa11110021')
on conflict (id) do nothing;

-- ice_depth: zoe's session (foreign) + alice's session (own).
insert into public.ice_depth_sessions (
  id, facility_id, layout_id, employee_id,
  measurement_unit_snapshot, low_threshold_snapshot, high_threshold_snapshot
) values
  ('c0220d51-0001-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-1ae0-aaaa-aaaa-aaaa11110072',
   'dada1111-0000-4000-8000-000000000002', 'inches', 1.0, 2.0),
  ('c0220d51-0002-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-1ae0-aaaa-aaaa-aaaa11110072',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'inches', 1.0, 2.0)
on conflict (id) do nothing;

-- ice_operations: zoe's submission (foreign) + alice's submission (own).
insert into public.ice_operations_submissions (id, facility_id, employee_id, operation_type)
values
  ('c0221c01-0001-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'dada1111-0000-4000-8000-000000000002', 'ice_make'),
  ('c0221c01-0002-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ice_make')
on conflict (id) do nothing;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- air_quality_readings ------------------------------------------------------
select pg_temp.expect_error(
  $$insert into public.air_quality_readings
      (facility_id, report_id, key_snapshot, label_snapshot, unit_snapshot, value_numeric)
    values ('11111111-1111-1111-1111-111111111111',
            'c0220a91-0001-4000-8000-000000000001', 'co', 'CO', 'ppm', 1.0)$$,
  'GAP-220: a submit-holder CANNOT add a reading to another user''s air_quality report');
select pg_temp.expect_ok(
  $$insert into public.air_quality_readings
      (facility_id, report_id, key_snapshot, label_snapshot, unit_snapshot, value_numeric)
    values ('11111111-1111-1111-1111-111111111111',
            'c0220a91-0002-4000-8000-000000000002', 'co', 'CO', 'ppm', 1.0)$$,
  'GAP-220: the OWNER can still add a reading to their own air_quality report');

-- ice_depth_measurements ----------------------------------------------------
select pg_temp.expect_error(
  $$insert into public.ice_depth_measurements
      (facility_id, session_id, point_number_snapshot, x_snapshot, y_snapshot, depth_value, severity)
    values ('11111111-1111-1111-1111-111111111111',
            'c0220d51-0001-4000-8000-000000000001', 1, 0.5, 0.5, 1.5, 'ok')$$,
  'GAP-220: a submit-holder CANNOT add a measurement to another user''s ice_depth session');
select pg_temp.expect_ok(
  $$insert into public.ice_depth_measurements
      (facility_id, session_id, point_number_snapshot, x_snapshot, y_snapshot, depth_value, severity)
    values ('11111111-1111-1111-1111-111111111111',
            'c0220d51-0002-4000-8000-000000000002', 1, 0.5, 0.5, 1.5, 'ok')$$,
  'GAP-220: the OWNER can still add a measurement to their own ice_depth session');

-- ice_operations_circle_check_results ---------------------------------------
select pg_temp.expect_error(
  $$insert into public.ice_operations_circle_check_results
      (facility_id, submission_id, label_snapshot, passed)
    values ('11111111-1111-1111-1111-111111111111',
            'c0221c01-0001-4000-8000-000000000001', 'Blades OK', true)$$,
  'GAP-220: a submit-holder CANNOT add a circle-check result to another user''s ice_operations submission');
select pg_temp.expect_ok(
  $$insert into public.ice_operations_circle_check_results
      (facility_id, submission_id, label_snapshot, passed)
    values ('11111111-1111-1111-1111-111111111111',
            'c0221c01-0002-4000-8000-000000000002', 'Blades OK', true)$$,
  'GAP-220: the OWNER can still add a circle-check result to their own ice_operations submission');
reset role;

-- ---------------------------------------------------------------------------
-- D-1 (migration 224): audit_logs INSERT must name the caller as the actor.
-- A non-super-admin (alice) may append an audit row for HERSELF, but cannot
-- forge one attributed to a colleague (zoe, a same-facility user) — closing the
-- "frame a coworker" hole the old facility-only WITH CHECK left open.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$insert into public.audit_logs (facility_id, actor_user_id, action, entity_type)
    values ('11111111-1111-1111-1111-111111111111',
            'dada1111-0000-4000-8000-000000000001', 'test.frame', 'test')$$,
  'D-1: alice CANNOT insert an audit_logs row attributed to another user');
select pg_temp.expect_ok(
  $$insert into public.audit_logs (facility_id, actor_user_id, action, entity_type)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test.self', 'test')$$,
  'D-1: alice CAN insert an audit_logs row attributed to herself (logAudit path)');
reset role;

-- ---------------------------------------------------------------------------
-- D-2 (migration 225): offline_sync_queue owner DELETE. Before this policy only
-- super_admin could delete, so releaseClaim() (deleting one's own row by
-- local_id) was a silent no-op. A user may now delete their OWN queue row but
-- not another user's — even a same-facility colleague's.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.offline_sync_queue
  (local_id, facility_id, employee_id, module_key, action, payload)
values
  ('c0224000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'dada1111-0000-4000-8000-000000000002', 'daily_reports', 'submit', '{}'::jsonb),
  ('c0224000-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'daily_reports', 'submit', '{}'::jsonb)
on conflict (local_id) do nothing;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_count(
  $$with d as (
      delete from public.offline_sync_queue
       where local_id = 'c0224000-0000-4000-8000-000000000001'
       returning 1)
    select count(*) from d$$,
  0, 'D-2: alice CANNOT delete another user''s offline_sync_queue row (RLS scopes it to 0 rows)');
select pg_temp.expect_count(
  $$with d as (
      delete from public.offline_sync_queue
       where local_id = 'c0224000-0000-4000-8000-000000000002'
       returning 1)
    select count(*) from d$$,
  1, 'D-2: alice CAN delete her OWN offline_sync_queue row (releaseClaim now works)');
reset role;

-- The colleague's row must have survived alice's delete attempt.
set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.offline_sync_queue
     where local_id = 'c0224000-0000-4000-8000-000000000001'$$,
  1, 'D-2: zoe''s queue row is untouched by alice''s rejected delete');
reset role;

-- ---------------------------------------------------------------------------
-- 2Z. Authorization-audit hardening (migration 216).
--
-- user_has_permission() was a cross-tenant permission oracle (SECURITY
-- DEFINER, no internal gate); check_rate_limit() let any client forge
-- counters. Probe the new gate and the revoked grant.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Alice may ask about HERSELF.
select pg_temp.expect_ok(
  $$select public.user_has_permission(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '11111111-1111-1111-1111-111111111111', 'daily_reports', 'submit')$$,
  'AUTHZ-219: a user CAN query their own permission bit');
-- Alice (plain staff) CANNOT probe another user in another facility.
select pg_temp.expect_error(
  $$select public.user_has_permission(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '22222222-2222-2222-2222-222222222222', 'admin', 'admin')$$,
  'AUTHZ-219: a user CANNOT probe another user/facility permission bit');
-- check_rate_limit EXECUTE is revoked from authenticated.
select pg_temp.expect_error(
  $$select public.check_rate_limit('login_email', 'victim@x.test', 1, 3600)$$,
  'AUTHZ-219: authenticated CANNOT call check_rate_limit (service-role only)');
reset role;

-- A facility admin CAN query bits within their own facility; service_role
-- retains the rate-limit grant.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);
select pg_temp.expect_ok(
  $$select public.user_has_permission(
      'dada1111-0000-4000-8000-000000000001',
      '11111111-1111-1111-1111-111111111111', 'daily_reports', 'submit')$$,
  'AUTHZ-219: a facility admin CAN query bits within their own facility');
reset role;

set local role service_role;
select pg_temp.expect_ok(
  $$select public.check_rate_limit('probe', 'x', 5, 60)$$,
  'AUTHZ-219: service_role CAN call check_rate_limit');
reset role;

-- ---------------------------------------------------------------------------
-- 2X. Retired-role drift guard (migration 209).
--
-- 'gm' and 'supervisor' were retired in migrations 58/87 and key-blocked by
-- the roles_key_not_retired CHECK (migration 188), yet quoted references
-- kept resurfacing in RLS policies (migration 119 re-added 'gm' to the
-- employee_certifications write policies) and in SECURITY DEFINER role
-- gates / seed matrices. These probes scan the LIVE catalog — not the
-- migration files — so any future policy or function that quotes a retired
-- role key fails CI here.
-- ---------------------------------------------------------------------------
select pg_temp.expect_count(
  $$select count(*) from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '')       ~ '''gm'''
         or coalesce(with_check, '') ~ '''gm'''
         or coalesce(qual, '')       ~ '''supervisor'''
         or coalesce(with_check, '') ~ '''supervisor''')$$,
  0, 'RRD: no public RLS policy references a retired role key');

select pg_temp.expect_count(
  $$select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.prosrc ~ '''gm''' or p.prosrc ~ '''supervisor''')$$,
  0, 'RRD: no public function body references a retired role key');

select pg_temp.expect_count(
  $$select count(*) from public.canonical_role_permission_grants()
     where role_key in ('gm', 'supervisor')$$,
  0, 'RRD: canonical grant matrix has no retired-role rows');
-- 2z. Retention floors + keep-forever invariant (migration 208).
--
-- The defect this closes: the per-module retention floor (365 days for
-- accident/incident reports) lived ONLY in the browser as a `minDays` prop,
-- while the server action accepted a flat keep_days >= 30 for every module. A
-- crafted POST wrote accident_reports = 30 days, and because purge_module_data
-- ignores auto_purge, the admin "Purge now" button then hard-deleted against it
-- immediately. These assertions are the regression gate.
--
-- Run as postgres (BYPASSRLS) so it is the trigger — not a policy — doing the
-- rejecting. The trigger is deliberately NOT role-exempt: a retention floor is
-- a compliance minimum, not a permission check.
-- ---------------------------------------------------------------------------

select pg_temp.expect_error(
  $$insert into public.retention_settings (facility_id, module_key, keep_days)
    values ('11111111-1111-1111-1111-111111111111', 'accident_reports', 30)$$,
  'RETENTION-208: accident_reports CANNOT be set below its 365-day floor');

select pg_temp.expect_error(
  $$insert into public.retention_settings (facility_id, module_key, keep_days)
    values ('11111111-1111-1111-1111-111111111111', 'incident_reports', 90)$$,
  'RETENTION-208: incident_reports CANNOT be set below its 365-day floor');

select pg_temp.expect_ok(
  $$insert into public.retention_settings (facility_id, module_key, keep_days)
    values ('11111111-1111-1111-1111-111111111111', 'accident_reports', 365)
    on conflict (facility_id, module_key)
    do update set keep_days = 365$$,
  'RETENTION-208: accident_reports CAN be set at its 365-day floor');

select pg_temp.expect_error(
  $$insert into public.retention_settings (facility_id, module_key, keep_days)
    values ('11111111-1111-1111-1111-111111111111', 'refrigeration', 60)$$,
  'RETENTION-208: refrigeration CANNOT be set below its 90-day floor');

-- keep_days = 0 is "keep forever": always permitted (stricter than any floor),
-- and MUST force auto_purge off. Every retention-driven purge function filters
-- `auto_purge = true`, so this coercion is what stops a keep-forever row from
-- computing a cutoff of now() - '0 days' = now() and deleting the whole module.
select pg_temp.expect_ok(
  $$insert into public.retention_settings (facility_id, module_key, keep_days, auto_purge)
    values ('11111111-1111-1111-1111-111111111111', 'daily_reports', 0, true)
    on conflict (facility_id, module_key)
    do update set keep_days = 0, auto_purge = true$$,
  'RETENTION-208: keep_days=0 (keep forever) is accepted');

select pg_temp.expect_count(
  $$select count(*)::int from public.retention_settings
     where keep_days = 0 and auto_purge = true$$,
  0,
  'RETENTION-208: INVARIANT — no row can hold keep_days=0 AND auto_purge=true');

select pg_temp.expect_ok(
  $$insert into public.retention_settings (facility_id, module_key, keep_days)
    values ('11111111-1111-1111-1111-111111111111', 'accident_reports', 0)
    on conflict (facility_id, module_key)
    do update set keep_days = 0$$,
  'RETENTION-208: keep_days=0 accepted even where a 365-day floor applies');

-- The floors table itself must not be lowerable by a facility admin, or the
-- defect simply moves up one level.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*)::int from public.retention_module_floors
     where module_key = 'accident_reports' and min_days = 365$$,
  1,
  'RETENTION-208: floors are readable by an authenticated user');

select pg_temp.expect_count(
  $$with attempted as (
      update public.retention_module_floors set min_days = 30
       where module_key = 'accident_reports'
      returning 1
    ) select count(*)::int from attempted$$,
  0,
  'RETENTION-208: non-super-admin CANNOT lower a retention floor');

reset role;
set local role postgres;

-- ---------------------------------------------------------------------------
-- 2y. Open-shift + swap guards (migration 210, prompt-library Defect 4).
--
-- schedule_shifts is locked by migrations 148/164/181, but the two satellite
-- tables that describe HOW a published shift may be filled were not. Their RLS
-- gates only on has_module_admin_access('scheduling') with no publish predicate
-- and no column restriction, and neither had a guard trigger.
--
-- The exploit these pin is NOT unauthorized assignment — the parent shift stays
-- frozen. It is that a scheduling admin could PATCH approval_required to false,
-- turning a manager-approval listing into first-come so the next staff claim
-- auto-fills a published shift; desync the queue with claim_status='filled';
-- or mark a swap 'manager_approved' directly, which moves no shift and leaves
-- the swap permanently unrunnable while reading as applied.
--
-- Carol (cccccccc-…) holds scheduling:admin in Facility A — she is exactly the
-- caller the old policies trusted unconditionally.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

-- A published, unassigned shift with a manager-approval open listing.
insert into public.schedule_shifts
  (id, facility_id, department_id, employee_id, starts_at, ends_at, status)
values ('aaaa1111-5521-aaaa-aaaa-aaaa11110210',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-de71-aaaa-aaaa-aaaa11110091',
        null,
        now() + interval '9 days', now() + interval '9 days 4 hours', 'published')
on conflict (id) do nothing;

insert into public.schedule_open_shifts
  (id, facility_id, shift_id, claim_status, approval_required, expires_at)
values ('aaaa1111-05a1-aaaa-aaaa-aaaa11110210',
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-5521-aaaa-aaaa-aaaa11110210',
        'open', true, now() + interval '2 days')
on conflict (id) do nothing;

-- Two pending swaps: one to attempt a direct apply on, one to deny normally.
insert into public.schedule_swap_requests
  (id, facility_id, requester_employee_id, requester_shift_id, target_employee_id, status)
values
  ('aaaa1111-5721-aaaa-aaaa-aaaa11110210',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
   'aaaa1111-5511-aaaa-aaaa-aaaa11110092',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending'),
  ('aaaa1111-5722-aaaa-aaaa-aaaa11110210',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
   'aaaa1111-5513-aaaa-aaaa-aaaa11110094',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending')
on conflict (id) do nothing;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

-- THE approval-gate bypass. One PATCH used to turn manager-approval into
-- first-come; scheduling_claim_open_shift branches purely on this column.
select pg_temp.expect_error(
  $$update public.schedule_open_shifts
       set approval_required = false
     where id = 'aaaa1111-05a1-aaaa-aaaa-aaaa11110210'$$,
  'SCHED-210: scheduling admin CANNOT flip approval_required on a listing');

select pg_temp.expect_error(
  $$update public.schedule_open_shifts
       set claim_status = 'filled',
           claimed_by_employee_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     where id = 'aaaa1111-05a1-aaaa-aaaa-aaaa11110210'$$,
  'SCHED-210: scheduling admin CANNOT mark a listing filled directly');

select pg_temp.expect_error(
  $$update public.schedule_open_shifts
       set expires_at = now() + interval '400 days'
     where id = 'aaaa1111-05a1-aaaa-aaaa-aaaa11110210'$$,
  'SCHED-210: scheduling admin CANNOT push a listing past the expiry sweeper');

select pg_temp.expect_error(
  $$delete from public.schedule_open_shifts
     where id = 'aaaa1111-05a1-aaaa-aaaa-aaaa11110210'$$,
  'SCHED-210: listing for a PUBLISHED shift cannot be deleted directly');

-- Swap: only scheduling_apply_swap may apply. A direct write moved no shift and
-- bricked the request (apply/deny/cancel all refuse afterwards).
select pg_temp.expect_error(
  $$update public.schedule_swap_requests
       set status = 'manager_approved'
     where id = 'aaaa1111-5721-aaaa-aaaa-aaaa11110210'$$,
  'SCHED-210: scheduling admin CANNOT mark a swap manager_approved directly');

-- The guard must stay narrow. The app writes these two directly as
-- authenticated (governance-actions.ts denySwap / cancelSwap), so breaking them
-- would be a worse regression than the hole being closed.
select pg_temp.expect_ok(
  $$update public.schedule_swap_requests
       set status = 'denied', decided_at = now()
     where id = 'aaaa1111-5721-aaaa-aaaa-aaaa11110210'$$,
  'SCHED-210: scheduling admin CAN still deny a swap');
select pg_temp.expect_ok(
  $$update public.schedule_swap_requests
       set status = 'cancelled', decided_at = now()
     where id = 'aaaa1111-5722-aaaa-aaaa-aaaa11110210'$$,
  'SCHED-210: scheduling admin CAN still cancel a swap');

-- The governed path must still work — a guard that blocks legitimate use is a
-- worse outcome than the hole. The SECURITY DEFINER RPCs run as the table owner
-- and are exempt by design.
reset role;
set local role service_role;
select pg_temp.expect_ok(
  $$select public.scheduling_expire_open_claims(10)$$,
  'SCHED-210: governed sweeper still updates listings (owner exemption holds)');

reset role;
set local role postgres;
select pg_temp.expect_ok(
  $$update public.schedule_open_shifts
       set claim_status = 'cancelled'
     where id = 'aaaa1111-05a1-aaaa-aaaa-aaaa11110210'$$,
  'SCHED-210: table owner can still write a listing (RPC path unaffected)');

reset role;
set local role postgres;

-- ---------------------------------------------------------------------------
-- E-1 (migration 227): the admin/admin permission cell is fenced to super
-- admins at the RLS layer.
--
-- "Only a super admin may grant Admin Center access" was enforced only in app
-- code (isAdminConsoleGrant, src/lib/permissions/actions.ts); the browser holds
-- the anon key + the user's JWT, so a facility admin could POST straight to
-- /rest/v1/user_permissions and mint a peer facility admin. Migration 226 adds
-- the cell-level term to the user_permissions and role_permission_defaults
-- write policies.
--
-- Cast:
--   Fred  (a0a0a0a0-…) facility-A admin: `admin` employee role + an enabled
--                      admin/admin grant (seeded in the D-01 block above).
--   Sue   (e2260000-…) NEW: platform super admin, the positive control.
--   Zoe   (dada1111-…) facility-A staff, no admin/admin row  -> INSERT probes.
--   Sam   (ed17ed17-…) facility-A staff, seeded a DISABLED admin/admin row
--                      -> the "flip an existing disabled cell on" probe.
--   Mona  (cccccccc-…) facility-A manager, seeded an ENABLED admin/admin row
--                      -> proves REVOKE stays open to facility admins.
-- ---------------------------------------------------------------------------
set local role postgres;

insert into auth.users (id, email)
values ('e2260000-0000-4000-8000-000000000001', 'sue@platform.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('e2260000-0000-4000-8000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'sue@platform.test', true)
on conflict (id) do nothing;  -- fresh id; DO NOTHING keeps the
                              -- users_profile_update_guard trigger out of the
                              -- fixture path entirely.

-- Sam: a DISABLED admin/admin cell (the row a facility admin must not flip on).
-- Mona: an ENABLED one (the row a facility admin must still be able to revoke).
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values
  ('ed17ed17-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'admin', 'admin'::public.user_action, false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111',
   'admin', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action)
  do update set enabled = excluded.enabled;

-- A DISABLED admin/admin role default on facility A's `staff` role. The
-- canonical matrix gives `staff` no admin-module row at all, so this row exists
-- only for the flip-it-on probe below.
insert into public.role_permission_defaults
  (facility_id, role_id, module_name, action, enabled)
select '11111111-1111-1111-1111-111111111111', r.id,
       'admin', 'admin'::public.user_action, false
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (facility_id, role_id, module_name, action)
  do update set enabled = excluded.enabled;

-- ---- user_permissions, as Fred (facility admin) ---------------------------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);

-- THE hole: mint a peer facility admin with one INSERT.
select pg_temp.expect_error(
  $$insert into public.user_permissions
      (user_id, facility_id, module_name, action, enabled)
    values ('dada1111-0000-4000-8000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            'admin', 'admin'::public.user_action, true)$$,
  'E-1: facility admin CANNOT insert an ENABLED admin/admin user_permissions row for a peer');

-- Same cell, reached by flipping an existing DISABLED row (the UPDATE leg).
select pg_temp.expect_error(
  $$update public.user_permissions set enabled = true
     where user_id     = 'ed17ed17-0000-4000-8000-000000000001'
       and facility_id = '11111111-1111-1111-1111-111111111111'
       and module_name = 'admin'
       and action      = 'admin'::public.user_action$$,
  'E-1: facility admin CANNOT flip a peer''s DISABLED admin/admin row to enabled');

-- The policy is user_id-agnostic: writing the enabled cell for HERSELF is
-- refused too (the app never issues this write — every path skips or zeroes the
-- cell for a non-super caller).
select pg_temp.expect_error(
  $$update public.user_permissions set enabled = true
     where user_id     = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'
       and facility_id = '11111111-1111-1111-1111-111111111111'
       and module_name = 'admin'
       and action      = 'admin'::public.user_action$$,
  'E-1: facility admin CANNOT re-assert the enabled admin/admin cell on THEMSELVES');

-- Deliberately still allowed #1: the `admin` ACTION on a REPORT module is
-- normal delegation, not Admin Center access.
select pg_temp.expect_ok(
  $$insert into public.user_permissions
      (user_id, facility_id, module_name, action, enabled)
    values ('dada1111-0000-4000-8000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            'daily_reports', 'admin'::public.user_action, true)$$,
  'E-1: facility admin CAN still grant the admin ACTION on a non-admin module');

-- Deliberately still allowed #2: REVOKING admin/admin. applyPresetToUser(),
-- upsertUserPermission(enabled:false) and the CSV import all write a DISABLED
-- admin/admin row; fencing this would break the admin console.
select pg_temp.expect_count(
  $$with u as (
      update public.user_permissions set enabled = false
       where user_id     = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
         and facility_id = '11111111-1111-1111-1111-111111111111'
         and module_name = 'admin'
         and action      = 'admin'::public.user_action
      returning 1)
    select count(*) from u$$,
  1, 'E-1: facility admin CAN still REVOKE an admin/admin grant (enabled = false)');

-- Cross-check: Fred's rejected writes left no enabled cell behind.
select pg_temp.expect_count(
  $$select count(*) from public.user_permissions
     where facility_id = '11111111-1111-1111-1111-111111111111'
       and module_name = 'admin'
       and action      = 'admin'::public.user_action
       and enabled     = true
       and user_id in ('dada1111-0000-4000-8000-000000000001',
                       'ed17ed17-0000-4000-8000-000000000001',
                       'cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  0, 'E-1: no peer gained an enabled admin/admin cell from the facility admin''s attempts');

-- ---- role_permission_defaults, as Fred ------------------------------------
-- Reachable escalation even without touching user_permissions: an enabled
-- admin/admin DEFAULT plus reapply_role_defaults_for_role() (granted to
-- `authenticated`) pushes the cell onto every active holder of the role.
select pg_temp.expect_error(
  $$insert into public.role_permission_defaults
      (facility_id, role_id, module_name, action, enabled)
    select '11111111-1111-1111-1111-111111111111', r.id,
           'admin', 'admin'::public.user_action, true
    from public.roles r
    where r.facility_id = '11111111-1111-1111-1111-111111111111'
      and r.key = 'manager'$$,
  'E-1: facility admin CANNOT insert an ENABLED admin/admin role default');

select pg_temp.expect_error(
  $$update public.role_permission_defaults d set enabled = true
     where d.facility_id = '11111111-1111-1111-1111-111111111111'
       and d.module_name = 'admin'
       and d.action      = 'admin'::public.user_action
       and d.role_id = (select id from public.roles
                         where facility_id = '11111111-1111-1111-1111-111111111111'
                           and key = 'staff')$$,
  'E-1: facility admin CANNOT flip a DISABLED admin/admin role default to enabled');

select pg_temp.expect_ok(
  $$insert into public.role_permission_defaults
      (facility_id, role_id, module_name, action, enabled)
    select '11111111-1111-1111-1111-111111111111', r.id,
           'refrigeration', 'admin'::public.user_action, true
    from public.roles r
    where r.facility_id = '11111111-1111-1111-1111-111111111111'
      and r.key = 'staff'$$,
  'E-1: facility admin CAN still grant a non-admin module''s admin action as a role default');

select pg_temp.expect_count(
  $$with u as (
      update public.role_permission_defaults d set enabled = false
       where d.facility_id = '11111111-1111-1111-1111-111111111111'
         and d.module_name = 'admin'
         and d.action      = 'admin'::public.user_action
         and d.role_id = (select id from public.roles
                           where facility_id = '11111111-1111-1111-1111-111111111111'
                             and key = 'staff')
      returning 1)
    select count(*) from u$$,
  1, 'E-1: facility admin CAN still write a DISABLED admin/admin role default (revoke)');

reset role;

-- ---- the same writes, as a SUPER ADMIN (must all succeed) -----------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"e2260000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'e2260000-0000-4000-8000-000000000001', true);

select pg_temp.expect_ok(
  $$insert into public.user_permissions
      (user_id, facility_id, module_name, action, enabled)
    values ('dada1111-0000-4000-8000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            'admin', 'admin'::public.user_action, true)$$,
  'E-1: a SUPER ADMIN CAN insert an enabled admin/admin user_permissions row');

select pg_temp.expect_ok(
  $$update public.user_permissions set enabled = true
     where user_id     = 'ed17ed17-0000-4000-8000-000000000001'
       and facility_id = '11111111-1111-1111-1111-111111111111'
       and module_name = 'admin'
       and action      = 'admin'::public.user_action$$,
  'E-1: a SUPER ADMIN CAN flip a disabled admin/admin row to enabled');

select pg_temp.expect_ok(
  $$update public.role_permission_defaults d set enabled = true
     where d.facility_id = '11111111-1111-1111-1111-111111111111'
       and d.module_name = 'admin'
       and d.action      = 'admin'::public.user_action
       and d.role_id = (select id from public.roles
                         where facility_id = '11111111-1111-1111-1111-111111111111'
                           and key = 'staff')$$,
  'E-1: a SUPER ADMIN CAN enable an admin/admin role default');

reset role;

-- Put the fixtures back so nothing downstream inherits a surprise admin.
set local role postgres;
update public.user_permissions set enabled = false
 where facility_id = '11111111-1111-1111-1111-111111111111'
   and module_name = 'admin'
   and action      = 'admin'::public.user_action
   and user_id in ('dada1111-0000-4000-8000-000000000001',
                   'ed17ed17-0000-4000-8000-000000000001',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc');
update public.role_permission_defaults set enabled = false
 where facility_id = '11111111-1111-1111-1111-111111111111'
   and module_name = 'admin'
   and action      = 'admin'::public.user_action
   and role_id = (select id from public.roles
                   where facility_id = '11111111-1111-1111-1111-111111111111'
                     and key = 'staff');
reset role;

-- ---------------------------------------------------------------------------
-- E-1 sibling (migration 228): roles_update is fenced by the caller's own
-- hierarchy floor.
--
-- Pre-227 any facility admin could PATCH /rest/v1/roles and rewrite
-- hierarchy_level on ANY role in their facility — hoisting a role they control
-- above the admin tier and defeating callerHierarchyFloor() /
-- can_edit_user_profile(), both of which compare these numbers. LOWER number =
-- HIGHER rank; canonical seed is super_admin=0, admin=1, manager=2, staff=3.
-- Fred's employee role is `admin`, so his floor is 1.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);

select pg_temp.expect_count(
  $$select public.current_role_hierarchy_floor(
      '11111111-1111-1111-1111-111111111111')$$,
  1, 'E-1/roles: Fred''s hierarchy floor in facility A is the admin tier (1)');

-- WITH CHECK leg: cannot leave a role ranked above your own floor.
select pg_temp.expect_error(
  $$update public.roles set hierarchy_level = 0
     where facility_id = '11111111-1111-1111-1111-111111111111'
       and key = 'manager'$$,
  'E-1/roles: facility admin CANNOT raise a role above their own hierarchy floor');

-- USING leg: a role that ALREADY outranks the caller is not updatable at all
-- (RLS filters it to zero rows rather than raising).
select pg_temp.expect_count(
  $$with u as (
      update public.roles set display_name = 'Pwned'
       where facility_id = '11111111-1111-1111-1111-111111111111'
         and key = 'super_admin'
      returning 1)
    select count(*) from u$$,
  0, 'E-1/roles: facility admin CANNOT edit a role that already outranks them');

-- Legitimate edits at or below the caller's rank still work.
select pg_temp.expect_count(
  $$with u as (
      update public.roles set display_name = display_name
       where facility_id = '11111111-1111-1111-1111-111111111111'
         and key = 'staff'
      returning 1)
    select count(*) from u$$,
  1, 'E-1/roles: facility admin CAN still edit a role below their own rank');

select pg_temp.expect_count(
  $$with u as (
      update public.roles set hierarchy_level = 1
       where facility_id = '11111111-1111-1111-1111-111111111111'
         and key = 'admin'
      returning 1)
    select count(*) from u$$,
  1, 'E-1/roles: facility admin CAN still edit their OWN tier role at its own level');

select pg_temp.expect_count(
  $$select hierarchy_level from public.roles
     where facility_id = '11111111-1111-1111-1111-111111111111'
       and key = 'manager'$$,
  2, 'E-1/roles: the manager role''s rank survived the escalation attempt');

reset role;

-- ---------------------------------------------------------------------------
-- E-1 sibling (migration 231): employees.role_id assignment is fenced by the
-- caller's own hierarchy floor via a BEFORE UPDATE trigger.
--
-- Pre-230 any facility admin could PATCH /rest/v1/employees?id=eq.<peer> setting
-- role_id to the facility's `admin` role, then reapply_role_defaults_for_role()
-- (granted to authenticated) would seed an enabled admin/admin user_permissions
-- row for that peer AS postgres — minting a peer admin past 227/228. The rank
-- rule (canAssignRoleLevel / assertCanAssignRole, ADMIN_TIER_LEVEL = 1) lived
-- only in the console server actions; the role change is a plain
-- .from("employees").update({role_id}) under the invoker's RLS, which had no
-- rank check. LOWER number = HIGHER rank; Fred's employee role is `admin`, floor
-- 1. The guard fires ONLY when role_id actually changes, is exempt for backend /
-- SECURITY DEFINER owner callers and super admins, and requires the NEW role's
-- hierarchy_level to be strictly greater than the caller's floor (null floor =>
-- 1, null target level => 0).
--
-- Cast (all facility A): Fred (admin, floor 1), Sue (platform super admin), Zoe
-- & Sam (staff, level 3), Mona (manager, level 2), plus Ada — a fresh peer who
-- already HOLDS the `admin` role (level 1), the "edit a peer admin's non-role
-- field" target.
-- ---------------------------------------------------------------------------
set local role postgres;
-- Ada: an existing peer admin (no auth/user row needed — an invited-but-unlinked
-- employee). Used to prove a non-role edit on an admin peer is NOT blocked.
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'adada000-0000-4000-8000-000000000002'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       null,
       r.id, 'Ada', 'Adminson', 'ada@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111' and r.key = 'admin'
on conflict (id) do update set role_id = excluded.role_id, is_active = true;
reset role;

-- ---- as Fred (facility admin, floor 1) ------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);

-- THE hole: promote a peer to the `admin` role (level 1, == floor -> denied).
select pg_temp.expect_error(
  $$update public.employees
       set role_id = (select id from public.roles
                       where facility_id = '11111111-1111-1111-1111-111111111111'
                         and key = 'admin')
     where id = 'dada1111-0000-4000-8000-000000000002'$$,
  'E-1/employees: facility admin CANNOT change a peer''s role to the admin tier (level 1)');

-- And cannot leapfrog straight to super_admin (level 0).
select pg_temp.expect_error(
  $$update public.employees
       set role_id = (select id from public.roles
                       where facility_id = '11111111-1111-1111-1111-111111111111'
                         and key = 'super_admin')
     where id = 'dada1111-0000-4000-8000-000000000002'$$,
  'E-1/employees: facility admin CANNOT change a peer''s role to super_admin (level 0)');

-- The rejected attempts left Zoe on `staff`.
select pg_temp.expect_count(
  $$select r.hierarchy_level from public.employees e
      join public.roles r on r.id = e.role_id
     where e.id = 'dada1111-0000-4000-8000-000000000002'$$,
  3, 'E-1/employees: Zoe is still `staff` (level 3) after the rejected promotions');

-- Legitimate downward assignments (level >= 2) still work.
select pg_temp.expect_count(
  $$with u as (
      update public.employees
         set role_id = (select id from public.roles
                         where facility_id = '11111111-1111-1111-1111-111111111111'
                           and key = 'manager')
       where id = 'ed17ed17-0000-4000-8000-000000000002'
      returning 1)
    select count(*) from u$$,
  1, 'E-1/employees: facility admin CAN assign a peer the manager role (level 2)');

select pg_temp.expect_count(
  $$with u as (
      update public.employees
         set role_id = (select id from public.roles
                         where facility_id = '11111111-1111-1111-1111-111111111111'
                           and key = 'staff')
       where id = 'cccc3333-cccc-cccc-cccc-cccccccccccc'
      returning 1)
    select count(*) from u$$,
  1, 'E-1/employees: facility admin CAN assign a peer the staff role (level 3)');

-- The "only when role_id changes" guarantee: a NON-role edit on a peer who
-- ALREADY holds `admin` (level 1 == Fred's floor) is NOT blocked.
select pg_temp.expect_count(
  $$with u as (
      update public.employees set is_active = true
       where id = 'adada000-0000-4000-8000-000000000002'
      returning 1)
    select count(*) from u$$,
  1, 'E-1/employees: facility admin CAN still edit a non-role field on a peer who already holds admin');

reset role;

-- ---- as Sue (platform super admin) — the rank guard does not apply ---------
set local role authenticated;
set local request.jwt.claims to '{"sub":"e2260000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'e2260000-0000-4000-8000-000000000001', true);

select pg_temp.expect_count(
  $$with u as (
      update public.employees
         set role_id = (select id from public.roles
                         where facility_id = '11111111-1111-1111-1111-111111111111'
                           and key = 'admin')
       where id = 'dada1111-0000-4000-8000-000000000002'
      returning 1)
    select count(*) from u$$,
  1, 'E-1/employees: a SUPER ADMIN CAN reassign a peer to the admin role');

reset role;

-- ---- backend / SECURITY DEFINER owner path (current_user = postgres) -------
-- Proves the exemption that keeps create_employee_complete() and other owner
-- flows working: as `postgres`, setting an admin role is allowed.
set local role postgres;
select pg_temp.expect_count(
  $$with u as (
      update public.employees
         set role_id = (select id from public.roles
                         where facility_id = '11111111-1111-1111-1111-111111111111'
                           and key = 'admin')
       where id = 'ed17ed17-0000-4000-8000-000000000002'
      returning 1)
    select count(*) from u$$,
  1, 'E-1/employees: the table-owner (postgres) path CAN set an admin role (SECURITY DEFINER exemption)');

-- Restore the fixture roles so nothing downstream inherits a surprise admin.
update public.employees e set role_id = r.id
  from public.roles r
 where r.facility_id = '11111111-1111-1111-1111-111111111111' and r.key = 'staff'
   and e.id in ('dada1111-0000-4000-8000-000000000002',
                'ed17ed17-0000-4000-8000-000000000002');
update public.employees e set role_id = r.id
  from public.roles r
 where r.facility_id = '11111111-1111-1111-1111-111111111111' and r.key = 'manager'
   and e.id = 'cccc3333-cccc-cccc-cccc-cccccccccccc';
delete from public.employees where id = 'adada000-0000-4000-8000-000000000002';
reset role;

-- ---------------------------------------------------------------------------
-- E-2 (migration 229): copy_role_permission_defaults(uuid,uuid) is no longer
-- callable from the client.
--
-- SECURITY DEFINER, EXECUTE-granted to `authenticated`, gated only on
-- facility + current_user_role() — no admin-cell guard — and reachable at
-- /rest/v1/rpc/. Nothing in src/ calls it (the admin console copies
-- role_permission_defaults inline under RLS), so the grant was revoked
-- outright, per the migration 26/66/122/160/163/201 pattern.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);
select pg_temp.expect_error(
  $$select public.copy_role_permission_defaults(
      (select id from public.roles
        where facility_id = '11111111-1111-1111-1111-111111111111' and key = 'admin'),
      (select id from public.roles
        where facility_id = '11111111-1111-1111-1111-111111111111' and key = 'staff'))$$,
  'E-2: a facility admin CANNOT execute copy_role_permission_defaults (grant revoked)');
reset role;

-- The ACL itself, so a future re-grant fails here rather than in production.
select pg_temp.expect_count(
  $$select count(*) from (
      select 1 where has_function_privilege(
        'authenticated', 'public.copy_role_permission_defaults(uuid,uuid)', 'execute')
         or has_function_privilege(
        'anon', 'public.copy_role_permission_defaults(uuid,uuid)', 'execute')) t$$,
  0, 'E-2: neither anon nor authenticated holds EXECUTE on copy_role_permission_defaults');

select pg_temp.expect_count(
  $$select count(*) from (
      select 1 where has_function_privilege(
        'service_role', 'public.copy_role_permission_defaults(uuid,uuid)', 'execute')) t$$,
  1, 'E-2: service_role keeps EXECUTE on copy_role_permission_defaults');

-- ---------------------------------------------------------------------------
-- E-3 (migration 230): a user may not delete their own SYNCED queue row.
--
-- offline_sync_queue.local_id is the sole replay dedup key. Migration 224
-- (D-2) opened owner DELETE so releaseClaim() could free a stale `pending`
-- claim, but not scoping it by sync_status let a user delete their own `synced`
-- row and re-POST the identical body to /api/offline-sync — claimQueueSlot()
-- would upsert cleanly and the report would be persisted a SECOND time. DELETE
-- is now restricted to non-synced rows; the `pending` release path (the whole
-- point of 224) is unaffected.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.offline_sync_queue
  (local_id, facility_id, employee_id, module_key, action, payload, sync_status)
values
  ('c0229000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'daily_reports', 'submit', '{}'::jsonb,
   'synced'),
  ('c0229000-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'daily_reports', 'submit', '{}'::jsonb,
   'pending')
on conflict (local_id) do nothing;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$with d as (
      delete from public.offline_sync_queue
       where local_id = 'c0229000-0000-4000-8000-000000000001'
       returning 1)
    select count(*) from d$$,
  0, 'E-3: alice CANNOT delete her OWN SYNCED queue row (idempotency token survives)');

select pg_temp.expect_count(
  $$with d as (
      delete from public.offline_sync_queue
       where local_id = 'c0229000-0000-4000-8000-000000000002'
       returning 1)
    select count(*) from d$$,
  1, 'E-3: alice CAN still delete her OWN PENDING queue row (releaseClaim path)');

reset role;
set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from public.offline_sync_queue
     where local_id = 'c0229000-0000-4000-8000-000000000001'$$,
  1, 'E-3: the synced row is still on the table after the rejected delete');
reset role;

set local role postgres;

-- ---------------------------------------------------------------------------
-- E-4. scheduling_move_compliance_rule (migration 232) is tenant-fenced.
--
-- The RPC is SECURITY DEFINER (it needs to swap two rows in one statement,
-- which RLS-scoped client updates could not do atomically), so RLS does NOT
-- protect it — the facility check inside the function is the only gate. Carol
-- is a Facility-A scheduling admin; Bob is a Facility-B employee.
-- ---------------------------------------------------------------------------
set local role postgres;

insert into public.schedule_compliance_rules (id, facility_id, rule_type, name, sort_order)
values
  ('c0232000-0000-4000-8000-00000000000a',
   '11111111-1111-1111-1111-111111111111', 'overtime', 'A-rule-1', 0),
  ('c0232000-0000-4000-8000-00000000000b',
   '11111111-1111-1111-1111-111111111111', 'overtime', 'A-rule-2', 1),
  ('c0232000-0000-4000-8000-00000000000c',
   '22222222-2222-2222-2222-222222222222', 'overtime', 'B-rule-1', 0),
  ('c0232000-0000-4000-8000-00000000000d',
   '22222222-2222-2222-2222-222222222222', 'overtime', 'B-rule-2', 1)
on conflict (id) do nothing;
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_move_compliance_rule(
        'c0232000-0000-4000-8000-00000000000b', -1))
     where key = 'ok' and value = 'true'::jsonb$$,
  1, 'E-4: carol (facility-A scheduling admin) CAN reorder a Facility-A rule');

select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_move_compliance_rule(
        'c0232000-0000-4000-8000-00000000000d', -1))
     where key = 'ok' and value = 'true'::jsonb$$,
  0, 'E-4: carol CANNOT reorder a Facility-B rule (cross-tenant)');

reset role;
set local role postgres;

select pg_temp.expect_count(
  $$select count(*) from public.schedule_compliance_rules
     where id = 'c0232000-0000-4000-8000-00000000000b' and sort_order = 0$$,
  1, 'E-4: the Facility-A swap actually applied');

select pg_temp.expect_count(
  $$select count(*) from public.schedule_compliance_rules
     where id = 'c0232000-0000-4000-8000-00000000000d' and sort_order = 1$$,
  1, 'E-4: the Facility-B rule order is UNCHANGED after the rejected call');
reset role;

-- Staff Alice has scheduling view/submit but NOT admin — the RPC must refuse
-- her even inside her own facility.
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_move_compliance_rule(
        'c0232000-0000-4000-8000-00000000000a', 1))
     where key = 'ok' and value = 'true'::jsonb$$,
  0, 'E-4: staff alice (no scheduling admin grant) CANNOT reorder rules');
reset role;

set local role postgres;

-- ---------------------------------------------------------------------------
-- E-5. Staff shift drops (migration 234).
--
-- scheduling_request_shift_drop / _decide_shift_drop / _cancel_shift_drop are
-- all SECURITY DEFINER — they must be, because releasing a PUBLISHED shift
-- means clearing employee_id through the publish lock, which only the table
-- owner may do. DEFINER bypasses RLS, so the facility + ownership checks
-- inside each function are the only gate, and these are the assertions on it.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Facility A needs a settings row: the drop RPC reads
-- drop_requires_manager_approval / drop_min_notice_hours from it, and the
-- release helper reads open_shift_first_come to snapshot approval_required.
insert into public.schedule_settings (facility_id, open_shift_first_come)
values ('11111111-1111-1111-1111-111111111111', true)
on conflict (facility_id) do update set open_shift_first_come = true;

-- A published FUTURE shift for each of alice (facility A) and bob (facility B),
-- plus one for carol so alice can be caught reaching for a coworker's shift.
insert into public.schedule_shifts (
  id, facility_id, department_id, employee_id, starts_at, ends_at, status
) values
  ('c0234000-0000-4000-8000-0000000000a1',
   '11111111-1111-1111-1111-111111111111',
   (select id from public.departments
     where facility_id = '11111111-1111-1111-1111-111111111111' limit 1),
   'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() + interval '5 days', now() + interval '5 days 8 hours', 'published'),
  ('c0234000-0000-4000-8000-0000000000a2',
   '11111111-1111-1111-1111-111111111111',
   (select id from public.departments
     where facility_id = '11111111-1111-1111-1111-111111111111' limit 1),
   'aaaa1111-ca01-aaaa-aaaa-aaaa11110099',
   now() + interval '6 days', now() + interval '6 days 8 hours', 'published'),
  ('c0234000-0000-4000-8000-0000000000b1',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-de71-bbbb-bbbb-bbbb22220082',
   'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   now() + interval '5 days', now() + interval '5 days 8 hours', 'published')
on conflict (id) do nothing;

-- A pending facility-B drop for carol to be refused on.
insert into public.schedule_shift_drop_requests (
  id, facility_id, shift_id, requester_employee_id, status
) values (
  'c0234000-0000-4000-8000-0000000000d1',
  '22222222-2222-2222-2222-222222222222',
  'c0234000-0000-4000-8000-0000000000b1',
  'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'pending')
on conflict (id) do nothing;
reset role;

-- ---- alice (facility-A staff, scheduling view+submit) ----
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_request_shift_drop(
        'c0234000-0000-4000-8000-0000000000b1', null))
     where key = 'ok' and value = 'true'::jsonb$$,
  0, 'E-5: alice CANNOT request a drop on a Facility-B shift');

select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_request_shift_drop(
        'c0234000-0000-4000-8000-0000000000a2', null))
     where key = 'ok' and value = 'true'::jsonb$$,
  0, 'E-5: alice CANNOT request a drop on a COWORKER''s shift in her own facility');

select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_request_shift_drop(
        'c0234000-0000-4000-8000-0000000000a1', 'car trouble'))
     where key = 'ok' and value = 'true'::jsonb$$,
  1, 'E-5: alice CAN request a drop on her OWN shift');

-- The drop RPC is the only writer of these rows; alice must not see another
-- facility's requests through the table's own SELECT policy either.
select pg_temp.expect_count(
  $$select count(*) from public.schedule_shift_drop_requests
     where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'E-5: alice CANNOT SELECT facility-B drop requests');

-- Staff cannot decide their own request, even in their own facility.
select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_decide_shift_drop(
        (select id from public.schedule_shift_drop_requests
          where shift_id = 'c0234000-0000-4000-8000-0000000000a1'), true, null))
     where key = 'ok' and value = 'true'::jsonb$$,
  0, 'E-5: staff alice (no scheduling admin grant) CANNOT decide a drop');
reset role;

-- ---- carol (facility-A scheduling admin) ----
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_decide_shift_drop(
        'c0234000-0000-4000-8000-0000000000d1', true, null))
     where key = 'ok' and value = 'true'::jsonb$$,
  0, 'E-5: carol CANNOT decide a Facility-B drop (cross-tenant)');

select pg_temp.expect_count(
  $$select count(*) from jsonb_each(
      public.scheduling_decide_shift_drop(
        (select id from public.schedule_shift_drop_requests
          where shift_id = 'c0234000-0000-4000-8000-0000000000a1'), true, 'ok'))
     where key = 'ok' and value = 'true'::jsonb$$,
  1, 'E-5: carol CAN decide a Facility-A drop');
reset role;

set local role postgres;

select pg_temp.expect_count(
  $$select count(*) from public.schedule_shift_drop_requests
     where id = 'c0234000-0000-4000-8000-0000000000d1' and status = 'pending'$$,
  1, 'E-5: the Facility-B drop is UNCHANGED after the rejected cross-tenant call');

select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'c0234000-0000-4000-8000-0000000000b1'
       and employee_id = 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  1, 'E-5: the Facility-B shift is still assigned after the rejected call');

select pg_temp.expect_count(
  $$select count(*) from public.schedule_shifts
     where id = 'c0234000-0000-4000-8000-0000000000a1' and employee_id is null$$,
  1, 'E-5: an approved drop leaves the shift UNASSIGNED');

-- open_shift_first_come = true above, so approval_required snapshots false.
select pg_temp.expect_count(
  $$select count(*) from public.schedule_open_shifts
     where shift_id = 'c0234000-0000-4000-8000-0000000000a1'
       and claim_status = 'open' and approval_required = false$$,
  1, 'E-5: an approved drop creates exactly one open listing with the right approval_required');

select pg_temp.expect_count(
  $$select count(*) from public.schedule_notifications
     where drop_id = (select id from public.schedule_shift_drop_requests
                       where shift_id = 'c0234000-0000-4000-8000-0000000000a1')
       and notification_type = 'shift_drop_decided'
       and employee_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  1, 'E-5: the requester is notified of the decision');
reset role;

set local role postgres;

-- ---------------------------------------------------------------------------
-- E-6. schedule_notifications.notification_type domain coverage.
--
-- The domain is an enumerated CHECK, and Postgres has no "add a value" — so
-- every migration that introduces a type must DROP + ADD with the whole list
-- restated. Migration 158 warned that this silently NARROWS the domain if a
-- value is missed, and migration 234 promptly did exactly that (it dropped
-- 'swap_expired' / 'claim_expired', which scheduling_expire_stale_swaps
-- inserts from the 10-minute expiry cron).
--
-- Inserting one row of EVERY permitted value turns that class of mistake into
-- a CI failure here instead of a broken cron in production. When a migration
-- legitimately adds a type, add it to this list too.
-- ---------------------------------------------------------------------------
set local role postgres;

do $$
declare
  v_type text;
  v_types text[] := array[
    'schedule_published','shift_changed','open_shift_available',
    'swap_request_received','swap_approved','swap_denied',
    'time_off_decided','overtime_warning','shift_reminder',
    'swap_expired','claim_expired',
    'shift_drop_requested','shift_drop_decided'
  ];
begin
  foreach v_type in array v_types loop
    begin
      insert into public.schedule_notifications (
        facility_id, employee_id, notification_type
      ) values (
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        v_type
      );
    exception when others then
      insert into _rls_failures (msg)
      values (format(
        'FAIL: E-6: notification_type %L was REMOVED from the CHECK domain (%s). '
        'A migration restated the constraint and dropped it.', v_type, sqlerrm));
    end;
  end loop;
end$$;

-- And the constraint must still REJECT an unknown value — otherwise a
-- migration that widened it to anything would pass the loop above.
select pg_temp.expect_error(
  $$insert into public.schedule_notifications (
      facility_id, employee_id, notification_type
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'not_a_real_notification_type')$$,
  'E-6: an unknown notification_type is still rejected');
reset role;

set local role postgres;

-- ---------------------------------------------------------------------------
-- FB: Daily Reports form builder — form templates / fields / instances / day
-- locks (migration 235). Covers the four form-builder audit checks:
--   (a) locked-day writes rejected AT THE DATABASE with the UI and server
--       actions bypassed (RLS for staff, the BEFORE trigger for everyone
--       else including module admins);
--   (b) publishing a new template version never alters an existing
--       instance's frozen template_snapshot;
--   (c) cross-facility access blocked by RLS on all four tables;
--   (d) a client-supplied facility_id is refused by RLS WITH CHECK (the
--       server actions additionally never accept one — their input shapes
--       have no facility field; see src/app/reports/daily/instance-actions.ts).
-- Fixture: Fiona holds daily_reports ADMIN in facility A; Alice (staff,
-- module submit + can_submit on the Granted Area) and Bob (facility B) are
-- the standing fixture users.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values ('fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb', 'fiona@fac-a.test')
on conflict (id) do nothing;
insert into public.users (id, facility_id, email, is_super_admin)
values ('fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb',
        '11111111-1111-1111-1111-111111111111', 'fiona@fac-a.test', false)
on conflict (id) do update set facility_id = excluded.facility_id;
insert into public.employees (
  id, facility_id, user_id, role_id, first_name, last_name, email, is_active
)
select 'fbfb4444-fbfb-4fbf-8fbf-fbfbfbfbfbfb'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb'::uuid,
       r.id, 'Fiona', 'Forms', 'fiona@fac-a.test', true
from public.roles r
where r.facility_id = '11111111-1111-1111-1111-111111111111'
  and r.key = 'staff'
on conflict (id) do nothing;
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values
  ('fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb',
   '11111111-1111-1111-1111-111111111111',
   'daily_reports', 'view'::public.user_action, true),
  ('fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb',
   '11111111-1111-1111-1111-111111111111',
   'daily_reports', 'admin'::public.user_action, true)
on conflict (user_id, facility_id, module_name, action) do nothing;

-- Form template v1 (+ two fields) in facility A's Granted Area; one in B.
insert into public.daily_report_form_templates (id, facility_id, area_id, name, version)
values
  ('aaaa1111-f0f0-4aaa-8aaa-aaaa11110001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-da01-aaaa-aaaa-aaaa11110011', 'Event Set Up Form', 1),
  ('bbbb2222-f0f0-4bbb-8bbb-bbbb22220001',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-db01-bbbb-bbbb-bbbb22220011', 'B Form', 1)
on conflict (id) do nothing;
insert into public.daily_report_form_fields
  (id, facility_id, template_id, label, field_type, options, required, sort_order)
values
  ('aaaa1111-f1f1-4aaa-8aaa-aaaa11110001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-f0f0-4aaa-8aaa-aaaa11110001', 'Event name', 'text', null, true, 0),
  ('aaaa1111-f1f1-4aaa-8aaa-aaaa11110002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-f0f0-4aaa-8aaa-aaaa11110001', 'Zone', 'select',
   '["North","South"]'::jsonb, false, 1)
on conflict (id) do nothing;

-- Alice's draft instance for TODAY, carrying the frozen v1 snapshot.
insert into public.daily_report_instances
  (id, facility_id, area_id, report_date, title, template_id,
   template_snapshot, responses, status, employee_id)
values
  ('aaaa1111-f2f2-4aaa-8aaa-aaaa11110001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-da01-aaaa-aaaa-aaaa11110011', current_date, 'Friday Night Game',
   'aaaa1111-f0f0-4aaa-8aaa-aaaa11110001',
   '{"template_id":"aaaa1111-f0f0-4aaa-8aaa-aaaa11110001","template_name":"Event Set Up Form","version":1,"fields":[{"id":"aaaa1111-f1f1-4aaa-8aaa-aaaa11110001","label":"Event name","field_type":"text","options":null,"required":true,"sort_order":0}]}'::jsonb,
   '{}'::jsonb, 'draft', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict (id) do nothing;

-- Baseline: on an UNLOCKED day Alice can edit her own draft, so any failure
-- below is unambiguously the lock (or fence) under test.
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_ok(
  $$update public.daily_report_instances
      set responses = '{"aaaa1111-f1f1-4aaa-8aaa-aaaa11110001":"Hockey Night"}'::jsonb
    where id = 'aaaa1111-f2f2-4aaa-8aaa-aaaa11110001'$$,
  'FB: alice CAN save her own draft instance on an unlocked day');

-- (b) Publishing a NEW VERSION (the only "edit" path) leaves existing
-- instances untouched: Fiona inserts v2 with supersedes_id and stamps v1.
set local request.jwt.claims to '{"sub":"fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb', true);
select pg_temp.expect_ok(
  $$insert into public.daily_report_form_templates
      (id, facility_id, area_id, name, version, supersedes_id)
    values ('aaaa1111-f0f0-4aaa-8aaa-aaaa11110002',
            '11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'Event Set Up Form', 2,
            'aaaa1111-f0f0-4aaa-8aaa-aaaa11110001')$$,
  'FB: daily_reports module admin CAN publish a new template version');
select pg_temp.expect_ok(
  $$update public.daily_report_form_templates
      set superseded_at = now(),
          superseded_by = 'aaaa1111-f0f0-4aaa-8aaa-aaaa11110002'
    where id = 'aaaa1111-f0f0-4aaa-8aaa-aaaa11110001'
      and superseded_at is null$$,
  'FB: module admin CAN stamp the old version superseded');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_instances
    where id = 'aaaa1111-f2f2-4aaa-8aaa-aaaa11110001'
      and (template_snapshot->>'version')::int = 1
      and template_snapshot->'fields'->0->>'label' = 'Event name'$$,
  1, 'FB: (b) existing instance still renders its FROZEN v1 snapshot after the v2 publish');
-- The supersede chain cannot branch: a second "publish" against the same v1
-- head hits the partial unique index on supersedes_id.
select pg_temp.expect_error(
  $$insert into public.daily_report_form_templates
      (facility_id, area_id, name, version, supersedes_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011',
            'Rogue publish', 3,
            'aaaa1111-f0f0-4aaa-8aaa-aaaa11110001')$$,
  'FB: a concurrent second publish of the same head is rejected (unique supersedes_id)');

-- (c) Cross-facility isolation: Bob (facility B) sees nothing of facility A
-- and cannot write into it. A yesterday-lock in facility A also stays
-- invisible to him (and visible to Alice, who holds module view).
set local role postgres;
insert into public.daily_report_day_locks (facility_id, report_date)
values ('11111111-1111-1111-1111-111111111111', current_date - 1)
on conflict (facility_id, report_date) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_form_templates
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  0, 'FB: (c) bob CANNOT SELECT facility A form templates');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_form_fields
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  0, 'FB: (c) bob CANNOT SELECT facility A form fields');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_instances
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  0, 'FB: (c) bob CANNOT SELECT facility A report instances');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_day_locks
    where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  0, 'FB: (c) bob CANNOT SELECT facility A day locks');
select pg_temp.expect_error(
  $$insert into public.daily_report_instances
      (facility_id, area_id, report_date, title, template_id,
       template_snapshot, responses, status, employee_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011', current_date, 'Spoofed',
            'aaaa1111-f0f0-4aaa-8aaa-aaaa11110002',
            '{"template_id":"x","template_name":"x","version":2,"fields":[]}'::jsonb,
            '{}'::jsonb, 'draft', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'FB: (c)(d) bob CANNOT INSERT an instance carrying facility A''s facility_id');

-- (d) Alice tagging HER insert with facility B's id is refused by the same
-- WITH CHECK fence (facility_id = current_facility_id()). Staff also cannot
-- write day locks at all — locking is module-admin only.
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$insert into public.daily_report_instances
      (facility_id, area_id, report_date, title, template_id,
       template_snapshot, responses, status, employee_id)
    values ('22222222-2222-2222-2222-222222222222',
            'bbbb2222-db01-bbbb-bbbb-bbbb22220011', current_date, 'Wrong facility',
            'bbbb2222-f0f0-4bbb-8bbb-bbbb22220001',
            '{"template_id":"x","template_name":"x","version":1,"fields":[]}'::jsonb,
            '{}'::jsonb, 'draft', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'FB: (d) alice CANNOT INSERT an instance carrying facility B''s facility_id');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_day_locks
    where facility_id = '11111111-1111-1111-1111-111111111111'
      and report_date = current_date - 1$$,
  1, 'FB: alice (module view) CAN see her facility''s locked days');
select pg_temp.expect_error(
  $$insert into public.daily_report_day_locks (facility_id, report_date)
    values ('11111111-1111-1111-1111-111111111111', current_date)$$,
  'FB: staff alice CANNOT lock a day (module-admin only)');

-- (a) The end-of-day lock, with every app layer bypassed. Fiona (module
-- admin) locks today through RLS; from that moment EVERY direct write to the
-- day's instances is rejected at the DB — staff by RLS+trigger, and the
-- module admin herself by the BEFORE trigger (RLS alone would allow her).
set local request.jwt.claims to '{"sub":"fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb', true);
select pg_temp.expect_ok(
  $$insert into public.daily_report_day_locks (facility_id, report_date, locked_by)
    values ('11111111-1111-1111-1111-111111111111', current_date,
            'fbfb4444-fbfb-4fbf-8fbf-fbfbfbfbfbfb')$$,
  'FB: (a) daily_reports module admin CAN lock today');
select pg_temp.expect_count(
  $$select count(*) where public.daily_report_day_is_locked(
      '11111111-1111-1111-1111-111111111111', current_date)$$,
  1, 'FB: (a) daily_report_day_is_locked() reports today locked');
select pg_temp.expect_error(
  $$update public.daily_report_instances
      set title = 'Admin edit on locked day'
    where id = 'aaaa1111-f2f2-4aaa-8aaa-aaaa11110001'$$,
  'FB: (a) even the module ADMIN cannot edit an instance on a locked day (trigger)');
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$insert into public.daily_report_instances
      (facility_id, area_id, report_date, title, template_id,
       template_snapshot, responses, status, employee_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-da01-aaaa-aaaa-aaaa11110011', current_date, 'After lock',
            'aaaa1111-f0f0-4aaa-8aaa-aaaa11110002',
            '{"template_id":"x","template_name":"x","version":2,"fields":[]}'::jsonb,
            '{}'::jsonb, 'draft', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'FB: (a) staff CANNOT create an instance on a locked day');
-- A staff UPDATE on a locked day is refused by RLS ROW-FILTERING, not an
-- exception: the owner branch's USING requires `not daily_report_day_is_locked`,
-- so the row never matches and the write touches ZERO rows — nothing is
-- persisted, and the server action surfaces the zero-row result via .select().
select pg_temp.expect_count(
  $$with upd as (
      update public.daily_report_instances
         set responses = '{"aaaa1111-f1f1-4aaa-8aaa-aaaa11110001":"tampered"}'::jsonb
       where id = 'aaaa1111-f2f2-4aaa-8aaa-aaaa11110001'
       returning 1)
    select count(*) from upd$$,
  0, 'FB: (a) staff draft save on a locked day matches ZERO rows (RLS filter)');
select pg_temp.expect_count(
  $$select count(*) from public.daily_report_instances
    where id = 'aaaa1111-f2f2-4aaa-8aaa-aaaa11110001'
      and responses->>'aaaa1111-f1f1-4aaa-8aaa-aaaa11110001' = 'Hockey Night'$$,
  1, 'FB: (a) the locked-day save persisted NOTHING (responses unchanged)');

-- Unlock restores writes — proving the failures above were the lock itself.
set local role postgres;
delete from public.daily_report_day_locks
 where facility_id = '11111111-1111-1111-1111-111111111111'
   and report_date = current_date;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_ok(
  $$update public.daily_report_instances
      set responses = '{"aaaa1111-f1f1-4aaa-8aaa-aaaa11110001":"Hockey Night II"}'::jsonb
    where id = 'aaaa1111-f2f2-4aaa-8aaa-aaaa11110001'$$,
  'FB: unlocking the day restores the owner''s draft writes');

-- Submitted instances are append-only for staff: the owner's post-submit
-- UPDATE matches ZERO rows (RLS owner branch requires status = draft), the
-- silent-0-row shape the server action detects via .select().
select pg_temp.expect_ok(
  $$update public.daily_report_instances
      set status = 'submitted', submitted_at = now()
    where id = 'aaaa1111-f2f2-4aaa-8aaa-aaaa11110001' and status = 'draft'$$,
  'FB: the owner CAN make the one-way draft -> submitted transition');
select pg_temp.expect_count(
  $$with upd as (
      update public.daily_report_instances
         set responses = '{"aaaa1111-f1f1-4aaa-8aaa-aaaa11110001":"tampered"}'::jsonb
       where id = 'aaaa1111-f2f2-4aaa-8aaa-aaaa11110001'
       returning 1)
    select count(*) from upd$$,
  0, 'FB: staff post-submit edit matches zero rows (submitted = append-only)');
reset role;

set local role postgres;

-- ---------------------------------------------------------------------------
-- ice_operations_submissions.operation_type domain coverage.
--
-- Same enumerated-CHECK sharp edge as schedule_notifications (E-6 above):
-- widening means DROP + ADD with the whole list restated, and a missed value
-- silently narrows the domain. Migration 236 added 'propane_tank_change'.
-- Inserting one submission of EVERY permitted value turns a lost value into a
-- CI failure here instead of a broken staff form in production. When a
-- migration legitimately adds an operation type, add it to this list too.
-- ---------------------------------------------------------------------------
do $$
declare
  v_type text;
  v_types text[] := array[
    'ice_make','circle_check','edging','blade_change','propane_tank_change'
  ];
begin
  foreach v_type in array v_types loop
    begin
      insert into public.ice_operations_submissions (
        facility_id, employee_id, operation_type
      ) values (
        '11111111-1111-1111-1111-111111111111',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        v_type
      );
    exception when others then
      insert into _rls_failures (msg)
      values (format(
        'FAIL: ice-ops domain: operation_type %L was REMOVED from the CHECK domain (%s). '
        'A migration restated the constraint and dropped it.', v_type, sqlerrm));
    end;
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Surface results.
-- ---------------------------------------------------------------------------
reset role;

-- ---------------------------------------------------------------------------
-- 2ab. Dasher Boards retention (migration 239).
--
-- purge_old_dasher_boards_inspections() is a SECURITY DEFINER bulk-deleter
-- wired into the run-retention-purge cron, so — like the migration-134/138
-- workers — the EXECUTE grant (service_role only) IS the gate.
--
-- Also asserts the retention_module_floors row exists. Without it the
-- migration-208 trigger rejects every dasher_boards retention rule a facility
-- tries to save, which would make the new module row in the admin UI unusable.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_error(
  $$select public.purge_old_dasher_boards_inspections()$$,
  'PURGE-239: authenticated CANNOT execute purge_old_dasher_boards_inspections');

reset role;
set local role anon;

select pg_temp.expect_error(
  $$select public.purge_old_dasher_boards_inspections()$$,
  'PURGE-239: anon CANNOT execute purge_old_dasher_boards_inspections');

reset role;
set local role service_role;

select pg_temp.expect_ok(
  $$select public.purge_old_dasher_boards_inspections()$$,
  'PURGE-239: service_role CAN execute purge_old_dasher_boards_inspections');

reset role;

select pg_temp.expect_count(
  $$select 1 from public.retention_module_floors where module_key = 'dasher_boards'$$,
  1,
  'RETENTION-239: dasher_boards has a retention floor row');

-- An unresolved issue is a live safety defect, so the purge must never take it
-- however old the walk that raised it is. Assert the manual purge keeps it:
-- purge_module_data deletes only issues with resolved_at set.
select pg_temp.expect_count(
  $$select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'purge_module_data'
       and pg_get_functiondef(p.oid) like '%resolved_at is not null%'$$,
  1,
  'RETENTION-239: purge_module_data only purges RESOLVED dasher_boards issues');

-- ===========================================================================
-- Module 12: Rink Scheduling & Billing (migrations 247-250). Label prefix RS.
--
-- Covers, in order: the auto-seed trigger; tenant isolation on every new
-- table; the four-tier gate mapping (view/submit/edit/admin standing in for
-- the spec's staff/supervisor/facility_manager/org_admin); the tentative-only
-- INSERT rule that splits supervisor from facility_manager; the booking
-- overlap exclusion constraint; append-only payments; one-live-invoice-per-
-- booking; the anon lockout on the display-token table; and (DISP) the anon
-- lockout on every table the public locker-room display reads.
-- ===========================================================================

set local role postgres;

-- The facilities fixture above fires facilities_seed_rink_scheduling, so both
-- facilities already carry booking types, customer types, payment methods,
-- settings, an invoice counter and a default rate card. Assert that before
-- relying on it.
select pg_temp.expect_count(
  $$select count(*) from public.rink_booking_types
     where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  7, 'RS1: facility auto-seed created the 7 booking types');

select pg_temp.expect_count(
  $$select count(*) from public.rink_scheduling_settings
     where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  1, 'RS2: facility auto-seed created a settings row for facility B too');

select pg_temp.expect_count(
  $$select count(*) from public.facility_operating_hours
     where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  7, 'RS3: facility auto-seed created a full Mon-Sun operating hours grid');

-- Rinks in BOTH facilities.
insert into public.facility_rinks (id, facility_id, name, slug, short_code, sort_order)
values
  ('a5000001-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'A Main', 'a-main', 'AMAIN', 0),
  ('b5000002-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222',
   'B Main', 'b-main', 'BMAIN', 0)
on conflict (id) do nothing;

insert into public.facility_locker_rooms (id, facility_id, name, slug, short_code, sort_order)
values
  ('a5000001-0000-4000-8000-000000001dd1', '11111111-1111-1111-1111-111111111111',
   'A Locker 1', 'a-locker-1', 'A1', 0)
on conflict (id) do nothing;

insert into public.rink_customers (id, facility_id, name)
values
  ('a5000001-0000-4000-8000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   'A Hockey Club'),
  ('b5000002-0000-4000-8000-0000000000c2', '22222222-2222-2222-2222-222222222222',
   'B Hockey Club')
on conflict (id) do nothing;

-- One booking per facility, using each facility's own seeded Ice Rental type.
insert into public.rink_bookings
  (id, facility_id, rink_id, customer_id, booking_type_id, starts_at, ends_at,
   buffer_minutes_after, status)
select 'a5000001-0000-4000-8000-0000000000b1',
       '11111111-1111-1111-1111-111111111111',
       'a5000001-0000-4000-8000-000000000001',
       'a5000001-0000-4000-8000-0000000000c1',
       bt.id, '2026-10-01 18:00:00-04', '2026-10-01 19:00:00-04', 15, 'confirmed'
from public.rink_booking_types bt
where bt.facility_id = '11111111-1111-1111-1111-111111111111' and bt.slug = 'ice-rental'
on conflict (id) do nothing;

insert into public.rink_bookings
  (id, facility_id, rink_id, customer_id, booking_type_id, starts_at, ends_at,
   buffer_minutes_after, status)
select 'b5000002-0000-4000-8000-0000000000b2',
       '22222222-2222-2222-2222-222222222222',
       'b5000002-0000-4000-8000-000000000002',
       'b5000002-0000-4000-8000-0000000000c2',
       bt.id, '2026-10-01 18:00:00-04', '2026-10-01 19:00:00-04', 15, 'confirmed'
from public.rink_booking_types bt
where bt.facility_id = '22222222-2222-2222-2222-222222222222' and bt.slug = 'ice-rental'
on conflict (id) do nothing;

-- An invoice in each facility, so the money-is-edit-tier assertions are real.
insert into public.rink_invoices
  (id, facility_id, customer_id, invoice_number, status, issue_date, due_date,
   subtotal, tax_amount, total)
values
  ('a5000001-0000-4000-8000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   'a5000001-0000-4000-8000-0000000000c1', 'INV-1', 'draft',
   date '2026-10-02', date '2026-11-01', 100, 0, 100),
  ('b5000002-0000-4000-8000-0000000000f2', '22222222-2222-2222-2222-222222222222',
   'b5000002-0000-4000-8000-0000000000c2', 'INV-1', 'draft',
   date '2026-10-02', date '2026-11-01', 100, 0, 100)
on conflict (id) do nothing;

insert into public.rink_display_tokens (id, facility_id, token_hash, label)
values
  ('a5000001-0000-4000-8000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   repeat('a', 64), 'A Lobby TV'),
  ('b5000002-0000-4000-8000-0000000000d2', '22222222-2222-2222-2222-222222222222',
   repeat('b', 64), 'B Lobby TV')
on conflict (id) do nothing;

-- Alice: SUPERVISOR tier in Facility A (view + submit, deliberately NOT edit).
-- Carol: FACILITY_MANAGER tier in Facility A (view + submit + edit, NOT admin).
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'rink_scheduling', a::public.user_action, true
from unnest(array['view', 'submit']) as a
on conflict (user_id, facility_id, module_name, action) do nothing;

insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
select 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       'rink_scheduling', a::public.user_action, true
from unnest(array['view', 'submit', 'edit']) as a
on conflict (user_id, facility_id, module_name, action) do nothing;

-- ---------------------------------------------------------------------------
-- Alice — supervisor tier, Facility A.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from public.facility_rinks
     where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  1, 'RS4: alice CAN read her own facility''s rinks');

select pg_temp.expect_count(
  $$select count(*) from public.facility_rinks
     where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'RS5: alice CANNOT read facility B''s rinks');

select pg_temp.expect_count(
  $$select count(*) from public.rink_bookings$$,
  1, 'RS6: alice sees only her own facility''s bookings (1 of 2)');

select pg_temp.expect_count(
  $$select count(*) from public.rink_customers$$,
  1, 'RS7: alice sees only her own facility''s customers');

-- Money is edit-tier: a supervisor sees no invoices at all, even her own
-- facility's.
select pg_temp.expect_count(
  $$select count(*) from public.rink_invoices$$,
  0, 'RS8: alice (no edit grant) sees NO invoices, not even her own facility''s');

select pg_temp.expect_count(
  $$select count(*) from public.rink_payments$$,
  0, 'RS9: alice (no edit grant) sees no payments');

-- Display tokens carry token hashes; supervisors must not read them.
select pg_temp.expect_count(
  $$select count(*) from public.rink_display_tokens$$,
  0, 'RS10: alice (no edit grant) CANNOT read display tokens');

-- Rate cards are submit-tier readable (the booking sheet's rate preview).
select pg_temp.expect_count(
  $$select count(*) from public.rink_rate_cards$$,
  1, 'RS11: alice (submit grant) CAN read her facility''s rate card for rate preview');

-- One arithmetic probe pins all four helper tiers at once.
select pg_temp.expect_count(
  $$select (case when public.has_module_access('rink_scheduling') then 1 else 0 end)
        + (case when public.has_module_submit_access('rink_scheduling') then 10 else 0 end)
        + (case when public.has_module_edit_access('rink_scheduling') then 0 else 100 end)
        + (case when public.has_module_admin_access('rink_scheduling') then 0 else 1000 end)$$,
  1111, 'RS12: helper tiers — alice has view+submit but NOT edit and NOT admin');

-- THE supervisor/facility_manager split: tentative yes, confirmed no.
select pg_temp.expect_ok(
  $$insert into public.rink_bookings
      (facility_id, rink_id, customer_id, booking_type_id, starts_at, ends_at, status)
    select '11111111-1111-1111-1111-111111111111',
           'a5000001-0000-4000-8000-000000000001',
           'a5000001-0000-4000-8000-0000000000c1', bt.id,
           '2026-10-02 09:00:00-04', '2026-10-02 10:00:00-04', 'tentative'
    from public.rink_booking_types bt
    where bt.facility_id = '11111111-1111-1111-1111-111111111111' and bt.slug = 'ice-rental'$$,
  'RS13: alice (submit) CAN create a TENTATIVE booking');

select pg_temp.expect_error(
  $$insert into public.rink_bookings
      (facility_id, rink_id, customer_id, booking_type_id, starts_at, ends_at, status)
    select '11111111-1111-1111-1111-111111111111',
           'a5000001-0000-4000-8000-000000000001',
           'a5000001-0000-4000-8000-0000000000c1', bt.id,
           '2026-10-02 11:00:00-04', '2026-10-02 12:00:00-04', 'confirmed'
    from public.rink_booking_types bt
    where bt.facility_id = '11111111-1111-1111-1111-111111111111' and bt.slug = 'ice-rental'$$,
  'RS14: alice (submit, no edit) CANNOT create a CONFIRMED booking');

-- Editing/confirming an existing booking is edit-tier: the UPDATE matches no
-- rows rather than erroring, which is how RLS denies an UPDATE.
select pg_temp.expect_count(
  $$with u as (
      update public.rink_bookings set status = 'confirmed'
       where id = 'a5000001-0000-4000-8000-0000000000b1'
       returning 1)
    select count(*) from u$$,
  0, 'RS15: alice (no edit grant) CANNOT confirm/edit a booking (0 rows match)');

-- Cross-tenant write attempt: naming facility B explicitly must still fail.
select pg_temp.expect_error(
  $$insert into public.facility_rinks (facility_id, name, slug, short_code)
    values ('22222222-2222-2222-2222-222222222222', 'Rogue', 'rogue', 'RGE')$$,
  'RS16: alice CANNOT create a rink in facility B');

-- Locker room assignment is the supervisor's other write capability.
select pg_temp.expect_ok(
  $$insert into public.rink_locker_room_assignments
      (facility_id, booking_id, locker_room_id, occupies_from, occupies_until, display_label_override)
    values ('11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-0000000000b1',
            'a5000001-0000-4000-8000-000000001dd1',
            '2026-10-01 17:15:00-04', '2026-10-01 19:30:00-04', 'Home')$$,
  'RS17: alice (submit) CAN assign a locker room to a booking');

-- Locker room overlaps are ALLOWED BY DESIGN — fast turnover is normal.
select pg_temp.expect_ok(
  $$insert into public.rink_locker_room_assignments
      (facility_id, booking_id, locker_room_id, occupies_from, occupies_until)
    select '11111111-1111-1111-1111-111111111111', b.id,
           'a5000001-0000-4000-8000-000000001dd1',
           '2026-10-01 19:00:00-04', '2026-10-01 20:00:00-04'
      from public.rink_bookings b
     where b.starts_at = '2026-10-02 09:00:00-04'
       and b.facility_id = '11111111-1111-1111-1111-111111111111'$$,
  'RS18: overlapping locker room occupancy is ALLOWED (warned in UI, not blocked)');

-- The booking overlap constraint fires for ordinary users too, buffer included.
select pg_temp.expect_error(
  $$insert into public.rink_bookings
      (facility_id, rink_id, customer_id, booking_type_id, starts_at, ends_at, status)
    select '11111111-1111-1111-1111-111111111111',
           'a5000001-0000-4000-8000-000000000001',
           'a5000001-0000-4000-8000-0000000000c1', bt.id,
           '2026-10-01 19:05:00-04', '2026-10-01 20:00:00-04', 'tentative'
    from public.rink_booking_types bt
    where bt.facility_id = '11111111-1111-1111-1111-111111111111' and bt.slug = 'ice-rental'$$,
  'RS19: a booking landing inside the 15-minute resurfacing buffer is REJECTED');

-- ---------------------------------------------------------------------------
-- Carol — facility_manager tier, Facility A.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select count(*) from public.rink_invoices$$,
  1, 'RS20: carol (edit grant) CAN read her own facility''s invoices — and only those');

select pg_temp.expect_count(
  $$select count(*) from public.rink_display_tokens$$,
  1, 'RS21: carol (edit grant) CAN read her own facility''s display tokens only');

select pg_temp.expect_ok(
  $$update public.rink_bookings set status = 'confirmed'
     where id = 'a5000001-0000-4000-8000-0000000000b1'$$,
  'RS22: carol (edit) CAN confirm a booking');

-- Rate cards and module settings are the ADMIN tier — carol must be refused.
select pg_temp.expect_error(
  $$insert into public.rink_rate_cards
      (facility_id, name, effective_start, is_default, hourly_rate_prime, hourly_rate_nonprime)
    values ('11111111-1111-1111-1111-111111111111', 'Rogue Card', date '2027-01-01', false, 500, 400)$$,
  'RS23: carol (edit, no admin) CANNOT create a rate card');

select pg_temp.expect_count(
  $$with u as (
      update public.rink_scheduling_settings set tax_rate = 0.5
       where facility_id = '11111111-1111-1111-1111-111111111111'
       returning 1)
    select count(*) from u$$,
  0, 'RS24: carol (edit, no admin) CANNOT change module settings (0 rows match)');

-- Money: append-only, and never against a void invoice.
select pg_temp.expect_ok(
  $$insert into public.rink_payments
      (facility_id, invoice_id, amount, payment_date)
    values ('11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-0000000000f1', 40.00, date '2026-10-05')$$,
  'RS25: carol (edit) CAN record a payment');

-- Two layers, asserted separately. At the RLS layer there is simply no
-- UPDATE/DELETE policy, so the statement matches zero rows rather than
-- raising — that is how RLS denies a write, and asserting an error here would
-- be asserting the wrong thing.
select pg_temp.expect_count(
  $$with u as (
      update public.rink_payments set amount = 999
       where invoice_id = 'a5000001-0000-4000-8000-0000000000f1'
       returning 1)
    select count(*) from u$$,
  0, 'RS26: RLS layer — carol CANNOT update a payment (no policy; 0 rows match)');

select pg_temp.expect_count(
  $$with d as (
      delete from public.rink_payments
       where invoice_id = 'a5000001-0000-4000-8000-0000000000f1'
       returning 1)
    select count(*) from d$$,
  0, 'RS27: RLS layer — carol CANNOT delete a payment (no policy; 0 rows match)');

-- One live invoice per booking.
select pg_temp.expect_ok(
  $$insert into public.rink_invoice_line_items
      (facility_id, invoice_id, booking_id, description, quantity_hours, unit_rate, amount)
    values ('11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-0000000000f1',
            'a5000001-0000-4000-8000-0000000000b1',
            'Ice Rental - A Main - 2026-10-01 18:00-19:00', 1.00, 100.00, 100.00)$$,
  'RS28: carol CAN add a line item billing a booking');

set local role postgres;
insert into public.rink_invoices
  (id, facility_id, customer_id, invoice_number, status, issue_date, due_date, subtotal, tax_amount, total)
values ('a5000001-0000-4000-8000-0000000000f3', '11111111-1111-1111-1111-111111111111',
        'a5000001-0000-4000-8000-0000000000c1', 'INV-3', 'draft',
        date '2026-10-02', date '2026-11-01', 100, 0, 100)
on conflict (id) do nothing;
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_error(
  $$insert into public.rink_invoice_line_items
      (facility_id, invoice_id, booking_id, description, quantity_hours, unit_rate, amount)
    values ('11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-0000000000f3',
            'a5000001-0000-4000-8000-0000000000b1',
            'Double-billed', 1.00, 100.00, 100.00)$$,
  'RS29: the SAME booking CANNOT appear on a second live invoice');

-- Voiding the first invoice releases its booking back to uninvoiced.
select pg_temp.expect_ok(
  $$update public.rink_invoices
       set status = 'void', voided_at = now()
     where id = 'a5000001-0000-4000-8000-0000000000f1'$$,
  'RS30: carol CAN void an invoice');

select pg_temp.expect_ok(
  $$insert into public.rink_invoice_line_items
      (facility_id, invoice_id, booking_id, description, quantity_hours, unit_rate, amount)
    values ('11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-0000000000f3',
            'a5000001-0000-4000-8000-0000000000b1',
            'Re-billed after void', 1.00, 100.00, 100.00)$$,
  'RS31: voiding RELEASES the booking — it can be billed on a new invoice');

select pg_temp.expect_error(
  $$update public.rink_invoices set status = 'draft'
     where id = 'a5000001-0000-4000-8000-0000000000f1'$$,
  'RS32: a VOID invoice is terminal and cannot be reopened');

-- ---------------------------------------------------------------------------
-- Bob (facility B) and anon.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);

select pg_temp.expect_count(
  $$select count(*) from public.rink_bookings
     where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  0, 'RS33: bob (facility B, no grant) CANNOT read facility A bookings');

reset role;
set local role anon;

select pg_temp.expect_count(
  $$select count(*) from public.rink_bookings$$,
  0, 'RS34: anon reads NO bookings (every policy is TO authenticated)');

select pg_temp.expect_count(
  $$select count(*) from public.rink_display_tokens$$,
  0, 'RS35: anon CANNOT read display tokens — the public display never touches this table directly');

select pg_temp.expect_count(
  $$select count(*) from public.rink_invoices$$,
  0, 'RS36: anon reads no invoices');

-- ---------------------------------------------------------------------------
-- Public locker-room display (/display/[token]). Label prefix DISP.
--
-- The display endpoint reads with the SERVICE-ROLE key inside a Route Handler
-- that has already resolved the token, precisely so that `anon` keeps zero
-- grants on the tables it reads. That is a claim about the database, so it is
-- asserted here rather than trusted to the handler: if a future migration ever
-- adds an anon-readable policy to make the display "simpler", these fail.
-- ---------------------------------------------------------------------------
select pg_temp.expect_count(
  $$select count(*) from public.facility_locker_rooms$$,
  0, 'DISP1: anon reads NO locker rooms — the board is served by the Route Handler, not by RLS');

select pg_temp.expect_count(
  $$select count(*) from public.rink_locker_room_assignments$$,
  0, 'DISP2: anon reads NO locker room assignments');

-- As with RS26/RS27: no policy for this role means the statement matches zero
-- rows, not that it raises. Asserting an error would assert the wrong thing.
select pg_temp.expect_count(
  $$with u as (
      update public.rink_display_tokens set last_seen_at = now()
       returning 1)
    select count(*) from u$$,
  0, 'DISP3: anon CANNOT stamp last_seen_at (no policy; 0 rows match) — only the service-role handler does');

reset role;

-- Structural: no Module 12 policy names anon at all. RS34-36 and DISP1-2 each
-- prove one table; this proves the rule, so a new table added to the module
-- cannot quietly arrive with an anon policy nobody wrote an assertion for.
set local role postgres;
select pg_temp.expect_count(
  $$select count(*) from pg_policies
     where schemaname = 'public'
       and (tablename like 'rink\_%' or tablename like 'facility\_locker\_%')
       and 'anon' = any (roles)$$,
  0, 'DISP4: no Rink Scheduling policy grants anything to anon');
reset role;

-- ---------------------------------------------------------------------------
-- Structural guarantees.
-- ---------------------------------------------------------------------------
set local role postgres;

-- Trigger layer: `postgres` bypasses RLS entirely, so this proves the
-- append-only rule survives direct SQL and is not merely a policy artifact.
select pg_temp.expect_error(
  $$update public.rink_payments set amount = 999
     where invoice_id = 'a5000001-0000-4000-8000-0000000000f1'$$,
  'RS26b: trigger layer — direct-SQL UPDATE of a payment RAISES');

select pg_temp.expect_error(
  $$delete from public.rink_payments
     where invoice_id = 'a5000001-0000-4000-8000-0000000000f1'$$,
  'RS27b: trigger layer — direct-SQL DELETE of a payment RAISES');

-- The documented escape hatch still works for an owner role that opts in
-- explicitly, and only for one.
select set_config('rr.rink_scheduling_guard_bypass', 'on', true);
select pg_temp.expect_ok(
  $$update public.rink_payments set notes = 'corrected by operator'
     where invoice_id = 'a5000001-0000-4000-8000-0000000000f1'$$,
  'RS27c: an owner role that explicitly sets the bypass GUC CAN repair a payment');
select set_config('rr.rink_scheduling_guard_bypass', 'off', true);

select pg_temp.expect_count(
  $$select count(*) from pg_constraint
     where conname = 'rink_bookings_no_overlap' and contype = 'x'$$,
  1, 'RS37: the booking overlap EXCLUSION constraint exists');

select pg_temp.expect_count(
  $$select count(*) from pg_constraint
     where conname = 'rink_rate_cards_no_default_overlap' and contype = 'x'$$,
  1, 'RS38: default rate cards cannot overlap in time (exclusion constraint exists)');

-- Two default cards covering the same dates would make rate resolution
-- ambiguous.
select pg_temp.expect_error(
  $$insert into public.rink_rate_cards
      (facility_id, name, effective_start, effective_end, is_default,
       hourly_rate_prime, hourly_rate_nonprime)
    values ('11111111-1111-1111-1111-111111111111', 'Overlapping Default',
            date '2020-01-01', null, true, 10, 10)$$,
  'RS39: a second overlapping DEFAULT rate card is REJECTED');

-- The coverage debounce: one pending row per facility, so a whole publish
-- batch collapses into a single evaluation pass.
insert into public.rink_coverage_reeval_queue (facility_id, reason)
values ('11111111-1111-1111-1111-111111111111', 'shift_change')
on conflict do nothing;

select pg_temp.expect_error(
  $$insert into public.rink_coverage_reeval_queue (facility_id, reason)
    values ('11111111-1111-1111-1111-111111111111', 'shift_change')$$,
  'RS40: only ONE pending coverage re-evaluation per facility (publish debounce)');

-- The module must be registered, or every has_module_* helper returns false.
select pg_temp.expect_ok(
  $$insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '11111111-1111-1111-1111-111111111111', 'rink_scheduling', 'admin', true)
    on conflict (user_id, facility_id, module_name, action) do nothing$$,
  'RS41: rink_scheduling is an accepted user_permissions.module_name');

select pg_temp.expect_count(
  $$select count(*) from public.facility_modules
     where module_key = 'rink_scheduling'
       and facility_id in ('11111111-1111-1111-1111-111111111111',
                           '22222222-2222-2222-2222-222222222222')$$,
  2, 'RS42: rink_scheduling is registered as a nav toggle for both fixture facilities');

-- Retired role keys must never reappear in the new module's seed matrix.
select pg_temp.expect_count(
  $$select count(*) from public.canonical_role_permission_grants()
     where module_name = 'rink_scheduling' and role_key in ('gm', 'supervisor')$$,
  0, 'RS43: the rink_scheduling grant matrix contains NO retired role keys');

reset role;

-- Retention (migration 251). Financial records, so the floor is the point.
select pg_temp.expect_count(
  $$select count(*) from public.retention_module_floors
     where module_key = 'rink_scheduling' and min_days = 2555$$,
  1, 'RETENTION-250: rink_scheduling carries a 7-year (2555 day) retention floor');

-- A booking still cited by an invoice line is billing evidence and must survive
-- the purge whatever its age; without the NOT EXISTS guard the delete would hit
-- the ON DELETE RESTRICT FK and abort the whole purge run.
select pg_temp.expect_count(
  $$select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'purge_module_data'
       and pg_get_functiondef(p.oid) like '%rink_invoice_line_items li%'
       and pg_get_functiondef(p.oid) like '%not exists%'$$,
  1, 'RETENTION-250: purge_module_data KEEPS bookings cited by an invoice line');

-- Configuration must never be purged by age: deleting a customer or rate card
-- would orphan newer bookings and strand the snapshots justifying past invoices.
select pg_temp.expect_count(
  $$select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'purge_module_data'
       and pg_get_functiondef(p.oid) not like '%delete from public.rink_customers%'
       and pg_get_functiondef(p.oid) not like '%delete from public.rink_rate_cards%'
       and pg_get_functiondef(p.oid) not like '%delete from public.facility_rinks%'$$,
  1, 'RETENTION-250: the purge never deletes customers, rate cards or rinks');

set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$select public.purge_old_rink_scheduling_records()$$,
  'PURGE-250: authenticated CANNOT execute purge_old_rink_scheduling_records');

reset role;
set local role anon;
select pg_temp.expect_error(
  $$select public.purge_old_rink_scheduling_records()$$,
  'PURGE-250: anon CANNOT execute purge_old_rink_scheduling_records');

reset role;
set local role service_role;
select pg_temp.expect_ok(
  $$select public.purge_old_rink_scheduling_records()$$,
  'PURGE-250: service_role CAN execute purge_old_rink_scheduling_records');

reset role;

-- Coverage detection (migration 253). Label prefix COV.
--
-- The trigger on schedule_shifts is the only place this module touches another
-- module's table, so these assertions pin down exactly what it may do: enqueue
-- into a Rink Scheduling table, never write to scheduling, and never be able to
-- break a publish.

set local role postgres;

select pg_temp.expect_count(
  $$select count(*) from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'schedule_shifts'
       and t.tgname = 'trg_rink_scheduling_shift_coverage'
       and not t.tgisinternal$$,
  1, 'COV1: the coverage trigger is installed on schedule_shifts');

-- The read-only-integration guarantee, asserted against the function body.
select pg_temp.expect_count(
  $$select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'rink_scheduling_enqueue_on_shift_change'
       and pg_get_functiondef(p.oid) like '%rink_coverage_reeval_queue%'
       and pg_get_functiondef(p.oid) not like '%update public.schedule%'
       and pg_get_functiondef(p.oid) not like '%insert into public.schedule%'
       and pg_get_functiondef(p.oid) not like '%delete from public.schedule%'$$,
  1, 'COV2: the trigger writes ONLY the coverage queue — never a scheduling table');

select pg_temp.expect_count(
  $$select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='rink_scheduling_enqueue_on_shift_change'
       and has_function_privilege('authenticated', p.oid, 'execute')$$,
  0, 'COV3: the trigger function is not callable by authenticated');

-- Publishing a whole week must produce ONE evaluation pass, not one per shift.
insert into public.employees (id, facility_id, role_id, first_name, last_name, email, is_active)
select 'aaaa1111-c091-aaaa-aaaa-aaaa11110077'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       r.id, 'Cov', 'Sweeper', 'cov@fac-a.test', true
  from public.roles r
 where r.facility_id = '11111111-1111-1111-1111-111111111111' and r.key = 'staff'
 limit 1
on conflict (id) do nothing;

delete from public.rink_coverage_reeval_queue
 where facility_id = '11111111-1111-1111-1111-111111111111';

insert into public.schedule_shifts (facility_id, employee_id, starts_at, ends_at, status)
select '11111111-1111-1111-1111-111111111111',
       'aaaa1111-c091-aaaa-aaaa-aaaa11110077',
       '2028-01-03 08:00:00-05'::timestamptz + (n || ' days')::interval,
       '2028-01-03 16:00:00-05'::timestamptz + (n || ' days')::interval,
       'draft'
  from generate_series(1, 20) n;

select pg_temp.expect_count(
  $$select count(*) from public.rink_coverage_reeval_queue
     where facility_id = '11111111-1111-1111-1111-111111111111' and status = 'pending'$$,
  0, 'COV4: creating DRAFT shifts enqueues nothing — drafts provide no coverage');

update public.schedule_shifts
   set status = 'published', published_at = now()
 where facility_id = '11111111-1111-1111-1111-111111111111'
   and starts_at >= '2028-01-01';

select pg_temp.expect_count(
  $$select count(*) from public.rink_coverage_reeval_queue
     where facility_id = '11111111-1111-1111-1111-111111111111' and status = 'pending'$$,
  1, 'COV5: publishing 20 shifts in one statement produces exactly ONE pending pass');

-- One open alert per booking, so a five-minute sweep updates rather than piles up.
select pg_temp.expect_count(
  $$select count(*) from pg_indexes
     where schemaname = 'public'
       and indexname = 'communication_alerts_rink_scheduling_open_uniq'$$,
  1, 'COV6: the one-open-alert-per-booking index exists');

insert into public.communication_alerts
  (facility_id, source_module, source_record_id, severity, title, body)
values ('11111111-1111-1111-1111-111111111111', 'rink_scheduling',
        'a5000001-0000-4000-8000-0000000000b1', 'warn', 'Ice booked without cover', 'first');

select pg_temp.expect_error(
  $$insert into public.communication_alerts
      (facility_id, source_module, source_record_id, severity, title, body)
    values ('11111111-1111-1111-1111-111111111111', 'rink_scheduling',
            'a5000001-0000-4000-8000-0000000000b1', 'warn', 'Ice booked without cover', 'duplicate')$$,
  'COV7: a SECOND unresolved alert for the same booking is REJECTED');

-- Once resolved, a later recurrence may legitimately open a fresh alert.
update public.communication_alerts
   set resolved_at = now()
 where facility_id = '11111111-1111-1111-1111-111111111111'
   and source_module = 'rink_scheduling';

select pg_temp.expect_ok(
  $$insert into public.communication_alerts
      (facility_id, source_module, source_record_id, severity, title, body)
    values ('11111111-1111-1111-1111-111111111111', 'rink_scheduling',
            'a5000001-0000-4000-8000-0000000000b1', 'warn', 'Ice booked without cover', 'reopened')$$,
  'COV8: after the gap clears and returns, a NEW alert is allowed');

-- The index must not constrain any other module.
select pg_temp.expect_ok(
  $$insert into public.communication_alerts
      (facility_id, source_module, source_record_id, severity, title, body)
    values ('11111111-1111-1111-1111-111111111111', 'refrigeration',
            'a5000001-0000-4000-8000-0000000000b1', 'warn', 'Other module', 'one'),
           ('11111111-1111-1111-1111-111111111111', 'refrigeration',
            'a5000001-0000-4000-8000-0000000000b1', 'warn', 'Other module', 'two')$$,
  'COV9: other modules may still hold several open alerts for one record');

reset role;

-- ===========================================================================
-- Module 12 invoicing & AR (migrations 247, 254). Label prefix AR.
--
-- Money rules asserted at BOTH layers, the way the dasher_boards block does:
-- what RLS refuses for an ordinary user, and what the guard trigger refuses
-- even for direct SQL from a non-exempt owner session.
-- ===========================================================================

set local role postgres;

insert into public.rink_customers (id, facility_id, name)
values ('a9990001-0000-4000-8000-00000000000c',
        '11111111-1111-1111-1111-111111111111', 'AR Test Club')
on conflict (id) do nothing;

insert into public.rink_bookings
  (id, facility_id, rink_id, customer_id, booking_type_id, starts_at, ends_at,
   buffer_minutes_after, status, computed_amount)
select 'a9990001-0000-4000-8000-00000000000b',
       '11111111-1111-1111-1111-111111111111',
       'a5000001-0000-4000-8000-000000000001',
       'a9990001-0000-4000-8000-00000000000c',
       bt.id, '2027-05-04 18:00:00-04', '2027-05-04 20:00:00-04', 15, 'confirmed', 600
from public.rink_booking_types bt
where bt.facility_id = '11111111-1111-1111-1111-111111111111' and bt.slug = 'ice-rental'
on conflict (id) do nothing;

insert into public.rink_invoices
  (id, facility_id, customer_id, invoice_number, status, issue_date, due_date,
   subtotal, tax_amount, total)
values
  ('a9990001-0000-4000-8000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   'a9990001-0000-4000-8000-00000000000c', 'AR-0001', 'draft',
   date '2027-05-05', date '2027-06-04', 600, 0, 600),
  ('a9990001-0000-4000-8000-0000000000f2', '11111111-1111-1111-1111-111111111111',
   'a9990001-0000-4000-8000-00000000000c', 'AR-0002', 'draft',
   date '2027-05-05', date '2027-06-04', 600, 0, 600)
on conflict (id) do nothing;

-- A booking reaches at most ONE live invoice.
select pg_temp.expect_ok(
  $$insert into public.rink_invoice_line_items
      (facility_id, invoice_id, booking_id, description, quantity_hours, unit_rate, amount)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f1',
            'a9990001-0000-4000-8000-00000000000b', 'Ice', 2, 300, 600)$$,
  'AR1: a booking can be billed on an invoice');

select pg_temp.expect_error(
  $$insert into public.rink_invoice_line_items
      (facility_id, invoice_id, booking_id, description, quantity_hours, unit_rate, amount)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2',
            'a9990001-0000-4000-8000-00000000000b', 'Ice again', 2, 300, 600)$$,
  'AR2: the SAME booking CANNOT appear on a second live invoice');

-- Voiding releases the booking: the propagate trigger flips its lines to
-- voided, dropping them out of the partial unique index.
select pg_temp.expect_ok(
  $$update public.rink_invoices set status = 'void', voided_at = now()
     where id = 'a9990001-0000-4000-8000-0000000000f1'$$,
  'AR3: an invoice can be voided');

select pg_temp.expect_count(
  $$select count(*) from public.rink_invoice_line_items
     where invoice_id = 'a9990001-0000-4000-8000-0000000000f1' and voided$$,
  1, 'AR4: voiding an invoice marks its line items voided');

select pg_temp.expect_ok(
  $$insert into public.rink_invoice_line_items
      (facility_id, invoice_id, booking_id, description, quantity_hours, unit_rate, amount)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2',
            'a9990001-0000-4000-8000-00000000000b', 'Re-billed', 2, 300, 600)$$,
  'AR5: voiding RELEASES the booking to be billed again');

-- Money: append-only, correctly signed, reversible exactly once.
update public.rink_invoices set status = 'sent', sent_at = now()
 where id = 'a9990001-0000-4000-8000-0000000000f2';

select pg_temp.expect_ok(
  $$insert into public.rink_payments (id, facility_id, invoice_id, amount, payment_date)
    values ('a9990001-0000-4000-8000-00000000a0a1',
            '11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2', 250, date '2027-05-10')$$,
  'AR6: a payment can be recorded against a sent invoice');

select pg_temp.expect_error(
  $$insert into public.rink_payments (facility_id, invoice_id, amount, payment_date)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2', -250, date '2027-05-11')$$,
  'AR7: a negative amount that reverses nothing is REJECTED');

select pg_temp.expect_ok(
  $$insert into public.rink_payments
      (facility_id, invoice_id, amount, payment_date, reverses_payment_id)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2', -250, date '2027-05-11',
            'a9990001-0000-4000-8000-00000000a0a1')$$,
  'AR8: a proper reversal row is accepted');

select pg_temp.expect_error(
  $$insert into public.rink_payments
      (facility_id, invoice_id, amount, payment_date, reverses_payment_id)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2', -250, date '2027-05-12',
            'a9990001-0000-4000-8000-00000000a0a1')$$,
  'AR9: the same payment CANNOT be reversed twice (no double credit)');

-- Trigger layer: `postgres` bypasses RLS and is deliberately NOT guard-exempt,
-- so these prove the lock survives direct SQL.
select pg_temp.expect_error(
  $$update public.rink_payments set amount = 999
     where id = 'a9990001-0000-4000-8000-00000000a0a1'$$,
  'AR10: trigger layer — a payment cannot be edited');

select pg_temp.expect_error(
  $$delete from public.rink_payments
     where id = 'a9990001-0000-4000-8000-00000000a0a1'$$,
  'AR11: trigger layer — a payment cannot be deleted');

select pg_temp.expect_error(
  $$insert into public.rink_payments (facility_id, invoice_id, amount, payment_date)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f1', 10, date '2027-05-13')$$,
  'AR12: trigger layer — no payment against a VOID invoice (migration 254)');

-- Overpayment backstop (migration 257). Invoice f2 totals 600 with a net paid
-- of 0 (AR6's 250 was reversed by AR8), so 601 must be refused, 600 exactly
-- must land, and once settled even a cent more must be refused — while a
-- reversal (negative) always passes because it only shrinks the sum.
select pg_temp.expect_error(
  $$insert into public.rink_payments (facility_id, invoice_id, amount, payment_date)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2', 601, date '2027-05-14')$$,
  'AR15: trigger layer — a payment past the invoice total is REJECTED (migration 257)');

select pg_temp.expect_ok(
  $$insert into public.rink_payments (id, facility_id, invoice_id, amount, payment_date)
    values ('a9990001-0000-4000-8000-00000000a0a2',
            '11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2', 600, date '2027-05-14')$$,
  'AR16: a payment settling the invoice EXACTLY is accepted');

select pg_temp.expect_error(
  $$insert into public.rink_payments (facility_id, invoice_id, amount, payment_date)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2', 0.01, date '2027-05-15')$$,
  'AR17: once settled, even one more cent is REJECTED');

select pg_temp.expect_ok(
  $$insert into public.rink_payments
      (facility_id, invoice_id, amount, payment_date, reverses_payment_id)
    values ('11111111-1111-1111-1111-111111111111',
            'a9990001-0000-4000-8000-0000000000f2', -600, date '2027-05-15',
            'a9990001-0000-4000-8000-00000000a0a2')$$,
  'AR18: a reversal is never blocked by the overpayment guard');

-- Reminder settings (migration 257): the cadence CHECK mirrors the app's
-- validation, and the columns default to reminders-on / weekly.
select pg_temp.expect_error(
  $$update public.rink_scheduling_settings set reminder_cadence_days = 0
     where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  'AR19: a reminder cadence outside 1-90 days is REJECTED by the CHECK');

select pg_temp.expect_count(
  $$select count(*) from public.rink_scheduling_settings
     where facility_id = '11111111-1111-1111-1111-111111111111'
       and overdue_reminders_enabled and not send_booking_confirmations
       and reminder_cadence_days between 1 and 90$$,
  1, 'AR20: reminder defaults — nagging on, confirmations opt-in, sane cadence');

-- Money is edit-tier: alice holds view+submit only and must see none of it.
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from public.rink_invoice_line_items$$,
  0, 'AR13: a submit-only user sees no invoice lines');

select pg_temp.expect_count(
  $$select count(*) from public.rink_payments$$,
  0, 'AR14: a submit-only user sees no payments');

reset role;

-- ---------------------------------------------------------------------------
-- PS: migration 258 public surfaces — token types, booking requests, waitlist.
--
-- The display_type CHECK was widened by DROP + ADD (Postgres has no "add a
-- value"), so a restatement that lost one would silently NARROW the domain.
-- Inserting a row of every permitted value is the CI tripwire, same pattern
-- as schedule_notifications.
-- ---------------------------------------------------------------------------

select pg_temp.expect_ok(
  $$insert into public.rink_display_tokens (facility_id, token_hash, label, display_type)
    values
      ('11111111-1111-1111-1111-111111111111', repeat('0', 60) || 'a258', 'PS locker', 'locker_rooms'),
      ('11111111-1111-1111-1111-111111111111', repeat('0', 60) || 'b258', 'PS sched',  'ice_schedule'),
      ('11111111-1111-1111-1111-111111111111', repeat('0', 60) || 'c258', 'PS ics',    'rink_ics'),
      ('11111111-1111-1111-1111-111111111111', repeat('0', 60) || 'd258', 'PS form',   'request_form')$$,
  'PS1: every permitted display_type value inserts (CHECK not narrowed)');

select pg_temp.expect_error(
  $$insert into public.rink_display_tokens (facility_id, token_hash, label, display_type)
    values ('11111111-1111-1111-1111-111111111111', repeat('0', 60) || 'e258', 'PS bad', 'jumbotron')$$,
  'PS2: an unknown display_type is REJECTED');

-- Seed one request per facility (as postgres — the app path is the service
-- role behind the tokened Route Handler; authenticated must have NO insert).
insert into public.rink_booking_requests
  (id, facility_id, requester_name, requester_email, requested_date, start_minute, end_minute, purpose)
values
  ('a2580001-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Jordan Vaughn', 'jordan@club.test', date '2027-06-01', 1020, 1110, 'League practice'),
  ('a2580001-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Foreign Requester', 'other@club.test', date '2027-06-01', 600, 720, null)
on conflict (id) do nothing;

-- Carol (edit tier, Facility A) works the inbox; the other facility's
-- requests do not exist for her.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_count(
  $$select count(*) from public.rink_booking_requests$$,
  1, 'PS3: carol (edit) sees her facility''s requests and ONLY those');

select pg_temp.expect_error(
  $$insert into public.rink_booking_requests
      (facility_id, requester_name, requester_email, requested_date, start_minute, end_minute)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky', 's@x.test',
            date '2027-06-02', 600, 700)$$,
  'PS4: authenticated CANNOT insert a request through PostgREST (service role only)');

select pg_temp.expect_count(
  $$with u as (
      update public.rink_booking_requests
         set status = 'declined', decided_at = now(), decision_note = 'No ice available'
       where id = 'a2580001-0000-4000-8000-000000000001'
       returning 1)
    select count(*) from u$$,
  1, 'PS5: carol (edit) CAN decide a request');

-- Waitlist: edit tier owns it end to end, facility-scoped.
select pg_temp.expect_ok(
  $$insert into public.rink_waitlist_entries
      (facility_id, contact_name, contact_phone, desired_date, notes)
    values ('11111111-1111-1111-1111-111111111111', 'Casey Mills', '315-555-0199',
            date '2027-06-03', 'Wants Friday evening ice')$$,
  'PS6: carol (edit) CAN add a waitlist entry');

select pg_temp.expect_error(
  $$insert into public.rink_waitlist_entries (facility_id, contact_name, desired_date)
    values ('22222222-2222-2222-2222-222222222222', 'Rogue Entry', date '2027-06-03')$$,
  'PS7: carol CANNOT add a waitlist entry for another facility');

select pg_temp.expect_error(
  $$insert into public.rink_waitlist_entries (facility_id, desired_date)
    values ('11111111-1111-1111-1111-111111111111', date '2027-06-03')$$,
  'PS8: a waitlist entry needs a customer or a contact name (CHECK)');

-- Alice (view+submit, no edit) sees neither surface: requests carry requester
-- PII and the waitlist is desk work.
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from public.rink_booking_requests$$,
  0, 'PS9: alice (submit-only) sees NO booking requests');

select pg_temp.expect_count(
  $$select count(*) from public.rink_waitlist_entries$$,
  0, 'PS10: alice (submit-only) sees NO waitlist entries');

reset role;

-- ---------------------------------------------------------------------------
-- SC: migration 264 season contracts — tier, tenancy, and the composite FKs
-- that make cross-facility binding impossible.
-- ---------------------------------------------------------------------------

-- Fixtures as postgres: a facility-B contract to attack with, and a
-- facility-A series to (fail to) bind it to.
insert into public.rink_customers (id, facility_id, name)
values ('b2640001-0000-4000-8000-0000000000cb', '22222222-2222-2222-2222-222222222222', 'Fac-B League')
on conflict (id) do nothing;

insert into public.rink_season_contracts
  (id, facility_id, customer_id, name, season_start, season_end)
values ('b2640001-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222',
        'b2640001-0000-4000-8000-0000000000cb', 'Fac-B Season', date '2026-09-01', date '2027-03-31')
on conflict (id) do nothing;

insert into public.rink_booking_series
  (id, facility_id, rink_id, customer_id, booking_type_id, days_of_week,
   start_time, end_time, frequency, interval_weeks, series_start_date, series_end_date, status)
select 'a2640001-0000-4000-8000-00000000005e', '11111111-1111-1111-1111-111111111111',
       'a5000001-0000-4000-8000-000000000001', 'a5000001-0000-4000-8000-0000000000c1',
       bt.id, '{2}', '18:00', '19:00', 'weekly', 1, date '2026-09-01', date '2027-03-31', 'active'
from public.rink_booking_types bt
where bt.facility_id = '11111111-1111-1111-1111-111111111111' and bt.slug = 'ice-rental'
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_ok(
  $$insert into public.rink_season_contracts
      (id, facility_id, customer_id, name, season_start, season_end, contract_rate)
    values ('a2640001-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-0000000000c1', '2026-27 Youth League', date '2026-09-01',
            date '2027-03-31', 275.00)$$,
  'SC1: carol (edit) CAN create a season contract for her facility');

select pg_temp.expect_error(
  $$insert into public.rink_season_contracts
      (facility_id, customer_id, name, season_start, season_end)
    values ('22222222-2222-2222-2222-222222222222',
            'b2640001-0000-4000-8000-0000000000cb', 'Rogue Season', date '2026-09-01', date '2027-03-31')$$,
  'SC2: carol CANNOT create a contract in facility B');

select pg_temp.expect_error(
  $$insert into public.rink_season_contracts
      (facility_id, customer_id, name, season_start, season_end)
    values ('11111111-1111-1111-1111-111111111111',
            'b2640001-0000-4000-8000-0000000000cb', 'Stolen Customer', date '2026-09-01', date '2027-03-31')$$,
  'SC3: a contract CANNOT name another facility''s customer (composite FK)');

select pg_temp.expect_error(
  $$insert into public.rink_season_contracts
      (facility_id, customer_id, name, season_start, season_end, invoice_day_of_month)
    values ('11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-0000000000c1', 'Bad Day', date '2026-09-01', date '2027-03-31', 31)$$,
  'SC4: invoice day outside 1-28 is REJECTED (every month must have the day)');

select pg_temp.expect_error(
  $$insert into public.rink_season_contracts
      (facility_id, customer_id, name, season_start, season_end)
    values ('11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-0000000000c1', 'Backwards', date '2027-03-31', date '2026-09-01')$$,
  'SC5: a season ending before it starts is REJECTED');

select pg_temp.expect_ok(
  $$update public.rink_booking_series
       set contract_id = 'a2640001-0000-4000-8000-000000000001'
     where id = 'a2640001-0000-4000-8000-00000000005e'$$,
  'SC6: carol CAN bind her facility''s series to her facility''s contract');

select pg_temp.expect_error(
  $$update public.rink_booking_series
       set contract_id = 'b2640001-0000-4000-8000-000000000001'
     where id = 'a2640001-0000-4000-8000-00000000005e'$$,
  'SC7: binding a series to ANOTHER facility''s contract is IMPOSSIBLE (composite FK)');

select pg_temp.expect_count(
  $$select count(*) from public.rink_season_contracts
     where id = 'b2640001-0000-4000-8000-000000000001'$$,
  0, 'SC8: carol cannot even SEE facility B''s contract');

-- Contracts are money: submit-only staff see none of it.
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select pg_temp.expect_count(
  $$select count(*) from public.rink_season_contracts$$,
  0, 'SC9: alice (submit-only) sees NO season contracts');

reset role;

-- ---------------------------------------------------------------------------
-- RF: migration 265 resurfaces — the type flag, lifecycle coherence, the
-- facility-fenced ice-cut join, and the untouched overlap referee.
-- ---------------------------------------------------------------------------

-- Fixtures as postgres: a resurface booking type for facility A, and one
-- ice-cut submission per facility to attack the composite FK with.
insert into public.rink_booking_types
  (id, facility_id, name, slug, color, is_billable, is_system, sort_order, is_resurface)
values ('a2650001-0000-4000-8000-00000000007b', '11111111-1111-1111-1111-111111111111',
        'Resurface', 'resurface-test', '#56666F', false, false, 99, true)
on conflict (id) do nothing;

insert into public.ice_operations_submissions
  (id, facility_id, operation_type, occurred_at)
values
  ('a2650001-0000-4000-8000-00000000001c', '11111111-1111-1111-1111-111111111111',
   'ice_make', '2027-08-01 12:00:00Z'),
  ('b2650001-0000-4000-8000-00000000001c', '22222222-2222-2222-2222-222222222222',
   'ice_make', '2027-08-01 12:00:00Z')
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_ok(
  $$insert into public.rink_bookings
      (id, facility_id, rink_id, booking_type_id, starts_at, ends_at, status)
    values ('a2650001-0000-4000-8000-0000000000b1',
            '11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-000000000001',
            'a2650001-0000-4000-8000-00000000007b',
            '2027-08-02 18:00:00-04', '2027-08-02 18:15:00-04', 'confirmed')$$,
  'RF1: carol (edit) CAN schedule a resurface (no customer needed)');

select pg_temp.expect_count(
  $$select count(*) from public.rink_bookings
     where id = 'a2650001-0000-4000-8000-0000000000b1'
       and resurface_status = 'scheduled'$$,
  1, 'RF2: a new resurface DEFAULTS to resurface_status = scheduled (trigger)');

select pg_temp.expect_error(
  $$insert into public.rink_bookings
      (facility_id, rink_id, customer_id, booking_type_id, starts_at, ends_at,
       status, resurface_status)
    select '11111111-1111-1111-1111-111111111111',
           'a5000001-0000-4000-8000-000000000001',
           'a5000001-0000-4000-8000-0000000000c1', bt.id,
           '2027-08-03 09:00:00-04', '2027-08-03 10:00:00-04', 'confirmed', 'scheduled'
    from public.rink_booking_types bt
    where bt.facility_id = '11111111-1111-1111-1111-111111111111'
      and bt.slug = 'ice-rental'$$,
  'RF3: a NON-resurface booking CANNOT carry resurface_status');

select pg_temp.expect_error(
  $$update public.rink_bookings
       set ice_cut_submission_id = 'a2650001-0000-4000-8000-00000000001c'
     where id = 'a5000001-0000-4000-8000-0000000000b1'$$,
  'RF4: a NON-resurface booking CANNOT carry an ice-cut link');

select pg_temp.expect_error(
  $$update public.rink_bookings
       set resurface_status = 'polished'
     where id = 'a2650001-0000-4000-8000-0000000000b1'$$,
  'RF5: an unknown resurface_status is REJECTED (CHECK)');

select pg_temp.expect_error(
  $$update public.rink_bookings
       set ice_cut_submission_id = 'b2650001-0000-4000-8000-00000000001c'
     where id = 'a2650001-0000-4000-8000-0000000000b1'$$,
  'RF6: linking ANOTHER facility''s ice-cut record is IMPOSSIBLE (composite FK)');

select pg_temp.expect_ok(
  $$update public.rink_bookings
       set ice_cut_submission_id = 'a2650001-0000-4000-8000-00000000001c',
           resurface_status = 'completed'
     where id = 'a2650001-0000-4000-8000-0000000000b1'$$,
  'RF7: completing a resurface with its own facility''s ice-cut record works');

-- The overlap referee is untouched: a cut occupies the sheet like any other
-- booking, so a second one on the same window is refused.
select pg_temp.expect_error(
  $$insert into public.rink_bookings
      (facility_id, rink_id, booking_type_id, starts_at, ends_at, status)
    values ('11111111-1111-1111-1111-111111111111',
            'a5000001-0000-4000-8000-000000000001',
            'a2650001-0000-4000-8000-00000000007b',
            '2027-08-02 18:05:00-04', '2027-08-02 18:20:00-04', 'confirmed')$$,
  'RF8: a resurface still answers to the overlap referee (no double-cut)');

reset role;

-- Duration settings mirror their CHECKs (as postgres: settings writes are
-- admin-tier under RLS, and a zero-row match would pass vacuously).
select pg_temp.expect_error(
  $$update public.rink_scheduling_settings set default_resurface_minutes = 0
     where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  'RF9: a resurface default outside 1-120 minutes is REJECTED');

select pg_temp.expect_error(
  $$update public.facility_rinks set resurface_minutes_override = 200
     where facility_id = '11111111-1111-1111-1111-111111111111'
       and slug = (select slug from public.facility_rinks
                    where facility_id = '11111111-1111-1111-1111-111111111111' limit 1)$$,
  'RF10: a per-sheet override outside 1-120 minutes is REJECTED');

-- ---------------------------------------------------------------------------
-- GATE-246: cron RPC caller gates (migration 247).
--
-- The first production cron runs proved a `session_user = 'service_role'`
-- branch can NEVER pass through PostgREST (session_user is 'authenticator';
-- inside SECURITY DEFINER current_user is the owner). Migration 246 rebases
-- the three cron-called gates onto auth.role(). Two layers of coverage:
--
--   (a) Functional: a PostgREST-shaped service-role caller (SET ROLE
--       service_role + a JWT claiming role=service_role) can execute all
--       three. Caveat: under this harness session_user stays 'postgres', so
--       (a) alone could not catch a session_user regression — which is what
--       (b) is for.
--   (b) Source pins: each function's definition must contain the auth.role()
--       check and must NOT contain any of the session_user/current_user
--       patterns the old gates used. A future restatement that resurrects
--       them (the known lost-in-restatement failure mode, cf. the
--       notification_type CHECK) fails here instead of in production.
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
-- Both claim shapes, mirroring the impersonation blocks above: the plural
-- `request.jwt.claims` (hosted/newer auth.role()) and the singular
-- `request.jwt.claim.role` (older readers).
set local request.jwt.claims to '{"role":"service_role"}';
select set_config('request.jwt.claim.role', 'service_role', true);

select pg_temp.expect_ok(
  $$select count(*) from public.drain_notification_outbox(1, null)$$,
  'GATE-246: service_role (PostgREST-shaped) CAN execute drain_notification_outbox');

select pg_temp.expect_ok(
  $$select public.verify_all_audit_chains()$$,
  'GATE-246: service_role (PostgREST-shaped) CAN execute verify_all_audit_chains');

select pg_temp.expect_ok(
  $$select public.snapshot_closed_daily_assignment_days()$$,
  'GATE-246: service_role (PostgREST-shaped) CAN execute snapshot_closed_daily_assignment_days');

reset role;

select pg_temp.expect_count(
  $$select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('drain_notification_outbox',
                         'verify_all_audit_chains',
                         'snapshot_closed_daily_assignment_days')
       and pg_get_functiondef(p.oid)
             like '%coalesce(auth.role(), '''') = ''service_role''%'$$,
  3,
  'GATE-246: all three cron RPC gates check auth.role() = service_role');

select pg_temp.expect_count(
  $$select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('drain_notification_outbox',
                         'verify_all_audit_chains',
                         'snapshot_closed_daily_assignment_days')
       and (pg_get_functiondef(p.oid) like '%session_user = ''service_role''%'
         or pg_get_functiondef(p.oid) like '%''postgres'', ''service_role''%'
         or pg_get_functiondef(p.oid) like '%current_user%'
         -- pg_safeupdate (loaded on PostgREST sessions, absent here and in
         -- psql) rejects an unqualified DELETE; migration 255 qualified the
         -- drain's claim-table DELETE with WHERE true and this pin keeps a
         -- future restatement from silently reverting it.
         or pg_get_functiondef(p.oid) like '%delete from _drain_claim;%')$$,
  0,
  'GATE-246: no cron RPC gate matches session_user/current_user against service_role (unreachable via PostgREST)');

-- ---------------------------------------------------------------------------
-- DSL1-16: Dasher Boards custom segment labels / zones / snapshots
-- (migration 257).
--
-- The product invariant under test: custom_label is DISPLAY ONLY — renaming a
-- segment never breaks or reattributes history (label_snapshot is written at
-- log time, server-derived, and frozen), every rename and out-of-service flip
-- writes an asset event (no silent status writes), and zones/labels are
-- facility-isolated like every other dasher table.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;
set local request.jwt.claims to '{}';
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

-- Zone seeding: the rinks AFTER INSERT trigger seeded the standard seven for
-- the fixture rinks (created after migration 257 applied).
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_zones
    where rink_id = 'dab0000a-0000-4000-8000-00000000000a'$$,
  7, 'DSL1: rink trigger seeded the 7 standard zones');

-- Event-type domain canary (the migration 158/234 lost-value lesson): one
-- event of EVERY permitted value must insert; a value lost in a future CHECK
-- restatement fails here instead of in production.
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_asset_events (facility_id, asset_id, event_type)
    select '11111111-1111-1111-1111-111111111111',
           'dabb000a-0000-4000-8000-000000000001', v.t
    from (values
      ('created'), ('converted_to_door'), ('converted_to_board'), ('relabeled'),
      ('deactivated'), ('reactivated'), ('glass_toggled'), ('spec_updated'),
      ('renumbered'), ('marked_out_of_service'), ('returned_to_service')
    ) as v(t)$$,
  'DSL2: every permitted asset event_type value inserts (domain canary)');

-- New segment types are accepted as positioned assets.
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_assets
      (id, facility_id, rink_id, asset_type, label, sequence_position)
    values ('dabb000a-0000-4000-8000-0000000000c1',
            '11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a', 'corner_radius', 'C1', 60)$$,
  'DSL3a: corner_radius assets insert as positioned segments');
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_assets
      (id, facility_id, rink_id, asset_type, label, sequence_position)
    values ('dabb000a-0000-4000-8000-0000000000e1',
            '11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a', 'post_gap', 'P1', 61)$$,
  'DSL3b: post_gap assets insert as positioned segments');

-- Trusted-context asset mutations below (same reasoning as DB22): the guard's
-- documented service bypass stands in for the admin/service tier.
set local rr.dasher_boards_guard_bypass = 'on';

select pg_temp.expect_ok(
  $$update public.dasher_boards_assets
       set custom_label = 'Zam Gate Left'
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DSL4a: setting a custom display label succeeds');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_asset_events
    where asset_id = 'dabb000a-0000-4000-8000-000000000001'
      and event_type = 'relabeled'
      and detail->>'label_kind' = 'custom_label'
      and detail->>'new' = 'Zam Gate Left'$$,
  1, 'DSL4b: the custom relabel auto-wrote a relabeled asset event');

select pg_temp.expect_error(
  $$update public.dasher_boards_assets
       set custom_label = 'zam gate left'
     where id = 'dabb000a-0000-4000-8000-0000000000c1'$$,
  'DSL5: custom labels are case-insensitively unique per rink');

select pg_temp.expect_ok(
  $$update public.dasher_boards_assets
       set out_of_service = true
     where id = 'dabb000a-0000-4000-8000-0000000000c1'$$,
  'DSL6a: marking a segment out of service succeeds');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_asset_events
    where asset_id = 'dabb000a-0000-4000-8000-0000000000c1'
      and event_type = 'marked_out_of_service'$$,
  1, 'DSL6b: the out-of-service flip auto-wrote its asset event (no silent status write)');

-- A zone reference is pinned to the asset's own rink (composite FK).
select pg_temp.expect_error(
  $$update public.dasher_boards_assets
       set zone_id = (select id from public.dasher_boards_zones
                       where rink_id = 'dab0000b-0000-4000-8000-00000000000b'
                         and name = 'North End')
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DSL7a: an asset CANNOT reference a zone of another rink');
select pg_temp.expect_ok(
  $$update public.dasher_boards_assets
       set zone_id = (select id from public.dasher_boards_zones
                       where rink_id = 'dab0000a-0000-4000-8000-00000000000a'
                         and name = 'North End')
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DSL7b: an asset CAN reference a zone of its own rink');

set local rr.dasher_boards_guard_bypass = 'off';

-- A fresh open walk for alice (idempotent against any open walk left by the
-- DB16+ fixtures — at most one open walk per inspector per rink).
insert into public.dasher_boards_inspections (id, facility_id, rink_id, inspector_id)
values ('dabd000a-0000-4000-8000-00000000000f',
        '11111111-1111-1111-1111-111111111111',
        'dab0000a-0000-4000-8000-00000000000a',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict (rink_id, inspector_id) where completed_at is null do nothing;

-- Alice (staff tier: view + submit).
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Snapshots are server-derived: a forged client value is overwritten with the
-- asset's display label at log time.
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_issues
      (id, facility_id, rink_id, asset_id, description, severity, reported_by,
       label_snapshot)
    values ('dabb000a-0000-4000-8000-00000000f001',
            '11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a',
            'dabb000a-0000-4000-8000-000000000001',
            'Scuffed at the zam gate', 'c',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FORGED')$$,
  'DSL8a: staff issue insert with a forged label_snapshot succeeds');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_issues
    where id = 'dabb000a-0000-4000-8000-00000000f001'
      and label_snapshot = 'Zam Gate Left'$$,
  1, 'DSL8b: the snapshot is server-derived (custom label at log time, forgery overwritten)');

select pg_temp.expect_ok(
  $$insert into public.dasher_boards_asset_checks
      (facility_id, inspection_id, asset_id, status, checked_by, label_snapshot)
    select '11111111-1111-1111-1111-111111111111', i.id,
           'dabb000a-0000-4000-8000-0000000000c1', 'pass',
           'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FORGED'
      from public.dasher_boards_inspections i
     where i.rink_id = 'dab0000a-0000-4000-8000-00000000000a'
       and i.inspector_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and i.completed_at is null
     limit 1$$,
  'DSL9a: walk asset check with a forged label_snapshot succeeds');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_asset_checks
    where asset_id = 'dabb000a-0000-4000-8000-0000000000c1'
      and label_snapshot = 'C1'$$,
  1, 'DSL9b: the check snapshot falls back to the permanent label when no custom label is set');

-- Zones: facility-isolated reads; writes stay admin-only.
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_zones
    where rink_id = 'dab0000a-0000-4000-8000-00000000000a'$$,
  7, 'DSL10a: alice CAN read her own rink''s zones');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_zones
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'DSL10b: alice CANNOT read facility B''s zones');
select pg_temp.expect_error(
  $$insert into public.dasher_boards_zones (facility_id, rink_id, name)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a', 'Staff Zone')$$,
  'DSL11a: staff (submit) CANNOT create zones');
select pg_temp.expect_count(
  $$with d as (
      update public.dasher_boards_zones set name = 'Hacked'
      where rink_id = 'dab0000a-0000-4000-8000-00000000000a'
        and name = 'North End' returning 1)
    select count(*) from d$$,
  0, 'DSL11b: staff (submit) zone UPDATE is a 0-row no-op under RLS');

-- Mona (edit tier): may flip out_of_service (a status change — audited by
-- trigger), may NOT touch the display layer (custom_label/aliases/zone_id).
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.expect_ok(
  $$update public.dasher_boards_assets
       set out_of_service = true
     where id = 'dabb000a-0000-4000-8000-000000000002'$$,
  'DSL12a: manager (edit) CAN mark a segment out of service');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_asset_events
    where asset_id = 'dabb000a-0000-4000-8000-000000000002'
      and event_type = 'marked_out_of_service'$$,
  1, 'DSL12b: the edit-tier status change was auto-audited despite the admin-only events policy');
select pg_temp.expect_error(
  $$update public.dasher_boards_assets
       set custom_label = 'Managers Corner'
     where id = 'dabb000a-0000-4000-8000-000000000002'$$,
  'DSL13: manager (edit) CANNOT change custom_label (column guard)');
select pg_temp.expect_error(
  $$update public.dasher_boards_assets
       set zone_id = (select id from public.dasher_boards_zones
                       where rink_id = 'dab0000a-0000-4000-8000-00000000000a'
                         and name = 'South End')
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DSL14: manager (edit) CANNOT change zone_id (column guard)');
select pg_temp.expect_error(
  $$update public.dasher_boards_issues
       set label_snapshot = 'REWRITTEN'
     where id = 'dabb000a-0000-4000-8000-00000000f001'$$,
  'DSL15: label_snapshot is frozen on update (history cannot be rewritten)');

-- THE invariant: renaming a segment never breaks or reattributes history.
set local role postgres;
set local request.jwt.claims to '{}';
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
set local rr.dasher_boards_guard_bypass = 'on';

select pg_temp.expect_ok(
  $$update public.dasher_boards_assets
       set custom_label = 'North 3'
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DSL16a: renaming the segment again succeeds');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_issues
    where id = 'dabb000a-0000-4000-8000-00000000f001'
      and asset_id = 'dabb000a-0000-4000-8000-000000000001'
      and label_snapshot = 'Zam Gate Left'$$,
  1, 'DSL16b: history still reads the label it was logged under — renames never reattribute events');

set local rr.dasher_boards_guard_bypass = 'off';

-- DSL17: tenant pinning of rink_id (the migration-257 composite FKs). RLS
-- validates facility_id against the caller, but rink_id is client-supplied;
-- the (rink_id, facility_id) FKs onto dasher_boards_rinks are what stop a
-- facility-A module admin from placing rows onto facility B's rink and
-- squatting B's per-rink uniqueness domains (zone names, labels, positions).
-- Mona gains the admin grant here — nothing below this point relies on her
-- being edit-only.
insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111',
        'dasher_boards', 'admin', true)
on conflict (user_id, facility_id, module_name, action) do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select pg_temp.expect_error(
  $$insert into public.dasher_boards_zones (facility_id, rink_id, name)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000b-0000-4000-8000-00000000000b', 'Rogue Zone')$$,
  'DSL17a: a facility-A admin CANNOT create a zone on facility B''s rink (composite FK)');
select pg_temp.expect_error(
  $$update public.dasher_boards_assets
       set rink_id = 'dab0000b-0000-4000-8000-00000000000b'
     where id = 'dabb000a-0000-4000-8000-000000000001'$$,
  'DSL17b: a facility-A admin CANNOT retarget an asset onto facility B''s rink (composite FK)');
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_zones (facility_id, rink_id, name)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000a-0000-4000-8000-00000000000a', 'Mezzanine Side')$$,
  'DSL17c: the same admin CAN create a zone on their own facility''s rink');

-- DSL18: the migration-258 transactional RPCs (reorder + bulk label), still
-- as mona (module admin). SECURITY INVOKER: every row passes RLS + the assets
-- column guard, so the admin path works and lower tiers fail loudly.
-- Rink A's active positioned assets at this point: B1X (pos 1), C1 (pos 60),
-- P1 (pos 61).
select pg_temp.expect_ok(
  $$select public.dasher_boards_reorder_assets(
      'dab0000a-0000-4000-8000-00000000000a',
      array['dabb000a-0000-4000-8000-0000000000c1',
            'dabb000a-0000-4000-8000-0000000000e1',
            'dabb000a-0000-4000-8000-000000000001']::uuid[])$$,
  'DSL18a: admin CAN transactionally reorder the rink''s segments');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_assets
    where id = 'dabb000a-0000-4000-8000-000000000001'
      and sequence_position = 3$$,
  1, 'DSL18b: reorder assigned positions 1..N in the given order');
select pg_temp.expect_error(
  $$select public.dasher_boards_reorder_assets(
      'dab0000a-0000-4000-8000-00000000000a',
      array['dabb000a-0000-4000-8000-0000000000c1']::uuid[])$$,
  'DSL18c: a stale/partial reorder list is rejected, not silently applied');
select pg_temp.expect_error(
  $$select public.dasher_boards_apply_custom_labels(
      'dab0000a-0000-4000-8000-00000000000a',
      array['dabb000a-0000-4000-8000-0000000000c1']::uuid[],
      array['north 3']::text[])$$,
  'DSL18d: a bulk label colliding (case-insensitively) with an existing custom label is rejected');
select pg_temp.expect_ok(
  $$select public.dasher_boards_apply_custom_labels(
      'dab0000a-0000-4000-8000-00000000000a',
      array['dabb000a-0000-4000-8000-0000000000c1',
            'dabb000a-0000-4000-8000-0000000000e1']::uuid[],
      array['NW Corner', 'Gap 1']::text[])$$,
  'DSL18e: a clean bulk label batch applies atomically');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_asset_events
    where asset_id = 'dabb000a-0000-4000-8000-0000000000c1'
      and event_type = 'relabeled'
      and detail->>'label_kind' = 'custom_label'
      and detail->>'new' = 'NW Corner'$$,
  1, 'DSL18f: the bulk relabel auto-wrote per-asset relabeled events');

-- Alice (view+submit) can SEE the segments, so the RPC's existence check
-- passes — but her UPDATE matches zero rows under the admin-or-edit policy,
-- which the RPC surfaces as an error instead of a silent no-op.
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$select public.dasher_boards_reorder_assets(
      'dab0000a-0000-4000-8000-00000000000a',
      array['dabb000a-0000-4000-8000-0000000000c1',
            'dabb000a-0000-4000-8000-0000000000e1',
            'dabb000a-0000-4000-8000-000000000001']::uuid[])$$,
  'DSL18g: staff (submit) reorder fails loudly — RLS blocks the writes inside the INVOKER RPC');

-- DSL19: typed-template seeding (migration 258). A fresh rink (zones
-- auto-seeded by the 257 trigger), then mona (module admin) applies a small
-- typed template: labels allocate per prefix, boards get glass children,
-- names resolve against the facility/rink, and a second apply is rejected.
set local role postgres;
set local request.jwt.claims to '{}';
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

insert into public.dasher_boards_rinks (id, facility_id, name, slug) values
  ('dab0000d-0000-4000-8000-00000000000d',
   '11111111-1111-1111-1111-111111111111', 'Rink D', 'rink-d');

set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select pg_temp.expect_ok(
  $$select public.dasher_boards_apply_template(
      'dab0000d-0000-4000-8000-00000000000d',
      array['board_panel', 'door', 'corner_radius', 'post_gap']::text[],
      array[null, 'Zamboni', null, null]::text[],
      array['North End', 'North End', null, 'East Side']::text[])$$,
  'DSL19a: admin CAN seed an empty rink from a typed template');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_assets
    where rink_id = 'dab0000d-0000-4000-8000-00000000000d'$$,
  5, 'DSL19b: 4 positioned segments + the board''s 1:1 glass row were created');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_assets a
    join public.dasher_boards_zones z on z.id = a.zone_id
    where a.rink_id = 'dab0000d-0000-4000-8000-00000000000d'
      and a.label = 'B1' and z.name = 'North End'$$,
  1, 'DSL19c: template zone names resolved to this rink''s zones');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_assets a
    join public.dasher_boards_asset_subtypes s on s.id = a.subtype_id
    where a.rink_id = 'dab0000d-0000-4000-8000-00000000000d'
      and a.label = 'D1' and s.label = 'Zamboni'$$,
  1, 'DSL19d: template door subtypes resolved by name');
select pg_temp.expect_error(
  $$select public.dasher_boards_apply_template(
      'dab0000d-0000-4000-8000-00000000000d',
      array['board_panel']::text[], array[null]::text[], array[null]::text[])$$,
  'DSL19e: a rink with assets cannot be re-templated');

-- DSL19f-i: the negative cases every other module RPC carries, plus the
-- retired-label high-water-mark rule. Two fresh empty rinks: E in facility B
-- (the tenant-isolation target) and F in facility A (tier / validation /
-- retired-label targets). Rink F also gets a surviving retired label — the
-- relabel-then-hard-delete residue an "empty" rink can legitimately hold.
set local role postgres;
set local request.jwt.claims to '{}';
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
insert into public.dasher_boards_rinks (id, facility_id, name, slug) values
  ('dab0000e-0000-4000-8000-00000000000e',
   '22222222-2222-2222-2222-222222222222', 'Rink E', 'rink-e'),
  ('dab0000f-0000-4000-8000-00000000000f',
   '11111111-1111-1111-1111-111111111111', 'Rink F', 'rink-f');
insert into public.dasher_boards_retired_labels (facility_id, rink_id, label) values
  ('11111111-1111-1111-1111-111111111111',
   'dab0000f-0000-4000-8000-00000000000f', 'B1');

-- Mona (facility-A module admin): facility B's empty rink is invisible under
-- her RLS, so the template RPC reports it as not found.
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select pg_temp.expect_error(
  $$select public.dasher_boards_apply_template(
      'dab0000e-0000-4000-8000-00000000000e',
      array['board_panel']::text[], array[null]::text[], array[null]::text[])$$,
  'DSL19f: a facility-A admin CANNOT template another facility''s rink (invisible under RLS)');
select pg_temp.expect_error(
  $$select public.dasher_boards_apply_template(
      'dab0000f-0000-4000-8000-00000000000f',
      array['board_panel', 'door']::text[], array[null]::text[], array[null]::text[])$$,
  'DSL19g: mismatched template array lengths are rejected');

-- Alice (view + submit, same facility): the rink is visible, but the first
-- asset insert fails her RLS WITH CHECK — loud failure, empty rink untouched.
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$select public.dasher_boards_apply_template(
      'dab0000f-0000-4000-8000-00000000000f',
      array['board_panel']::text[], array[null]::text[], array[null]::text[])$$,
  'DSL19h: staff (submit) CANNOT apply a template (RLS insert gate)');

-- Mona again: the surviving retired B1 bumps the counter — labels are never
-- reused, so the template allocates from the high-water mark (B2..), and
-- every created row got its audit event.
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
select pg_temp.expect_ok(
  $$select public.dasher_boards_apply_template(
      'dab0000f-0000-4000-8000-00000000000f',
      array['board_panel', 'board_panel']::text[],
      array[null, null]::text[], array[null, null]::text[])$$,
  'DSL19i: templating over a retired label succeeds');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_assets
    where rink_id = 'dab0000f-0000-4000-8000-00000000000f'
      and label = 'B1'$$,
  0, 'DSL19j: the retired label was never reallocated (counter starts past the high-water mark)');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_assets
    where rink_id = 'dab0000f-0000-4000-8000-00000000000f'
      and label in ('B2', 'B3')$$,
  2, 'DSL19k: allocation continued from the high-water mark (B2, B3)');
select pg_temp.expect_count(
  $$select count(*) from public.dasher_boards_asset_events e
    join public.dasher_boards_assets a on a.id = e.asset_id
    where a.rink_id = 'dab0000f-0000-4000-8000-00000000000f'
      and e.event_type = 'created'
      and e.detail->>'source' = 'template'$$,
  4, 'DSL19l: every template-created asset (2 boards + 2 glass) got its created audit event');

-- DSL20: rink pinning completion (migration 260) — issues, inspections, and
-- checklist items can no longer smuggle a foreign rink_id past the
-- facility-only RLS check. Rink 'dab0000b' belongs to facility B; every row
-- below carries facility A (which passes RLS) and must die on the composite FK.
-- Alice (facility-A submit tier): a checklist-flag issue targeting her own
-- facility's item but facility B's rink.
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_error(
  $$insert into public.dasher_boards_issues
      (facility_id, rink_id, checklist_item_id, description, severity, reported_by)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000b-0000-4000-8000-00000000000b',
            'dabc000a-0000-4000-8000-000000000001',
            'smuggled rink', 'c', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'DSL20a: an issue cannot reference another facility''s rink (composite FK)');
select pg_temp.expect_error(
  $$insert into public.dasher_boards_inspections
      (facility_id, rink_id, inspector_id)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000b-0000-4000-8000-00000000000b',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'DSL20b: an inspection cannot reference another facility''s rink (composite FK)');

-- Mona (facility-A admin): a checklist item on facility B's rink.
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
select pg_temp.expect_error(
  $$insert into public.dasher_boards_checklist_items
      (facility_id, rink_id, label, cadence)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000b-0000-4000-8000-00000000000b',
            'Smuggled item', 'weekly')$$,
  'DSL20c: a checklist item cannot reference another facility''s rink (composite FK)');

-- DSL21: annual contractor inspections (migration 261). The contractor
-- attribution is CHECK-shaped both ways (annual requires a name, routine
-- forbids one), and a completed annual walk is as frozen as any other.
set local role postgres;
set local request.jwt.claims to '{}';
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select pg_temp.expect_error(
  $$insert into public.dasher_boards_inspections
      (facility_id, rink_id, inspector_id, contractor_name)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000d-0000-4000-8000-00000000000d',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Rink Systems Ltd.')$$,
  'DSL21a: a routine walk cannot carry contractor attribution');
select pg_temp.expect_error(
  $$insert into public.dasher_boards_inspections
      (facility_id, rink_id, inspector_id, inspection_kind)
    values ('11111111-1111-1111-1111-111111111111',
            'dab0000d-0000-4000-8000-00000000000d',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'annual_contractor')$$,
  'DSL21b: an annual contractor walk requires the contractor''s name');
select pg_temp.expect_ok(
  $$insert into public.dasher_boards_inspections
      (id, facility_id, rink_id, inspector_id, inspection_kind,
       contractor_name, contractor_company, started_at, completed_at)
    values ('dabd000d-0000-4000-8000-000000000021',
            '11111111-1111-1111-1111-111111111111',
            'dab0000d-0000-4000-8000-00000000000d',
            'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'annual_contractor',
            'Pat Doe', 'Boards & Glass Co.',
            now() - interval '2 hours', now() - interval '1 hour')$$,
  'DSL21c: a completed annual contractor walk records who performed it');
select pg_temp.expect_error(
  $$update public.dasher_boards_inspections
       set inspection_kind = 'routine', contractor_name = null,
           contractor_company = null
     where id = 'dabd000d-0000-4000-8000-000000000021'$$,
  'DSL21d: a completed annual walk is immutable — the attestation cannot be rewritten');

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
