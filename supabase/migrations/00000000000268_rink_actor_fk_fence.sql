-- =============================================================================
-- 00000000000268_rink_actor_fk_fence.sql
-- Fence every Module-12 actor column with a composite (actor, facility_id)
-- foreign key to employees (id, facility_id), closing the reviewer finding
-- tracked since PR #343: a plain single-column FK let a row record an actor
-- employee from ANOTHER facility. Application code never does that (every
-- action resolves the employee scoped to the session facility), but the
-- database should refuse it, exactly as it already refuses a cross-facility
-- rink_id or ice_cut_submission_id.
--
-- Columns fenced (12 — every employees-referencing actor column on a rink_*
-- table; facility_rink_diagram_config.updated_by belongs to the Dasher
-- Boards workstream and is deliberately untouched):
--   rink_booking_requests.decided_by         rink_invoices.created_by
--   rink_booking_series.created_by           rink_invoices.voided_by
--   rink_bookings.created_by                 rink_locker_room_assignments.created_by
--   rink_bookings.cancelled_by               rink_payments.recorded_by
--   rink_bookings.resurface_resolved_by      rink_season_contracts.created_by
--   rink_display_tokens.created_by           rink_waitlist_entries.created_by
--
-- Mechanics, in order:
--   1. employees gains UNIQUE (id, facility_id) — the composite join point.
--      Trivially satisfiable (id alone is the primary key); mirrors the
--      additive unique(id, facility_id) pattern used by facility_rinks,
--      rink_bookings, ice_operations_submissions, etc.
--   2. Per column: drop the old FK, null out any value whose employee is not
--      of the row's facility (the value would be WRONG, not just unfenced —
--      none are expected, but the migration must not fail on dirty data),
--      then add the composite FK.
--   3. Every ON DELETE keeps its existing SET NULL behavior via the PG15
--      column-list form `on delete set null (<actor_col>)` — a plain
--      composite SET NULL would try to null facility_id too and fail on the
--      NOT NULL, the migration-190/265/266 trap this codebase has already
--      been burned by and swept for.
--
-- No RLS change; no new function; nothing SECURITY DEFINER.
-- =============================================================================

begin;

alter table public.employees
  drop constraint if exists employees_id_facility_uniq;
alter table public.employees
  add constraint employees_id_facility_uniq unique (id, facility_id);

comment on constraint employees_id_facility_uniq on public.employees is
  'Composite join point so actor columns elsewhere can be fenced with (actor_id, facility_id) foreign keys — an actor must belong to the same facility as the row that names them (migration 268).';

-- ---------------------------------------------------------------------------
-- rink_bookings: created_by, cancelled_by, resurface_resolved_by
-- ---------------------------------------------------------------------------

alter table public.rink_bookings drop constraint if exists rink_bookings_created_by_fkey;
update public.rink_bookings b
   set created_by = null
 where b.created_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = b.created_by and e.facility_id = b.facility_id);
alter table public.rink_bookings
  add constraint rink_bookings_created_by_fkey
    foreign key (created_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (created_by);

alter table public.rink_bookings drop constraint if exists rink_bookings_cancelled_by_fkey;
update public.rink_bookings b
   set cancelled_by = null
 where b.cancelled_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = b.cancelled_by and e.facility_id = b.facility_id);
alter table public.rink_bookings
  add constraint rink_bookings_cancelled_by_fkey
    foreign key (cancelled_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (cancelled_by);

alter table public.rink_bookings drop constraint if exists rink_bookings_resurface_resolved_by_fkey;
update public.rink_bookings b
   set resurface_resolved_by = null
 where b.resurface_resolved_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = b.resurface_resolved_by and e.facility_id = b.facility_id);
alter table public.rink_bookings
  add constraint rink_bookings_resurface_resolved_by_fkey
    foreign key (resurface_resolved_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (resurface_resolved_by);

-- ---------------------------------------------------------------------------
-- rink_booking_series.created_by
-- ---------------------------------------------------------------------------

alter table public.rink_booking_series drop constraint if exists rink_booking_series_created_by_fkey;
update public.rink_booking_series s
   set created_by = null
 where s.created_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = s.created_by and e.facility_id = s.facility_id);
