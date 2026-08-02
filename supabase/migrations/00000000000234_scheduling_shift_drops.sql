-- Scheduling: let staff release ("drop") a shift back to the open pool.
--
-- Until now a shift only reached schedule_open_shifts through an admin:
-- publishing an unassigned shift, or an admin unassigning one while approving
-- time off. An employee who could not work a shift had to arrange a swap with
-- a NAMED coworker — scheduling_apply_swap handles one-way coverage, but only
-- to a specific target_employee_id. There was no way to hand a shift back for
-- anyone to pick up.
--
-- This migration adds that path:
--   * schedule_shift_drop_requests — the request record + its decision trail.
--   * schedule_settings.drop_requires_manager_approval (default true) and
--     .drop_min_notice_hours (default 0 = no cutoff).
--   * scheduling_request_shift_drop / _decide_shift_drop / _cancel_shift_drop.
--
-- WHY THE RPCs ARE SECURITY DEFINER: releasing a shift means clearing
-- employee_id on a PUBLISHED row, which schedule_shifts_publish_lock (migrations
-- 148/164/181) rejects for any end-user role. A DEFINER function runs as the
-- table owner ('postgres'), which that trigger's current_user check already
-- exempts — the same route scheduling_claim_open_shift and
-- scheduling_admin_edit_published_shift take. Because DEFINER bypasses RLS,
-- each function below re-implements its own facility fence; those fences are
-- asserted in supabase/tests/rls_isolation.sql.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

alter table public.schedule_settings
  add column if not exists drop_requires_manager_approval boolean not null default true,
  add column if not exists drop_min_notice_hours integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'schedule_settings_drop_min_notice_hours_check'
  ) then
    alter table public.schedule_settings
      add constraint schedule_settings_drop_min_notice_hours_check
      check (drop_min_notice_hours >= 0 and drop_min_notice_hours <= 8760);
  end if;
end
$$;

comment on column public.schedule_settings.drop_requires_manager_approval is
  'true (default) = a staff shift drop is a REQUEST a scheduling admin must approve before the shift is released. false = the drop takes effect immediately and the shift goes straight to the open-shift pool, which can leave a shift uncovered with nobody signing off — opt in deliberately.';
comment on column public.schedule_settings.drop_min_notice_hours is
  'Minimum hours between now and a shift''s start for staff to be allowed to drop it. 0 (default) = no cutoff.';

-- ---------------------------------------------------------------------------
-- 2. Drop requests
-- ---------------------------------------------------------------------------

create table if not exists public.schedule_shift_drop_requests (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  shift_id                 uuid not null references public.schedule_shifts(id) on delete cascade,
  requester_employee_id    uuid not null references public.employees(id) on delete cascade,
  status                   text not null default 'pending'
                             check (status in ('pending','approved','denied','cancelled')),
  reason                   text,
  decided_by_employee_id   uuid references public.employees(id) on delete set null,
  decided_at               timestamptz,
  decision_note            text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

comment on table public.schedule_shift_drop_requests is
  'Scheduling: an employee asking to be released from a published shift. On approval the shift is unassigned and listed in schedule_open_shifts for anyone to claim. Status transitions happen only through the scheduling_*_shift_drop RPCs.';

-- One live request per shift: without this, two rapid submissions (or a
-- double-tap) would queue two pending rows and an admin could approve the
-- same release twice.
create unique index if not exists idx_shift_drop_requests_one_pending
  on public.schedule_shift_drop_requests (shift_id)
  where status = 'pending';

create index if not exists idx_shift_drop_requests_facility_status
  on public.schedule_shift_drop_requests (facility_id, status, created_at desc);

create index if not exists idx_shift_drop_requests_requester
  on public.schedule_shift_drop_requests (requester_employee_id, created_at desc);

drop trigger if exists trg_schedule_shift_drop_requests_updated_at
  on public.schedule_shift_drop_requests;
create trigger trg_schedule_shift_drop_requests_updated_at
  before update on public.schedule_shift_drop_requests
  for each row execute function public.set_updated_at();

alter table public.schedule_shift_drop_requests enable row level security;

-- SELECT: the requester sees their own; scheduling admins see their facility's.
drop policy if exists schedule_shift_drop_requests_select
  on public.schedule_shift_drop_requests;
create policy schedule_shift_drop_requests_select
  on public.schedule_shift_drop_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        requester_employee_id = public.current_employee_id()
        or public.has_module_admin_access('scheduling')
      )
    )
  );

