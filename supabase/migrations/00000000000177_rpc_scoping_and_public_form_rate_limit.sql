-- =============================================================================
-- 00000000000177_rpc_scoping_and_public_form_rate_limit.sql
--
-- Three RPC/public-surface findings from the 2026-07-06 admin-area review of
-- the live project:
--
-- 1. get_employee_counts_by_facility() (migration 17) is SECURITY DEFINER with
--    no scoping — any authenticated user could read employee counts for ALL
--    facilities. Harmless with one tenant, a cross-tenant metadata leak the
--    day facility #2 onboards. Both call sites keep working: the super-admin
--    console gets all facilities, /admin/facility (requireAdmin) gets the
--    caller's own facility — which is all its RLS-scoped facility list can
--    display anyway.
--
-- 2. scheduling_expire_stale_swaps / scheduling_expire_open_claims
--    (migration 158) were meant to be cron/service-role-only — 158 revoked
--    PUBLIC and anon and granted service_role — but the authenticated role
--    kept EXECUTE (advisor-confirmed on prod), so any signed-in user could
--    run the sweepers and mass-generate swap_expired notifications. Revoke
--    authenticated; /api/cron/expire-scheduling uses the service role and is
--    unaffected. Also pin the full (public, pg_temp) search_path they missed.
--
-- 3. information_requests: the public splash-page form is defended by length
--    CHECKs (migration 88) and an IP rate limit in the API route (migration
--    92's check_rate_limit) — but the anon key ships in the client bundle, so
--    a direct PostgREST INSERT bypasses the route's rate limit entirely. Add
--    a DB-level BEFORE INSERT rate limit (per-email + global buckets) and an
--    email-format CHECK so the last unmetered write path to the table is
--    closed. check_rate_limit deliberately KEEPS anon EXECUTE — the route
--    calls it under the anon key.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Scope employee counts to the caller's facility (super-admin sees all).
-- ---------------------------------------------------------------------------
create or replace function public.get_employee_counts_by_facility()
returns table(facility_id uuid, employee_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.facility_id, count(*)::bigint as employee_count
  from public.employees e
  where public.is_super_admin()
     or e.facility_id = public.current_facility_id()
  group by e.facility_id;
$$;

comment on function public.get_employee_counts_by_facility() is
  'One row per facility with the total employee count. Super-admins see every facility; everyone else sees only their own (SECURITY DEFINER would otherwise leak cross-tenant counts). Used by admin/facility and admin/super-admin pages.';

-- ---------------------------------------------------------------------------
-- 2. Finish the sweeper lockdown that migration 158 intended.
-- ---------------------------------------------------------------------------
revoke execute on function public.scheduling_expire_stale_swaps(int) from authenticated;
revoke execute on function public.scheduling_expire_open_claims(int) from authenticated;
alter function public.scheduling_expire_stale_swaps(int) set search_path = public, pg_temp;
alter function public.scheduling_expire_open_claims(int) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 3. DB-level rate limit + email shape for the public lead form.
-- ---------------------------------------------------------------------------
alter table public.information_requests
  add constraint information_requests_email_format_check
    check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

create or replace function public.rate_limit_information_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Per-email bucket: 5 submissions/hour, mirroring the route's per-IP cap.
  if not public.check_rate_limit(
    'information_requests_email', lower(new.email), 5, 3600
  ) then
    raise exception 'Too many requests. Please try again later.'
      using errcode = 'P0001';
  end if;
  -- Coarse global bucket so rotating emails cannot bypass the per-email cap:
  -- 100 submissions/hour across the whole table (a legitimate marketing page
  -- for a pre-launch product is nowhere near this; raise it when it is).
  if not public.check_rate_limit(
    'information_requests_global', 'all', 100, 3600
  ) then
    raise exception 'Too many requests. Please try again later.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.rate_limit_information_requests() from public, anon, authenticated;

drop trigger if exists trg_rate_limit_information_requests on public.information_requests;
create trigger trg_rate_limit_information_requests
  before insert on public.information_requests
  for each row execute function public.rate_limit_information_requests();

comment on function public.rate_limit_information_requests() is
  'BEFORE INSERT on information_requests: fixed-window rate limits (5/hour per email, 100/hour global) via check_rate_limit(). Closes the direct-PostgREST bypass of the API route''s per-IP limit — the anon key is public, so the table itself must meter writes.';

commit;
