-- =============================================================================
-- Cron execution audit trail
--
-- Seven cron routes drive notifications, email, retention, scheduling expiry,
-- reminders, daily snapshots, and the audit-chain check. Until now the only
-- record that any of them ran was a console.log line in Vercel's function logs:
-- ephemeral, unqueryable, and gone within the retention window.
--
-- The practical failure that motivates this: a silently dead cron looks exactly
-- like a healthy one. An empty notification outbox is consistent with "the drain
-- ran and there was nothing to do" AND with "the drain has not run in three
-- weeks". Nothing in the system could tell those apart.
--
-- cron_runs makes "did the drain actually run last night, and how long did it
-- take?" answerable in SQL.
--
-- This table is deliberately NOT facility-scoped: a cron run is a system-level
-- event that sweeps every facility, so there is no single facility_id to
-- attribute it to. That makes it super-admin-readable only.
-- =============================================================================

create table if not exists public.cron_runs (
  id           uuid primary key default gen_random_uuid(),
  route        text        not null,
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  duration_ms  integer     not null,
  ok           boolean     not null,
  summary      jsonb       not null default '{}'::jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  constraint cron_runs_duration_nonneg check (duration_ms >= 0),
  constraint cron_runs_route_nonblank check (length(btrim(route)) > 0)
);

comment on table public.cron_runs is
  'One row per cron route invocation. Written by withCronRoute() in '
  'src/lib/cron/with-cron-auth.ts. System-level (not facility-scoped), so it is '
  'super-admin-readable and service-role-writable only.';

comment on column public.cron_runs.summary is
  'The same structured summary the route logs — row counts, durations, per-step '
  'tallies. Shape varies per route by design.';

-- Hot query is "recent runs for this route", e.g. "when did the drain last
-- succeed?", so index route + time descending.
create index if not exists cron_runs_route_started_idx
  on public.cron_runs (route, started_at desc);

-- Used by the retention worker below, which scans purely by age.
create index if not exists cron_runs_started_at_idx
  on public.cron_runs (started_at);

-- RLS ------------------------------------------------------------------------
alter table public.cron_runs enable row level security;

-- Read: super-admins only. There is no facility to scope this to, and run
-- summaries can carry cross-tenant counts.
drop policy if exists cron_runs_select_super_admin on public.cron_runs;
create policy cron_runs_select_super_admin
  on public.cron_runs
  for select
  to authenticated
  using (public.is_super_admin());

-- Write: nothing. service_role bypasses RLS, and the cron routes are the only
-- writers. No insert/update/delete policy is defined on purpose, so an
-- authenticated session cannot forge or erase a run record.

-- Retention ------------------------------------------------------------------
-- The audit flagged unbounded growth on tables nothing purges, so this one
-- ships with its own worker rather than repeating that mistake. 90 days is
-- well past any "has this cron been running?" investigation window.
create or replace function public.purge_old_cron_runs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.cron_runs
   where started_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_old_cron_runs() is
  'Drops cron_runs rows older than 90 days. Fixed window — this is operational '
  'telemetry, not per-facility data, so it is not configurable in '
  'retention_settings. Called by /api/cron/run-retention-purge.';

-- Service-role only. Revoke from authenticated explicitly: Supabase's default
-- privileges grant EXECUTE on new functions to authenticated, which a
-- `from public` revoke does not remove.
revoke execute on function public.purge_old_cron_runs() from public;
revoke execute on function public.purge_old_cron_runs() from anon;
revoke execute on function public.purge_old_cron_runs() from authenticated;
grant  execute on function public.purge_old_cron_runs() to service_role;