-- INSERT: staff file their OWN request, in their own facility, with scheduling
-- submit rights. The RPC is the intended entry point (it also validates the
-- shift); this policy exists so the row is reachable but never forgeable for
-- someone else.
drop policy if exists schedule_shift_drop_requests_insert
  on public.schedule_shift_drop_requests;
create policy schedule_shift_drop_requests_insert
  on public.schedule_shift_drop_requests
  for insert to authenticated
  with check (
    facility_id = public.current_facility_id()
    and requester_employee_id = public.current_employee_id()
    and public.has_module_submit_access('scheduling')
    and status = 'pending'
  );

-- UPDATE: the requester may ONLY withdraw a still-pending request. Deciding
-- (approved/denied) is admin-only. Note the WITH CHECK repeats the status
-- restriction rather than relying on the USING clause — the swap-request
-- policy this is modelled on had exactly that bug (migration 136), where a
-- bare "requester = me" term in WITH CHECK nullified its own status guard and
-- let staff set any status.
drop policy if exists schedule_shift_drop_requests_update
  on public.schedule_shift_drop_requests;
create policy schedule_shift_drop_requests_update
  on public.schedule_shift_drop_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        (requester_employee_id = public.current_employee_id() and status = 'pending')
        or public.has_module_admin_access('scheduling')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        (requester_employee_id = public.current_employee_id() and status = 'cancelled')
        or public.has_module_admin_access('scheduling')
      )
    )
  );

-- DELETE: nobody. A decided request is history.
drop policy if exists schedule_shift_drop_requests_delete
  on public.schedule_shift_drop_requests;
create policy schedule_shift_drop_requests_delete
  on public.schedule_shift_drop_requests
  for delete to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. Notification types
-- ---------------------------------------------------------------------------

-- Postgres cannot add a value to a CHECK, so widening the domain means DROP +
-- ADD with the WHOLE list restated. Repeating migration 158's warning because
-- it is the exact trap here: every existing value must be carried forward or
-- the DROP + ADD silently NARROWS the domain. The full set as of this
-- migration is migration 15's eight, plus 'shift_reminder' (migration 20),
-- plus 'swap_expired' / 'claim_expired' (migration 158) — those last two are
-- inserted by scheduling_expire_stale_swaps, which /api/cron/expire-scheduling
-- runs every 10 minutes, so dropping them breaks the expiry sweep in
-- production. rls_isolation.sql now inserts one row of every value below, so a
-- future restatement that loses one fails CI instead of a cron.
alter table public.schedule_notifications
  drop constraint if exists schedule_notifications_notification_type_check;
alter table public.schedule_notifications
  add constraint schedule_notifications_notification_type_check
  check (notification_type in (
    'schedule_published','shift_changed','open_shift_available',
    'swap_request_received','swap_approved','swap_denied',
    'time_off_decided','overtime_warning','shift_reminder',
    'swap_expired','claim_expired',
    'shift_drop_requested','shift_drop_decided'
  ));

alter table public.schedule_notifications
  add column if not exists drop_id uuid
    references public.schedule_shift_drop_requests(id) on delete cascade;

comment on column public.schedule_notifications.drop_id is
  'Links a shift_drop_* notification to its schedule_shift_drop_requests row, mirroring the existing shift_id / swap_id / time_off_id columns.';

-- ---------------------------------------------------------------------------
-- 4. Release helper — shared by the auto-approve and admin-approve paths so
--    the two cannot drift on how a shift reaches the open pool.
-- ---------------------------------------------------------------------------

