-- =============================================================================
-- 00000000000128_purge_module_data.sql
--
-- Adds the facility-scoped manual-purge function that the admin Retention
-- module's "Purge now" button has been calling since it shipped. The action
-- (src/app/admin/retention/actions.ts) invokes rpc('purge_module_data', ...),
-- but no migration ever created the function — every manual purge has failed
-- with "function does not exist". This went unnoticed because the call site
-- bypassed the generated DB types with an `as any` cast; regenerating the
-- types (which removed the cast) surfaced it.
--
-- Why the existing purge_old_<module>() workers (migration 24) can't back the
-- button:
--   * they iterate ALL facilities, so an admin's manual action would purge
--     other tenants' data on their behalf, and
--   * they only process rows with auto_purge = true, while the Retention UI
--     explicitly supports a "Manual purge only" mode (auto_purge = false) —
--     the exact case a manual button exists for.
--
-- Semantics:
--   * Caller must be a super admin or an admin of p_facility_id
--     (is_facility_admin, migration 78). SECURITY DEFINER bypasses RLS, so
--     this gate is mandatory — asserted in supabase/tests/rls_isolation.sql.
--   * keep_days comes from the facility's retention_settings row for the
--     module; auto_purge is intentionally ignored (the click IS the trigger).
--   * audit_logs uses the fixed 7-year compliance window (mirrors
--     purge_old_audit_logs), never retention_settings.
--   * ice_depth purges ice_depth_sessions (children cascade). Note: the
--     nightly cron has no ice_depth worker yet, so manual purge is currently
--     the only purge path for this module.
--   * scheduling raises: purging schedule history has unresolved semantics
--     (shifts feed compliance lookbacks); the UI surfaces the message.
--   * Delete statements mirror migration 24 exactly (same tables + cutoff
--     columns) so manual and nightly purges can never disagree on scope.
-- =============================================================================

create or replace function public.purge_module_data(
  p_facility_id uuid,
  p_module_key text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    -- Fixed compliance window; not configurable via retention_settings.
    delete from public.audit_logs
     where facility_id = p_facility_id
       and created_at < now() - interval '7 years';
    get diagnostics v_deleted = row_count;
    return v_deleted;
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

    else
      raise exception 'Unknown module key: %', p_module_key;
  end case;

  return v_total;
end;
$$;

comment on function public.purge_module_data(uuid, text) is
  'Facility-scoped manual purge for the admin Retention module. Authorization '
  'enforced internally (super admin or facility admin); keep_days read from '
  'retention_settings ignoring auto_purge; audit_logs fixed at 7 years.';

-- Callable by signed-in admins through the user client; the internal gate
-- (not the grant) is the security boundary. Never callable anonymously.
revoke execute on function public.purge_module_data(uuid, text) from public, anon;
grant execute on function public.purge_module_data(uuid, text) to authenticated, service_role;
