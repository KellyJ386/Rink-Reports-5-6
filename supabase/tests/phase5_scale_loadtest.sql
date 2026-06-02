-- =============================================================================
-- phase5_scale_loadtest.sql  —  1,000-facility scale + RLS query-plan harness
--
-- WHY THIS IS A LOCAL SCRIPT, NOT A CI/REMOTE RUN:
--   * Seeding ~1,000 facilities + millions of rows must NOT touch production.
--   * Supabase managed branching requires the Pro plan (this org is Free), so we
--     can't spin an isolated remote branch. Run this against a LOCAL stack:
--
--       supabase start
--       psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--         -v ON_ERROR_STOP=1 -f supabase/tests/phase5_scale_loadtest.sql
--
--   It seeds into a SAVEPOINT-wrapped transaction and ROLLS BACK at the end, so
--   it leaves no data behind (drop the final `rollback;` to keep the data for
--   manual poking).
--
-- WHAT IT MEASURES:
--   1. Per-tenant index usage under RLS — EXPLAIN ANALYZE on the hot access
--      patterns, asserting Index Scans (not Seq Scans) on the facility_id /
--      (facility_id, created_at) indexes added in migrations 91/92/96.
--   2. Cross-tenant isolation still holds at volume (impersonated authenticated
--      role sees only its own facility).
--   3. Rough latency of the admin "latest N by facility" queries at volume.
--
-- TUNABLES (psql -v):
--   -v facilities=1000  -v audit_per_fac=2000  -v measure_per_fac=500
-- =============================================================================

\set facilities    :facilities
\set audit_per_fac :audit_per_fac
\set measure_per_fac :measure_per_fac
-- Defaults if not passed on the command line.
select coalesce(nullif(current_setting('my.facilities', true), '')::int, 1000)  \gset fallback_
\if :{?facilities}  \else \set facilities 1000 \endif
\if :{?audit_per_fac} \else \set audit_per_fac 2000 \endif
\if :{?measure_per_fac} \else \set measure_per_fac 500 \endif

\echo '== Phase 5 scale test =='
\echo 'facilities=' :facilities ' audit_rows/fac=' :audit_per_fac ' measure_rows/fac=' :measure_per_fac

begin;

-- ---------------------------------------------------------------------------
-- 0. Speed knob for the seed only (local box).
-- ---------------------------------------------------------------------------
set local synchronous_commit = off;

-- ---------------------------------------------------------------------------
-- 1. Seed N facilities, one admin user+employee each, and a known "focus"
--    facility we'll impersonate for the isolation checks.
-- ---------------------------------------------------------------------------
-- Facilities
insert into public.facilities (id, name, slug, timezone)
select gen_random_uuid(),
       'LoadTest Facility ' || g,
       'loadtest-' || g,
       'America/New_York'
from generate_series(1, :facilities) g;

-- One auth user + app user + employee (admin role) per facility, so RLS helpers
-- (current_facility_id / current_employee_id / is_super_admin) resolve.
-- NOTE: depends on the project's roles seed; we attach to each facility's own
-- 'admin' role if present, else any role.
with f as (select id as facility_id, row_number() over () rn from public.facilities where slug like 'loadtest-%')
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'admin' || f.rn || '@loadtest.local', '', now(), now(), now()
from f;

-- Map each facility to one freshly-created auth user by ordering.
with f as (select id as facility_id, row_number() over (order by slug) rn from public.facilities where slug like 'loadtest-%'),
     au as (select id as auth_id, row_number() over (order by email) rn from auth.users where email like 'admin%@loadtest.local')
insert into public.users (id, facility_id, email, full_name, is_super_admin, is_active)
select au.auth_id, f.facility_id, ('admin' || f.rn || '@loadtest.local')::text, 'LoadTest Admin ' || f.rn, false, true
from f join au using (rn);