create or replace function public.scheduling_release_shift_to_pool(
  p_shift_id uuid,
  p_facility_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_first_come boolean;
begin
  select coalesce(open_shift_first_come, true) into v_first_come
    from public.schedule_settings
   where facility_id = p_facility_id;

  update public.schedule_shifts
     set employee_id = null
   where id = p_shift_id;

  -- approval_required snapshots (NOT open_shift_first_come) at creation time,
  -- exactly as scheduling_approve_publish_request does.
  insert into public.schedule_open_shifts (
    facility_id, shift_id, claim_status, approval_required
  )
  values (
    p_facility_id, p_shift_id, 'open', not coalesce(v_first_come, true)
  )
  on conflict (shift_id) do update
    set claim_status           = 'open',
        claimed_by_employee_id = null,
        claimed_at             = null,
        approved_by_employee_id = null,
        approved_at            = null;
end;
$$;

revoke all on function public.scheduling_release_shift_to_pool(uuid, uuid) from public;

comment on function public.scheduling_release_shift_to_pool(uuid, uuid) is
  'Internal: unassign a shift and (re)list it as an open shift. Called only by the shift-drop RPCs; not granted to any client role.';

-- ---------------------------------------------------------------------------
-- 5. scheduling_request_shift_drop
-- ---------------------------------------------------------------------------

create or replace function public.scheduling_request_shift_drop(
  p_shift_id uuid,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_shift       public.schedule_shifts%rowtype;
  v_settings    public.schedule_settings%rowtype;
  v_needs_admin boolean;
  v_notice      integer;
  v_drop_id     uuid;
  v_admin       record;
begin
  if v_employee_id is null then
    return jsonb_build_object('ok', false, 'error', 'Your account isn''t set up for scheduling.');
  end if;
  if not public.has_module_submit_access('scheduling') then
    return jsonb_build_object('ok', false, 'error', 'You don''t have permission to drop shifts.');
  end if;

  select * into v_shift
    from public.schedule_shifts
   where id = p_shift_id
   for update;

  -- Same message for "not found" and "not yours" so the RPC can't be used to
  -- probe for another facility's shift ids.
  if not found
     or v_shift.facility_id is distinct from v_facility_id
     or v_shift.employee_id is distinct from v_employee_id then
    return jsonb_build_object('ok', false, 'error', 'Shift not found.');
  end if;

  if v_shift.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'Only a published shift can be dropped.');
  end if;
  if v_shift.starts_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'That shift has already started.');
  end if;

  select * into v_settings
    from public.schedule_settings
   where facility_id = v_facility_id;

  v_notice := coalesce(v_settings.drop_min_notice_hours, 0);
  if v_notice > 0 and v_shift.starts_at < now() + make_interval(hours => v_notice) then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        'Shifts must be dropped at least %s hours ahead. Contact your manager.',
        v_notice)
    );
  end if;

  if exists (
    select 1 from public.schedule_shift_drop_requests
     where shift_id = p_shift_id and status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'error', 'You already have a pending request for this shift.');
  end if;

  v_needs_admin := coalesce(v_settings.drop_requires_manager_approval, true);

  insert into public.schedule_shift_drop_requests (
    facility_id, shift_id, requester_employee_id, status, reason,
    decided_by_employee_id, decided_at
  ) values (
    v_facility_id, p_shift_id, v_employee_id,
    case when v_needs_admin then 'pending' else 'approved' end,
    nullif(btrim(coalesce(p_reason, '')), ''),
    case when v_needs_admin then null else v_employee_id end,
    case when v_needs_admin then null else now() end
  )
  returning id into v_drop_id;

  if v_needs_admin then
    -- Tell every scheduling admin in the facility there's something to decide.
    for v_admin in
      select distinct e.id
        from public.employees e
        join public.user_permissions up on up.user_id = e.user_id
       where e.facility_id = v_facility_id
         and e.is_active = true
         and up.facility_id = v_facility_id
         and up.module_name = 'scheduling'
         and up.action = 'admin'
         and up.enabled = true
    loop
      insert into public.schedule_notifications (
        facility_id, employee_id, notification_type, shift_id, drop_id, payload
      ) values (
        v_facility_id, v_admin.id, 'shift_drop_requested', p_shift_id, v_drop_id,
        jsonb_build_object(
          'starts_at', v_shift.starts_at,
          'ends_at', v_shift.ends_at,
          'message', 'An employee asked to drop a shift.')
      );
    end loop;

    return jsonb_build_object('ok', true, 'status', 'pending', 'drop_id', v_drop_id);
  end if;

  -- Auto-approve path: the facility has turned manager approval off.
  perform public.scheduling_release_shift_to_pool(p_shift_id, v_facility_id);

  insert into public.schedule_notifications (
    facility_id, employee_id, notification_type, shift_id, drop_id, payload
  )
  select v_facility_id, e.id, 'open_shift_available', p_shift_id, v_drop_id,
         jsonb_build_object(
           'starts_at', v_shift.starts_at,
           'ends_at', v_shift.ends_at,
           'message', 'A shift is available to pick up.')
    from public.employees e
   where e.facility_id = v_facility_id
     and e.is_active = true
     and e.id <> v_employee_id;

  return jsonb_build_object('ok', true, 'status', 'approved', 'drop_id', v_drop_id);
end;
$$;

revoke all on function public.scheduling_request_shift_drop(uuid, text) from public;
grant execute on function public.scheduling_request_shift_drop(uuid, text) to authenticated;

comment on function public.scheduling_request_shift_drop(uuid, text) is
  'Staff: ask to be released from one of your own published, future shifts. Files a pending request, or releases the shift straight to the open pool when the facility has drop_requires_manager_approval off.';

-- ---------------------------------------------------------------------------
-- 6. scheduling_decide_shift_drop
-- ---------------------------------------------------------------------------

