-- =============================================================================
-- 00000000000214_scheduling_toggle_governs_all_doors.sql
--
-- One violation policy for every scheduling door.
--
-- The app-layer grid gate (grid-actions.ts gateShiftWrite) has always split
-- violation codes into always-blocking cert gaps (cert_missing:*) and
-- advisory codes (overtime, minor_overtime, break_required,
-- min_rest_between_shifts, double_booked, unavailable, time_off,
-- not_qualified), hard-blocking the advisory set only when the facility's
-- schedule_settings.block_on_violations toggle (migration 129) is on.
--
-- The five governed RPC doors, however, blocked on ANY code with no toggle
-- and no override: approve-publish, admin open-shift assign, open-claim
-- decide, swap apply, and staff self-claim. Net effect: with the toggle OFF
-- (the default), an admin could save a draft over an advisory warning via
-- the confirm gate, and the same schedule was then unpublishable — the rule
-- was strict at one door and advisory at another, so which door you used
-- decided whether the rule existed.
--
-- This migration introduces a single SQL policy helper and rewrites the five
-- RPCs to use it. Cert gaps still block everywhere unconditionally.
-- (scheduling_admin_edit_published_shift already re-checks cert-only and
-- defers advisory policy to the app gate — consistent, unchanged.)
-- =============================================================================

-- The one place the blocking policy is decided in SQL. Mirrors
-- partitionViolations() in src/app/admin/scheduling/_lib/enforcement.ts.
create or replace function public.scheduling_blocking_violations(
  p_facility_id uuid,
  p_codes       text[]
) returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when coalesce(
           (select s.block_on_violations
              from public.schedule_settings s
             where s.facility_id = p_facility_id),
           false)
      then coalesce(p_codes, '{}')
    else coalesce(
           (select array_agg(c order by c)
              from unnest(coalesce(p_codes, '{}')) as c
             where c like 'cert_missing:%'),
           '{}')
  end
$$;

comment on function public.scheduling_blocking_violations(uuid, text[]) is
  'Filters scheduling_assignment_violations() codes down to the subset that '
  'must BLOCK a write for this facility: cert_missing:* always; everything '
  'else only when schedule_settings.block_on_violations is on. Single source '
  'of the hard/soft policy for the governed scheduling RPCs (migration 214).';

revoke execute on function public.scheduling_blocking_violations(uuid, text[]) from public, anon;
grant  execute on function public.scheduling_blocking_violations(uuid, text[]) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.scheduling_approve_publish_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_req         public.schedule_publish_requests%rowtype;
  v_settings    public.schedule_settings%rowtype;
  v_ids         uuid[];
  v_shift       record;
  v_codes       text[];
  v_blocking    text[];
  v_advisory    text[] := '{}';
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

  -- Re-validate every assigned draft before publishing. BLOCKING codes are
  -- decided by scheduling_blocking_violations (migration 214): cert gaps
  -- always block; advisory codes (overtime, min-rest, time-off, overlap, …)
  -- block only when the facility's block_on_violations toggle is on —
  -- the SAME policy the scheduling-grid gate applies at authoring time.
  -- Before migration 214 this loop blocked on ANY code, so a draft that was
  -- legal to save (warn-and-confirm) could make the whole week unpublishable.
  -- Non-blocking advisory codes are collected and returned so the approver
  -- still sees them.
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
    v_blocking := public.scheduling_blocking_violations(v_req.facility_id, v_codes);
    if array_length(v_blocking, 1) is not null then
      v_blocked := v_blocked + 1;
    elsif array_length(v_codes, 1) is not null then
      v_advisory := array(
        select distinct c from unnest(v_advisory || v_codes) as c order by c);
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

  return jsonb_build_object(
    'ok', true, 'shift_count', v_count, 'open_count', v_open_count,
    'advisory_warnings', to_jsonb(v_advisory),
    'advisory_count', coalesce(array_length(v_advisory, 1), 0));
end;
$function$

;

