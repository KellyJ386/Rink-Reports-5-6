-- =============================================================================
-- 00000000000185_daily_assignment_snapshot.sql
-- Daily Reports: area assignment & routing — Phase 5 (day close + snapshot).
--
-- Daily reports have no explicit lock: a day "locks" implicitly when the
-- facility-local date rolls over (migrations 156/161). This migration gives
-- assignment routing the same day-close semantics (gate decision, discovery
-- doc §1 option A):
--
-- 1. Past-date guard trigger on report_area_assignments: once a business date
--    is in the past (facility-local), its assignment rows can no longer be
--    inserted or modified by end-user roles — "reassignment after lock is
--    impossible" at the DB boundary, not just in the actions. Service paths
--    (postgres / supabase_admin / service_role, incl. SECURITY DEFINER
--    functions owned by postgres) bypass, mirroring the scheduling
--    publish-lock trigger (migrations 148/164/181).
--
-- 2. snapshot_daily_assignment_days(facility): freezes the assignment record
--    (D8) for every closed day that still has assignment rows but no
--    snapshot: per area, the active assignees ([{employee_id, name, source}])
--    and completion (any submission that day; completed_by =
--    [{employee_id, name, submission_id, submitted_at}]). Insert-only —
--    an existing snapshot row is NEVER touched (ON CONFLICT DO NOTHING on
--    top of a table with no client write policies), so the record reflects
--    the day-close state permanently. Open areas (no active assignees at
--    close) get no row and render exactly as before the feature.
--    Lookback is bounded to 14 days, matching the submission purge window.
--
-- 3. resolve_daily_area_assignments() now calls the snapshot function first,
--    so the first console/board load after midnight closes out prior days
--    opportunistically — no cron dependency for active facilities.
--
-- 4. snapshot_closed_daily_assignment_days(): service-role wrapper looping
--    every facility with assignment rows, for the cron route
--    (/api/cron/snapshot-daily-assignments) to cover facilities nobody
--    opened. The lock is never blocked by incomplete assignments (D5): the
--    snapshot only RECORDS incompleteness, nothing stops the day rolling.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Past-date guard on report_area_assignments.
-- ---------------------------------------------------------------------------
-- NOT security definer: the current_user check below must see the INVOKING
-- role (authenticated / service_role); a definer trigger would always run as
-- postgres and bypass itself. The facilities read runs under the invoker's
-- RLS — their own facility row is always visible, and a null lookup falls
-- back to the UTC date.
create or replace function public.report_area_assignments_block_past()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row   public.report_area_assignments;
  v_today date;
begin
  -- Service paths bypass (mirrors schedule_shifts_publish_lock).
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;

  v_row := coalesce(new, old);
  select (now() at time zone coalesce(f.timezone, 'UTC'))::date
    into v_today
    from public.facilities f
   where f.id = v_row.facility_id;

  if v_row.report_date < coalesce(v_today, current_date)
     or (tg_op = 'UPDATE' and old.report_date < coalesce(v_today, current_date)) then
    raise exception
      'Assignments for a past day are locked: % is before the facility''s current date.',
      v_row.report_date
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.report_area_assignments_block_past() is
  'Trigger: rejects INSERT/UPDATE of report_area_assignments rows whose report_date is before '
  'the facility-local current date for end-user roles — the assignment record of a closed day '
  'is immutable ("no reassignment after lock"). Service roles bypass.';

drop trigger if exists trg_report_area_assignments_block_past
  on public.report_area_assignments;
create trigger trg_report_area_assignments_block_past
  before insert or update on public.report_area_assignments
  for each row execute function public.report_area_assignments_block_past();

