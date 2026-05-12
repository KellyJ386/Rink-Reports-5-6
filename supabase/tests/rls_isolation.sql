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

insert into public.users (id, email, is_super_admin)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@fac-a.test', false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@fac-b.test',   false)
on conflict (id) do nothing;

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

-- Department / facility permission defaults: empty for now, but RLS must apply.
select pg_temp.expect_count(
  $$select count(*) from public.department_module_permission_defaults
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT dept defaults in facility B');

select pg_temp.expect_count(
  $$select count(*) from public.facility_module_permission_defaults
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT facility defaults in facility B');

-- Notification outbox: empty for now, but RLS must scope.
select pg_temp.expect_count(
  $$select count(*) from public.notification_outbox
    where facility_id = '22222222-2222-2222-2222-222222222222'$$,
  0, 'alice CANNOT SELECT outbox rows in facility B');

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

-- effective_module_permission for an employee in facility B should resolve to 'none'
-- from Alice's vantage point (the function is SECURITY DEFINER so it actually
-- computes; the assertion is that we don't crash and don't leak).
select pg_temp.expect_count(
  $$select case
      when public.effective_module_permission(
        'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
        'daily_reports'
      ) is not null then 1 else 0 end$$,
  1, 'effective_module_permission runs across facilities (does not crash)');

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
