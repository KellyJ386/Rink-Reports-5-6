-- =============================================================================
-- 00000000000265_rink_resurfaces.sql
-- Resurfaces as first-class rows on the Ice Schedule — minimal shape.
--
-- DESIGN (v2, after review). Mid-session cuts and the parent-booking link
-- were deliberately dropped, and that changes everything about the size of
-- this migration: a resurface is now an ORDINARY BOOKING whose type carries
-- an is_resurface flag. No discriminator column, no nullable booking_type_id,
-- no shape CHECK, and — the big one — NO REBUILD of the overlap exclusion
-- constraint: a cut occupies the sheet like any other booking and the
-- existing referee (migration 247) already guarantees it cannot be
-- double-booked. The RLS story is untouched by construction: same table,
-- same policies (248), verbatim.
--
-- WHY A TYPE FLAG AND NOT A MAGIC NAME OR A HOUSE CUSTOMER. Booking types
-- are facility-configurable rows; keying app behavior on a slug or label
-- breaks the moment an admin renames one, and a fake "Resurface" customer
-- would put zamboni passes in the customer ledger. The flag is structural,
-- admins can carry several cut types (game cut, deep cut), and non-billable
-- types already skip the customer requirement (migration 247's trigger), so
-- a cut needs no customer today and can still be a billable line item at
-- facilities that charge renters for extra cuts.
--
-- WHAT IS GENUINELY NEW:
--   * resurface_status — scheduled -> completed | skipped: the operational
--     lifecycle, and the future join point for Ice Operations.
--   * ice_cut_submission_id — nullable, facility-fenced reference to the
--     Ice Operations ice-cut record (ice_operations_submissions,
--     operation_type 'ice_make'). Left unpopulated by this migration.
--   * Admin-configurable default cut duration per facility, with an
--     optional per-sheet override. No hardcoded minutes anywhere in code —
--     the seed value below is data, editable in the settings tab.
--
-- NO PARENT LINK, NO ORPHANS — BY SUBTRACTION. A cut is a standalone row
-- that owns its own time. Cancelling or moving the session it happened to
-- follow changes nothing automatically; the cut stays visible on the
-- schedule for staff to keep, move, or skip. There is nothing to orphan
-- because nothing links.
--
-- The two rows-of-one-table rules that ARE cross-row (the type flag lives
-- on rink_booking_types) are enforced by trigger, not CHECK: a resurface-
-- typed booking always carries a lifecycle status (defaulted to
-- 'scheduled'), and a non-resurface booking may carry neither status nor
-- ice-cut link.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Facility-fence target on the Ice Operations side (additive only; no
--    behavior change to that module). Lets ice_cut_submission_id be a
--    composite FK instead of trusting the app to keep facilities aligned.
-- ---------------------------------------------------------------------------

alter table public.ice_operations_submissions
  add constraint ice_operations_submissions_id_facility_uniq unique (id, facility_id);

comment on constraint ice_operations_submissions_id_facility_uniq
  on public.ice_operations_submissions is
  'Target for facility-fenced composite FKs from other modules (first consumer: rink_bookings.ice_cut_submission_id, migration 265).';

-- ---------------------------------------------------------------------------
-- 1. The type flag.
-- ---------------------------------------------------------------------------

alter table public.rink_booking_types
  add column if not exists is_resurface boolean not null default false;

comment on column public.rink_booking_types.is_resurface is
  'Marks this type''s bookings as ice resurfaces: they carry a resurface_status lifecycle and may later link an Ice Operations ice-cut record. App behavior keys on this flag, never on the type''s name. Flipping the flag on a type with existing rows does not rewrite those rows; the trigger enforces coherence only on row writes.';

-- ---------------------------------------------------------------------------
-- 2. Configurable durations.
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
-- 3. Lifecycle status + the Ice Operations join point.
-- ---------------------------------------------------------------------------

alter table public.rink_bookings
  add column if not exists resurface_status text,
  add column if not exists ice_cut_submission_id uuid;

alter table public.rink_bookings
  add constraint rink_bookings_resurface_status_chk
    check (resurface_status is null
           or resurface_status in ('scheduled', 'completed', 'skipped'));

-- SET NULL: if the operations record is ever purged, the schedule row's own
-- history (resurface_status) survives.
alter table public.rink_bookings
  add constraint rink_bookings_ice_cut_fk
    foreign key (ice_cut_submission_id, facility_id)
    references public.ice_operations_submissions (id, facility_id) on delete set null;

comment on column public.rink_bookings.resurface_status is
  'Lifecycle of a resurface booking (its type has is_resurface): scheduled -> completed | skipped. Null on every other booking — the coherence trigger enforces both directions.';
comment on column public.rink_bookings.ice_cut_submission_id is
  'Future join to the Ice Operations ice-cut record (ice_operations_submissions, operation_type ''ice_make''). Facility-fenced composite FK. Left unpopulated by migration 265; the completing flow will set it.';

-- ---------------------------------------------------------------------------
-- 4. Coherence trigger (cross-row: the flag lives on rink_booking_types, so
--    this cannot be a CHECK).
-- ---------------------------------------------------------------------------

create or replace function public.rink_bookings_resurface_coherence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_resurface boolean;
begin
  select bt.is_resurface into v_is_resurface
  from public.rink_booking_types bt
  where bt.id = new.booking_type_id;

  if coalesce(v_is_resurface, false) then
    -- A resurface always has a lifecycle; new ones start scheduled.
    new.resurface_status := coalesce(new.resurface_status, 'scheduled');
  else
    if new.resurface_status is not null or new.ice_cut_submission_id is not null then
      raise exception
        'rink_scheduling: resurface_status and ice_cut_submission_id belong only to resurface-typed bookings'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.rink_bookings_resurface_coherence() is
  'Resurface-typed bookings (rink_booking_types.is_resurface) always carry a resurface_status (defaulted to scheduled); every other booking carries neither the status nor the ice-cut link. Cross-row rule (the flag lives on the type), so a trigger rather than a CHECK.';

drop trigger if exists trg_rink_bookings_resurface_coherence on public.rink_bookings;
create trigger trg_rink_bookings_resurface_coherence
  before insert or update of booking_type_id, resurface_status, ice_cut_submission_id
  on public.rink_bookings
  for each row execute function public.rink_bookings_resurface_coherence();

-- ---------------------------------------------------------------------------
-- 5. What this migration deliberately does NOT touch:
--    * rink_bookings_no_overlap — unchanged; a cut occupies the sheet under
--      the same referee as everything else (between-sessions model).
--    * RLS — same table, same policies (248). Note the submit-tier INSERT
--      policy admits only status = 'tentative'; an edit-tier scheduler
--      confirms cuts like any other booking.
--    * Indexes — the day-window/overlap query keys on
--      (facility_id, rink_id, starts_at); idx_rink_bookings_facility_rink_start
--      (migration 247) already covers cut rows: same table, same index.
-- ---------------------------------------------------------------------------

commit;
