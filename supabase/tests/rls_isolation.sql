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

-- INSERT into facility B should fail.
select pg_temp.expect_error(
  $$insert into public.module_permissions (
      facility_id, employee_id, module_key, permission_level
    ) values (
      '22222222-2222-2222-2222-222222222222',
      'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'daily_reports',
      'view'
    )$$,
  'alice CANNOT INSERT module_permissions into facility B');

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
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $$select public.drain_notification_outbox(500)$$,
  'M5: drain_notification_outbox rejects authenticated callers');

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
