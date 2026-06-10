-- =============================================================================
-- 00000000000137_scheduling_facility_tz_engine_and_open_claims.sql
--
-- 1. scheduling_assignment_violations() computes on the FACILITY's calendar:
--    * The weekly-hours window is the facility-local week (anchored on
--      schedule_settings.week_start_day, local midnight to local midnight —
--      previously a Sunday-UTC week, which pushed e.g. a Saturday-evening US
--      shift into the wrong week's overtime/minor totals and drifted an hour
--      across DST). Mirrored by complianceWeekWindow() in
--      src/app/admin/scheduling/_lib/compliance.ts.
--    * The `unavailable` check compares facility-local day-of-week and
--      wall-clock times against schedule_availability (previously UTC clock
--      times — wrong day/hours for any non-UTC facility), and splits shifts
--      that cross local midnight into two segments so overnight shifts no
--      longer silently escape the check.
-- 2. scheduling_decide_open_claim(): atomic admin approve/decline for an
--    approval-required open-shift claim. Approve re-validates the claimant,
--    assigns the (still unassigned) parent shift, marks the listing filled,
--    and notifies the claimant; decline reopens the listing and notifies.
--    Previously the claimed state was a dead end the UI could only clobber.
-- 3. scheduling_notify_swap_request(): lets the REQUESTER (plain staff, who
--    cannot insert into schedule_notifications since migration 136) fire the
--    swap_request_received notification to their chosen target. Validates the
--    caller is the swap's requester; idempotent per swap.
-- 4. scheduling_approve_publish_request() additionally notifies active
--    employees (one summary `open_shift_available` row each) when publishing
--    opened claimable shifts, still honoring notify_on_publish.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Facility-local rules engine (same 8-arg signature as migration 136).
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_assignment_violations(
  p_facility_id       uuid,
  p_employee_id       uuid,
  p_starts            timestamptz,
  p_ends              timestamptz,
  p_break_minutes     int,
  p_job_area_id       uuid,
  p_exclude_shift_id  uuid,
  p_exclude_shift_id2 uuid default null
)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_codes        text[] := '{}';
  v_settings     public.schedule_settings%rowtype;
  v_tz           text;
  v_wsd          int;
  v_is_minor     boolean;
  v_gross_hours  numeric;
  v_this_hours   numeric;
  v_other_hours  numeric;
  v_total_hours  numeric;
  v_start_local  timestamp;  -- facility wall-clock
  v_end_local    timestamp;
  v_week_anchor  date;
  v_week_start   timestamptz;
  v_week_end     timestamptz;
  v_rule         record;
  v_req          record;
  v_max          numeric;
  v_thr          numeric;
  v_after        numeric;
  v_minm         numeric;
  v_minrest      numeric;