alter table public.rink_booking_series
  add constraint rink_booking_series_created_by_fkey
    foreign key (created_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (created_by);

-- ---------------------------------------------------------------------------
-- rink_booking_requests.decided_by
-- ---------------------------------------------------------------------------

alter table public.rink_booking_requests drop constraint if exists rink_booking_requests_decided_by_fkey;
update public.rink_booking_requests r
   set decided_by = null
 where r.decided_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = r.decided_by and e.facility_id = r.facility_id);
alter table public.rink_booking_requests
  add constraint rink_booking_requests_decided_by_fkey
    foreign key (decided_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (decided_by);

-- ---------------------------------------------------------------------------
-- rink_display_tokens.created_by
-- ---------------------------------------------------------------------------

alter table public.rink_display_tokens drop constraint if exists rink_display_tokens_created_by_fkey;
update public.rink_display_tokens t
   set created_by = null
 where t.created_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = t.created_by and e.facility_id = t.facility_id);
alter table public.rink_display_tokens
  add constraint rink_display_tokens_created_by_fkey
    foreign key (created_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (created_by);

-- ---------------------------------------------------------------------------
-- rink_invoices: created_by, voided_by
-- ---------------------------------------------------------------------------

alter table public.rink_invoices drop constraint if exists rink_invoices_created_by_fkey;
update public.rink_invoices i
   set created_by = null
 where i.created_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = i.created_by and e.facility_id = i.facility_id);
alter table public.rink_invoices
  add constraint rink_invoices_created_by_fkey
    foreign key (created_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (created_by);

alter table public.rink_invoices drop constraint if exists rink_invoices_voided_by_fkey;
update public.rink_invoices i
   set voided_by = null
 where i.voided_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = i.voided_by and e.facility_id = i.facility_id);
alter table public.rink_invoices
  add constraint rink_invoices_voided_by_fkey
    foreign key (voided_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (voided_by);

-- ---------------------------------------------------------------------------
-- rink_locker_room_assignments.created_by
-- ---------------------------------------------------------------------------

alter table public.rink_locker_room_assignments drop constraint if exists rink_locker_room_assignments_created_by_fkey;
update public.rink_locker_room_assignments a
   set created_by = null
 where a.created_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = a.created_by and e.facility_id = a.facility_id);
alter table public.rink_locker_room_assignments
  add constraint rink_locker_room_assignments_created_by_fkey
    foreign key (created_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (created_by);

-- ---------------------------------------------------------------------------
-- rink_payments.recorded_by
-- ---------------------------------------------------------------------------

alter table public.rink_payments drop constraint if exists rink_payments_recorded_by_fkey;
update public.rink_payments p
   set recorded_by = null
 where p.recorded_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = p.recorded_by and e.facility_id = p.facility_id);
alter table public.rink_payments
  add constraint rink_payments_recorded_by_fkey
    foreign key (recorded_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (recorded_by);

-- ---------------------------------------------------------------------------
-- rink_season_contracts.created_by
-- ---------------------------------------------------------------------------

alter table public.rink_season_contracts drop constraint if exists rink_season_contracts_created_by_fkey;
update public.rink_season_contracts c
   set created_by = null
 where c.created_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = c.created_by and e.facility_id = c.facility_id);
alter table public.rink_season_contracts
  add constraint rink_season_contracts_created_by_fkey
    foreign key (created_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (created_by);

-- ---------------------------------------------------------------------------
-- rink_waitlist_entries.created_by
-- ---------------------------------------------------------------------------

alter table public.rink_waitlist_entries drop constraint if exists rink_waitlist_entries_created_by_fkey;
update public.rink_waitlist_entries w
   set created_by = null
 where w.created_by is not null
   and not exists (select 1 from public.employees e
                    where e.id = w.created_by and e.facility_id = w.facility_id);
alter table public.rink_waitlist_entries
  add constraint rink_waitlist_entries_created_by_fkey
    foreign key (created_by, facility_id)
    references public.employees (id, facility_id)
    on delete set null (created_by);

commit;
