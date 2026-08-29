-- =============================================================================
-- 00000000000265_rink_resurfaces.sql
-- Resurfaces become first-class rows on the Ice Schedule.
--
-- SAME TABLE, DISCRIMINATOR — not a separate table, and here is the
-- structural reason: the module's one conflict guarantee is the gist
-- exclusion constraint ON rink_bookings. Postgres cannot express an
-- exclusion constraint across two tables, so a separate rink_resurfaces
-- table either duplicates the guarantee (two constraints that cannot see
-- each other — a booking could silently overlap a resurface with no referee)
-- or abandons it. One table keeps every schedule row under one referee, and
-- the RLS story is identical BY CONSTRUCTION: the existing rink_bookings
-- policies (248) govern resurface rows verbatim, because they are rows of
-- the same table. One consequence to know: the submit-tier INSERT policy
-- only admits status = 'tentative', and resurface rows are pinned to
-- status = 'confirmed' (below), so creating a resurface is an EDIT-tier act
-- — scheduling the zamboni is operations, not a booking request.
--
-- A RESURFACE OWNS ITS TIME. starts_at/ends_at are the cut window (duration
-- is the difference); parent_booking_id is OPTIONAL — a mid-session cut
-- during one long public skate is a resurface with a parent it sits INSIDE,
-- and a between-sessions cut can stand with no parent at all.
--
-- THE EXCLUSION CONSTRAINT SPLITS IN TWO. Today's rule would reject the
-- mid-session cut (it overlaps its parent). After this migration:
--   * bookings vs bookings — today's rule verbatim, now predicated on
--     entry_kind = 'booking';
--   * resurfaces vs resurfaces — one sheet cannot be cut twice at once
--     ('skipped' rows leave the constraint so a replacement cut can be
--     scheduled over a skipped one);
--   * booking <-> resurface overlap is ALLOWED BY DESIGN.
-- Restating an exclusion constraint means DROP + ADD — same sharp edge as a
-- widened CHECK; the harness assertions ride with the PR that applies this.
--
-- PARENT LIFECYCLE — no silent orphans:
--   * parent hard-deleted (super-admin only): children CASCADE. A resurface
--     for a session that no longer exists is noise; SET NULL would be
--     exactly the silent orphan this schema bans.
--   * parent cancelled: its SCHEDULED resurfaces flip to 'skipped' by
--     trigger. Completed cuts are history and stay.
--   * parent moved: the resurface keeps its own wall time and its link —
--     but if its window no longer intersects the parent's new occupied
--     range, the same trigger flips a scheduled cut to 'skipped'. Explicit,
--     visible in status, never stranded mid-nothing.
--
-- STATUS AND THE ICE CUT JOIN. resurface_status (scheduled/completed/
-- skipped) is the operational lifecycle; ice_cut_submission_id is the
-- future join point to Ice Operations' ice-cut record
-- (ice_operations_submissions, operation_type 'ice_make') — nullable,
-- facility-fenced, and left unpopulated by this migration. Note the two
-- modules keep SEPARATE rink registries (facility_rinks vs
-- ice_operations_rinks); reconciling them is out of scope here.
--
-- NO HARDCODED MINUTES. Default cut duration is a per-facility setting
-- (default_resurface_minutes, admin-editable; 15 is only the seed value)
-- with an optional per-sheet override on facility_rinks.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Facility-fence target on the Ice Operations side (additive only; no
--    behavior change to that module). Required so ice_cut_submission_id can
--    be a composite FK instead of trusting the app to keep facilities
--    aligned.
-- ---------------------------------------------------------------------------

alter table public.ice_operations_submissions
  add constraint ice_operations_submissions_id_facility_uniq unique (id, facility_id);

comment on constraint ice_operations_submissions_id_facility_uniq
  on public.ice_operations_submissions is
  'Target for facility-fenced composite FKs from other modules (first consumer: rink_bookings.ice_cut_submission_id, migration 265).';

-- ---------------------------------------------------------------------------
-- 1. Configurable durations.
-- ---------------------------------------------------------------------------

alter table public.rink_scheduling_settings
  add column if not exists default_resurface_minutes integer not null default 15;

alter table public.rink_scheduling_settings
  add constraint rink_scheduling_settings_resurface_chk
    check (default_resurface_minutes between 1 and 120);

comment on column public.rink_scheduling_settings.default_resurface_minutes is
  'Default duration for a scheduled resurface, facility-wide. Admin-editable; the app must always read this (or the per-sheet override) — never a hardcoded number of minutes.';