create or replace function public.scheduling_decide_shift_drop(
  p_drop_id uuid,
  p_approve boolean,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id    uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_drop        public.schedule_shift_drop_requests%rowtype;
  v_shift       public.schedule_shifts%rowtype;
begin
  select * into v_drop
    from public.schedule_shift_drop_requests
   where id = p_drop_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;

  -- DEFINER bypasses RLS, so this is the fence. Super admins are exempt from
  -- the facility match; everyone else must hold the scheduling admin grant AND
  -- be in the request's own facility. Same "not found" message either way so
  -- the RPC can't confirm another facility's ids.
  if not (
    public.is_super_admin()
    or (
      public.has_module_admin_access('scheduling')
      and v_drop.facility_id = v_facility_id
    )
  ) then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;

  if v_drop.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', format('Request is already %s.', v_drop.status));
  end if;

  select * into v_shift
    from public.schedule_shifts
   where id = v_drop.shift_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'The shift no longer exists.');
  end if;

  if p_approve then
    -- Re-check the snapshot: if the shift moved to someone else (a swap, an
    -- admin edit) since the request was filed, releasing it would take it away
    -- from whoever holds it now.
    if v_shift.employee_id is distinct from v_drop.requester_employee_id then
      return jsonb_build_object(
        'ok', false,
        'error', 'That shift is no longer assigned to the employee who asked to drop it.');
    end if;
    if v_shift.status <> 'published' then
      return jsonb_build_object('ok', false, 'error', 'That shift is no longer published.');
    end if;

    perform public.scheduling_release_shift_to_pool(v_drop.shift_id, v_drop.facility_id);
  end if;

  update public.schedule_shift_drop_requests
     set status                 = case when p_approve then 'approved' else 'denied' end,
         decided_by_employee_id = v_actor_id,
         decided_at             = now(),
         decision_note          = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_drop_id;

  -- Always tell the requester.
  insert into public.schedule_notifications (
    facility_id, employee_id, notification_type, shift_id, drop_id, payload
  ) values (
    v_drop.facility_id, v_drop.requester_employee_id, 'shift_drop_decided',
    v_drop.shift_id, p_drop_id,
    jsonb_build_object(
      'decision', case when p_approve then 'approved' else 'denied' end,
      'decision_note', nullif(btrim(coalesce(p_note, '')), ''),
      'starts_at', v_shift.starts_at,
      'ends_at', v_shift.ends_at)
  );

  -- On approval the shift is now up for grabs — tell everyone else.
  if p_approve then
    insert into public.schedule_notifications (
      facility_id, employee_id, notification_type, shift_id, drop_id, payload
    )
    select v_drop.facility_id, e.id, 'open_shift_available', v_drop.shift_id, p_drop_id,
           jsonb_build_object(
             'starts_at', v_shift.starts_at,
             'ends_at', v_shift.ends_at,
             'message', 'A shift is available to pick up.')
      from public.employees e
     where e.facility_id = v_drop.facility_id
       and e.is_active = true
       and e.id <> v_drop.requester_employee_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'decision', case when p_approve then 'approved' else 'denied' end);
end;
$$;

revoke all on function public.scheduling_decide_shift_drop(uuid, boolean, text) from public;
grant execute on function public.scheduling_decide_shift_drop(uuid, boolean, text) to authenticated;

comment on function public.scheduling_decide_shift_drop(uuid, boolean, text) is
  'Scheduling admin: approve (release the shift to the open pool) or deny a staff shift-drop request. Re-checks that the shift is still assigned to the requester before releasing it.';

-- ---------------------------------------------------------------------------
-- 7. scheduling_cancel_shift_drop
-- ---------------------------------------------------------------------------

create or replace function public.scheduling_cancel_shift_drop(p_drop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_drop        public.schedule_shift_drop_requests%rowtype;
begin
  select * into v_drop
    from public.schedule_shift_drop_requests
   where id = p_drop_id
   for update;

  if not found
     or v_drop.facility_id is distinct from v_facility_id
     or v_drop.requester_employee_id is distinct from v_employee_id then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;

  if v_drop.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'This request can no longer be withdrawn.');
  end if;

  update public.schedule_shift_drop_requests
     set status = 'cancelled', decided_at = now()
   where id = p_drop_id
     and status = 'pending';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.scheduling_cancel_shift_drop(uuid) from public;
grant execute on function public.scheduling_cancel_shift_drop(uuid) to authenticated;

comment on function public.scheduling_cancel_shift_drop(uuid) is
  'Staff: withdraw your own still-pending shift-drop request.';
