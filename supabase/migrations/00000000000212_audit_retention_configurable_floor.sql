-- =============================================================================
-- 00000000000212_audit_retention_configurable_floor.sql
--
-- Audit-log retention: a dial with a lock (review decision A2).
--
-- The retention window for audit_logs was welded to `interval '7 years'`
-- inside purge_old_audit_logs() (migration 24) and purge_module_data()
-- (migration 132). If an insurer or regulator ever requires ten years, the
-- functions have to be rewritten. Both now read the per-facility
-- retention_settings row (module_key = 'audit_logs', which the admin UI
-- already surfaces), falling back to the historical 7 years when no row
-- exists — so behavior is unchanged until a facility opts to KEEP MORE.
--
-- The lock: a table-level CHECK forbids configuring audit retention below
-- 2555 days (7 years). keep_days = 0 keeps the UI's "Forever (no purge)"
-- meaning. Defense in depth, both purge paths ALSO clamp to the floor with
-- greatest(keep_days, 2555), so a pre-CHECK row (or a future constraint
-- regression) can never shorten the window. The server action enforces the
-- same floor (the old server-side minimum was a module-agnostic 30 days —
-- the UI's 365-day minimum was decorative).
-- =============================================================================

alter table public.retention_settings
  drop constraint if exists retention_settings_audit_floor;
alter table public.retention_settings
  add constraint retention_settings_audit_floor
  check (module_key <> 'audit_logs' or keep_days = 0 or keep_days >= 2555);

create or replace function public.purge_old_audit_logs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
  v_n       integer;
  f         record;
begin
  for f in
    select fac.id,
           coalesce(rs.keep_days, 2555) as keep_days
      from public.facilities fac
      left join public.retention_settings rs
        on rs.facility_id = fac.id
       and rs.module_key  = 'audit_logs'
  loop
    if f.keep_days = 0 then
      continue; -- Forever (no purge)
    end if;
    delete from public.audit_logs
     where facility_id = f.id
       and created_at < now() - make_interval(days => greatest(f.keep_days, 2555));
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_old_audit_logs() from public, anon, authenticated;
grant  execute on function public.purge_old_audit_logs() to service_role;

comment on function public.purge_old_audit_logs() is
  'Retention worker for audit_logs. Per-facility window from retention_settings '
  '(module_key=audit_logs), default 7 years, hard floor 2555 days (0 = never '
  'purge). Service-role only; called by the nightly retention cron.';

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
    -- (migration 212).
    select keep_days into v_keep_days
      from public.retention_settings
     where facility_id = p_facility_id
       and module_key  = 'audit_logs';
    v_keep_days := coalesce(v_keep_days, 2555);
    if v_keep_days = 0 then
      return 0;
    end if;
    delete from public.audit_logs
     where facility_id = p_facility_id
       and created_at < now() - make_interval(days => greatest(v_keep_days, 2555));
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
$function$

;

comment on function public.purge_module_data(uuid, text) is
  'Admin-triggered manual purge for one module in one facility. Deletes rows older than the facility''s retention_settings window. audit_logs is configurable since migration 212 with a 2555-day floor (0 = never purge). Requires super-admin or facility-admin; scheduling is not manually purgeable.';
