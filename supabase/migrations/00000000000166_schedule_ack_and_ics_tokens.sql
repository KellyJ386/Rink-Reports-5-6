-- =============================================================================
-- 00000000000166_schedule_ack_and_ics_tokens.sql
--
-- Two staff-visibility features for Employee Scheduling:
--
-- 1. SCHEDULE ACKNOWLEDGMENT. Managers need "who has seen the posted week".
--    schedule_notifications gains:
--      * acknowledged_at — staff explicitly acknowledge a schedule_published
--        notification (stronger than read_at). Writable by the employee via
--        the existing schedule_notifications_update policy (own rows).
--      * publish_event_id — links each schedule_published notification to its
--        schedule_publish_events row, so the admin publish history can show
--        "acknowledged N / notified M" per publish without fragile payload
--        joins. Stamped by the publish RPC (re-created below; the only body
--        change is the new column in the notification insert).
--
-- 2. ICS CALENDAR TOKENS. schedule_ics_tokens holds one secret per employee
--    used by the public calendar-feed route (/api/schedule-ics/[token]) so
--    Google/Apple Calendar can subscribe without an authenticated session —
--    the unguessable token IS the credential. Tokens are generated app-side
--    (crypto.randomBytes) and are readable/rotatable ONLY by their owner; the
--    feed route reads them with the service role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. Acknowledgment + publish-event linkage columns.
-- -----------------------------------------------------------------------------
alter table public.schedule_notifications
  add column if not exists acknowledged_at timestamptz;
alter table public.schedule_notifications
  add column if not exists publish_event_id uuid
    references public.schedule_publish_events(id) on delete set null;

comment on column public.schedule_notifications.acknowledged_at is
  'Set when the employee explicitly acknowledges the notification (currently used for schedule_published). Stronger than read_at; powers the admin "who has seen the posted week" view.';
comment on column public.schedule_notifications.publish_event_id is
  'For schedule_published notifications: the schedule_publish_events row this notification belongs to. Stamped by scheduling_approve_publish_request.';

create index if not exists idx_schedule_notifications_publish_event
  on public.schedule_notifications (publish_event_id)
  where publish_event_id is not null;

-- -----------------------------------------------------------------------------
-- 1b. Publish RPC: stamp publish_event_id on the per-shift notifications.
--     Body is otherwise identical to migration 137's definition.
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_approve_publish_request(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_req         public.schedule_publish_requests%rowtype;
  v_settings    public.schedule_settings%rowtype;
  v_ids         uuid[];
  v_shift       record;
  v_codes       text[];
  v_blocked     int := 0;
  v_count       int := 0;
  v_open_count  int := 0;
  v_event_id    uuid;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_approve_publish_request: scheduling admin required'
      using errcode = '42501';
  end if;
  if v_employee_id is null then
    return jsonb_build_object('ok', false, 'error',
      'No active employee record for your account.');
  end if;

  select * into v_req
    from public.schedule_publish_requests
   where id = p_request_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;
  if not public.is_super_admin() and v_req.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_approve_publish_request: request belongs to another facility'
      using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error',
      format('Request is already %s.', v_req.status));
  end if;
  if v_req.requested_by_employee_id = v_employee_id then
    return jsonb_build_object('ok', false, 'error',
      'You cannot approve your own publish request.');
  end if;

  -- Lock the drafts in range so a concurrent edit can't slip between
  -- validation and publish.
  perform 1
     from public.schedule_shifts
    where facility_id = v_req.facility_id
      and status = 'draft'
      and starts_at >= v_req.range_starts_at
      and starts_at <  v_req.range_ends_at
    order by id
      for update;

  select array_agg(id) into v_ids
    from public.schedule_shifts
   where facility_id = v_req.facility_id
     and status = 'draft'
     and starts_at >= v_req.range_starts_at
     and starts_at <  v_req.range_ends_at;

  if v_ids is null then
    return jsonb_build_object('ok', false, 'error',
      'No draft shifts remain in range. Reject this request instead.');
  end if;

  -- Hard block: re-validate every assigned draft before publishing.
  for v_shift in
    select id, employee_id, starts_at, ends_at, break_minutes, job_area_id
      from public.schedule_shifts
     where id = any(v_ids)
       and employee_id is not null
  loop
    v_codes := public.scheduling_assignment_violations(
      v_req.facility_id, v_shift.employee_id,
      v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
      v_shift.job_area_id, v_shift.id);
    if array_length(v_codes, 1) is not null then
      v_blocked := v_blocked + 1;
    end if;
  end loop;
  if v_blocked > 0 then
    return jsonb_build_object('ok', false, 'error', format(
      'Cannot publish: %s assigned shift%s in this range now violate a scheduling rule. Resolve them (reassign, adjust time-off/availability, or fix the shift) and try again.',
      v_blocked, case when v_blocked = 1 then '' else 's' end));
  end if;

  update public.schedule_shifts
     set status                    = 'published',
         published_at              = now(),
         published_by_employee_id  = v_employee_id
   where id = any(v_ids);
  v_count := coalesce(array_length(v_ids, 1), 0);

  insert into public.schedule_publish_events
    (facility_id, published_by_employee_id, range_starts_at, range_ends_at, shift_count)
  values
    (v_req.facility_id, v_employee_id, v_req.range_starts_at, v_req.range_ends_at, v_count)
  returning id into v_event_id;

  select * into v_settings
    from public.schedule_settings
   where facility_id = v_req.facility_id;

  -- Surface unassigned published shifts in the staff claim queue.
  insert into public.schedule_open_shifts (facility_id, shift_id, claim_status, approval_required)
  select s.facility_id, s.id, 'open', not coalesce(v_settings.open_shift_first_come, true)
    from public.schedule_shifts s
   where s.id = any(v_ids)
     and s.employee_id is null
  on conflict (shift_id) do nothing;
  get diagnostics v_open_count = row_count;

  if coalesce(v_settings.notify_on_publish, true) then
    -- Per-shift notification for each assigned employee, linked to the
    -- publish event so acknowledgment progress can be reported per publish.
    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, publish_event_id, payload)
    select s.facility_id, s.employee_id, 'schedule_published', s.id, v_event_id,
           jsonb_build_object(
             'range_starts_at', v_req.range_starts_at,
             'range_ends_at',   v_req.range_ends_at)
      from public.schedule_shifts s
     where s.id = any(v_ids)
       and s.employee_id is not null;

    -- One summary notification per active employee when claimable shifts
    -- opened, so open shifts actually get seen.
    if v_open_count > 0 then
      insert into public.schedule_notifications
        (facility_id, employee_id, notification_type, payload)
      select v_req.facility_id, e.id, 'open_shift_available',
             jsonb_build_object(
               'count',           v_open_count,
               'range_starts_at', v_req.range_starts_at,
               'range_ends_at',   v_req.range_ends_at,
               'message', format('%s open shift%s available to claim.',
                                 v_open_count,
                                 case when v_open_count = 1 then '' else 's' end))
        from public.employees e
       where e.facility_id = v_req.facility_id
         and e.is_active;
    end if;
  end if;

  update public.schedule_publish_requests
     set status                  = 'published',
         decided_by_employee_id  = v_employee_id,
         decided_at              = now(),
         published_event_id      = v_event_id
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'shift_count', v_count, 'open_count', v_open_count);
end;
$$;

