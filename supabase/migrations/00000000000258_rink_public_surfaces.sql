-- =============================================================================
-- 00000000000258_rink_public_surfaces.sql

--
-- Three additions to Rink Scheduling & Billing's public edge, all reusing the
-- hashed facility-scoped token model from migration 247 (rink_display_tokens):
--
-- 1. NEW TOKEN TYPES. display_type gains 'ice_schedule' (a lobby TV showing
--    today's public ice schedule per rink), 'rink_ics' (a read-only iCalendar
--    subscription of a rink's bookings for coaches/league schedulers), and
--    'request_form' (an unguessable public booking-request form link the
--    facility publishes). Widening the CHECK means DROP + ADD with the whole
--    list restated — the documented sharp edge; the harness inserts a row of
--    every permitted value so a lost one fails CI.
--
-- 2. BOOKING REQUESTS. rink_booking_requests: an inbox of ice-time requests
--    from the public form. anon holds ZERO grants on this table — the public
--    POST goes through a Route Handler that validates the request_form token
--    and inserts with the service role (same trust confinement as the display
--    endpoint). Staff read/decide at the edit tier. Approving is an app-layer
--    act that creates a tentative booking and back-links it.
--
-- 3. WAITLIST. rink_waitlist_entries: staff-managed list of customers wanting
--    ice on a date/window. Edit-tier CRUD (soft close via status), facility
--    scoped. Surfaced when a booking is cancelled so the desk can call the
--    next name.
-- =============================================================================

begin;

-- 1. Widen the display token types (drop + add, full list restated).
alter table public.rink_display_tokens
  drop constraint rink_display_tokens_type_chk;
alter table public.rink_display_tokens
  add constraint rink_display_tokens_type_chk
    check (display_type in ('locker_rooms', 'ice_schedule', 'rink_ics', 'request_form'));

comment on column public.rink_display_tokens.display_type is
  'locker_rooms and ice_schedule are TV boards behind /display/<token>; rink_ics is an iCalendar feed behind /api/rink-ics/<token>; request_form is the public booking-request form behind /request-ice/<token>. The CHECK is widened (drop + add, whole list restated) when a new type ships.';

-- 2. Booking requests.
create table if not exists public.rink_booking_requests (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid not null references public.facilities(id) on delete restrict,
  requester_name    text not null,
  requester_email   text not null,
  requester_phone   text,
  organization      text,
  rink_id           uuid references public.facility_rinks(id) on delete set null,
  requested_date    date not null,
  start_minute      integer not null,
  end_minute        integer not null,
  purpose           text,
  status            text not null default 'new',
  decided_by        uuid references public.employees(id) on delete set null,
  decided_at        timestamptz,
  decision_note     text,
  created_booking_id uuid references public.rink_bookings(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  constraint rink_booking_requests_status_chk
    check (status in ('new', 'approved', 'declined', 'archived')),
  constraint rink_booking_requests_window_chk
    check (start_minute >= 0 and start_minute < 1440
           and end_minute > start_minute and end_minute <= 1680),
  constraint rink_booking_requests_name_len check (char_length(btrim(requester_name)) between 1 and 120),
  constraint rink_booking_requests_email_len check (char_length(requester_email) between 3 and 254),
  constraint rink_booking_requests_email_shape check (requester_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint rink_booking_requests_phone_len check (requester_phone is null or char_length(requester_phone) <= 40),
  constraint rink_booking_requests_org_len check (organization is null or char_length(organization) <= 160),
  constraint rink_booking_requests_purpose_len check (purpose is null or char_length(purpose) <= 2000)
);

comment on table public.rink_booking_requests is
  'Rink Scheduling: public ice-time requests. Inserted ONLY by the service role from /api/rink-booking-requests after validating a request_form display token — anon and authenticated hold no INSERT on this table. end_minute may run to 1680 (next-day 04:00) for past-midnight requests.';

create index if not exists idx_rink_booking_requests_facility_status
  on public.rink_booking_requests (facility_id, status, requested_date);

drop trigger if exists trg_rink_booking_requests_updated_at on public.rink_booking_requests;
create trigger trg_rink_booking_requests_updated_at
  before update on public.rink_booking_requests
  for each row execute function public.set_updated_at();

alter table public.rink_booking_requests enable row level security;

-- Edit tier reads and decides; nobody inserts through PostgREST; no deletes
-- (retention owns removal).
create policy rink_booking_requests_select on public.rink_booking_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

create policy rink_booking_requests_update on public.rink_booking_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

-- 3. Waitlist.
create table if not exists public.rink_waitlist_entries (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  customer_id   uuid references public.rink_customers(id) on delete cascade,
  contact_name  text,
  contact_phone text,
  rink_id       uuid references public.facility_rinks(id) on delete set null,
  desired_date  date not null,
  start_minute  integer,
  end_minute    integer,
  notes         text,
  status        text not null default 'open',
  created_by    uuid references public.employees(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint rink_waitlist_status_chk check (status in ('open', 'fulfilled', 'cancelled')),
  constraint rink_waitlist_window_chk
    check ((start_minute is null and end_minute is null)
           or (start_minute >= 0 and start_minute < 1440
               and end_minute > start_minute and end_minute <= 1680)),
  constraint rink_waitlist_someone check (customer_id is not null or contact_name is not null),
  constraint rink_waitlist_name_len check (contact_name is null or char_length(btrim(contact_name)) between 1 and 120),
  constraint rink_waitlist_phone_len check (contact_phone is null or char_length(contact_phone) <= 40),
  constraint rink_waitlist_notes_len check (notes is null or char_length(notes) <= 2000)
);

comment on table public.rink_waitlist_entries is
  'Rink Scheduling: staff-managed waitlist for ice time. Either an existing customer or a free-text contact. Surfaced when a booking is cancelled so the desk can offer the freed slot.';

create index if not exists idx_rink_waitlist_facility_status
  on public.rink_waitlist_entries (facility_id, status, desired_date);

drop trigger if exists trg_rink_waitlist_updated_at on public.rink_waitlist_entries;
create trigger trg_rink_waitlist_updated_at
  before update on public.rink_waitlist_entries
  for each row execute function public.set_updated_at();

alter table public.rink_waitlist_entries enable row level security;

create policy rink_waitlist_select on public.rink_waitlist_entries
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

create policy rink_waitlist_insert on public.rink_waitlist_entries
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

create policy rink_waitlist_update on public.rink_waitlist_entries
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );


-- ---------------------------------------------------------------------------
-- Retention: the two new tables hold requester PII (name, email, phone), so
-- both purge paths must cover them. Full restatement, per repo convention.
-- Undecided requests and open waitlist entries are kept whatever their age:
-- they are live work items, not history.
-- ---------------------------------------------------------------------------

create or replace function public.purge_module_data(p_facility_id uuid, p_module_key text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_keep_days integer;
  v_cutoff    timestamptz;
  v_deleted   integer;
  v_total     integer := 0;
begin
  if not (
    public.is_super_admin()
    or public.is_facility_admin(p_facility_id)
  ) then
    raise exception 'Not authorized to purge data for this facility.';
  end if;

  if p_module_key = 'scheduling' then
    raise exception 'Manual purge is not supported for scheduling.';
  end if;

  if p_module_key = 'audit_logs' then
    -- Compliance window: per-facility retention_settings (default 7 years),
    -- clamped to the 2555-day floor; keep_days = 0 disables purging
    -- (migration 215). Since migration 216 expired rows are STAGED into
    -- audit_logs_pending_destruction (recoverable until two admins approve
    -- destruction) instead of deleted.
    select keep_days into v_keep_days
      from public.retention_settings
     where facility_id = p_facility_id
       and module_key  = 'audit_logs';
    v_keep_days := coalesce(v_keep_days, 2555);
    if v_keep_days = 0 then
      return 0;
    end if;
    return public.stage_audit_logs_for_destruction(
      p_facility_id,
      now() - make_interval(days => greatest(v_keep_days, 2555)));
  end if;

  select keep_days into v_keep_days
    from public.retention_settings
   where facility_id = p_facility_id
     and module_key = p_module_key;

  if v_keep_days is null then
    raise exception 'No retention rule configured for this module. Save one first.';
  end if;
  if v_keep_days = 0 then
    raise exception 'Retention for this module is set to keep records forever.';
  end if;

  v_cutoff := now() - (v_keep_days || ' days')::interval;

  case p_module_key
    when 'daily_reports' then
      delete from public.daily_report_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'communications' then
      delete from public.communication_messages
       where facility_id = p_facility_id and sent_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_alerts
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_audit_log
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'accident_reports' then
      delete from public.accident_reports
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'incident_reports' then
      delete from public.incident_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'refrigeration' then
      delete from public.refrigeration_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'air_quality' then
      delete from public.air_quality_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_operations' then
      delete from public.ice_operations_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_depth' then
      delete from public.ice_depth_sessions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    -- Dasher Boards. Walks past the cutoff go, and dasher_boards_asset_checks /
    -- _checklist_responses cascade off the inspection FK. Issues do NOT: their
    -- inspection_id is ON DELETE SET NULL, so without the second delete below
    -- every issue ever raised would survive forever, detached from the walk
    -- that found it.
    --
    -- Only RESOLVED issues are purged. An unresolved issue is a live safety
    -- defect on the boards, not history, so it is kept regardless of age --
    -- deleting one because the walk that found it aged out would silently drop
    -- an open defect off the rink's record.
    when 'dasher_boards' then
      delete from public.dasher_boards_inspections
       where facility_id = p_facility_id and started_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.dasher_boards_issues
       where facility_id = p_facility_id
         and resolved_at is not null
         and resolved_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    -- Rink Scheduling & Billing. Financial history, floored at 7 years by
    -- retention_module_floors. See this migration's header for the ordering
    -- rationale; in short, payments before invoices (RESTRICT), and a booking
    -- still cited by a line item is kept whatever its age.
    when 'rink_scheduling' then
      delete from public.rink_payments p
       where p.facility_id = p_facility_id
         and exists (
           select 1 from public.rink_invoices i
            where i.id = p.invoice_id
              and i.facility_id = p_facility_id
              and i.issue_date < v_cutoff::date
         );
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.rink_invoices
       where facility_id = p_facility_id
         and issue_date < v_cutoff::date;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.rink_bookings b
       where b.facility_id = p_facility_id
         and b.starts_at < v_cutoff
         and not exists (
           select 1 from public.rink_invoice_line_items li
            where li.booking_id = b.id
         );
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.rink_booking_requests
       where facility_id = p_facility_id
         and created_at < v_cutoff
         and status <> 'new';
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.rink_waitlist_entries
       where facility_id = p_facility_id
         and created_at < v_cutoff
         and status <> 'open';
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    else
      raise exception 'Unknown module key: %', p_module_key;
  end case;

  return v_total;
end;
$$;

comment on function public.purge_module_data(uuid, text) is
  'Manual per-module purge for a facility. rink_scheduling (migrations 251, 258): '
  'payments, then their invoices (line items cascade), then bookings not cited by '
  'any invoice line, then decided booking requests and closed waitlist entries '
  '(requester PII). Customers, rate cards and facility setup are configuration '
  'and are never purged by age.';

create or replace function public.purge_old_rink_scheduling_records()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r         record;
  v_cutoff  timestamptz;
  v_deleted integer;
  v_total   integer := 0;
begin
  for r in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'rink_scheduling'
       and auto_purge = true
       and keep_days is not null
       and keep_days > 0
  loop
    v_cutoff := now() - make_interval(days => greatest(r.keep_days, 2555));

    delete from public.rink_payments p
     where p.facility_id = r.facility_id
       and exists (
         select 1 from public.rink_invoices i
          where i.id = p.invoice_id
            and i.facility_id = r.facility_id
            and i.issue_date < v_cutoff::date
       );
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.rink_invoices
     where facility_id = r.facility_id
       and issue_date < v_cutoff::date;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.rink_bookings b
     where b.facility_id = r.facility_id
       and b.starts_at < v_cutoff
       and not exists (
         select 1 from public.rink_invoice_line_items li
          where li.booking_id = b.id
       );
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.rink_booking_requests
     where facility_id = r.facility_id
       and created_at < v_cutoff
       and status <> 'new';
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.rink_waitlist_entries
     where facility_id = r.facility_id
       and created_at < v_cutoff
       and status <> 'open';
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    update public.retention_settings
       set last_purged_at  = now(),
           last_purge_count = v_total
     where facility_id = r.facility_id
       and module_key  = 'rink_scheduling';
  end loop;

  return v_total;
end;
$$;

comment on function public.purge_old_rink_scheduling_records() is
  'Nightly retention worker for Rink Scheduling & Billing. Financial records, so the cutoff is clamped to the 7-year floor regardless of the configured keep_days. Migration 258 adds decided booking requests and closed waitlist entries (requester PII). Service-role only.';

commit;
