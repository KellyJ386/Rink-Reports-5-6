-- =============================================================================
-- 00000000000140_schedule_shifts_no_double_booking.sql
--
-- DB backstop against double-booking an employee. The app-side friendly
-- pre-validation (scheduling_assignment_violations()'s 'double_booked' check,
-- surfaced before the write) stays as the first line of defense; this GiST
-- EXCLUDE constraint is the last line — it makes it physically impossible for
-- any code path (or a race between two near-simultaneous assigns) to commit two
-- overlapping shifts for the same employee.
--
-- Semantics:
--   * '[)' (half-open) range bounds mean two shifts that merely TOUCH — one
--     shift's ends_at == the next shift's starts_at — do NOT conflict.
--   * The WHERE clause excludes open/unassigned shifts (employee_id is null)
--     and cancelled shifts (status not in draft/published) — they can freely
--     overlap; only an actually-assigned, live shift competes for an employee's
--     time.
--
-- A pre-flight prod audit found 0 overlapping pairs, so this constraint can be
-- added without a data cleanup step.
--
-- btree_gist is installed into the `extensions` schema (Supabase convention,
-- matching the base pgcrypto/citext/pg_trgm install) so its ~240 gbt_* support
-- functions do NOT land in `public` and pollute the generated database.ts types.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
alter table public.schedule_shifts
  drop constraint if exists schedule_shifts_no_double_booking;
alter table public.schedule_shifts
  add constraint schedule_shifts_no_double_booking
  exclude using gist (
    employee_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (employee_id is not null and status in ('draft','published'));
