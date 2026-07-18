-- =============================================================================
-- 00000000000187_daily_assignment_schedule_resync.sql
-- Daily Reports routing follow-up: explicit "re-sync from schedule".
--
-- The resolution engine is first-materialization-wins (migration 184), so a
-- schedule published or edited AFTER a day materialized does not auto-flow
-- into assignments. This adds the deliberate catch-up:
-- resync_daily_area_assignments(p_date), invoked from a button on the
-- supervisor board by an edit/admin-tier user.
--
-- Semantics (explicit-action variant of the engine's priority order):
--   * Scope: MAPPED areas only (daily_area_job_area_map), for the given
--     (today-or-future) date, and only areas with NO active manual-source
--     assignment — a manual override always outranks the schedule and is
--     never touched by re-sync.
--   * The desired set per area = distinct active employees on PUBLISHED
--     shifts starting inside the facility-local day, through the map (same
--     read as the engine; still zero scheduling writes).
--   * Active schedule-sourced rows not in the desired set are superseded
--     (shift cancelled/unpublished => assignee removed). Active
--     default-sourced rows are superseded only when the desired set is
--     non-empty (schedule outranks defaults; an empty schedule leaves the
--     default fallback standing). Missing desired assignees are inserted as
--     source='schedule'.
--   * Because this is an explicit button press, it DOES repopulate an area a
--     supervisor previously opened up (tombstone), unlike the passive engine
--     — the board shows the result immediately and the actor can open it up
--     again. Delta notifications (assigned/unassigned) fire per change;
--     a no-change re-sync inserts nothing.
--   * Past dates are rejected (closed days are immutable — migration 185).
-- =============================================================================

create or replace function public.resync_daily_area_assignments(p_date date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  if p_date is null or p_date < v_today or p_date > current_date + 2 then
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
$$;

comment on function public.resync_daily_area_assignments(date) is
  'Daily Reports routing: explicit supervisor "re-sync from schedule" for a today-or-future '
  'date — replaces schedule/default-sourced assignees of mapped areas with the current '
  'PUBLISHED-shift set (manual overrides never touched; empty schedule leaves defaults '
  'standing; delta notifications fire per change). Reads scheduling only, writes none of it. '
  'SECURITY DEFINER; caller must hold the daily_reports edit or admin action.';

revoke execute on function public.resync_daily_area_assignments(date) from public, anon;
grant  execute on function public.resync_daily_area_assignments(date) to authenticated;