begin
  -- Caller scoping: only within your own facility (super admins anywhere).
  if not (
    public.is_super_admin()
    or (p_facility_id = public.current_facility_id() and public.has_module_access('scheduling'))
  ) then
    raise exception 'scheduling_assignment_violations: not authorized for this facility'
      using errcode = '42501';
  end if;

  -- Open / unassigned slot: nothing to validate.
  if p_employee_id is null or p_starts is null or p_ends is null then
    return v_codes;
  end if;

  select * into v_settings from public.schedule_settings where facility_id = p_facility_id;
  select is_minor into v_is_minor from public.employees where id = p_employee_id;
  select coalesce(timezone, 'UTC') into v_tz from public.facilities where id = p_facility_id;
  v_tz  := coalesce(v_tz, 'UTC');
  v_wsd := coalesce(v_settings.week_start_day, 0);

  v_gross_hours := extract(epoch from (p_ends - p_starts)) / 3600.0;
  v_this_hours  := v_gross_hours - coalesce(p_break_minutes, 0) / 60.0;

  -- Facility-local wall-clock representations of the candidate shift.
  v_start_local := p_starts at time zone v_tz;
  v_end_local   := p_ends   at time zone v_tz;

  -- Facility-local week containing the shift start, anchored on the
  -- configured week-start day. Local midnight -> timestamptz handles DST
  -- (167/169-hour weeks) correctly.
  v_week_anchor := v_start_local::date
    - ((extract(dow from v_start_local)::int - v_wsd + 7) % 7);
  v_week_start  := v_week_anchor::timestamp at time zone v_tz;
  v_week_end    := (v_week_anchor + 7)::timestamp at time zone v_tz;

  select coalesce(sum(
           extract(epoch from (s.ends_at - s.starts_at)) / 3600.0
           - coalesce(s.break_minutes, 0) / 60.0
         ), 0)
    into v_other_hours
    from public.schedule_shifts s
   where s.employee_id = p_employee_id
     and s.status in ('draft', 'published')
     and s.starts_at >= v_week_start
     and s.starts_at <  v_week_end
     and (p_exclude_shift_id  is null or s.id <> p_exclude_shift_id)
     and (p_exclude_shift_id2 is null or s.id <> p_exclude_shift_id2);

  v_total_hours := coalesce(v_other_hours, 0) + v_this_hours;

  -- ---- Active compliance rules --------------------------------------------
  for v_rule in
    select rule_type, params
      from public.schedule_compliance_rules
     where facility_id = p_facility_id
       and is_active
  loop
    if v_rule.rule_type = 'minor_max_hours' then
      v_max := coalesce((v_rule.params->>'max_weekly_hours')::numeric, v_settings.minor_max_weekly_hours);
      if coalesce(v_is_minor, false) and v_max is not null and v_total_hours > v_max then
        v_codes := array_append(v_codes, 'minor_overtime');
      end if;

    elsif v_rule.rule_type = 'overtime' then
      v_thr := coalesce((v_rule.params->>'weekly_threshold')::numeric, v_settings.overtime_weekly_hours);
      if v_thr is not null and v_total_hours > v_thr then
        v_codes := array_append(v_codes, 'overtime');
      end if;

    elsif v_rule.rule_type = 'break_required' then
      v_after := coalesce((v_rule.params->>'after_hours')::numeric, v_settings.minimum_break_after_hours);
      v_minm  := coalesce((v_rule.params->>'min_minutes')::numeric, v_settings.minimum_break_minutes);
      if v_after is not null and v_gross_hours > v_after
         and coalesce(p_break_minutes, 0) < coalesce(v_minm, 0) then
        v_codes := array_append(v_codes, 'break_required');
      end if;

    elsif v_rule.rule_type = 'min_rest_between_shifts' then
      v_minrest := coalesce((v_rule.params->>'min_hours')::numeric, (v_rule.params->>'min_rest_hours')::numeric);
      if v_minrest is not null and exists (
        select 1 from public.schedule_shifts s2
         where s2.employee_id = p_employee_id
           and s2.status in ('draft', 'published')
           and (p_exclude_shift_id  is null or s2.id <> p_exclude_shift_id)
           and (p_exclude_shift_id2 is null or s2.id <> p_exclude_shift_id2)
           and (
             (s2.ends_at   <= p_starts and (p_starts - s2.ends_at)   < (v_minrest * interval '1 hour')) or
             (s2.starts_at >= p_ends   and (s2.starts_at - p_ends)   < (v_minrest * interval '1 hour'))
           )
      ) then
        v_codes := array_append(v_codes, 'min_rest_between_shifts');
      end if;
    end if;
  end loop;

  -- ---- Intrinsic: double booking (overlapping assigned shift) --------------
  if exists (
    select 1 from public.schedule_shifts s3
     where s3.employee_id = p_employee_id
       and s3.status in ('draft', 'published')
       and (p_exclude_shift_id  is null or s3.id <> p_exclude_shift_id)
       and (p_exclude_shift_id2 is null or s3.id <> p_exclude_shift_id2)
       and s3.starts_at < p_ends
       and s3.ends_at   > p_starts
  ) then
    v_codes := array_append(v_codes, 'double_booked');
  end if;

  -- ---- Intrinsic: unavailable block ---------------------------------------
  -- Availability rows are recurring facility-local wall-clock blocks. Compare
  -- in facility-local terms, splitting a shift that crosses local midnight
  -- into [start, 24:00) on the start day and [00:00, end) on the end day.
  -- (Shifts longer than ~24h would need full middle-day handling; real shifts
  -- aren't.)
  if exists (
    select 1
      from (
        select extract(dow from v_start_local)::int as seg_dow,
               v_start_local::time                  as seg_start,
               case when v_start_local::date = v_end_local::date
                    then v_end_local::time
                    else time '24:00' end           as seg_end,
               v_start_local::date                  as seg_date
        union all
        select extract(dow from v_end_local)::int,
               time '00:00',
               v_end_local::time,
               v_end_local::date
         where v_start_local::date <> v_end_local::date
           and v_end_local::time > time '00:00'
      ) seg
      join public.schedule_availability a
        on a.employee_id = p_employee_id
       and a.availability_type = 'unavailable'
       and a.day_of_week = seg.seg_dow
       and a.start_time < seg.seg_end
       and a.end_time   > seg.seg_start
       and (a.effective_from is null or a.effective_from <= seg.seg_date)
       and (a.effective_to   is null or a.effective_to   >= seg.seg_date)
  ) then
    v_codes := array_append(v_codes, 'unavailable');
  end if;

  -- ---- Intrinsic: approved time-off ---------------------------------------
  if exists (
    select 1 from public.schedule_time_off_requests t
     where t.employee_id = p_employee_id
       and t.status = 'approved'
       and t.starts_at < p_ends
       and t.ends_at   > p_starts
  ) then
    v_codes := array_append(v_codes, 'time_off');
  end if;

  -- ---- Job-area qualification (opt-in via settings) -----------------------
  if p_job_area_id is not null and coalesce(v_settings.require_job_area_qualification, false) then
    if not exists (
      select 1 from public.employee_job_area_assignments j
       where j.employee_id = p_employee_id
         and j.job_area_id = p_job_area_id
    ) then
      v_codes := array_append(v_codes, 'not_qualified');
    end if;
  end if;

  -- ---- Required certifications for the job area ---------------------------
  if p_job_area_id is not null then
    for v_req in
      select cert_name
        from public.job_area_certification_requirements
       where facility_id = p_facility_id
         and job_area_id = p_job_area_id
         and is_active
    loop
      if not exists (
        select 1 from public.employee_certifications c
         where c.employee_id = p_employee_id
           and lower(btrim(c.name)) = lower(btrim(v_req.cert_name))
           and (c.expires_at is null or c.expires_at >= current_date)
      ) then
        v_codes := array_append(v_codes, 'cert_missing:' || v_req.cert_name);
      end if;
    end loop;
  end if;

  -- De-duplicate.
  select coalesce(array_agg(distinct code), '{}')
    into v_codes
    from unnest(v_codes) as code;

  return v_codes;
end;
$$;

comment on function public.scheduling_assignment_violations(uuid, uuid, timestamptz, timestamptz, int, uuid, uuid, uuid) is
  'Returns the array of hard-block violation codes for assigning an employee to a shift slot (empty = allowed). Single source of truth used by the admin server actions, the swap-apply / publish-approve / open-claim RPCs, and the staff self-claim RPC. Weekly windows and availability matching are computed on the facility''s local calendar (facilities.timezone, schedule_settings.week_start_day).';

-- -----------------------------------------------------------------------------
-- 2. Atomic approve/decline of an approval-required open-shift claim.
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_decide_open_claim(
  p_open_shift_id uuid,
  p_approve       boolean,
  p_note          text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_open        public.schedule_open_shifts%rowtype;
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_decide_open_claim: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_open
    from public.schedule_open_shifts
   where id = p_open_shift_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Open shift not found.');
  end if;
  if not public.is_super_admin() and v_open.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_decide_open_claim: listing belongs to another facility'
      using errcode = '42501';
  end if;
  if v_open.claim_status <> 'claimed' or v_open.claimed_by_employee_id is null then
    return jsonb_build_object('ok', false, 'error',
      'This listing has no pending claim to decide.');
  end if;

  select * into v_shift
    from public.schedule_shifts
   where id = v_open.shift_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'The parent shift no longer exists.');
  end if;

  if p_approve then
    if v_shift.employee_id is not null then
      return jsonb_build_object('ok', false, 'error',
        'The shift was already assigned to someone else. Decline this claim.');
    end if;

    -- Re-validate the claimant at decision time.
    v_codes := public.scheduling_assignment_violations(
      v_open.facility_id, v_open.claimed_by_employee_id,
      v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
      v_shift.job_area_id, v_shift.id);
    if array_length(v_codes, 1) is not null then
      return jsonb_build_object('ok', false,
        'error', 'claimant_not_assignable', 'violations', to_jsonb(v_codes));
    end if;

    update public.schedule_shifts
       set employee_id = v_open.claimed_by_employee_id
     where id = v_shift.id;

    update public.schedule_open_shifts
       set claim_status            = 'filled',
           approved_by_employee_id = v_employee_id,
           approved_at             = now()
     where id = p_open_shift_id;

    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, payload)
    values
      (v_open.facility_id, v_open.claimed_by_employee_id, 'shift_changed',
       v_shift.id,
       jsonb_build_object(
         'message', 'Your open-shift claim was approved — the shift is yours.',
         'note', nullif(btrim(coalesce(p_note, '')), '')));

    return jsonb_build_object('ok', true, 'decision', 'approved');
  else
    update public.schedule_open_shifts
       set claim_status            = 'open',
           claimed_by_employee_id  = null,
           claimed_at              = null
     where id = p_open_shift_id;

    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, payload)
    values
      (v_open.facility_id, v_open.claimed_by_employee_id, 'shift_changed',
       v_shift.id,
       jsonb_build_object(
         'message', 'Your open-shift claim was declined. The shift is open again.',
         'note', nullif(btrim(coalesce(p_note, '')), '')));

    return jsonb_build_object('ok', true, 'decision', 'declined');
  end if;
