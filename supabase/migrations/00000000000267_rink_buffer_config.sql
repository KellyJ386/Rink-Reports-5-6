-- =============================================================================
-- 00000000000267_rink_buffer_config.sql
-- Two knobs on the same "resurfacing buffer" mechanism that migration 247
-- shipped as a single facility-wide default_buffer_minutes:
--
-- 1. A per-sheet override (facility_rinks.buffer_minutes_override), mirroring
--    resurface_minutes_override from migration 265 — a facility can have one
--    rink that turns over in 10 minutes and another that needs 15.
--
-- 2. A facility-wide toggle (rink_scheduling_settings.buffer_included_in_rental).
--    Most facilities APPEND the buffer after the booked slot: a customer buys
--    an hour of ice, and the flood happens in a separate reserved window after
--    it, so the next booking cannot start until the flood is done. Some
--    facilities instead sell "an hour" that already includes the flood inside
--    it (a 60-minute booking is really ~50 minutes of skating + a built-in
--    10-minute make at the end) — the customer is billed for the full hour
--    either way (billing has always priced strictly off starts_at/ends_at,
--    never buffer_minutes_after, so this needs no rate-engine change), but
--    NO time is reserved after the booking, because the make already happened
--    inside it. Turning the toggle on makes new bookings snapshot
--    buffer_minutes_after = 0 regardless of the configured buffer minutes —
--    see resolveBufferMinutes() in src/lib/rink-scheduling/buffer.ts, the one
--    place application code turns these two columns into a number.
--
-- Neither column touches RLS: both tables already carry full RLS from
-- migration 248 (facility_rinks: edit-tier write; rink_scheduling_settings:
-- admin-tier write), which is row-level and needs no update for a new column.
-- No new table, policy, or SECURITY DEFINER function.
-- =============================================================================

begin;

alter table public.rink_scheduling_settings
  add column if not exists buffer_included_in_rental boolean not null default false;

comment on column public.rink_scheduling_settings.buffer_included_in_rental is
  'When true, the resurfacing/make time is sold as part of the booked hour rather than reserved after it: new bookings snapshot buffer_minutes_after = 0 regardless of default_buffer_minutes or a rink override. Billing is unaffected either way (it has always priced off starts_at/ends_at only). Default false — most facilities append the buffer.';

alter table public.facility_rinks
  add column if not exists buffer_minutes_override integer;

alter table public.facility_rinks
  add constraint facility_rinks_buffer_override_chk
    check (buffer_minutes_override is null
           or buffer_minutes_override between 0 and 120);

comment on column public.facility_rinks.buffer_minutes_override is
  'Per-sheet resurfacing buffer, overriding the facility default (rink_scheduling_settings.default_buffer_minutes) when set. Null = use the facility default. Ignored (buffer is 0) when buffer_included_in_rental is true.';

commit;
