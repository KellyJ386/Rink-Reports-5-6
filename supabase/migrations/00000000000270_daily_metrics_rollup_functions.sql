-- =============================================================================
-- 00000000000267_daily_metrics_rollup_functions.sql
--
-- One rollup function per module, an orchestrator that calls them, a
-- yesterday-in-each-facility's-own-timezone entry point for the nightly cron,
-- and a bounded backfill entry point for recovering after a metric bug.
--
-- All functions: SECURITY DEFINER, SET search_path = public, pg_temp, revoked
-- from anon (module functions and the yesterday/backfill entry points are
-- service_role only; the orchestrator additionally allows is_super_admin() so
-- an admin console "recompute this day" action has a path in without needing
-- the service key).
--
-- IDEMPOTENCY. Every write is `insert ... on conflict (facility_id,
-- business_date, module_key) do update`, so recomputing a day is always safe —
-- this is how the backfill route recovers from a bad metric definition without
-- needing a delete-then-reinsert dance.
--
-- WHICH DAY A ROW STARTED VS COMPLETED ON (dasher_boards). Migration 264 stamps
-- dasher_boards_inspections.business_date from completed_at, falling back to
-- started_at only while the walk is open. A walk started 11:50pm and completed
-- 12:10am is stamped onto the COMPLETION day. That is correct for
-- walks_completed (bucket by business_date, completed_at is not null) but wrong
-- for walks_started, which must bucket by the walk's own start instant
-- converted through the facility's timezone directly — NOT the stored
-- business_date column. The two counts can therefore disagree by one walk on a
-- day that closed past local midnight; that is expected, not a bug.
--
-- HISTORICAL STATE FROM TIMESTAMPED TRANSITIONS, NOT MUTABLE STATUS COLUMNS.
-- incident_reports.status and dasher_boards_issues' implicit open/closed state
-- are current-state fields with no history table backing them. Backfilling a
-- past day's "open at end of day" snapshot from today's status would silently
-- rewrite history every time it's recomputed. Instead these functions
-- reconstruct the state AS OF THAT DAY from the timestamped transition columns
-- (resolved_at, archived_at) that do not change once set: an item counts as
-- closed by end of day D only if its resolution/archive timestamp's
-- facility-local date is <= D. That is what makes recomputing an old day safe.
--
-- JSONB-VALUED METRICS (by_type, by_severity, exceedance_max_by_metric,
-- out_of_range_fields, open_issues_at_eod, ...). Their declared aggregation
-- mode still governs how they combine across a period, generalized per shape:
--   - object value (a breakdown, e.g. by_type: {"slip":2}) -> union the keys,
--     combine the values PER KEY using the metric's own mode. by_type/
--     by_severity are 'sum' (total per category over the period);
--     exceedance_max_by_metric is 'max' (peak reading per metric, not a sum
--     of peaks). Only 'last' skips this — see below.
--   - array value (a label list, e.g. out_of_range_fields) -> union of
--     distinct items across the period, regardless of declared mode ("sum" of
--     a set of labels has no numeric meaning; union is the only
--     value-preserving combinator for "which fields were ever flagged").
--   - 'last', any shape -> the most recent day's value verbatim, never merged
--     — open_issues_at_eod is a snapshot to REPLACE with the latest one, not
--     a breakdown to accumulate across days.
-- That convention lives here as the contract the Phase 5 period-aggregator
-- (src/app/insights/_lib/combine.ts) implements — it is not enforceable by a
-- CHECK constraint on report_metric_definitions.aggregation, so it is written
-- down instead.
--
-- ACKNOWLEDGED APPROXIMATIONS. median_hours_to_resolve (incident_reports) and
-- mean_days_open (dasher_boards) have no exact daily-grain combinator: a
-- median or mean computed fresh from a week of raw rows is not recoverable
-- from seven stored daily medians/means. They are stored per day and rolled up
-- as 'avg' (median_hours_to_resolve) or 'last' (mean_days_open, a snapshot of
-- current backlog age) respectively — a disclosed approximation, not silent
-- imprecision. Their labels say so.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- daily_reports
--   Source: daily_area_assignment_snapshots (migration 185) for
--   areas_assigned/areas_completed — it only gets a row for areas that had an
--   active assignee at day-close, matching "assigned" exactly; and
--   daily_report_submissions + daily_report_submission_items for
--   submissions/items. superseded_at IS NULL is the as-corrected view
--   (migration 218): a same-day correction updates the "current" count without
--   double-counting the row it replaced.
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_daily_reports(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_areas_assigned  int;
  v_areas_completed int;
  v_submissions     int;
  v_superseded      int;
  v_items_checked   int;
  v_items_total     int;
begin
  select count(*), count(*) filter (where completed)
    into v_areas_assigned, v_areas_completed
    from public.daily_area_assignment_snapshots
   where facility_id = p_facility_id and business_date = p_business_date;

  select count(*) filter (where superseded_at is null),
         count(*) filter (where superseded_at is not null)
    into v_submissions, v_superseded
    from public.daily_report_submissions
   where facility_id = p_facility_id and business_date = p_business_date;

  select count(*) filter (where i.is_checked), count(*)
    into v_items_checked, v_items_total
    from public.daily_report_submission_items i
    join public.daily_report_submissions s on s.id = i.submission_id
   where s.facility_id = p_facility_id
     and s.business_date = p_business_date
     and s.superseded_at is null;

  return jsonb_build_object(
    'areas_assigned', v_areas_assigned,
    'areas_completed', v_areas_completed,
    'completion_pct',
      case when v_areas_assigned > 0
           then round(100.0 * v_areas_completed / v_areas_assigned, 1)
           else null end,
    'submissions', v_submissions,
    'submissions_superseded', v_superseded,
    'items_checked', v_items_checked,
    'items_total', v_items_total
  );
end;
$$;

comment on function public.compute_daily_metrics_daily_reports(uuid, date) is
  'Daily reports rollup for one facility/day. areas_assigned/completed from '
  'daily_area_assignment_snapshots (only areas with an active assignee at close '
  'get a row there, so both counts are exact, not "all configured areas"). '
  'submissions counts the as-corrected view (superseded_at is null); '
  'submissions_superseded makes corrections visible rather than hiding them.';

revoke execute on function public.compute_daily_metrics_daily_reports(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_daily_reports(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- ice_operations
--   Grouped by operation_type (ice_make | circle_check | edging |
--   blade_change | propane_tank_change per the table's CHECK). failed_count and
--   has_failed_check already exist on the table (migration 1xx circle-check
--   work) — summed/counted rather than recomputed from a child table.
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_ice_operations(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ice_cuts int;
  v_edging   int;
  v_blade    int;
  v_propane  int;
  v_cc_completed int;
  v_cc_with_failure int;
  v_failed_total int;
begin
  select
    count(*) filter (where operation_type = 'ice_make'),
    count(*) filter (where operation_type = 'edging'),
    count(*) filter (where operation_type = 'blade_change'),
    count(*) filter (where operation_type = 'propane_tank_change'),
    count(*) filter (where operation_type = 'circle_check'),
    count(*) filter (where operation_type = 'circle_check' and has_failed_check),
    coalesce(sum(failed_count) filter (where operation_type = 'circle_check'), 0)
    into v_ice_cuts, v_edging, v_blade, v_propane,
         v_cc_completed, v_cc_with_failure, v_failed_total
    from public.ice_operations_submissions
   where facility_id = p_facility_id and business_date = p_business_date;

  return jsonb_build_object(
    'ice_cuts', v_ice_cuts,
    'edging_ops', v_edging,
    'blade_changes', v_blade,
    'propane_changes', v_propane,
    'circle_checks_completed', v_cc_completed,
    'circle_checks_with_failure', v_cc_with_failure,
    'failed_items_total', v_failed_total
  );
end;
$$;

comment on function public.compute_daily_metrics_ice_operations(uuid, date) is
  'Ice operations rollup for one facility/day, grouped by operation_type. '
  'circle_checks_with_failure/failed_items_total read the has_failed_check and '
  'failed_count columns already persisted at submit time rather than '
  'recomputing from a child table.';

revoke execute on function public.compute_daily_metrics_ice_operations(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_ice_operations(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- ice_depth
--   low_count/high_count/total_measurements already exist on the session row
--   (summed). min_depth/mean_depth need the child measurements table.
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_ice_depth(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sessions int;
  v_measurements int;
  v_low int;
  v_high int;
  v_min numeric;
  v_mean numeric;
begin
  select count(*),
         coalesce(sum(total_measurements), 0),
         coalesce(sum(low_count), 0),
         coalesce(sum(high_count), 0)
    into v_sessions, v_measurements, v_low, v_high
    from public.ice_depth_sessions
   where facility_id = p_facility_id and business_date = p_business_date;

  select min(m.depth_value), avg(m.depth_value)
    into v_min, v_mean
    from public.ice_depth_measurements m
    join public.ice_depth_sessions s on s.id = m.session_id
   where s.facility_id = p_facility_id and s.business_date = p_business_date;

  return jsonb_build_object(
    'sessions', v_sessions,
    'measurements_total', v_measurements,
    'low_readings', v_low,
    'high_readings', v_high,
    'min_depth', v_min,
    'mean_depth', case when v_mean is not null then round(v_mean, 3) else null end
  );
end;
$$;

comment on function public.compute_daily_metrics_ice_depth(uuid, date) is
  'Ice depth rollup for one facility/day. sessions/measurements_total/'
  'low_readings/high_readings sum the counters already persisted on '
  'ice_depth_sessions at submit time; min_depth/mean_depth read the raw '
  'per-point ice_depth_measurements rows (no equivalent counter exists on the '
  'session row for those). Depth values are stored in whatever unit the '
  'session was submitted in (measurement_unit_snapshot) — this function does '
  'not normalize units; a facility that has switched units mid-period will '
  'need that reconciled at the read layer.';

revoke execute on function public.compute_daily_metrics_ice_depth(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_ice_depth(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- refrigeration
--   is_out_of_range already exists on refrigeration_report_values.
--   readings_expected is read verbatim from refrigeration_settings; the table
--   has no notion of how many shifts run per day, so this is NOT
--   readings_per_shift x shifts-that-day — it is the configured per-shift
--   figure passed through unchanged. Treat it as a reference baseline, not a
--   computed daily target.
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_refrigeration(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_reports int;
  v_readings_expected int;
  v_oor_count int;
  v_oor_fields jsonb;
begin
  select count(*) into v_reports
    from public.refrigeration_reports
   where facility_id = p_facility_id and business_date = p_business_date;

  select readings_per_shift into v_readings_expected
    from public.refrigeration_settings
   where facility_id = p_facility_id;

  select count(*) filter (where v.is_out_of_range),
         coalesce(jsonb_agg(distinct v.label_snapshot) filter (where v.is_out_of_range), '[]'::jsonb)
    into v_oor_count, v_oor_fields
    from public.refrigeration_report_values v
    join public.refrigeration_reports r on r.id = v.report_id
   where r.facility_id = p_facility_id and r.business_date = p_business_date;

  return jsonb_build_object(
    'reports_submitted', v_reports,
    'readings_expected', v_readings_expected,
    'out_of_range_count', v_oor_count,
    'out_of_range_fields', v_oor_fields
  );
end;
$$;

comment on function public.compute_daily_metrics_refrigeration(uuid, date) is
  'Refrigeration rollup for one facility/day. out_of_range_count/fields read '
  'is_out_of_range as persisted on refrigeration_report_values at submit time '
  '(thresholds active then), never re-evaluated against today''s thresholds. '
  'readings_expected is the raw refrigeration_settings.readings_per_shift value '
  '(nullable), not a per-day target — the schema has no shifts-per-day concept '
  'to multiply it by.';

revoke execute on function public.compute_daily_metrics_refrigeration(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_refrigeration(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- air_quality
--   has_exceedance / is_exceedance already exist. exceedance_max_by_metric is
--   keyed by the reading's key_snapshot (stable even if a reading_type is
--   later renamed or deleted) rather than reading_type_id.
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_air_quality(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_reports int;
  v_exceedances int;
  v_metrics_measured int;
  v_max_by_metric jsonb;
begin
  select count(*), count(*) filter (where has_exceedance)
    into v_reports, v_exceedances
    from public.air_quality_reports
   where facility_id = p_facility_id and business_date = p_business_date;

  -- exceedance_max_by_metric only ever needs the exceeding rows.
  select coalesce(jsonb_object_agg(k.key_snapshot, k.max_value) filter (where k.max_value is not null), '{}'::jsonb)
    into v_max_by_metric
    from (
      select r.reading_type_id, r.key_snapshot, max(r.value_numeric) as max_value
        from public.air_quality_readings r
        join public.air_quality_reports rp on rp.id = r.report_id
       where rp.facility_id = p_facility_id
         and rp.business_date = p_business_date
         and r.is_exceedance
       group by r.reading_type_id, r.key_snapshot
    ) k;

  -- metrics_measured counts every reading type SUBMITTED that day, exceeding
  -- or not — a separate, wider query from the exceedance-only one above.
  select count(distinct r.reading_type_id) into v_metrics_measured
    from public.air_quality_readings r
    join public.air_quality_reports rp on rp.id = r.report_id
   where rp.facility_id = p_facility_id and rp.business_date = p_business_date;

  return jsonb_build_object(
    'reports_submitted', v_reports,
    'exceedances', v_exceedances,
    'exceedance_max_by_metric', v_max_by_metric,
    'metrics_measured', v_metrics_measured
  );
end;
$$;

comment on function public.compute_daily_metrics_air_quality(uuid, date) is
  'Air quality rollup for one facility/day. exceedance_max_by_metric is keyed '
  'by key_snapshot (stable if a reading type is later renamed/deleted), value '
  'is the day''s maximum exceeding reading for that key. metrics_measured '
  'counts distinct reading types submitted that day, exceeding or not.';

revoke execute on function public.compute_daily_metrics_air_quality(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_air_quality(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- incident_reports
--   by_type/by_severity are keyed by the dropdown's stable `name`/`key` rather
--   than the FK uuid. open_at_eod/resolved_today reconstruct state from
--   resolved_at/archived_at (timestamped transitions), never from the mutable
--   `status` column — see the file header. median_hours_to_resolve is an
--   acknowledged approximation (see file header).
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_incident_reports(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_reported int;
  v_by_type jsonb;
  v_by_severity jsonb;
  v_open_at_eod int;
  v_resolved_today int;
  v_median_hours numeric;
begin
  select coalesce(timezone, 'UTC') into v_tz from public.facilities where id = p_facility_id;

  select count(*) into v_reported
    from public.incident_reports
   where facility_id = p_facility_id and business_date = p_business_date;

  select coalesce(jsonb_object_agg(coalesce(t.name, 'unspecified'), cnt), '{}'::jsonb)
    into v_by_type
    from (
      select it.name, count(*) as cnt
        from public.incident_reports ir
        left join public.incident_types it on it.id = ir.incident_type_id
       where ir.facility_id = p_facility_id and ir.business_date = p_business_date
       group by it.name
    ) t(name, cnt);

  select coalesce(jsonb_object_agg(coalesce(s.key, 'unspecified'), cnt), '{}'::jsonb)
    into v_by_severity
    from (
      select sl.key, count(*) as cnt
        from public.incident_reports ir
        left join public.incident_severity_levels sl on sl.id = ir.severity_level_id
       where ir.facility_id = p_facility_id and ir.business_date = p_business_date
       group by sl.key
    ) s(key, cnt);

  -- Open as of end of p_business_date: reported on or before that day, and
  -- neither resolved nor archived by then (facility-local date of the
  -- transition timestamp, not the current `status` text).
  select count(*) into v_open_at_eod
    from public.incident_reports
   where facility_id = p_facility_id
     and business_date <= p_business_date
     and (resolved_at is null or (resolved_at at time zone v_tz)::date > p_business_date)
     and (archived_at is null or (archived_at at time zone v_tz)::date > p_business_date);

  select count(*) into v_resolved_today
    from public.incident_reports
   where facility_id = p_facility_id
     and resolved_at is not null
     and (resolved_at at time zone v_tz)::date = p_business_date;

  select round(
           (percentile_cont(0.5) within group (
              order by extract(epoch from (resolved_at - submitted_at)) / 3600.0
            ))::numeric,
           1
         )
    into v_median_hours
    from public.incident_reports
   where facility_id = p_facility_id
     and resolved_at is not null
     and (resolved_at at time zone v_tz)::date = p_business_date;

  return jsonb_build_object(
    'reported', v_reported,
    'by_type', v_by_type,
    'by_severity', v_by_severity,
    'open_at_eod', v_open_at_eod,
    'resolved_today', v_resolved_today,
    'median_hours_to_resolve', v_median_hours
  );
end;
$$;

comment on function public.compute_daily_metrics_incident_reports(uuid, date) is
  'Incident reports rollup for one facility/day. open_at_eod/resolved_today are '
  'reconstructed from resolved_at/archived_at (timestamped, immutable once set) '
  'rather than the current `status` column, so recomputing a past day never '
  'drifts as tickets move through the current-state workflow. '
  'median_hours_to_resolve is a per-day median (an acknowledged approximation '
  'when later averaged across a period — see migration file header).';

revoke execute on function public.compute_daily_metrics_incident_reports(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_incident_reports(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- accident_reports
--   by_severity keyed by the severity dropdown's stable key. medical_attention
--   counts anything other than the seeded 'none' key — i.e. any medical
--   attention at all, including first aid, which is what the field name says.
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_accident_reports(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_reported int;
  v_by_severity jsonb;
  v_medical int;
  v_workers_comp int;
begin
  select count(*), count(*) filter (where workers_comp)
    into v_reported, v_workers_comp
    from public.accident_reports
   where facility_id = p_facility_id and business_date = p_business_date;

  select coalesce(jsonb_object_agg(coalesce(d.key, 'unspecified'), cnt), '{}'::jsonb)
    into v_by_severity
    from (
      select d.key, count(*) as cnt
        from public.accident_reports a
        left join public.accident_dropdowns d on d.id = a.severity_dropdown_id
       where a.facility_id = p_facility_id and a.business_date = p_business_date
       group by d.key
    ) d(key, cnt);

  select count(*) into v_medical
    from public.accident_reports a
    join public.accident_dropdowns d on d.id = a.medical_attention_dropdown_id
   where a.facility_id = p_facility_id
     and a.business_date = p_business_date
     and d.key <> 'none';

  return jsonb_build_object(
    'reported', v_reported,
    'by_severity', v_by_severity,
    'medical_attention_count', v_medical,
    'workers_comp_count', v_workers_comp
  );
end;
$$;

comment on function public.compute_daily_metrics_accident_reports(uuid, date) is
  'Accident reports rollup for one facility/day. medical_attention_count is '
  'every report whose medical_attention dropdown selection is anything other '
  'than the seeded ''none'' key (includes first aid) — a report with no '
  'matching dropdown row (deleted/never set) is excluded rather than assumed.';

revoke execute on function public.compute_daily_metrics_accident_reports(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_accident_reports(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- dasher_boards
--   walks_completed buckets on business_date (which reflects the COMPLETION
--   day, migration 267) with completed_at not null. walks_started buckets on
--   started_at converted through the facility's OWN timezone directly — NOT
--   business_date — because a walk that starts before midnight and completes
--   after belongs to different days for the two counts. See file header.
--   dasher_boards_issues carries no business_date column at all (migration
--   264 did not touch it), so issues_opened/issues_resolved/open_issues_at_eod
--   all derive their days from created_at/resolved_at through the facility
--   timezone here.
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_dasher_boards(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_completed int;
  v_started int;
  v_opened int;
  v_resolved int;
  v_open_by_severity jsonb;
  v_mean_days_open numeric;
begin
  select coalesce(timezone, 'UTC') into v_tz from public.facilities where id = p_facility_id;

  select count(*) into v_completed
    from public.dasher_boards_inspections
   where facility_id = p_facility_id
     and business_date = p_business_date
     and completed_at is not null;

  select count(*) into v_started
    from public.dasher_boards_inspections
   where facility_id = p_facility_id
     and (started_at at time zone v_tz)::date = p_business_date;

  select count(*) into v_opened
    from public.dasher_boards_issues
   where facility_id = p_facility_id
     and (created_at at time zone v_tz)::date = p_business_date;

  select count(*) into v_resolved
    from public.dasher_boards_issues
   where facility_id = p_facility_id
     and resolved_at is not null
     and (resolved_at at time zone v_tz)::date = p_business_date;

  -- Open as of end of day: reported on or before p_business_date, not resolved
  -- by then (resolved_at's local date, not the mutable resolved_by/ack state).
  -- v_mean_days_open is the mean age across ALL open issues, computed
  -- separately from the per-severity breakdown below — it is NOT an average
  -- of the per-severity averages, which would over-weight low-volume
  -- severities.
  select coalesce(jsonb_object_agg(sev, cnt), '{}'::jsonb)
    into v_open_by_severity
    from (
      select severity as sev, count(*) as cnt
        from public.dasher_boards_issues
       where facility_id = p_facility_id
         and (created_at at time zone v_tz)::date <= p_business_date
         and (resolved_at is null or (resolved_at at time zone v_tz)::date > p_business_date)
       group by severity
    ) grp(sev, cnt);

  select round(avg(p_business_date - (created_at at time zone v_tz)::date)::numeric, 1)
    into v_mean_days_open
    from public.dasher_boards_issues
   where facility_id = p_facility_id
     and (created_at at time zone v_tz)::date <= p_business_date
     and (resolved_at is null or (resolved_at at time zone v_tz)::date > p_business_date);

  return jsonb_build_object(
    'walks_completed', v_completed,
    'walks_started', v_started,
    'issues_opened', v_opened,
    'issues_resolved', v_resolved,
    'open_issues_at_eod', v_open_by_severity,
    'mean_days_open', v_mean_days_open
  );
end;
$$;

comment on function public.compute_daily_metrics_dasher_boards(uuid, date) is
  'Dasher boards rollup for one facility/day. walks_completed buckets on '
  'business_date (completion day); walks_started buckets on started_at through '
  'the facility timezone directly, NOT business_date, because a walk begun '
  'before local midnight and completed after belongs to different days for the '
  'two counts. open_issues_at_eod/mean_days_open reconstruct backlog state as '
  'of end of p_business_date from resolved_at (never the mutable status), so '
  'recomputing a past day is stable. mean_days_open is the mean age of ALL open '
  'issues at eod, not an average of the per-severity averages.';

revoke execute on function public.compute_daily_metrics_dasher_boards(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_dasher_boards(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- scheduling
--   Shifts are bucketed by their START day in the facility's own timezone
--   (schedule_shifts carries no business_date — scheduling was out of scope
--   for migration 267). open_shifts_unfilled and compliance_warnings_count are
--   best-effort CURRENT-state reads: schedule_open_shifts.claim_status and
--   schedule_shifts.compliance_warnings are mutable with no history table, so
--   a backfilled day reflects today's state of old rows, not a true eod
--   reconstruction. That is a real limitation, disclosed in the label.
-- -----------------------------------------------------------------------------
create or replace function public.compute_daily_metrics_scheduling(
  p_facility_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_scheduled int;
  v_published int;
  v_open_unfilled int;
  v_warnings int;
begin
  select coalesce(timezone, 'UTC') into v_tz from public.facilities where id = p_facility_id;

  select count(*), count(*) filter (where status = 'published')
    into v_scheduled, v_published
    from public.schedule_shifts
   where facility_id = p_facility_id
     and (starts_at at time zone v_tz)::date = p_business_date;

  select count(*) into v_open_unfilled
    from public.schedule_open_shifts o
    join public.schedule_shifts s on s.id = o.shift_id
   where s.facility_id = p_facility_id
     and (s.starts_at at time zone v_tz)::date = p_business_date
     and o.claim_status = 'open';

  select count(*) into v_warnings
    from public.schedule_shifts
   where facility_id = p_facility_id
     and (starts_at at time zone v_tz)::date = p_business_date
     and jsonb_array_length(coalesce(compliance_warnings, '[]'::jsonb)) > 0;

  return jsonb_build_object(
    'shifts_scheduled', v_scheduled,
    'shifts_published', v_published,
    'open_shifts_unfilled', v_open_unfilled,
    'compliance_warnings_count', v_warnings
  );
end;
$$;

comment on function public.compute_daily_metrics_scheduling(uuid, date) is
  'Scheduling rollup for one facility/day. Bucketed by each shift''s starts_at '
  'converted through the facility timezone directly (schedule_shifts has no '
  'business_date column). open_shifts_unfilled and compliance_warnings_count '
  'are current-state reads with no eod history to reconstruct from — a '
  'backfilled past day reflects today''s claim_status/compliance_warnings on '
  'those rows, not necessarily what was true at the time. '
  'compliance_warnings_count counts AFFECTED SHIFTS (>=1 warning), not the '
  'total number of individual warnings.';

revoke execute on function public.compute_daily_metrics_scheduling(uuid, date) from public, anon, authenticated;
grant  execute on function public.compute_daily_metrics_scheduling(uuid, date) to service_role;

-- =============================================================================
-- PART B — orchestrator
-- =============================================================================

create or replace function public.compute_facility_daily_metrics(
  p_facility_id uuid,
  p_business_date date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row_count int := 0;
  v_module    text;
  v_metrics   jsonb;
begin
  if not (public.is_super_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'compute_facility_daily_metrics: not authorized';
  end if;

  if p_facility_id is null or p_business_date is null then
    raise exception 'compute_facility_daily_metrics: facility_id and business_date are required';
  end if;

  -- Only the nine modules this migration has a rollup function for. Iterating
  -- a fixed list (rather than every facility_modules row) means an unrelated
  -- module key (communications, facility_paperwork, rink_scheduling, admin)
  -- is silently skipped rather than raising on a missing function.
  for v_module in
    select unnest(array[
      'daily_reports', 'ice_operations', 'ice_depth', 'refrigeration',
      'air_quality', 'incident_reports', 'accident_reports',
      'dasher_boards', 'scheduling'
    ])
  loop
    if not exists (
      select 1 from public.facility_modules m
       where m.facility_id = p_facility_id and m.module_key = v_module and m.enabled
    ) then
      continue;
    end if;

    v_metrics := case v_module
      when 'daily_reports'    then public.compute_daily_metrics_daily_reports(p_facility_id, p_business_date)
      when 'ice_operations'   then public.compute_daily_metrics_ice_operations(p_facility_id, p_business_date)
      when 'ice_depth'        then public.compute_daily_metrics_ice_depth(p_facility_id, p_business_date)
      when 'refrigeration'    then public.compute_daily_metrics_refrigeration(p_facility_id, p_business_date)
      when 'air_quality'      then public.compute_daily_metrics_air_quality(p_facility_id, p_business_date)
      when 'incident_reports' then public.compute_daily_metrics_incident_reports(p_facility_id, p_business_date)
      when 'accident_reports' then public.compute_daily_metrics_accident_reports(p_facility_id, p_business_date)
      when 'dasher_boards'    then public.compute_daily_metrics_dasher_boards(p_facility_id, p_business_date)
      when 'scheduling'       then public.compute_daily_metrics_scheduling(p_facility_id, p_business_date)
    end;

    insert into public.facility_daily_metrics (facility_id, business_date, module_key, metrics, computed_at)
    values (p_facility_id, p_business_date, v_module, v_metrics, now())
    on conflict (facility_id, business_date, module_key)
      do update set metrics = excluded.metrics, computed_at = excluded.computed_at;

    v_row_count := v_row_count + 1;
  end loop;

  return v_row_count;
end;
$$;

comment on function public.compute_facility_daily_metrics(uuid, date) is
  'Computes and upserts one facility_daily_metrics row per ENABLED module (of '
  'the nine this migration covers) for one facility/day. Idempotent: recomputing '
  'a day updates metrics and computed_at in place. Callable by service_role or '
  'a super admin (e.g. a future "recompute this day" admin action) — nobody '
  'else.';

revoke execute on function public.compute_facility_daily_metrics(uuid, date) from public, anon;
grant  execute on function public.compute_facility_daily_metrics(uuid, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- run_daily_metrics_rollup_for_yesterday()
--   The nightly cron's single entry point. For EACH facility, "yesterday"
--   means yesterday in THAT facility's own timezone, resolved independently —
--   a facility in a different zone than the cron's run time must not get a
--   half-day or the wrong day entirely.
-- -----------------------------------------------------------------------------
create or replace function public.run_daily_metrics_rollup_for_yesterday()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility record;
  v_business_date date;
  v_rows int;
  v_total_rows int := 0;
  v_facilities int := 0;
  v_per_facility jsonb := '[]'::jsonb;
begin
  if not (public.is_super_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'run_daily_metrics_rollup_for_yesterday: not authorized';
  end if;

  for v_facility in select id, timezone from public.facilities loop
    v_business_date := ((now() at time zone coalesce(v_facility.timezone, 'UTC'))::date - 1);
    v_rows := public.compute_facility_daily_metrics(v_facility.id, v_business_date);
    v_total_rows := v_total_rows + v_rows;
    v_facilities := v_facilities + 1;
    v_per_facility := v_per_facility || jsonb_build_object(
      'facility_id', v_facility.id,
      'business_date', v_business_date,
      'rows', v_rows
    );
  end loop;

  return jsonb_build_object(
    'facilities', v_facilities,
    'total_rows', v_total_rows,
    'per_facility', v_per_facility
  );
end;
$$;

comment on function public.run_daily_metrics_rollup_for_yesterday() is
  'Nightly rollup entry point: for every facility, computes YESTERDAY in that '
  'facility''s OWN timezone (not a shared "yesterday UTC") and upserts its '
  'facility_daily_metrics rows. Called by /api/cron/daily-metrics-rollup via a '
  'single RPC, matching the snapshot_closed_daily_assignment_days pattern.';

revoke execute on function public.run_daily_metrics_rollup_for_yesterday() from public, anon, authenticated;
grant  execute on function public.run_daily_metrics_rollup_for_yesterday() to service_role;

-- -----------------------------------------------------------------------------
-- backfill_facility_daily_metrics(facility, from, to)
--   Recomputes a bounded date range for ONE facility. This is how a metric bug
--   gets fixed after the fact — build it now, before it is needed under
--   pressure. Capped at 400 days per invocation so a route calling this can
--   never be made to run an unbounded scan.
-- -----------------------------------------------------------------------------
create or replace function public.backfill_facility_daily_metrics(
  p_facility_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date;
  v_rows int;
  v_total_rows int := 0;
  v_days int := 0;
begin
  if not (public.is_super_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'backfill_facility_daily_metrics: not authorized';
  end if;

  if p_facility_id is null or p_from is null or p_to is null then
    raise exception 'backfill_facility_daily_metrics: facility_id, from and to are required';
  end if;

  if p_to < p_from then
    raise exception 'backfill_facility_daily_metrics: to (%) is before from (%)', p_to, p_from;
  end if;

  if (p_to - p_from) > 400 then
    raise exception 'backfill_facility_daily_metrics: range is % days, capped at 400 per invocation',
      (p_to - p_from) + 1;
  end if;

  v_day := p_from;
  while v_day <= p_to loop
    v_rows := public.compute_facility_daily_metrics(p_facility_id, v_day);
    v_total_rows := v_total_rows + v_rows;
    v_days := v_days + 1;
    v_day := v_day + 1;
  end loop;

  return jsonb_build_object('facility_id', p_facility_id, 'days', v_days, 'total_rows', v_total_rows);
end;
$$;

comment on function public.backfill_facility_daily_metrics(uuid, date, date) is
  'Recomputes facility_daily_metrics for ONE facility across an inclusive date '
  'range, capped at 400 days per call. Idempotent (same upsert as the nightly '
  'path), so this is how a metric-definition bug is recovered from after the '
  'fact and how historical data is backfilled the first time. Called by '
  '/api/cron/daily-metrics-backfill.';

revoke execute on function public.backfill_facility_daily_metrics(uuid, date, date) from public, anon, authenticated;
grant  execute on function public.backfill_facility_daily_metrics(uuid, date, date) to service_role;

-- =============================================================================
-- PART C — report_metric_definitions seed, one block per module, matching the
-- metrics each compute_daily_metrics_* function above actually emits.
-- =============================================================================

insert into public.report_metric_definitions (module_key, metric_key, label, unit, aggregation, sort_order) values
  -- daily_reports
  ('daily_reports', 'areas_assigned', 'Areas assigned', null, 'sum', 1),
  ('daily_reports', 'areas_completed', 'Areas completed', null, 'sum', 2),
  ('daily_reports', 'completion_pct', 'Completion rate', '%', 'avg', 3),
  ('daily_reports', 'submissions', 'Submissions', null, 'sum', 4),
  ('daily_reports', 'submissions_superseded', 'Corrections made', null, 'sum', 5),
  ('daily_reports', 'items_checked', 'Checklist items checked', null, 'sum', 6),
  ('daily_reports', 'items_total', 'Checklist items total', null, 'sum', 7),

  -- ice_operations
  ('ice_operations', 'ice_cuts', 'Ice cuts', null, 'sum', 1),
  ('ice_operations', 'edging_ops', 'Edging operations', null, 'sum', 2),
  ('ice_operations', 'blade_changes', 'Blade changes', null, 'sum', 3),
  ('ice_operations', 'propane_changes', 'Propane tank changes', null, 'sum', 4),
  ('ice_operations', 'circle_checks_completed', 'Circle checks completed', null, 'sum', 5),
  ('ice_operations', 'circle_checks_with_failure', 'Circle checks with a failed item', null, 'sum', 6),
  ('ice_operations', 'failed_items_total', 'Failed checklist items', null, 'sum', 7),

  -- ice_depth
  ('ice_depth', 'sessions', 'Measurement sessions', null, 'sum', 1),
  ('ice_depth', 'measurements_total', 'Measurements taken', null, 'sum', 2),
  ('ice_depth', 'low_readings', 'Low readings', null, 'sum', 3),
  ('ice_depth', 'high_readings', 'High readings', null, 'sum', 4),
  ('ice_depth', 'min_depth', 'Minimum depth', null, 'min', 5),
  ('ice_depth', 'mean_depth', 'Mean depth', null, 'avg', 6),

  -- refrigeration
  ('refrigeration', 'reports_submitted', 'Reports submitted', null, 'sum', 1),
  ('refrigeration', 'readings_expected', 'Readings expected per shift (configured)', null, 'last', 2),
  ('refrigeration', 'out_of_range_count', 'Out-of-range readings', null, 'sum', 3),
  ('refrigeration', 'out_of_range_fields', 'Out-of-range fields', null, 'sum', 4),

  -- air_quality
  ('air_quality', 'reports_submitted', 'Reports submitted', null, 'sum', 1),
  ('air_quality', 'exceedances', 'Exceedances', null, 'sum', 2),
  ('air_quality', 'exceedance_max_by_metric', 'Peak exceeding reading by metric', null, 'max', 3),
  ('air_quality', 'metrics_measured', 'Distinct metrics measured', null, 'last', 4),

  -- incident_reports
  ('incident_reports', 'reported', 'Incidents reported', null, 'sum', 1),
  ('incident_reports', 'by_type', 'Incidents by type', null, 'sum', 2),
  ('incident_reports', 'by_severity', 'Incidents by severity', null, 'sum', 3),
  ('incident_reports', 'open_at_eod', 'Open at end of day', null, 'last', 4),
  ('incident_reports', 'resolved_today', 'Resolved', null, 'sum', 5),
  ('incident_reports', 'median_hours_to_resolve', 'Median hours to resolve', 'hours', 'avg', 6),

  -- accident_reports
  ('accident_reports', 'reported', 'Accidents reported', null, 'sum', 1),
  ('accident_reports', 'by_severity', 'Accidents by severity', null, 'sum', 2),
  ('accident_reports', 'medical_attention_count', 'Required medical attention', null, 'sum', 3),
  ('accident_reports', 'workers_comp_count', 'Workers'' comp claims', null, 'sum', 4),

  -- dasher_boards
  ('dasher_boards', 'walks_completed', 'Walks completed', null, 'sum', 1),
  ('dasher_boards', 'walks_started', 'Walks started', null, 'sum', 2),
  ('dasher_boards', 'issues_opened', 'Issues opened', null, 'sum', 3),
  ('dasher_boards', 'issues_resolved', 'Issues resolved', null, 'sum', 4),
  ('dasher_boards', 'open_issues_at_eod', 'Open issues at end of day (by severity)', null, 'last', 5),
  ('dasher_boards', 'mean_days_open', 'Mean days open (current backlog)', 'days', 'last', 6),

  -- scheduling
  ('scheduling', 'shifts_scheduled', 'Shifts scheduled', null, 'sum', 1),
  ('scheduling', 'shifts_published', 'Shifts published', null, 'sum', 2),
  ('scheduling', 'open_shifts_unfilled', 'Open shifts unfilled', null, 'last', 3),
  ('scheduling', 'compliance_warnings_count', 'Shifts with a compliance warning', null, 'sum', 4)
on conflict (module_key, metric_key) do update
  set label = excluded.label, unit = excluded.unit, aggregation = excluded.aggregation,
      sort_order = excluded.sort_order, updated_at = now();

commit;