comment on function public.scheduling_approve_publish_request(uuid) is
  'Two-person publish approval, atomically: locks the request, re-validates every assigned draft, publishes, writes the audit event, creates schedule_open_shifts listings for unassigned shifts, notifies assigned employees per shift (stamping publish_event_id for acknowledgment tracking) and all active employees once when claimable shifts opened (honoring notify_on_publish), and finalizes the request. Returns jsonb {ok, error?, shift_count?, open_count?}.';

-- -----------------------------------------------------------------------------
-- 2. ICS calendar-feed tokens.
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_ics_tokens (
  employee_id  uuid primary key references public.employees(id)  on delete cascade,
  facility_id  uuid not null    references public.facilities(id) on delete cascade,
  token        text not null unique check (length(token) >= 32),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.schedule_ics_tokens is
  'One secret per employee for the public ICS calendar-feed route. The unguessable token is the credential (calendar apps cannot authenticate). Owner-only RLS; the feed route reads via service role. Rotating (rotate = delete + insert or update) invalidates old subscription URLs.';

drop trigger if exists trg_schedule_ics_tokens_updated_at on public.schedule_ics_tokens;
create trigger trg_schedule_ics_tokens_updated_at
  before update on public.schedule_ics_tokens
  for each row execute function public.set_updated_at();

alter table public.schedule_ics_tokens enable row level security;

-- Owner-only, all operations: an employee manages exactly their own token.
-- No admin branch — admins have no reason to read another person's calendar
-- credential (the service-role feed route bypasses RLS).
drop policy if exists schedule_ics_tokens_select on public.schedule_ics_tokens;
create policy schedule_ics_tokens_select on public.schedule_ics_tokens
  for select to authenticated
  using (employee_id = public.current_employee_id());

drop policy if exists schedule_ics_tokens_insert on public.schedule_ics_tokens;
create policy schedule_ics_tokens_insert on public.schedule_ics_tokens
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and facility_id = public.current_facility_id()
  );

drop policy if exists schedule_ics_tokens_update on public.schedule_ics_tokens;
create policy schedule_ics_tokens_update on public.schedule_ics_tokens
  for update to authenticated
  using (employee_id = public.current_employee_id())
  with check (
    employee_id = public.current_employee_id()
    and facility_id = public.current_facility_id()
  );

drop policy if exists schedule_ics_tokens_delete on public.schedule_ics_tokens;
create policy schedule_ics_tokens_delete on public.schedule_ics_tokens
  for delete to authenticated
  using (employee_id = public.current_employee_id());
