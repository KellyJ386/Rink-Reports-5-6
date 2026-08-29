-- =============================================================================
-- 00000000000266_rink_set_null_fixes_and_resurface_audit.sql
-- Two follow-ups from migration 265's security review.
--
-- 1. THE LATENT COMPOSITE SET NULL BUG, EVERYWHERE IT EXISTS. A plain
--    ON DELETE SET NULL on a multi-column FK nulls EVERY referencing column
--    — including facility_id, which is NOT NULL — so deleting the parent
--    errors instead of clearing the link. Migration 190 discovered and fixed
--    this for schedule_shifts; 265 nearly reintroduced it and was caught in
--    review; this migration sweeps ALL SIX pre-existing instances:
--      from migration 247 (live parent DELETE paths today):
--      * rink_bookings.series_id        (super-admin series delete)
--      * rink_customers.default_rate_card_id  (admin rate-card delete)
--      * rink_booking_series.rate_card_id     (admin rate-card delete)
--      from migration 264 (no DELETE policy on contracts today, so only
--      reachable by direct SQL — a landmine, not a live fault):
--      * rink_season_contracts.renewal_of     (self-referential)
--      * rink_booking_series.contract_id
--      * rink_invoices.contract_id
--    Each becomes ON DELETE SET NULL (<link column>). Metadata-only: the
--    constraints are dropped and re-added over the same, already-valid rows.
--
-- 2. RESURFACE AUDIT TRAIL. resurface_status transitions had no actor or
--    timestamp — unlike cancellation on the same table (cancelled_at/_by).
--    Added BEFORE the completing flow ships, while retrofitting is free:
--      * resurface_resolved_at / resurface_resolved_by cover BOTH terminal
--        statuses (completed and skipped) — "who decided this cut was done
--        or not happening, and when".
--      * The coherence trigger (restated from 265) now maintains the
--        timestamp itself: entering completed/skipped stamps resolved_at if
--        the app didn't; returning to scheduled clears both. resolved_by is
--        app-supplied (the DB cannot reliably map auth.uid() to the acting
--        employee here) and nullable — an automated skip has no actor.
--    A CHECK pins coherence: scheduled (or a non-resurface row) carries
--    neither; a terminal status always carries the timestamp.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Column-list SET NULL on all six pre-existing composite FKs.
-- ---------------------------------------------------------------------------

alter table public.rink_bookings
  drop constraint rink_bookings_series_fk;
alter table public.rink_bookings
  add constraint rink_bookings_series_fk
    foreign key (series_id, facility_id)
    references public.rink_booking_series (id, facility_id)
    on delete set null (series_id);

alter table public.rink_customers
  drop constraint rink_customers_rate_card_fk;
alter table public.rink_customers
  add constraint rink_customers_rate_card_fk
    foreign key (default_rate_card_id, facility_id)
    references public.rink_rate_cards (id, facility_id)
    on delete set null (default_rate_card_id);

alter table public.rink_booking_series
  drop constraint rink_booking_series_rate_card_fk;
alter table public.rink_booking_series
  add constraint rink_booking_series_rate_card_fk
    foreign key (rate_card_id, facility_id)
    references public.rink_rate_cards (id, facility_id)
    on delete set null (rate_card_id);

alter table public.rink_season_contracts
  drop constraint rink_season_contracts_renewal_fk;
alter table public.rink_season_contracts
  add constraint rink_season_contracts_renewal_fk
    foreign key (renewal_of, facility_id)
    references public.rink_season_contracts (id, facility_id)
    on delete set null (renewal_of);

alter table public.rink_booking_series
  drop constraint rink_booking_series_contract_fk;
alter table public.rink_booking_series
  add constraint rink_booking_series_contract_fk
    foreign key (contract_id, facility_id)
    references public.rink_season_contracts (id, facility_id)
    on delete set null (contract_id);

alter table public.rink_invoices
  drop constraint rink_invoices_contract_fk;
alter table public.rink_invoices
  add constraint rink_invoices_contract_fk
    foreign key (contract_id, facility_id)
    references public.rink_season_contracts (id, facility_id)
    on delete set null (contract_id);

-- ---------------------------------------------------------------------------
-- 2. Resurface audit columns + coherence.
-- ---------------------------------------------------------------------------

alter table public.rink_bookings
  add column if not exists resurface_resolved_at timestamptz,
  add column if not exists resurface_resolved_by uuid
    references public.employees(id) on delete set null;

-- Backfill BEFORE validating the CHECK: any resurface completed or skipped
-- in the window between 265 and 266 predates the column and would otherwise
-- fail the immediate constraint scan on a database with real rows (CI's
-- harness inserts its fixtures after migrations, so only production-shaped
-- data ever exercises this).
update public.rink_bookings
   set resurface_resolved_at = coalesce(updated_at, created_at, now())
 where resurface_status in ('completed', 'skipped')
   and resurface_resolved_at is null;

alter table public.rink_bookings
  add constraint rink_bookings_resurface_resolved_chk check (
    (
      coalesce(resurface_status, 'scheduled') = 'scheduled'
      and resurface_resolved_at is null
      and resurface_resolved_by is null
    )
    or (
      resurface_status in ('completed', 'skipped')
      and resurface_resolved_at is not null
    )
  );

comment on column public.rink_bookings.resurface_resolved_at is
  'When the resurface reached a terminal status (completed or skipped). Stamped by the coherence trigger if the app does not; cleared on return to scheduled. Null on bookings and on scheduled cuts.';
comment on column public.rink_bookings.resurface_resolved_by is
  'Employee who completed or skipped the cut. App-supplied and nullable — an automated skip has no actor.';

-- Restated from 265, now also maintaining the audit stamps so the CHECK
-- above is always satisfiable without every writer knowing the rule.
create or replace function public.rink_bookings_resurface_coherence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_resurface boolean;
begin
  select bt.is_resurface into v_is_resurface
  from public.rink_booking_types bt
  where bt.id = new.booking_type_id;

  if coalesce(v_is_resurface, false) then
    new.resurface_status := coalesce(new.resurface_status, 'scheduled');
    if new.resurface_status = 'scheduled' then
      -- Back on the board: the previous resolution is no longer true.
      new.resurface_resolved_at := null;
      new.resurface_resolved_by := null;
    else
      -- Terminal: the timestamp is never optional; the actor is app-supplied.
      new.resurface_resolved_at := coalesce(new.resurface_resolved_at, now());
    end if;
  else
    if new.resurface_status is not null
       or new.ice_cut_submission_id is not null
       or new.resurface_resolved_at is not null
       or new.resurface_resolved_by is not null then
      raise exception
        'rink_scheduling: resurface columns belong only to resurface-typed bookings'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.rink_bookings_resurface_coherence() is
  'Resurface-typed bookings (rink_booking_types.is_resurface) always carry a resurface_status (defaulted to scheduled) and, in a terminal status, a resolved_at stamp (cleared on return to scheduled); every other booking carries none of the resurface columns. SECURITY DEFINER so the type lookup ignores the caller''s SELECT visibility; trigger-only, EXECUTE revoked.';

revoke execute on function public.rink_bookings_resurface_coherence()
  from public, anon, authenticated;

drop trigger if exists trg_rink_bookings_resurface_coherence on public.rink_bookings;
create trigger trg_rink_bookings_resurface_coherence
  before insert or update of booking_type_id, resurface_status,
    ice_cut_submission_id, resurface_resolved_at, resurface_resolved_by
  on public.rink_bookings
  for each row execute function public.rink_bookings_resurface_coherence();

commit;
