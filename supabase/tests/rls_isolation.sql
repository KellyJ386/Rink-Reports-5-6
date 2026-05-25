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
  'incident_reports',
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

-- ---------------------------------------------------------------------------
-- 2. Impersonate Alice (Facility A) via JWT claims and run cross-tenant checks.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

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
-- the value through. Without this assertion a regression of either
-- function would silently revert ack-required messages to opt-out.
--
-- We can run dispatch + drain here because the `postgres` role of the
-- local stack has both BYPASSRLS and matches the session_user check
-- inside drain_notification_outbox. Each insert is then visible to the
-- subsequent expect_count() query.
-- ---------------------------------------------------------------------------
reset role;
set local role postgres;

-- Two rules in facility A: one ack-required, one not. Both target Alice
-- via her 'staff' role so resolve_rule_recipients returns her.
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

-- Dispatch both, capturing the outbox count so we can verify the column
-- was set on the outbox row itself (the drain reads from this column).
select public.dispatch_rules_for_submission(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'accident_reports',
  'dddd0001-1111-1111-1111-dddddddddddd'::uuid
);
select public.dispatch_rules_for_submission(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'daily_reports',
  'dddd0002-2222-2222-2222-dddddddddddd'::uuid
);

select pg_temp.expect_count(
  $$select count(*) from public.notification_outbox
     where source_record_id = 'dddd0001-1111-1111-1111-dddddddddddd'::uuid
       and requires_acknowledgement = true$$,
  1,
  'M6: outbox row from ack-required rule has requires_acknowledgement=true');

select pg_temp.expect_count(
  $$select count(*) from public.notification_outbox
     where source_record_id = 'dddd0002-2222-2222-2222-dddddddddddd'::uuid
       and requires_acknowledgement = false$$,
  1,
  'M6: outbox row from opt-out rule has requires_acknowledgement=false');

-- Immediate-timing dispatch marks outbox rows status='sent' without
-- creating messages — that's drain's job. Reset them to 'pending' so the
-- drain has work to do, then run drain.
update public.notification_outbox
  set status = 'pending'
  where source_record_id in (
    'dddd0001-1111-1111-1111-dddddddddddd'::uuid,
    'dddd0002-2222-2222-2222-dddddddddddd'::uuid
  );

-- `select *` is the SQL-script equivalent of plpgsql's `perform`.
select * from public.drain_notification_outbox(
  p_max_rows    := 100,
  p_facility_id := '11111111-1111-1111-1111-111111111111'::uuid
);

-- No prior test in this script inserts into communication_messages, so a
-- direct count by the flag is unambiguous: exactly one message of each
-- ack value should exist after drain.
select pg_temp.expect_count(
  $$select count(*) from public.communication_messages
     where requires_acknowledgement = true$$,
  1,
  'M6: drained message from ack-required rule has requires_acknowledgement=true');

select pg_temp.expect_count(
  $$select count(*) from public.communication_messages
     where requires_acknowledgement = false$$,
  1,
  'M6: drained message from opt-out rule has requires_acknowledgement=false');

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
