-- =============================================================================
-- 00000000000208_daily_assignment_tz_consistency.sql
--
-- Anchor the daily-assignment engine's date-window guards to the FACILITY
-- timezone instead of the session timezone.
--
-- resolve_daily_area_assignments (migrations 184/185) validated p_date
-- against `current_date ± 2`, and resync_daily_area_assignments (migration
-- 187) mixed a facility-local lower bound with a session-timezone upper
-- bound (`current_date + 2`) in the same predicate. `current_date` uses the
-- SESSION timezone — UTC on hosted Supabase — which runs one day ahead of a
-- US-Eastern facility every evening (19:00/20:00 local onward). The ±2-day
-- slack absorbed most of the skew, but the guards were inconsistent with
-- every other date computation in these functions (all facility-TZ) and
-- tightened/shifted the accepted window depending on wall-clock hour.
--
-- Bodies otherwise identical to the live versions (185 for resolve, 187 for
-- resync). The facility-timezone lookup in resolve moves ahead of the guard.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_daily_area_assignments(p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_facility uuid;
  v_tz       text;
  v_today    date;
  v_start    timestamptz;
  v_end      timestamptz;
  v_n        integer;
  v_total    integer := 0;
begin
  v_facility := public.current_facility_id();
  if v_facility is null then
    raise exception 'No facility for caller' using errcode = '42501';
  end if;

  -- Caller gate: any daily-reports member may trigger materialization (the
  -- writes below are the engine's, not the caller's).
  if not public.has_module_access('daily_reports') then
    raise exception 'daily_reports access required' using errcode = '42501';
  end if;

  -- Only today's window. The window is anchored to the FACILITY-LOCAL date
  -- (everything else in this function uses f.timezone; the previous
  -- current_date anchor used the session timezone — UTC on Supabase — which
  -- skews one day off facility-local every evening).
  select coalesce(f.timezone, 'UTC') into v_tz
    from public.facilities f where f.id = v_facility;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  if p_date is null or p_date < v_today - 2 or p_date > v_today + 2 then
    raise exception 'resolve_daily_area_assignments: date % out of range', p_date;
  end if;

  -- Day close (Phase 5): freeze the assignment record of any prior days
  -- before touching today. Runs even when routing has since been disabled.
  perform public.snapshot_daily_assignment_days(v_facility);

  -- Routing disabled -> no-op.
  if not exists (
    select 1 from public.daily_report_settings s
     where s.facility_id = v_facility
       and s.assignment_routing_enabled = true
  ) then
    return 0;
  end if;

  -- One materializer per (facility, date) at a time; concurrent console loads
  -- queue up behind the first instead of double-inserting.
  perform pg_advisory_xact_lock(hashtextextended(v_facility::text || ':' || p_date::text, 42));

  v_start := (p_date::timestamp) at time zone v_tz;
  v_end   := v_start + interval '1 day';

  -- Schedule branch: PUBLISHED shifts starting inside the facility-local day,
  -- mapped to daily areas via daily_area_job_area_map. Only areas with no
  -- assignment rows at all for this date (see migration 184 header).
  with ins as (
    insert into public.report_area_assignments
      (facility_id, report_date, area_id, employee_id, source)
    select distinct v_facility, p_date, m.area_id, s.employee_id, 'schedule'
      from public.daily_area_job_area_map m
      join public.daily_report_areas a
        on a.id = m.area_id and a.is_active = true
      join public.schedule_shifts s
        on s.facility_id = v_facility
       and s.job_area_id = m.job_area_id
       and s.status      = 'published'
       and s.employee_id is not null
       and s.starts_at  >= v_start
       and s.starts_at  <  v_end
      join public.employees e
        on e.id = s.employee_id and e.is_active = true
     where m.facility_id = v_facility
       and not exists (
         select 1 from public.report_area_assignments x
          where x.facility_id = v_facility
            and x.report_date = p_date
            and x.area_id     = m.area_id
       )
    on conflict (facility_id, report_date, area_id, employee_id)
      where superseded_at is null
      do nothing
    returning area_id, employee_id
  )
  insert into public.daily_report_assignment_notifications
    (facility_id, employee_id, area_id, report_date, notification_type, payload)
  select v_facility, ins.employee_id, ins.area_id, p_date, 'assigned',
         jsonb_build_object('area_name', a.name, 'source', 'schedule',
                            'report_date', p_date)
    from ins
    join public.daily_report_areas a on a.id = ins.area_id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- Default branch: standing default owners for active areas that STILL have
  -- no assignment rows for this date (i.e. no manual history and no
  -- schedule-derived assignees materialized above).
  with ins as (
    insert into public.report_area_assignments
      (facility_id, report_date, area_id, employee_id, source)
    select distinct v_facility, p_date, d.area_id, d.employee_id, 'default'
      from public.area_default_owners d
      join public.daily_report_areas a
        on a.id = d.area_id and a.is_active = true
      join public.employees e
        on e.id = d.employee_id and e.is_active = true
     where d.facility_id = v_facility
       and not exists (
         select 1 from public.report_area_assignments x
          where x.facility_id = v_facility
            and x.report_date = p_date
            and x.area_id     = d.area_id
       )
    on conflict (facility_id, report_date, area_id, employee_id)
      where superseded_at is null
      do nothing
    returning area_id, employee_id
  )
  insert into public.daily_report_assignment_notifications
    (facility_id, employee_id, area_id, report_date, notification_type, payload)
  select v_facility, ins.employee_id, ins.area_id, p_date, 'assigned',
         jsonb_build_object('area_name', a.name, 'source', 'default',
                            'report_date', p_date)
    from ins
    join public.daily_report_areas a on a.id = ins.area_id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.resync_daily_area_assignments(p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_facility uuid;
  v_tz       text;
  v_today    date;
  v_start    timestamptz;
  v_end      timestamptz;
  v_n        integer;
  v_total    integer := 0;
begin
  v_facility := public.current_facility_id();
  if v_facility is null then
    raise exception 'No facility for caller' using errcode = '42501';
  end if;

  -- Explicit assignment mutation: the routing tier only (mirrors the RLS
  -- write gate on report_area_assignments).
  if not (
    public.has_module_admin_access('daily_reports')
    or public.has_module_edit_access('daily_reports')
  ) then
    raise exception 'daily_reports edit or admin access required'
      using errcode = '42501';
  end if;

  select coalesce(f.timezone, 'UTC') into v_tz
    from public.facilities f where f.id = v_facility;
  v_today := (now() at time zone v_tz)::date;

  -- Both bounds anchored to the facility-local date (the upper bound
  -- previously used session-timezone current_date — one day off facility-local
  -- every evening on a UTC server).
  if p_date is null or p_date < v_today or p_date > v_today + 2 then
    raise exception 'resync_daily_area_assignments: date % out of range', p_date;
  end if;

  -- Routing disabled -> no-op.
  if not exists (
    select 1 from public.daily_report_settings s
     where s.facility_id = v_facility
       and s.assignment_routing_enabled = true
  ) then
    return 0;
  end if;

  -- Same lock family as the engine: one mutator per (facility, date).
  perform pg_advisory_xact_lock(hashtextextended(v_facility::text || ':' || p_date::text, 42));

  v_start := (p_date::timestamp) at time zone v_tz;
  v_end   := v_start + interval '1 day';

  -- 1. Supersede stale schedule-derived rows (and defaults ousted by a
  --    non-empty schedule) in mapped areas without an active manual override.
  with eligible as (
    select distinct m.area_id
      from public.daily_area_job_area_map m
      join public.daily_report_areas a
        on a.id = m.area_id and a.is_active = true
     where m.facility_id = v_facility
       and not exists (
         select 1 from public.report_area_assignments x
          where x.facility_id = v_facility
            and x.report_date = p_date
            and x.area_id     = m.area_id
            and x.superseded_at is null
            and x.source = 'manual'
       )
  ),
  desired as (
    select distinct m.area_id, s.employee_id
      from public.daily_area_job_area_map m
      join public.schedule_shifts s
        on s.facility_id = v_facility
       and s.job_area_id = m.job_area_id
       and s.status      = 'published'
       and s.employee_id is not null
       and s.starts_at  >= v_start
       and s.starts_at  <  v_end
      join public.employees e
        on e.id = s.employee_id and e.is_active = true
     where m.facility_id = v_facility
       and m.area_id in (select area_id from eligible)
  ),
  sup as (
    update public.report_area_assignments x
       set superseded_at = now()
     where x.facility_id = v_facility
       and x.report_date = p_date
       and x.superseded_at is null
       and x.area_id in (select area_id from eligible)
       and x.source in ('schedule', 'default')
       and not exists (
         select 1 from desired d
          where d.area_id = x.area_id and d.employee_id = x.employee_id
       )
       and (
         x.source = 'schedule'
         or exists (select 1 from desired d where d.area_id = x.area_id)
       )
    returning x.area_id, x.employee_id
  )
  insert into public.daily_report_assignment_notifications
    (facility_id, employee_id, area_id, report_date, notification_type, payload)
  select v_facility, sup.employee_id, sup.area_id, p_date, 'unassigned',
         jsonb_build_object('area_name', a.name, 'source', 'schedule',
                            'report_date', p_date)
    from sup
    join public.daily_report_areas a on a.id = sup.area_id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 2. Insert missing desired assignees.
  with eligible as (
    select distinct m.area_id
      from public.daily_area_job_area_map m
      join public.daily_report_areas a
        on a.id = m.area_id and a.is_active = true
     where m.facility_id = v_facility
       and not exists (
         select 1 from public.report_area_assignments x
          where x.facility_id = v_facility
            and x.report_date = p_date
            and x.area_id     = m.area_id
            and x.superseded_at is null
            and x.source = 'manual'
       )
  ),
  desired as (
    select distinct m.area_id, s.employee_id
      from public.daily_area_job_area_map m
      join public.schedule_shifts s
        on s.facility_id = v_facility
       and s.job_area_id = m.job_area_id
       and s.status      = 'published'
       and s.employee_id is not null
       and s.starts_at  >= v_start
       and s.starts_at  <  v_end
      join public.employees e
        on e.id = s.employee_id and e.is_active = true
     where m.facility_id = v_facility
       and m.area_id in (select area_id from eligible)
  ),
  ins as (
    insert into public.report_area_assignments
      (facility_id, report_date, area_id, employee_id, source)
    select v_facility, p_date, d.area_id, d.employee_id, 'schedule'
      from desired d
     where not exists (
       select 1 from public.report_area_assignments x
        where x.facility_id = v_facility
          and x.report_date = p_date
          and x.area_id     = d.area_id
          and x.employee_id = d.employee_id
          and x.superseded_at is null
     )
    on conflict (facility_id, report_date, area_id, employee_id)
      where superseded_at is null
      do nothing
    returning area_id, employee_id
  )
  insert into public.daily_report_assignment_notifications
    (facility_id, employee_id, area_id, report_date, notification_type, payload)
  select v_facility, ins.employee_id, ins.area_id, p_date, 'assigned',
         jsonb_build_object('area_name', a.name, 'source', 'schedule',
                            'report_date', p_date)
    from ins
    join public.daily_report_areas a on a.id = ins.area_id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$function$

;
