-- =============================================================================
-- 00000000000139_scheduling_expiry.sql
--
-- Time-bounds the swap + open-claim lifecycles so stale requests don't linger:
--
-- 1. schedule_settings.swap_expiry_hours — a configurable, per-facility window
--    (default 72h, must be > 0) after which an undecided swap request lapses.
-- 2. schedule_swap_requests gains an `expires_at` timestamp and an `'expired'`
--    status. A BEFORE INSERT trigger computes expires_at = least(created_at +
--    swap_expiry_hours, the requester shift's start) when the caller didn't set
--    it (you can't usefully cover a shift after it has already started). Existing
--    open swaps are backfilled.
-- 3. Two new schedule_notifications types — `swap_expired` and `claim_expired`.
-- 4. Two SECURITY DEFINER sweeper RPCs the cron route calls on a short cadence:
--    scheduling_expire_stale_swaps() flips lapsed pending/accepted swaps to
--    'expired' (notifying requester + target), and scheduling_expire_open_claims()
--    flips lapsed open listings to 'expired' (no notification — an open listing
--    has no single owner to notify). Both batch with FOR UPDATE SKIP LOCKED so
--    concurrent cron invocations don't contend or double-process a row.
--
-- The open-claim side reuses schedule_open_shifts.expires_at / claim_status
-- ('expired') + idx_schedule_open_shifts_status_expires from migration 137.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configurable per-facility swap window.
-- -----------------------------------------------------------------------------
alter table public.schedule_settings
  add column if not exists swap_expiry_hours integer not null default 72;
alter table public.schedule_settings
  drop constraint if exists schedule_settings_swap_expiry_hours_check;
alter table public.schedule_settings
  add constraint schedule_settings_swap_expiry_hours_check check (swap_expiry_hours > 0);

-- -----------------------------------------------------------------------------
-- 2. Swap expiry tracking + 'expired' status.
-- -----------------------------------------------------------------------------
alter table public.schedule_swap_requests add column if not exists expires_at timestamptz;
alter table public.schedule_swap_requests drop constraint if exists schedule_swap_requests_status_check;
alter table public.schedule_swap_requests add constraint schedule_swap_requests_status_check
  check (status in ('pending','accepted','manager_approved','denied','cancelled','expired'));
create index if not exists idx_schedule_swap_expires
  on public.schedule_swap_requests (status, expires_at) where status in ('pending','accepted');

-- -----------------------------------------------------------------------------
-- 3. New notification types. The recreated CHECK must preserve every existing
--    value (notably 'shift_reminder', added in migration 20) and add the two
--    new expiry types — otherwise a DROP + ADD silently narrows the domain.
-- -----------------------------------------------------------------------------
alter table public.schedule_notifications drop constraint if exists schedule_notifications_notification_type_check;
alter table public.schedule_notifications add constraint schedule_notifications_notification_type_check
  check (notification_type in ('schedule_published','shift_changed','open_shift_available',
    'swap_request_received','swap_approved','swap_denied','time_off_decided','overtime_warning',
    'shift_reminder','swap_expired','claim_expired'));

-- -----------------------------------------------------------------------------
-- 4. BEFORE INSERT trigger: compute expires_at when the caller didn't set it.
--    least(created_at + window, requester shift start) — covering a shift after
--    it starts is pointless, so the shift start caps the window.
-- -----------------------------------------------------------------------------
create or replace function public.schedule_swap_set_expiry() returns trigger
language plpgsql as $$
declare v_hours int; v_shift_start timestamptz;
begin
  if new.expires_at is null then
    select swap_expiry_hours into v_hours from public.schedule_settings where facility_id = new.facility_id;
    select starts_at into v_shift_start from public.schedule_shifts where id = new.requester_shift_id;
    new.expires_at := least(coalesce(new.created_at, now()) + make_interval(hours => coalesce(v_hours, 72)), v_shift_start);
  end if;
  return new;
end $$;
drop trigger if exists trg_schedule_swap_set_expiry on public.schedule_swap_requests;
create trigger trg_schedule_swap_set_expiry before insert on public.schedule_swap_requests
  for each row execute function public.schedule_swap_set_expiry();

-- -----------------------------------------------------------------------------
-- 5. Backfill existing open swaps.
-- -----------------------------------------------------------------------------
update public.schedule_swap_requests s set expires_at =
  least(s.created_at + make_interval(hours => coalesce(
    (select swap_expiry_hours from public.schedule_settings where facility_id = s.facility_id), 72)),
    (select starts_at from public.schedule_shifts where id = s.requester_shift_id))
where s.expires_at is null and s.status in ('pending','accepted');

-- -----------------------------------------------------------------------------
-- 6. Sweeper RPCs (SECURITY DEFINER, batched, FOR UPDATE SKIP LOCKED).
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_expire_stale_swaps(p_limit int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  for r in select id, facility_id, requester_employee_id, target_employee_id
    from public.schedule_swap_requests
    where status in ('pending','accepted') and expires_at is not null and expires_at <= now()
    order by expires_at for update skip locked limit p_limit
  loop
    update public.schedule_swap_requests set status='expired', decided_at=now(), updated_at=now() where id=r.id;
    insert into public.schedule_notifications(facility_id, employee_id, swap_id, notification_type, payload)
      values (r.facility_id, r.requester_employee_id, r.id, 'swap_expired', jsonb_build_object('reason','expired'));
    if r.target_employee_id is not null then
      insert into public.schedule_notifications(facility_id, employee_id, swap_id, notification_type, payload)
        values (r.facility_id, r.target_employee_id, r.id, 'swap_expired', jsonb_build_object('reason','expired'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.scheduling_expire_open_claims(p_limit int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  for r in select id from public.schedule_open_shifts
    where claim_status = 'open' and expires_at is not null and expires_at <= now()
    order by expires_at for update skip locked limit p_limit
  loop
    update public.schedule_open_shifts set claim_status='expired', updated_at=now() where id=r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

comment on function public.scheduling_expire_stale_swaps(int) is
  'Sweeper: flips up to p_limit pending/accepted swap requests whose expires_at has passed to ''expired'' (stamping decided_at/updated_at) and notifies the requester and, if set, the target with a swap_expired notification. Batched with FOR UPDATE SKIP LOCKED for safe concurrent cron invocation. Returns the number of swaps expired. Invoked by /api/cron/expire-scheduling.';

comment on function public.scheduling_expire_open_claims(int) is
  'Sweeper: flips up to p_limit open (claim_status=''open'') open-shift listings whose expires_at has passed to ''expired'' (stamping updated_at). No notification is sent — an open listing has no single owner. Batched with FOR UPDATE SKIP LOCKED for safe concurrent cron invocation. Returns the number of listings expired. Invoked by /api/cron/expire-scheduling.';

revoke all on function public.scheduling_expire_stale_swaps(int) from public;
revoke all on function public.scheduling_expire_open_claims(int) from public;
revoke execute on function public.scheduling_expire_stale_swaps(int) from anon;
revoke execute on function public.scheduling_expire_open_claims(int) from anon;
grant  execute on function public.scheduling_expire_stale_swaps(int) to service_role;
grant  execute on function public.scheduling_expire_open_claims(int) to service_role;