-- ---------------------------------------------------------------------------
-- 2. Per-facility snapshot writer (internal; called by resolve + the cron
--    wrapper below — NOT executable by end-user roles).
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_daily_assignment_days(
  p_facility_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date;
  v_count integer;
begin
  if p_facility_id is null then
    return 0;
  end if;

  select (now() at time zone coalesce(f.timezone, 'UTC'))::date
    into v_today
    from public.facilities f
   where f.id = p_facility_id;
  if v_today is null then
    return 0;
  end if;

  -- One snapshot writer per facility at a time (same lock family as the
  -- resolution engine's per-date lock, keyed on facility alone).
  perform pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':snapshot', 42));

  insert into public.daily_area_assignment_snapshots
    (facility_id, business_date, area_id, assignees, completed, completed_by)
  select
    p_facility_id,
    d.report_date,
    d.area_id,
    (
      select jsonb_agg(
               jsonb_build_object(
                 'employee_id', a.employee_id,
                 'name', coalesce(
                   nullif(trim(e.first_name || ' ' || e.last_name), ''),
                   'Unknown'),
                 'source', a.source
               )
               order by e.first_name, e.last_name)
        from public.report_area_assignments a
        join public.employees e on e.id = a.employee_id
       where a.facility_id  = p_facility_id
         and a.report_date  = d.report_date
         and a.area_id      = d.area_id
         and a.superseded_at is null
    ),
    exists (
      select 1
        from public.daily_report_submissions s
       where s.facility_id   = p_facility_id
         and s.area_id       = d.area_id
         and s.business_date = d.report_date
    ),
    (
      select jsonb_agg(
               jsonb_build_object(
                 'employee_id', s.employee_id,
                 'name', coalesce(
                   nullif(trim(e.first_name || ' ' || e.last_name), ''),
                   'Unknown'),
                 'submission_id', s.id,
                 'submitted_at', s.submitted_at
               )
               order by s.submitted_at)
        from public.daily_report_submissions s
        left join public.employees e on e.id = s.employee_id
       where s.facility_id   = p_facility_id
         and s.area_id       = d.area_id
         and s.business_date = d.report_date
    )
  from (
    -- Closed days (facility-local) within the retention window that carry
    -- ACTIVE assignment rows and are not snapshotted yet.
    select distinct a.report_date, a.area_id
      from public.report_area_assignments a
     where a.facility_id = p_facility_id
       and a.report_date < v_today
       and a.report_date >= v_today - 14
       and a.superseded_at is null
       and not exists (
         select 1
           from public.daily_area_assignment_snapshots sn
          where sn.facility_id   = p_facility_id
            and sn.business_date = a.report_date
            and sn.area_id       = a.area_id
       )
  ) d
  on conflict (facility_id, business_date, area_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.snapshot_daily_assignment_days(uuid) is
  'Daily Reports routing (D8): freezes the assignment record for every closed facility-local '
  'day (within 14 days) that has active assignment rows and no snapshot yet — assignees, '
  'completed y/n, completed-by. Insert-only; existing snapshots are never modified. Internal: '
  'invoked by resolve_daily_area_assignments and the cron wrapper, not by end users.';

revoke execute on function public.snapshot_daily_assignment_days(uuid)
  from public, anon, authenticated;
grant execute on function public.snapshot_daily_assignment_days(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Resolution engine: close out prior days before materializing today.
--    (Full CREATE OR REPLACE of the migration-184 function; the ONLY change
--    is the snapshot call, placed before the routing-flag early return so a
--    facility that just disabled routing still gets its final days frozen.)
-- ---------------------------------------------------------------------------
create or replace function public.resolve_daily_area_assignments(p_date date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility uuid;
  v_tz       text;
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

  -- Only today's window (facility-local "today" can differ from the server's
  -- UTC date by a day in either direction). Past days are locked; far-future
  -- materialization is meaningless because schedules/defaults still change.
  if p_date is null or p_date < current_date - 2 or p_date > current_date + 2 then
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

  select coalesce(f.timezone, 'UTC') into v_tz
    from public.facilities f where f.id = v_facility;
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
$$;

comment on function public.resolve_daily_area_assignments(date) is
  'Daily Reports routing: materializes report_area_assignments for the caller''s facility and '
  'the given business date (manual > published-schedule > default > open). First '
  'materialization per (area, date) wins; areas with any existing rows are never touched, so '
  're-runs are no-ops and manual changes are never overwritten. Also freezes snapshots for '
  'prior closed days (Phase 5). Reads scheduling data (schedule_shifts, published only) but '
  'never writes it. SECURITY DEFINER; caller must hold daily_reports module access; date '
  'restricted to a small window around today.';

revoke execute on function public.resolve_daily_area_assignments(date) from public, anon;
grant  execute on function public.resolve_daily_area_assignments(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cron wrapper: snapshot every facility that has assignment rows.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_closed_daily_assignment_days()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fac   uuid;
  v_total integer := 0;
begin
  -- Internal-only: cron route with the service key (or a superuser).
  if not (
    public.is_super_admin()
    or session_user in ('postgres', 'supabase_admin')
    or current_user in ('postgres', 'supabase_admin', 'service_role')
  ) then
    raise exception 'snapshot_closed_daily_assignment_days: not authorized'
      using errcode = '42501';
  end if;

  for v_fac in
    select distinct facility_id from public.report_area_assignments
  loop
    v_total := v_total + public.snapshot_daily_assignment_days(v_fac);
  end loop;

  return v_total;
end;
$$;

comment on function public.snapshot_closed_daily_assignment_days() is
  'Cron entry point: runs snapshot_daily_assignment_days for every facility with assignment '
  'rows, freezing closed days that opportunistic console loads have not covered. Authorized '
  'for service paths / super admins only.';

revoke execute on function public.snapshot_closed_daily_assignment_days()
  from public, anon, authenticated;
grant execute on function public.snapshot_closed_daily_assignment_days() to service_role;

commit;