end;
$$;

comment on function public.scheduling_decide_open_claim(uuid, boolean, text) is
  'Admin decision on an approval-required open-shift claim. Approve: re-validates the claimant via scheduling_assignment_violations, assigns the still-unassigned parent shift, marks the listing filled, notifies the claimant. Decline: reopens the listing and notifies. Atomic and race-safe (FOR UPDATE on listing + shift). Returns jsonb {ok, decision?, error?, violations?}.';

revoke execute on function public.scheduling_decide_open_claim(uuid, boolean, text) from public, anon;
grant  execute on function public.scheduling_decide_open_claim(uuid, boolean, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Requester-fired swap_request_received notification (staff cannot insert
--    into schedule_notifications directly since migration 136).
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_notify_swap_request(p_swap_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_swap        public.schedule_swap_requests%rowtype;
begin
  if v_employee_id is null then
    raise exception 'No current employee context.' using errcode = '28000';
  end if;

  select * into v_swap from public.schedule_swap_requests where id = p_swap_id;
  if not found then
    return false;
  end if;
  -- Only the swap's own requester may fire this, only toward a set target,
  -- and only while the swap is live.
  if v_swap.requester_employee_id is distinct from v_employee_id
     or v_swap.target_employee_id is null
     or v_swap.status <> 'pending' then
    return false;
  end if;
  -- Idempotent per swap.
  if exists (
    select 1 from public.schedule_notifications n
     where n.swap_id = p_swap_id
       and n.notification_type = 'swap_request_received'
  ) then
    return true;
  end if;

  insert into public.schedule_notifications
    (facility_id, employee_id, notification_type, swap_id, payload)
  values
    (v_swap.facility_id, v_swap.target_employee_id, 'swap_request_received',
     p_swap_id,
     jsonb_build_object('message', 'A coworker asked you to take a shift — review it on the swaps page.'));
  return true;
end;
$$;

comment on function public.scheduling_notify_swap_request(uuid) is
  'Fires the swap_request_received notification to the swap''s target employee. Callable only by the swap''s requester (notification INSERT is otherwise admin-only since migration 136); idempotent per swap.';

revoke execute on function public.scheduling_notify_swap_request(uuid) from public, anon;
grant  execute on function public.scheduling_notify_swap_request(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Publish approval: also announce newly opened claimable shifts (one
--    summary notification per active employee). Same signature as 136.
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
    -- Per-shift notification for each assigned employee.
    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, payload)
    select s.facility_id, s.employee_id, 'schedule_published', s.id,
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
  'Two-person publish approval, atomically: locks the request, re-validates every assigned draft, publishes, writes the audit event, creates schedule_open_shifts listings for unassigned shifts, notifies assigned employees per shift and all active employees once when claimable shifts opened (honoring notify_on_publish), and finalizes the request. Returns jsonb {ok, error?, shift_count?, open_count?}.';
