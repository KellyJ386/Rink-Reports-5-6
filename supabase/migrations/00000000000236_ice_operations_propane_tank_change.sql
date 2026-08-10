-- =============================================================================
-- 00000000000236_ice_operations_propane_tank_change.sql
-- Ice Operations: add the fifth operation type, 'propane_tank_change'.
--
-- Staff log a propane tank change with the machine (ice_resurfacer dropdown)
-- and the machine hours; occurred_at is auto-stamped at submit time like every
-- other ice-ops submission. Payload shape:
--   propane_tank_change: { hours_at_change }
--
-- The operation_type domain is an enumerated CHECK, and Postgres has no
-- "add a value" — this is a DROP + ADD restating the WHOLE list. Missing a
-- value here silently NARROWS the domain (see migrations 158/234 for the
-- schedule_notifications version of that mistake); supabase/tests/
-- rls_isolation.sql inserts one submission of every permitted value so a lost
-- one fails CI.
-- =============================================================================

alter table public.ice_operations_submissions
  drop constraint if exists ice_operations_submissions_operation_type_check;

alter table public.ice_operations_submissions
  add constraint ice_operations_submissions_operation_type_check
  check (operation_type in
    ('ice_make','circle_check','edging','blade_change','propane_tank_change'));

comment on table public.ice_operations_submissions is
  'Ice Operations: one row per submitted operation. operation_type is fixed to the five canonical values. payload jsonb shape varies per operation_type (ice_make: water/ice temps, time_in/out, water_used_gal, surface_pass_count; edging: hours_run; blade_change: blade_serial, hours_at_change, replaced_by_employee_id; propane_tank_change: hours_at_change; circle_check: empty -- results live in ice_operations_circle_check_results). Original is immutable; only super_admin may UPDATE/DELETE.';

comment on column public.ice_operations_submissions.equipment_id is
  'Relevance varies by operation_type: ice_resurfacer for ice_make/circle_check/propane_tank_change, edger for edging, blade_set for blade_change. Nullable in DB.';

comment on column public.ice_operations_settings.enabled_operation_types is
  'Subset of operation types visible to staff (ice_make/circle_check/edging/blade_change/propane_tank_change). NULL/empty = all enabled. The types themselves are code-defined; this only gates visibility.';

comment on table public.ice_operations_equipment is
  'Ice Operations: equipment dropdown. equipment_type drives which submissions can pick this row (ice_resurfacer=>ice_make/circle_check/propane_tank_change, edger=>edging, blade_set=>blade_change, hand_edger / other=>any). hours_count is admin-maintained cumulative hours; staff-side forms display the latest value.';