CREATE OR REPLACE FUNCTION public.scheduling_admin_assign_open_shift(p_open_shift_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_open        public.schedule_open_shifts%rowtype;
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
  v_blocking    text[];
  v_updated     int;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_assign_open_shift: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_open from public.schedule_open_shifts where id = p_open_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Open shift not found.');
  end if;
  if not public.is_super_admin() and v_open.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_assign_open_shift: listing belongs to another facility'
      using errcode = '42501';
  end if;
  if v_open.claim_status not in ('open', 'claimed') then
    return jsonb_build_object('ok', false, 'error', 'Open shift is no longer available.');
  end if;

  select * into v_shift from public.schedule_shifts where id = v_open.shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Parent shift not found.');
  end if;

  if not exists (
    select 1 from public.employees e
     where e.id = p_employee_id and e.facility_id = v_open.facility_id
  ) then
    return jsonb_build_object('ok', false, 'error',
      'That employee isn''t part of your facility.');
  end if;

  -- Re-validate. Cert gaps always block; advisory codes (overtime, time-off,
  -- overlap, …) block only under the facility's block_on_violations policy —
  -- the same partition the scheduling-grid gate applies (migration 214).
  v_codes := public.scheduling_assignment_violations(
    v_open.facility_id, p_employee_id,
    v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
    v_shift.job_area_id, v_shift.id);
  v_blocking := public.scheduling_blocking_violations(v_open.facility_id, v_codes);
  if array_length(v_blocking, 1) is not null then
    return jsonb_build_object('ok', false, 'error', 'not_assignable',
      'violations', to_jsonb(v_blocking));
  end if;

  update public.schedule_shifts
     set employee_id = p_employee_id
   where id = v_open.shift_id and employee_id is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error',
      'That shift was already assigned to someone else.');
  end if;

  update public.schedule_open_shifts
     set claim_status            = 'filled',
         claimed_by_employee_id  = p_employee_id,
         claimed_at              = now(),
         approved_by_employee_id = v_employee_id,
         approved_at             = now()
   where id = p_open_shift_id;

  return jsonb_build_object('ok', true);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.scheduling_decide_open_claim(p_open_shift_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_open        public.schedule_open_shifts%rowtype;
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
  v_blocking    text[];
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

    -- Re-validate the claimant at decision time. Cert gaps always block;
    -- advisory codes block only under block_on_violations (migration 214).
    v_codes := public.scheduling_assignment_violations(
      v_open.facility_id, v_open.claimed_by_employee_id,
      v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
      v_shift.job_area_id, v_shift.id);
    v_blocking := public.scheduling_blocking_violations(v_open.facility_id, v_codes);
    if array_length(v_blocking, 1) is not null then
      return jsonb_build_object('ok', false,
        'error', 'claimant_not_assignable', 'violations', to_jsonb(v_blocking));
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
$function$

;

CREATE OR REPLACE FUNCTION public.scheduling_apply_swap(p_swap_id uuid, p_decision_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_swap        public.schedule_swap_requests%rowtype;
  v_req_shift   public.schedule_shifts%rowtype;
  v_tgt_shift   public.schedule_shifts%rowtype;
  v_codes       text[];
  v_blocking    text[];
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

  -- Validate each employee against the shift they are moving onto, excluding
  -- BOTH traded shifts so the counterpart doesn't false-positive
  -- double-booking / weekly hours / min-rest. Cert gaps always block;
  -- advisory codes block only under block_on_violations (migration 214).
  v_codes := public.scheduling_assignment_violations(
    v_swap.facility_id, v_swap.target_employee_id,
    v_req_shift.starts_at, v_req_shift.ends_at, v_req_shift.break_minutes,
    v_req_shift.job_area_id, v_req_shift.id, v_swap.target_shift_id);
  v_blocking := public.scheduling_blocking_violations(v_swap.facility_id, v_codes);
  if array_length(v_blocking, 1) is not null then
    return jsonb_build_object('ok', false,
      'error', 'target_not_assignable', 'violations', to_jsonb(v_blocking));
  end if;

  if v_swap.target_shift_id is not null then
    v_codes := public.scheduling_assignment_violations(
      v_swap.facility_id, v_swap.requester_employee_id,
      v_tgt_shift.starts_at, v_tgt_shift.ends_at, v_tgt_shift.break_minutes,
      v_tgt_shift.job_area_id, v_tgt_shift.id, v_req_shift.id);
    v_blocking := public.scheduling_blocking_violations(v_swap.facility_id, v_codes);
    if array_length(v_blocking, 1) is not null then
      return jsonb_build_object('ok', false,
        'error', 'requester_not_assignable', 'violations', to_jsonb(v_blocking));
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
$function$

;

CREATE OR REPLACE FUNCTION public.scheduling_claim_open_shift(p_open_shift_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id   uuid := public.current_employee_id();
  v_facility_id   uuid := public.current_facility_id();
  v_open          public.schedule_open_shifts%rowtype;
  v_shift         public.schedule_shifts%rowtype;
  v_codes         text[];
  v_blocking      text[];
begin
  if v_employee_id is null then
    raise exception 'No current employee context.' using errcode = '28000';
  end if;
  if not public.has_module_access('scheduling') then
    raise exception 'Scheduling module access required.' using errcode = '42501';
  end if;

  select * into v_open
    from public.schedule_open_shifts
   where id = p_open_shift_id
     for update;

  if not found then
    return false;
  end if;
  if v_open.facility_id <> v_facility_id then
    raise exception 'Open shift does not belong to caller facility.' using errcode = '42501';
  end if;
  if v_open.claim_status <> 'open' then
    return false;
  end if;

  select * into v_shift from public.schedule_shifts where id = v_open.shift_id;

  -- A staff member may not claim a shift they are not allowed to work.
  -- Cert gaps always block; advisory codes block only under the facility's
  -- block_on_violations policy (migration 214).
  v_codes := public.scheduling_assignment_violations(
    v_facility_id, v_employee_id,
    v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
    v_shift.job_area_id, v_shift.id
  );
  v_blocking := public.scheduling_blocking_violations(v_facility_id, v_codes);
  if array_length(v_blocking, 1) is not null then
    raise exception 'Cannot claim this shift: %', array_to_string(v_blocking, ', ')
      using errcode = 'check_violation';
  end if;

  if v_open.approval_required = false then
    update public.schedule_open_shifts
       set claim_status            = 'filled',
           claimed_by_employee_id  = v_employee_id,
           claimed_at              = now(),
           approved_by_employee_id = v_employee_id,
           approved_at             = now()
     where id = p_open_shift_id;

    update public.schedule_shifts
       set employee_id = v_employee_id
     where id = v_open.shift_id
       and employee_id is null;
  else
    update public.schedule_open_shifts
       set claim_status           = 'claimed',
           claimed_by_employee_id = v_employee_id,
           claimed_at             = now()
     where id = p_open_shift_id;
  end if;

  return true;
end;
$function$

;