alter table public.facility_rinks
  add column if not exists resurface_minutes_override integer;

alter table public.facility_rinks
  add constraint facility_rinks_resurface_override_chk
    check (resurface_minutes_override is null
           or resurface_minutes_override between 1 and 120);

comment on column public.facility_rinks.resurface_minutes_override is
  'Per-sheet resurface duration, overriding the facility default when set (an Olympic sheet cuts slower than a studio rink). Null = use rink_scheduling_settings.default_resurface_minutes.';

-- ---------------------------------------------------------------------------
-- 2. The discriminator and the resurface column set.
-- ---------------------------------------------------------------------------

alter table public.rink_bookings
  add column if not exists entry_kind text not null default 'booking',
  add column if not exists resurface_status text,
  add column if not exists parent_booking_id uuid,
  add column if not exists ice_cut_submission_id uuid;

alter table public.rink_bookings
  add constraint rink_bookings_entry_kind_chk
    check (entry_kind in ('booking', 'resurface'));

-- A booking needs its type; a resurface is not a rentable product and must
-- not masquerade as one, so booking_type_id relaxes to nullable and the
-- shape CHECK below reinstates NOT NULL for entry_kind = 'booking'.
alter table public.rink_bookings
  alter column booking_type_id drop not null;

-- One shape constraint instead of six small ones, so the two row kinds are
-- readable as complete column sets:
--   booking   — exactly the pre-265 shape; none of the new columns used.
--   resurface — its own lifecycle status, optional parent, optional (future)
--               ice-cut link; no product/customer/series/rate columns, no
--               buffer (the cut IS the gap), status pinned to 'confirmed' so
--               the existing status machinery (cancel-coherence, policies)
--               stays single-purpose.
alter table public.rink_bookings
  add constraint rink_bookings_kind_shape check (
    (
      entry_kind = 'booking'
      and booking_type_id is not null
      and resurface_status is null
      and parent_booking_id is null
      and ice_cut_submission_id is null
    )
    or
    (
      entry_kind = 'resurface'
      and resurface_status in ('scheduled', 'completed', 'skipped')
      and status = 'confirmed'
      and booking_type_id is null
      and customer_id is null
      and series_id is null
      and buffer_minutes_after = 0
      and rate_snapshot_hourly is null
      and rate_snapshot_prime is null
      and computed_amount is null
    )
  );

-- A resurface cannot be its own parent, and only resurfaces have parents
-- (both already implied by rink_bookings_kind_shape for bookings; the
-- self-reference needs saying).
alter table public.rink_bookings
  add constraint rink_bookings_parent_not_self
    check (parent_booking_id is null or parent_booking_id <> id);

-- Facility-fenced parent link. ON DELETE CASCADE — see the header: a hard
-- delete (super-admin only in this module) takes the cuts scheduled for
-- that session with it, rather than leaving orphans pointing at nothing.
alter table public.rink_bookings
  add constraint rink_bookings_parent_fk
    foreign key (parent_booking_id, facility_id)
    references public.rink_bookings (id, facility_id) on delete cascade;

-- Facility-fenced join point to Ice Operations' ice-cut record. SET NULL:
-- if the operations record is ever purged, the schedule row's own history
-- (resurface_status) survives.
alter table public.rink_bookings
  add constraint rink_bookings_ice_cut_fk
    foreign key (ice_cut_submission_id, facility_id)
    references public.ice_operations_submissions (id, facility_id) on delete set null;

comment on column public.rink_bookings.entry_kind is
  'Row discriminator: ''booking'' (the pre-265 shape) or ''resurface'' (a first-class ice cut on the schedule). The rink_bookings_kind_shape CHECK pins which columns each kind may use.';
comment on column public.rink_bookings.resurface_status is
  'Resurface lifecycle: scheduled -> completed | skipped. Null on bookings. ''skipped'' rows leave the resurface overlap constraint so a replacement cut can be scheduled.';
comment on column public.rink_bookings.parent_booking_id is
  'OPTIONAL booking this cut belongs to — a mid-session cut sits INSIDE its parent''s window; a between-sessions cut has no parent. Cascade on parent hard-delete; the parent-lifecycle trigger handles cancel/move (no silent orphans).';
comment on column public.rink_bookings.ice_cut_submission_id is
  'Future join to the Ice Operations ice-cut record (ice_operations_submissions, operation_type ''ice_make''). Left unpopulated by migration 265; the completing flow will set it.';

