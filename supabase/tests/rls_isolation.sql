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

insert into public.job_area_certification_requirements
  (id, facility_id, job_area_id, cert_name, is_active)
values
  ('aaaa1111-ce70-aaaa-aaaa-aaaa11110003',
   '11111111-1111-1111-1111-111111111111',
   'aaaa1111-30b0-aaaa-aaaa-aaaa11110002', 'CPR', true),
  ('bbbb2222-ce70-bbbb-bbbb-bbbb22220003',
   '22222222-2222-2222-2222-222222222222',
   'bbbb2222-30b0-bbbb-bbbb-bbbb22220002', 'CPR', true)
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
insert into public.air_quality_locations (id, facility_id, name, slug, sort_order, is_active)
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
   '11111111-1111-1111-1111-111111111111', 'scheduling', 'view', true)
on conflict (user_id, facility_id, module_name, action) do nothing;

-- A-side scheduling rows so Carol's OWN-facility positive assertions are
-- non-empty (proves the migration-129 fix didn't over-restrict admins).
insert into public.schedule_availability (
  id, facility_id, employee_id, day_of_week, start_time, end_time
) values ('aaaa1111-a011-aaaa-aaaa-aaaa11110090',
          '11111111-1111-1111-1111-111111111111',
          'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 3, '09:00', '17:00')
on conflict (id) do nothing;

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

-- Roles: Alice can see her facility's roles, not Bob's.
select pg_temp.expect_count(
  $$select count(*) from public.roles where facility_id = '11111111-1111-1111-1111-111111111111'$$,
  6, 'alice can SELECT roles in her facility (6 system roles)');

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
-- a requirement even in her own facility.
select pg_temp.expect_error(
  $$insert into public.job_area_certification_requirements
      (facility_id, job_area_id, cert_name)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaa1111-30b0-aaaa-aaaa-aaaa11110002', 'Sneaky Cert')$$,
  'cert requirements: staff alice CANNOT INSERT a requirement');

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

select pg_temp.expect_error(
  $$insert into public.ice_depth_rinks
      (facility_id, name, slug)
    values
      ('22222222-2222-2222-2222-222222222222', 'Sneaky Rink', 'sneaky')$$,
  'ice_depth: alice CANNOT INSERT a rink into facility B');

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
--   (b) anon CANNOT touch public.rate_limit_counters directly (RLS enabled,
--       no policies — reachable only through the SECURITY DEFINER function).
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

-- (b) anon cannot read or write the counters table directly. RLS is enabled
-- with no policies, so SELECT returns 0 rows (no error) and INSERT is blocked.
select pg_temp.expect_count(
  $$select count(*) from public.rate_limit_counters$$,
  0, 'RL: anon CANNOT SELECT rate_limit_counters directly (no policy)');

select pg_temp.expect_error(
  $$insert into public.rate_limit_counters
      (bucket, identifier, window_start, hits)
    values ('rls_test', 'forged', now(), 1)$$,
  'RL: anon CANNOT INSERT into rate_limit_counters directly');

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
