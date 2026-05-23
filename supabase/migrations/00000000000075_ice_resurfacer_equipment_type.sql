-- =============================================================================
-- 00000000000075_ice_resurfacer_equipment_type.sql
-- Rename 'zamboni' (brand name) to 'ice_resurfacer' and add 'hand_edger' to
-- the Ice Operations equipment_type enum across:
--   * ice_operations_equipment.equipment_type            (check constraint)
--   * ice_operations_circle_check_items.applies_to_equipment_type (check)
--
-- Canonical set after this migration:
--   ice_resurfacer | edger | blade_set | hand_edger | other
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ice_operations_equipment: drop old check, backfill data, add new check
-- ---------------------------------------------------------------------------
alter table public.ice_operations_equipment
  drop constraint if exists ice_operations_equipment_equipment_type_check;

update public.ice_operations_equipment
   set equipment_type = 'ice_resurfacer'
 where equipment_type = 'zamboni';

alter table public.ice_operations_equipment
  add constraint ice_operations_equipment_equipment_type_check
  check (equipment_type in ('ice_resurfacer','edger','blade_set','hand_edger','other'));

comment on table public.ice_operations_equipment is
  'Ice Operations: equipment dropdown. equipment_type drives which submissions can pick this row (ice_resurfacer=>ice_make/circle_check, edger=>edging, blade_set=>blade_change, hand_edger / other=>any). hours_count is admin-maintained cumulative hours; staff-side forms display the latest value.';

-- ---------------------------------------------------------------------------
-- 2. ice_operations_circle_check_items.applies_to_equipment_type
-- ---------------------------------------------------------------------------
alter table public.ice_operations_circle_check_items
  drop constraint if exists ice_operations_circle_check_items_applies_to_equipment_type_check;

update public.ice_operations_circle_check_items
   set applies_to_equipment_type = 'ice_resurfacer'
 where applies_to_equipment_type = 'zamboni';

alter table public.ice_operations_circle_check_items
  add constraint ice_operations_circle_check_items_applies_to_equipment_type_check
  check (applies_to_equipment_type in ('ice_resurfacer','edger','blade_set','hand_edger','other'));

-- ---------------------------------------------------------------------------
-- 3. Refresh seed-defaults helper to use the new key.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_ice_operations_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  insert into public.ice_operations_settings
    (facility_id, temperature_unit, alerts_enabled, default_alert_severity)
  values
    (p_facility_id, 'F', true, 'high')
  on conflict (facility_id) do nothing;

  for r in
    select * from (values
      ('Check oil level',          'ice_resurfacer', 0),
      ('Check tire pressure',      'ice_resurfacer', 1),
      ('Check blade sharpness',    'ice_resurfacer', 2),
      ('Inspect for fluid leaks',  'ice_resurfacer', 3),
      ('Check edger blade',        'edger',          4)
    ) as v(label, eq_type, sort_order)
  loop
    insert into public.ice_operations_circle_check_items
      (facility_id, label, applies_to_equipment_type, sort_order, is_active)
    select p_facility_id, r.label, r.eq_type, r.sort_order, true
    where not exists (
      select 1 from public.ice_operations_circle_check_items
      where facility_id = p_facility_id and label = r.label
    );
  end loop;
end;
$$;

revoke execute on function public.seed_default_ice_operations_config(uuid) from public;
grant  execute on function public.seed_default_ice_operations_config(uuid) to service_role;
