-- =============================================================================
-- 00000000000136_scheduling_swap_publish_rpcs_and_rls.sql
-- Scheduling correctness batch:
--
-- 1. scheduling_assignment_violations gains an optional second exclusion id so
--    a two-way swap can be validated while ignoring BOTH shifts being traded.
--    (Previously the validator excluded only the destination shift, so the
--    counterpart shift still counted toward double-booking / weekly hours /
--    min-rest — falsely hard-blocking legitimate swaps.)
-- 2. scheduling_apply_swap(): atomic, race-safe swap approval. Locks the swap
--    row and both shifts, re-verifies the swap's snapshot is not stale (each
--    shift still belongs to the employee recorded on the swap), validates both
--    directions, applies the exchange (or one-way coverage when
--    target_shift_id IS NULL), finalizes the request, and notifies — all in
--    one transaction. Replaces the non-atomic two-UPDATE apply in
--    governance-actions.ts that could strand a half-applied swap.
-- 3. scheduling_approve_publish_request(): atomic publish approval. Locks the
--    request row (two concurrent approvers can no longer both publish),
--    re-validates every assigned draft, publishes, writes the audit event,
--    creates schedule_open_shifts listings for unassigned published shifts
--    (previously NOTHING ever created listings, so the staff claim flow was
--    unreachable), honors schedule_settings.notify_on_publish, and finalizes
--    the request.
-- 4. RLS hardening:
--    * schedule_swap_requests UPDATE: the old WITH CHECK contained a bare
--      "requester = me" / "target = me" term that nullified its own status
--      restriction — staff could set ANY status (including manager_approved).
--      Now: requester may only move pending/accepted -> cancelled; target may
--      only move pending -> accepted/denied; admins (facility-scoped) decide.
--    * schedule_shifts SELECT: draft (unpublished) shifts are admin-only.
--      Staff with module access see published/cancelled only — the publish
--      step is the gate.
--    * schedule_notifications INSERT: was open to ANY same-facility user
--      (notification forgery); now requires scheduling admin. The RPCs above
--      insert as SECURITY DEFINER and are unaffected.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Re-create the validator with an optional second exclusion.
--    CREATE OR REPLACE cannot add a parameter, so drop + recreate. The claim
--    RPC calls it with 7 positional args, which still resolves against the
--    defaulted 8th parameter.
-- -----------------------------------------------------------------------------
drop function if exists public.scheduling_assignment_violations(
  uuid, uuid, timestamptz, timestamptz, int, uuid, uuid);

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
  v_is_minor     boolean;
  v_gross_hours  numeric;
  v_this_hours   numeric;
  v_other_hours  numeric;
  v_total_hours  numeric;
  v_starts_utc   timestamp;
  v_dow          int;
  v_week_start   timestamptz;
  v_week_end     timestamptz;
  v_start_t      time;
  v_end_t        time;
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

  v_gross_hours := extract(epoch from (p_ends - p_starts)) / 3600.0;
  v_this_hours  := v_gross_hours - coalesce(p_break_minutes, 0) / 60.0;

  -- Sunday-anchored UTC week containing the shift start.
  v_starts_utc := p_starts at time zone 'UTC';
  v_dow        := extract(dow from v_starts_utc)::int;          -- 0 = Sunday
  v_week_start := ((v_starts_utc::date - v_dow)::timestamp) at time zone 'UTC';
  v_week_end   := v_week_start + interval '7 days';

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
  v_start_t := (p_starts at time zone 'UTC')::time;
  v_end_t   := (p_ends   at time zone 'UTC')::time;
  if exists (
    select 1 from public.schedule_availability a
     where a.employee_id = p_employee_id
       and a.availability_type = 'unavailable'
       and a.day_of_week = v_dow
       and a.start_time < v_end_t
       and a.end_time   > v_start_t
       and (a.effective_from is null or a.effective_from <= v_starts_utc::date)
       and (a.effective_to   is null or a.effective_to   >= v_starts_utc::date)
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
  'Returns the array of hard-block violation codes for assigning an employee to a shift slot (empty = allowed). Single source of truth used by the admin server actions, the swap-apply / publish-approve RPCs, and the staff self-claim RPC. p_exclude_shift_id2 lets swap validation ignore both shifts being traded.';

revoke execute on function public.scheduling_assignment_violations(uuid, uuid, timestamptz, timestamptz, int, uuid, uuid, uuid) from public, anon;
grant  execute on function public.scheduling_assignment_violations(uuid, uuid, timestamptz, timestamptz, int, uuid, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Atomic swap approval.
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_apply_swap(
  p_swap_id       uuid,
  p_decision_note text default null
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
  v_swap        public.schedule_swap_requests%rowtype;
  v_req_shift   public.schedule_shifts%rowtype;
  v_tgt_shift   public.schedule_shifts%rowtype;
  v_codes       text[];
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_apply_swap: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_swap
    from public.schedule_swap_requests
   where id = p_swap_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Swap request not found.');
  end if;
  if not public.is_super_admin() and v_swap.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_apply_swap: swap belongs to another facility'
      using errcode = '42501';
  end if;
  if v_swap.status not in ('pending', 'accepted') then
    return jsonb_build_object('ok', false, 'error',
      format('Swap is already %s.', v_swap.status));
  end if;
  if v_swap.target_employee_id is null then
    return jsonb_build_object('ok', false, 'error',
      'Assign a target employee before approving.');
  end if;

  -- Lock both shifts in a stable order (avoids deadlock with a concurrent
  -- apply touching the same pair), then verify the swap's snapshot is fresh.
  perform 1
     from public.schedule_shifts
    where id in (v_swap.requester_shift_id, v_swap.target_shift_id)
    order by id
      for update;

  select * into v_req_shift
    from public.schedule_shifts where id = v_swap.requester_shift_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'The requester''s shift no longer exists.');
  end if;
  if v_req_shift.facility_id <> v_swap.facility_id then
    return jsonb_build_object('ok', false, 'error', 'Requester shift belongs to another facility.');
  end if;
  if v_req_shift.employee_id is distinct from v_swap.requester_employee_id then
    return jsonb_build_object('ok', false, 'error',
      'The requester''s shift was reassigned after this swap was filed. Deny or cancel the swap.');
  end if;

  if v_swap.target_shift_id is not null then
    select * into v_tgt_shift
      from public.schedule_shifts where id = v_swap.target_shift_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'The target''s shift no longer exists.');
    end if;
    if v_tgt_shift.facility_id <> v_swap.facility_id then
      return jsonb_build_object('ok', false, 'error', 'Target shift belongs to another facility.');
    end if;
    if v_tgt_shift.employee_id is distinct from v_swap.target_employee_id then
      return jsonb_build_object('ok', false, 'error',
        'The target''s shift was reassigned after this swap was filed. Deny or cancel the swap.');
    end if;
  end if;

  -- Hard block: validate each employee against the shift they are moving onto,
  -- excluding BOTH traded shifts so the counterpart doesn't false-positive
  -- double-booking / weekly hours / min-rest.
  v_codes := public.scheduling_assignment_violations(
    v_swap.facility_id, v_swap.target_employee_id,
    v_req_shift.starts_at, v_req_shift.ends_at, v_req_shift.break_minutes,
    v_req_shift.job_area_id, v_req_shift.id, v_swap.target_shift_id);
  if array_length(v_codes, 1) is not null then
    return jsonb_build_object('ok', false,
      'error', 'target_not_assignable', 'violations', to_jsonb(v_codes));
  end if;

  if v_swap.target_shift_id is not null then
    v_codes := public.scheduling_assignment_violations(
      v_swap.facility_id, v_swap.requester_employee_id,
      v_tgt_shift.starts_at, v_tgt_shift.ends_at, v_tgt_shift.break_minutes,
      v_tgt_shift.job_area_id, v_tgt_shift.id, v_req_shift.id);
    if array_length(v_codes, 1) is not null then
      return jsonb_build_object('ok', false,
        'error', 'requester_not_assignable', 'violations', to_jsonb(v_codes));
    end if;
  end if;

  -- Apply. target_shift_id NULL = one-way coverage: the target simply takes
  -- over the requester's shift.
  update public.schedule_shifts
     set employee_id = v_swap.target_employee_id
   where id = v_req_shift.id;

  if v_swap.target_shift_id is not null then
    update public.schedule_shifts
       set employee_id = v_swap.requester_employee_id
     where id = v_tgt_shift.id;
  end if;

  update public.schedule_swap_requests
     set status                       = 'manager_approved',
         approved_at                  = now(),
         decided_at                   = now(),
         manager_approver_employee_id = v_employee_id,
         decision_note                = coalesce(nullif(btrim(p_decision_note), ''), decision_note)
   where id = p_swap_id;

  insert into public.schedule_notifications
    (facility_id, employee_id, notification_type, swap_id, payload)
  values
    (v_swap.facility_id, v_swap.requester_employee_id, 'swap_approved', p_swap_id,
     jsonb_build_object('role', 'requester')),
    (v_swap.facility_id, v_swap.target_employee_id, 'swap_approved', p_swap_id,
     jsonb_build_object('role', 'target'));

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.scheduling_apply_swap(uuid, text) is
  'Admin swap approval. Atomically locks the swap + both shifts, verifies the swap snapshot is not stale, hard-block validates both directions (excluding both traded shifts), exchanges employee_ids (or applies one-way coverage when target_shift_id is null), marks the swap manager_approved, and notifies both employees. Returns jsonb {ok, error?, violations?}.';

revoke execute on function public.scheduling_apply_swap(uuid, text) from public, anon;
grant  execute on function public.scheduling_apply_swap(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Atomic publish-request approval (+ open-shift listing creation).
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
  -- approval_required snapshots (NOT open_shift_first_come), per the
  -- schedule_open_shifts contract.
  insert into public.schedule_open_shifts (facility_id, shift_id, claim_status, approval_required)
  select s.facility_id, s.id, 'open', not coalesce(v_settings.open_shift_first_come, true)
    from public.schedule_shifts s
   where s.id = any(v_ids)
     and s.employee_id is null
  on conflict (shift_id) do nothing;
  get diagnostics v_open_count = row_count;

  if coalesce(v_settings.notify_on_publish, true) then
    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, payload)
    select s.facility_id, s.employee_id, 'schedule_published', s.id,
           jsonb_build_object(
             'range_starts_at', v_req.range_starts_at,
             'range_ends_at',   v_req.range_ends_at)
      from public.schedule_shifts s
     where s.id = any(v_ids)
       and s.employee_id is not null;
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
  'Two-person publish approval, atomically: locks the request (concurrent approvers race-safe), re-validates every assigned draft via scheduling_assignment_violations, publishes, writes the schedule_publish_events audit row, creates schedule_open_shifts listings for unassigned published shifts, honors schedule_settings.notify_on_publish, and finalizes the request. Returns jsonb {ok, error?, shift_count?, open_count?}.';

revoke execute on function public.scheduling_approve_publish_request(uuid) from public, anon;
grant  execute on function public.scheduling_approve_publish_request(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4a. schedule_swap_requests UPDATE: constrain staff status transitions.
-- -----------------------------------------------------------------------------
drop policy if exists schedule_swap_requests_update on public.schedule_swap_requests;
create policy schedule_swap_requests_update on public.schedule_swap_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or (requester_employee_id = public.current_employee_id() and status in ('pending', 'accepted'))
        or (target_employee_id    = public.current_employee_id() and status = 'pending')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or (requester_employee_id = public.current_employee_id() and status = 'cancelled')
        or (target_employee_id    = public.current_employee_id() and status in ('accepted', 'denied'))
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 4b. schedule_shifts SELECT: drafts are admin-only; publish is the gate.
-- -----------------------------------------------------------------------------
drop policy if exists schedule_shifts_select on public.schedule_shifts;
create policy schedule_shifts_select on public.schedule_shifts
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
      and status <> 'draft'
    )
  );

-- -----------------------------------------------------------------------------
-- 4c. schedule_notifications INSERT: server-side writers are scheduling admins
--     (or SECURITY DEFINER RPCs, which bypass RLS). Plain staff cannot forge
--     notifications to coworkers anymore.
-- -----------------------------------------------------------------------------
drop policy if exists schedule_notifications_insert on public.schedule_notifications;
create policy schedule_notifications_insert on public.schedule_notifications
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );
