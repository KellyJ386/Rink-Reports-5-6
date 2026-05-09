-- Replaces hardcoded-interval purge functions with retention_settings-aware
-- versions, and adds missing purge functions for all remaining modules.
--
-- Each function loops over retention_settings rows where auto_purge = true for
-- its module_key, deletes records older than keep_days per facility, and returns
-- the total row count purged. Child table rows cascade automatically via FK.
--
-- All functions are SECURITY DEFINER, granted to service_role only (for cron
-- invocation), and revoked from public.

-- ---------------------------------------------------------------------------
-- daily_reports
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_daily_reports()
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
     where module_key = 'daily_reports'
       and auto_purge = true
  loop
    delete from public.daily_report_submissions
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_old_daily_reports() from public;
grant  execute on function public.purge_old_daily_reports() to service_role;

-- ---------------------------------------------------------------------------
-- communications
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_communications()
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
     where module_key = 'communications'
       and auto_purge = true
  loop
    delete from public.communication_messages
     where facility_id = v_row.facility_id
       and sent_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.communication_alerts
     where facility_id = v_row.facility_id
       and created_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.communication_audit_log
     where facility_id = v_row.facility_id
       and created_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_old_communications() from public;
grant  execute on function public.purge_old_communications() to service_role;

-- ---------------------------------------------------------------------------
-- accident_reports
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_accident_reports()
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
     where module_key = 'accident_reports'
       and auto_purge = true
  loop
    delete from public.accident_reports
     where facility_id = v_row.facility_id
       and created_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_old_accident_reports() from public;
grant  execute on function public.purge_old_accident_reports() to service_role;

-- ---------------------------------------------------------------------------
-- incident_reports
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_incident_reports()
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
     where module_key = 'incident_reports'
       and auto_purge = true
  loop
    delete from public.incident_reports
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_old_incident_reports() from public;
grant  execute on function public.purge_old_incident_reports() to service_role;

-- ---------------------------------------------------------------------------
-- refrigeration_reports
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_refrigeration_reports()
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
     where module_key = 'refrigeration'
       and auto_purge = true
  loop
    delete from public.refrigeration_reports
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_old_refrigeration_reports() from public;
grant  execute on function public.purge_old_refrigeration_reports() to service_role;

-- ---------------------------------------------------------------------------
-- air_quality_reports
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_air_quality_reports()
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
     where module_key = 'air_quality'
       and auto_purge = true
  loop
    delete from public.air_quality_reports
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_old_air_quality_reports() from public;
grant  execute on function public.purge_old_air_quality_reports() to service_role;

-- ---------------------------------------------------------------------------
-- ice_operations_submissions
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_ice_operations_submissions()
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
     where module_key = 'ice_operations'
       and auto_purge = true
  loop
    delete from public.ice_operations_submissions
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_old_ice_operations_submissions() from public;
grant  execute on function public.purge_old_ice_operations_submissions() to service_role;

-- ---------------------------------------------------------------------------
-- audit_logs — fixed 7-year compliance window, not configurable per-facility
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_audit_logs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.audit_logs
   where created_at < now() - interval '7 years';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_old_audit_logs() from public;
grant  execute on function public.purge_old_audit_logs() to service_role;
