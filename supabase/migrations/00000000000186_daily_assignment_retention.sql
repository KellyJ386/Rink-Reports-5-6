-- =============================================================================
-- 00000000000186_daily_assignment_retention.sql
-- Daily Reports routing follow-up: retention for the assignment tables.
--
-- The Phase 1-5 routing tables (report_area_assignments,
-- daily_area_assignment_snapshots, daily_report_assignment_notifications)
-- accumulate per-day rows but had no purge path. Fold them into the existing
-- retention-aware public.purge_old_daily_reports() (migration 24 shape: one
-- pass per facility with retention_settings.module_key = 'daily_reports' and
-- auto_purge = true, honoring keep_days) so the module keeps ONE retention
-- knob. Date-keyed tables cut on their business/report date; notifications
-- cut on created_at. Standing config (area_default_owners,
-- daily_area_job_area_map, daily_report_settings) is not day-scoped and is
-- never purged.
--
-- The admin "purge module data now" path (purge_module_data, migration 132)
-- is intentionally left submission-only: routing rows are small operational
-- metadata, and the frozen snapshots are the module's assignment audit trail —
-- they age out here on the same keep_days rather than being bulk-droppable.
-- =============================================================================

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
  v_cutoff_date date;
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

    v_cutoff_date := (now() - (v_row.keep_days || ' days')::interval)::date;

    delete from public.report_area_assignments
     where facility_id = v_row.facility_id
       and report_date < v_cutoff_date;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.daily_area_assignment_snapshots
     where facility_id = v_row.facility_id
       and business_date < v_cutoff_date;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.daily_report_assignment_notifications
     where facility_id = v_row.facility_id
       and created_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

comment on function public.purge_old_daily_reports() is
  'Retention-aware purge for the Daily Reports module: submissions (cascading items + notes) '
  'plus the day-scoped assignment-routing rows (assignments, snapshots, notifications), per '
  'facility keep_days from retention_settings. Standing routing config is never purged. '
  'Invoked by the retention cron; service_role only.';

revoke execute on function public.purge_old_daily_reports() from public;
grant  execute on function public.purge_old_daily_reports() to service_role;
