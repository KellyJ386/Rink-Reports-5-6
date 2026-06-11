-- =============================================================================
-- 00000000000138_ice_depth_integrity_and_purge.sql
--
-- Three ice-depth integrity / operations gaps surfaced by the 100% review:
--
--   1. ice_depth_settings allowed low_threshold >= high_threshold. The admin
--      form guards against it, but nothing in the DB did. An inverted pair makes
--      severityFor() degenerate (no reading can ever be 'ok'), silently
--      corrupting every session submitted against it. Add a CHECK so the
--      database is the floor, matching how the rest of the schema treats its
--      invariants.
--
--   2. ice_depth_measurements.depth_value had no lower bound. parseMeasurements
--      only rejected non-finite numbers, so a crafted offline payload with a
--      negative depth would persist (and classify 'low'). Depth is a physical
--      measurement and is never negative; enforce it server-side AND in the DB.
--
--   3. There was no nightly purge worker for ice_depth. purge_module_data()
--      (migration 132) handles the manual "Purge now" button, but the daily
--      cron (src/app/api/cron/run-retention-purge) had no ice_depth function,
--      so facilities with auto_purge = true silently never purged ice-depth
--      data. Add purge_old_ice_depth_sessions() mirroring migration 24's
--      per-module workers; children (measurements, change_log, followup_notes)
--      cascade off ice_depth_sessions.
--
-- Constraints are added idempotently (DO guards) so re-running on a DB that
-- already has them is a no-op.
-- =============================================================================

-- 1. low_threshold must sit strictly below high_threshold ---------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ice_depth_settings_low_below_high'
       and conrelid = 'public.ice_depth_settings'::regclass
  ) then
    alter table public.ice_depth_settings
      add constraint ice_depth_settings_low_below_high
      check (low_threshold < high_threshold);
  end if;
end$$;

comment on constraint ice_depth_settings_low_below_high on public.ice_depth_settings is
  'low_threshold must be strictly below high_threshold; otherwise severityFor() '
  'can never return ''ok'' and every session is misclassified.';

-- 2. depth_value is a physical measurement and is never negative --------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ice_depth_measurements_depth_nonneg'
       and conrelid = 'public.ice_depth_measurements'::regclass
  ) then
    alter table public.ice_depth_measurements
      add constraint ice_depth_measurements_depth_nonneg
      check (depth_value >= 0);
  end if;
end$$;

comment on constraint ice_depth_measurements_depth_nonneg on public.ice_depth_measurements is
  'Depth is a physical measurement; reject negative values at the DB as well as '
  'in parseMeasurements().';

-- 3. Nightly retention worker for ice_depth -----------------------------------
-- Mirrors migration 24's purge_old_<module>() workers: loop over auto_purge
-- facilities, delete sessions older than keep_days, return the row count.
-- ice_depth_measurements / _change_log / _followup_notes cascade off the
-- session FK (on delete cascade), so deleting the session reaps the children.
create or replace function public.purge_old_ice_depth_sessions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'ice_depth'
       and auto_purge = true
  loop
    delete from public.ice_depth_sessions
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

comment on function public.purge_old_ice_depth_sessions() is
  'Nightly retention worker for ice_depth (mirrors migration 24). Deletes '
  'ice_depth_sessions older than keep_days for auto_purge facilities; children '
  'cascade. Invoked by the run-retention-purge cron as service_role.';

-- service_role only (invoked by /api/cron/run-retention-purge). Revoke from
-- authenticated explicitly: Supabase's default privileges grant EXECUTE on new
-- functions to authenticated, which a `from public` revoke does not remove
-- (mirrors migration 134; the rls_isolation harness asserts this gate).
-- Revoke from authenticated explicitly: Supabase's default privileges grant
-- EXECUTE on new functions to authenticated, which a `from public` revoke does
-- not remove (mirrors migration 134; rls_isolation asserts this gate).
revoke execute on function public.purge_old_ice_depth_sessions() from public;
revoke execute on function public.purge_old_ice_depth_sessions() from anon;
revoke execute on function public.purge_old_ice_depth_sessions() from authenticated;
grant  execute on function public.purge_old_ice_depth_sessions() to service_role;