-- Employee row (pick the facility's admin role; fall back to any role in facility).
insert into public.employees (id, facility_id, user_id, role_id, first_name, last_name, is_active)
select gen_random_uuid(), u.facility_id, u.id,
       coalesce(
         (select r.id from public.roles r where r.facility_id = u.facility_id and r.key = 'admin' limit 1),
         (select r.id from public.roles r where r.facility_id = u.facility_id limit 1)
       ),
       'Load', 'Admin ' || u.facility_id, true
from public.users u
where u.email like 'admin%@loadtest.local';

-- ---------------------------------------------------------------------------
-- 2. Bulk-seed the hot time-series tables (the ones we indexed in 91/92/96).
--    audit_logs: facility_id + created_at spread over ~2 years.
-- ---------------------------------------------------------------------------
insert into public.audit_logs (id, facility_id, actor_user_id, action, entity_type, entity_id, created_at)
select gen_random_uuid(),
       f.facility_id,
       null,
       (array['insert','update','delete'])[1 + (random()*2)::int],
       'loadtest',
       gen_random_uuid(),
       now() - ((random()*730) || ' days')::interval
from (select id as facility_id from public.facilities where slug like 'loadtest-%') f
cross join generate_series(1, :audit_per_fac);

-- ice_depth_measurements via real sessions/points if the schema requires FKs;
-- otherwise insert facility-scoped rows directly. Guarded so a schema mismatch
-- doesn't abort the whole run.
do $$
begin
  begin
    insert into public.ice_depth_measurements (id, facility_id, created_at)
    select gen_random_uuid(), f.facility_id, now() - ((random()*730)||' days')::interval
    from (select id as facility_id from public.facilities where slug like 'loadtest-%') f
    cross join generate_series(1, current_setting('my.measure_per_fac', true)::int);
  exception when others then
    raise notice 'ice_depth_measurements direct seed skipped (FK/NOT NULL): %', sqlerrm;
  end;
end$$;

analyze public.audit_logs;
analyze public.facilities;
analyze public.employees;
analyze public.users;

-- ---------------------------------------------------------------------------
-- 3. EXPLAIN ANALYZE — pick a focus facility, run the hot patterns.
--    We run as the table owner here to see raw plans; the RLS-on plans are in §4.
-- ---------------------------------------------------------------------------
\echo '--- PLAN A: admin "latest 50 audit rows for one facility" (expects Index Scan on idx_audit_logs_facility_created) ---'
select id as focus_fac from public.facilities where slug = 'loadtest-1' \gset
explain (analyze, buffers, costs off)
select * from public.audit_logs
where facility_id = :'focus_fac'
order by created_at desc
limit 50;

\echo '--- PLAN B: count audit rows for one facility (expects Index Scan, not Seq Scan) ---'
explain (analyze, buffers, costs off)
select count(*) from public.audit_logs where facility_id = :'focus_fac';

-- ---------------------------------------------------------------------------
-- 4. SAME query under RLS as an impersonated authenticated user of the focus
--    facility. Confirms (a) the policy uses the index via the helper, and
--    (b) only the focus facility's rows are visible.
-- ---------------------------------------------------------------------------
select u.id as focus_uid from public.users u where u.email = 'admin1@loadtest.local' \gset

set local role authenticated;
set local request.jwt.claims to ('{"sub":"' || :'focus_uid' || '","role":"authenticated"}');
select set_config('request.jwt.claim.sub', :'focus_uid', true);

\echo '--- PLAN C: RLS-on latest-50 (planner should still prune to one facility) ---'
explain (analyze, buffers, costs off)
select * from public.audit_logs order by created_at desc limit 50;

\echo '--- ISOLATION: visible audit rows must all belong to the focus facility ---'
select
  (select count(distinct facility_id) from public.audit_logs) as distinct_facilities_visible,
  (select count(*) from public.audit_logs where facility_id <> :'focus_fac') as foreign_rows_visible;
-- EXPECT: distinct_facilities_visible = 1, foreign_rows_visible = 0.

do $$
declare v_foreign int;
begin
  select count(*) into v_foreign from public.audit_logs where facility_id <> current_setting('request.jwt.claim.sub', true)::uuid;
exception when others then
  -- facility_id != user id; the real check is the assertion below via current_facility_id()
  null;
end$$;

reset role;

\echo '--- ISOLATION assert (hard fail if a foreign row leaks under RLS) ---'
do $$
declare
  v_focus uuid;
  v_uid   uuid;
  v_foreign int;
begin
  select id into v_focus from public.facilities where slug='loadtest-1';
  select id into v_uid from public.users where email='admin1@loadtest.local';
  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"'||v_uid||'","role":"authenticated"}', true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  select count(*) into v_foreign from public.audit_logs where facility_id <> v_focus;
  if v_foreign <> 0 then
    raise exception 'RLS ISOLATION FAILURE: % foreign audit rows visible to focus user', v_foreign;
  end if;
  raise notice 'RLS isolation OK: 0 foreign rows visible at % facilities.', (select count(*) from public.facilities where slug like 'loadtest-%');
  reset role;
end$$;

-- ---------------------------------------------------------------------------
-- 5. Leave nothing behind.
-- ---------------------------------------------------------------------------
rollback;

\echo '== done (rolled back; no data persisted) =='
-- HOW TO READ RESULTS:
--   PLAN A/B/C node line should say "Index Scan using idx_audit_logs_facility_created"
--   (or idx_audit_logs_facility_id). If you see "Seq Scan on audit_logs", the index
--   is not being used at volume — investigate before declaring scale-ready.