-- ---------------------------------------------------------------------------
-- 3. The overlap referee, restated as two constraints.
--    DROP + ADD, whole predicate restated — treat like a widened CHECK.
-- ---------------------------------------------------------------------------

alter table public.rink_bookings
  drop constraint rink_bookings_no_overlap;

-- Bookings vs bookings: today's guarantee, verbatim, now scoped to bookings.
alter table public.rink_bookings
  add constraint rink_bookings_no_overlap exclude using gist (
    rink_id with =,
    tstzrange(starts_at, blocks_until, '[)') with &&
  ) where (status <> 'cancelled' and entry_kind = 'booking');

-- Resurfaces vs resurfaces: one sheet, one zamboni at a time. Bookings and
-- resurfaces may overlap each other freely — that is the whole point.
-- (For resurfaces blocks_until = ends_at, since buffer is pinned to 0.)
alter table public.rink_bookings
  add constraint rink_resurfaces_no_overlap exclude using gist (
    rink_id with =,
    tstzrange(starts_at, blocks_until, '[)') with &&
  ) where (entry_kind = 'resurface' and resurface_status <> 'skipped');

-- ---------------------------------------------------------------------------
-- 4. Triggers.
-- ---------------------------------------------------------------------------

-- require_customer predates resurfaces: for a resurface row (null customer,
-- null type) its is_billable lookup finds nothing and coalesce(null, true)
-- would raise. Resurfaces are never billable; pass them through.
create or replace function public.rink_bookings_require_customer()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_billable boolean;
begin
  if new.entry_kind = 'resurface' then
    return new;
  end if;

  if new.customer_id is not null then
    return new;
  end if;

  select bt.is_billable into v_billable
  from public.rink_booking_types bt
  where bt.id = new.booking_type_id;

  if coalesce(v_billable, true) then
    raise exception 'rink_scheduling: a billable booking requires a customer'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.rink_bookings_require_customer() is
  'Enforces "customer_id is optional only for non-billable booking types" (Maintenance Block). Resurface rows (migration 265) are never billable and pass through. A cross-row rule, so it cannot be a CHECK constraint.';

-- Parent lifecycle: the explicit no-silent-orphans rule from the header.
-- AFTER trigger; the child update re-enters this function for resurface rows
-- and returns immediately, so it cannot recurse.
create or replace function public.rink_resurfaces_parent_sync()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.entry_kind <> 'booking' then
    return null;
  end if;

  -- Parent cancelled: scheduled cuts for it are moot -> skipped (visible,
  -- auditable). Completed cuts are history and stay.
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.rink_bookings
       set resurface_status = 'skipped'
     where parent_booking_id = new.id
       and facility_id = new.facility_id
       and entry_kind = 'resurface'
       and resurface_status = 'scheduled';
    return null;
  end if;

  -- Parent moved: a cut keeps its own wall time and its link, but a
  -- scheduled cut whose window no longer touches the parent's occupied
  -- range [starts_at, blocks_until) is stranded mid-nothing -> skipped.
  if new.starts_at is distinct from old.starts_at
     or new.blocks_until is distinct from old.blocks_until then
    update public.rink_bookings r
       set resurface_status = 'skipped'
     where r.parent_booking_id = new.id
       and r.facility_id = new.facility_id
       and r.entry_kind = 'resurface'
       and r.resurface_status = 'scheduled'
       and not (r.starts_at < new.blocks_until and r.ends_at > new.starts_at);
  end if;

  return null;
end;
$$;

comment on function public.rink_resurfaces_parent_sync() is
  'No silent orphans (migration 265): cancelling a booking skips its scheduled resurfaces; moving one skips any scheduled resurface its occupied window no longer touches. Completed resurfaces are history and are never touched.';

drop trigger if exists trg_rink_resurfaces_parent_sync on public.rink_bookings;
create trigger trg_rink_resurfaces_parent_sync
  after update of status, starts_at, ends_at, buffer_minutes_after
  on public.rink_bookings
  for each row execute function public.rink_resurfaces_parent_sync();

-- ---------------------------------------------------------------------------
-- 5. Indexing note (no new index).
--    The overlap/day-window query keys on (facility_id, rink_id, starts_at);
--    idx_rink_bookings_facility_rink_start (migration 247) already covers it
--    and covers resurface rows automatically — same table, same index.
-- ---------------------------------------------------------------------------

commit;
