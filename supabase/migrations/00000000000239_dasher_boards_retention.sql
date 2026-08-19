-- =============================================================================
-- Dasher Boards data retention
--
-- Dasher Boards shipped without any retention wiring at all: it had no
-- retention_module_floors row, no branch in purge_module_data(), and no nightly
-- worker. A facility could set every other module's retention and still
-- accumulate perimeter walks forever. This closes that gap.
--
-- What a purge deletes, and why:
--   * dasher_boards_inspections older than the cutoff. Its children
--     (_asset_checks, _checklist_responses) cascade off the inspection FK, so
--     deleting the walk reaps them.
--   * dasher_boards_issues that are RESOLVED and older than the cutoff.
--     Issues do not cascade -- inspection_id is ON DELETE SET NULL -- so
--     purging walks alone would leave every issue ever raised behind, detached
--     from its walk. Unresolved issues are deliberately exempt at any age: an
--     open issue is a live safety defect on the boards, and dropping one just
--     because its walk aged out would quietly remove it from the record.
--
-- Nothing here is destructive on its own: both paths require a facility to have
-- saved a retention rule, and the nightly worker additionally requires
-- auto_purge = true.
-- =============================================================================

-- 1. Retention floor ----------------------------------------------------------
-- 30 days, matching the other operational modules (daily_reports, ice_depth,
-- ice_operations). The trigger from migration 208 rejects any keep_days below
-- the floor, and refuses a module with no floor row at all.
insert into public.retention_module_floors (module_key, min_days, note) values
  ('dasher_boards', 30, 'Perimeter inspection walks. Resolved issues purge with them; unresolved issues are kept regardless of age.')
on conflict (module_key) do nothing;

-- 2. Manual purge -------------------------------------------------------------
-- Restates purge_module_data() from migration 216 with the dasher_boards branch
-- added. Restated in full rather than edited in place, per the migration rules.
CREATE OR REPLACE FUNCTION public.purge_module_data(p_facility_id uuid, p_module_key text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_keep_days integer;
  v_cutoff    timestamptz;
  v_deleted   integer;
  v_total     integer := 0;
begin
  if not (
    public.is_super_admin()
    or public.is_facility_admin(p_facility_id)
  ) then
    raise exception 'Not authorized to purge data for this facility.';
  end if;

  if p_module_key = 'scheduling' then
    raise exception 'Manual purge is not supported for scheduling.';
  end if;

  if p_module_key = 'audit_logs' then
    -- Compliance window: per-facility retention_settings (default 7 years),
    -- clamped to the 2555-day floor; keep_days = 0 disables purging
    -- (migration 215). Since migration 216 expired rows are STAGED into
    -- audit_logs_pending_destruction (recoverable until two admins approve
    -- destruction) instead of deleted.
    select keep_days into v_keep_days
      from public.retention_settings
     where facility_id = p_facility_id
       and module_key  = 'audit_logs';
    v_keep_days := coalesce(v_keep_days, 2555);
    if v_keep_days = 0 then
      return 0;
    end if;
    return public.stage_audit_logs_for_destruction(
      p_facility_id,
      now() - make_interval(days => greatest(v_keep_days, 2555)));
  end if;

  select keep_days into v_keep_days
    from public.retention_settings
   where facility_id = p_facility_id
     and module_key = p_module_key;

  if v_keep_days is null then
    raise exception 'No retention rule configured for this module. Save one first.';
  end if;
  if v_keep_days = 0 then
    raise exception 'Retention for this module is set to keep records forever.';
  end if;

  v_cutoff := now() - (v_keep_days || ' days')::interval;

  case p_module_key
    when 'daily_reports' then
      delete from public.daily_report_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'communications' then
      delete from public.communication_messages
       where facility_id = p_facility_id and sent_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_alerts
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_audit_log
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'accident_reports' then
      delete from public.accident_reports
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'incident_reports' then
      delete from public.incident_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'refrigeration' then
      delete from public.refrigeration_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'air_quality' then
      delete from public.air_quality_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_operations' then
      delete from public.ice_operations_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_depth' then
      delete from public.ice_depth_sessions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    -- Dasher Boards. Walks past the cutoff go, and dasher_boards_asset_checks /
    -- _checklist_responses cascade off the inspection FK. Issues do NOT: their
    -- inspection_id is ON DELETE SET NULL, so without the second delete below
    -- every issue ever raised would survive forever, detached from the walk
    -- that found it.
    --
    -- Only RESOLVED issues are purged. An unresolved issue is a live safety
    -- defect on the boards, not history, so it is kept regardless of age --
    -- deleting one because the walk that found it aged out would silently drop
    -- an open defect off the rink's record.
    when 'dasher_boards' then
      delete from public.dasher_boards_inspections
       where facility_id = p_facility_id and started_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.dasher_boards_issues
       where facility_id = p_facility_id
         and resolved_at is not null
         and resolved_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    else
      raise exception 'Unknown module key: %', p_module_key;
  end case;

  return v_total;
end;
$function$;

comment on function public.purge_module_data(uuid, text) is
  'Manual per-module purge for a facility. Adds dasher_boards (migration 239): '
  'walks past the cutoff plus their resolved issues; unresolved issues are kept '
  'at any age because an open issue is a live safety defect, not history.';

-- 3. Nightly retention worker -------------------------------------------------
-- Mirrors migration 138's purge_old_ice_depth_sessions(): loop the auto_purge
-- facilities, delete past the cutoff, return the row count. keep_days = 0 means
-- "keep forever" and cannot coexist with auto_purge = true (migration 208), so
-- the auto_purge filter already excludes those rows.
create or replace function public.purge_old_dasher_boards_inspections()
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
     where module_key = 'dasher_boards'
       and auto_purge = true
  loop
    delete from public.dasher_boards_inspections
     where facility_id = v_row.facility_id
       and started_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    -- Same resolved-only rule as the manual path above.
    delete from public.dasher_boards_issues
     where facility_id = v_row.facility_id
       and resolved_at is not null
       and resolved_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

comment on function public.purge_old_dasher_boards_inspections() is
  'Nightly dasher_boards retention worker, called by /api/cron/run-retention-purge. '
  'Deletes walks past each facility keep_days (children cascade) plus their '
  'resolved issues. Unresolved issues are never purged.';

-- Service-role only. Revoke from authenticated explicitly: Supabase's default
-- privileges grant EXECUTE on new functions to authenticated, which a
-- `from public` revoke does not remove.
revoke execute on function public.purge_old_dasher_boards_inspections() from public;
revoke execute on function public.purge_old_dasher_boards_inspections() from anon;
revoke execute on function public.purge_old_dasher_boards_inspections() from authenticated;
grant  execute on function public.purge_old_dasher_boards_inspections() to service_role;
