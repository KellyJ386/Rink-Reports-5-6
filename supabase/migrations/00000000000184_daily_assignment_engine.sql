-- =============================================================================
-- 00000000000184_daily_assignment_engine.sql
-- Daily Reports: area assignment & routing — Phase 3 (engine + notifications).
--
-- 1. daily_report_assignment_notifications — per-employee in-app inbox rows
--    for assignment changes ("You're assigned to Concessions for July 18").
--    Mirrors the schedule_notifications pattern (payload jsonb render context,
--    read_at NULL = unread) but lives in the daily-reports module so the two
--    module inboxes stay separate (gate decision, discovery doc §12).
--    Writers: the assignment server actions (edit/admin tier) and the
--    resolution engine below (SECURITY DEFINER). Staff cannot forge rows.
--
-- 2. resolve_daily_area_assignments(p_date) — the resolution engine.
--    Materializes report_area_assignments for the caller's facility and the
--    given business date with priority: manual > schedule-derived > standing
--    default > open. SECURITY DEFINER because a plain staff member opening
--    the daily console must be able to trigger materialization without
--    holding assignment-write rights.
--
--    Semantics (deliberate, documented in the discovery doc):
--    * Only areas with NO assignment rows AT ALL for (area, date) are
--      materialized — active or superseded. First materialization wins;
--      after that the day is manual territory. This makes re-runs no-ops
--      (no notification spam), and it makes unassignArea a durable tombstone:
--      superseding every active row reopens the area WITHOUT the next re-run
--      re-materializing schedule/default rows over the supervisor's intent.
--      Consequence: schedule changes published after first materialization do
--      not auto-flow into assignments; supervisors adjust manually (v1 scope).
--    * Schedule branch reads PUBLISHED shifts only (status = 'published'),
--      joined through daily_area_job_area_map. Overnight shifts assign the
--      business date they START on (gate decision). READ-ONLY against
--      scheduling: this function writes report_area_assignments and
--      daily_report_assignment_notifications, nothing else.
--    * Default branch fills areas that got no schedule-derived assignees from
--      area_default_owners.
--    * Routing disabled (flag off / no settings row) => no-op, returns 0.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. daily_report_assignment_notifications
-- ---------------------------------------------------------------------------
create table if not exists public.daily_report_assignment_notifications (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid not null references public.facilities(id) on delete restrict,
  employee_id       uuid not null references public.employees(id) on delete cascade,
  area_id           uuid not null references public.daily_report_areas(id) on delete cascade,
  report_date       date not null,
  notification_type text not null check (notification_type in ('assigned', 'unassigned')),
  payload           jsonb not null default '{}'::jsonb,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

comment on table public.daily_report_assignment_notifications is
  'Daily Reports routing: per-employee in-app notifications for area assignment changes. '
  'payload carries render context (area_name, source, ...) so the UI needs no joins; '
  'read_at NULL = unread. Written by the assignment actions (edit/admin) and the '
  'resolution engine (SECURITY DEFINER); recipients mark their own rows read.';

create index if not exists idx_daily_assignment_notifications_employee_unread
  on public.daily_report_assignment_notifications (employee_id, read_at nulls first, created_at desc);
create index if not exists idx_daily_assignment_notifications_facility_date
  on public.daily_report_assignment_notifications (facility_id, report_date);

alter table public.daily_report_assignment_notifications enable row level security;

-- SELECT: the recipient, or edit/admin within the facility.
drop policy if exists daily_assignment_notifications_select
  on public.daily_report_assignment_notifications;
create policy daily_assignment_notifications_select
  on public.daily_report_assignment_notifications
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or public.has_module_edit_access('daily_reports')
        or employee_id = public.current_employee_id()
      )
    )
  );

-- INSERT: edit/admin only (the assignment actions); recipient must be a
-- same-facility employee. The resolution engine bypasses via DEFINER.
drop policy if exists daily_assignment_notifications_insert
  on public.daily_report_assignment_notifications;
create policy daily_assignment_notifications_insert
  on public.daily_report_assignment_notifications
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or public.has_module_edit_access('daily_reports')
      )
      and exists (
        select 1
          from public.employees e
         where e.id = employee_id
           and e.facility_id = daily_report_assignment_notifications.facility_id
      )
    )
  );

-- UPDATE: the recipient (mark read), or facility module admin.
drop policy if exists daily_assignment_notifications_update
  on public.daily_report_assignment_notifications;
create policy daily_assignment_notifications_update
  on public.daily_report_assignment_notifications
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or employee_id = public.current_employee_id()
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or employee_id = public.current_employee_id()
      )
    )
  );

-- DELETE: facility module admin (cleanup) or super admin.
drop policy if exists daily_assignment_notifications_delete
  on public.daily_report_assignment_notifications;
create policy daily_assignment_notifications_delete
  on public.daily_report_assignment_notifications
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- ---------------------------------------------------------------------------
-- 2. resolve_daily_area_assignments(p_date) -> integer (rows materialized)
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
  -- assignment rows at all for this date (see header).
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
  're-runs are no-ops and manual changes are never overwritten. Reads scheduling data '
  '(schedule_shifts, published only) but never writes it. SECURITY DEFINER; caller must hold '
  'daily_reports module access; date restricted to a small window around today.';

revoke execute on function public.resolve_daily_area_assignments(date) from public, anon;
grant  execute on function public.resolve_daily_area_assignments(date) to authenticated;

commit;
