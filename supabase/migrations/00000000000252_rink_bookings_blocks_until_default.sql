-- =============================================================================
-- 00000000000252_rink_bookings_blocks_until_default.sql
-- Give rink_bookings.blocks_until a column default.
--
-- WHY. blocks_until is derived (ends_at + buffer_minutes_after) and is
-- maintained unconditionally by trg_rink_bookings_blocks_until, a BEFORE
-- INSERT/UPDATE trigger. It exists as a stored column only because an
-- exclusion constraint needs an IMMUTABLE expression to index and
-- `timestamptz + interval` is merely STABLE (see migration 247's header).
--
-- Without a default, the column is NOT NULL with no default, so the generated
-- TypeScript Insert type marks it REQUIRED — pushing every caller to send a
-- value for a column they must never set. The trigger overwrites whatever
-- arrives, so a supplied value is silently discarded: the type was demanding
-- a lie.
--
-- With a default the generated type marks it optional, which is the truth:
-- callers omit it and the trigger fills it in. The default value itself is
-- never observable — the BEFORE trigger runs before the row is stored and
-- before the exclusion constraint is checked, so it always replaces this.
--
-- No data change: every existing row already has a trigger-computed value.
-- =============================================================================

begin;

alter table public.rink_bookings
  alter column blocks_until set default now();

comment on column public.rink_bookings.blocks_until is
  'ends_at + buffer_minutes_after, maintained by trg_rink_bookings_blocks_until. Never write this from application code: an exclusion constraint needs an IMMUTABLE expression and timestamptz + interval is only STABLE, so the sum must be materialised. The now() default exists solely so generated types mark the column optional; the BEFORE trigger always overwrites it. Change buffer_minutes_after instead.';

commit;
