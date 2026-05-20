-- Rename Ice Operations equipment_type values:
--   zamboni   -> ice_resurfacer
--   blade_set -> hand_edger
--   edger     -> edger      (unchanged)
--   other     -> other      (unchanged)
--
-- Affects ice_operations_equipment.equipment_type and
-- ice_operations_circle_check_items.applies_to_equipment_type. Both columns
-- are text with a CHECK constraint; this migration drops the old constraint,
-- migrates existing rows, then re-adds the constraint with the new value set.

begin;

-- ice_operations_equipment.equipment_type ------------------------------------
alter table public.ice_operations_equipment
  drop constraint if exists ice_operations_equipment_equipment_type_check;

update public.ice_operations_equipment
  set equipment_type = 'ice_resurfacer'
  where equipment_type = 'zamboni';

update public.ice_operations_equipment
  set equipment_type = 'hand_edger'
  where equipment_type = 'blade_set';

alter table public.ice_operations_equipment
  add constraint ice_operations_equipment_equipment_type_check
  check (equipment_type in ('ice_resurfacer','edger','hand_edger','other'));

-- ice_operations_circle_check_items.applies_to_equipment_type ----------------
alter table public.ice_operations_circle_check_items
  drop constraint if exists ice_operations_circle_check_items_applies_to_equipment_type_check;

update public.ice_operations_circle_check_items
  set applies_to_equipment_type = 'ice_resurfacer'
  where applies_to_equipment_type = 'zamboni';

update public.ice_operations_circle_check_items
  set applies_to_equipment_type = 'hand_edger'
  where applies_to_equipment_type = 'blade_set';

alter table public.ice_operations_circle_check_items
  add constraint ice_operations_circle_check_items_applies_to_equipment_type_check
  check (applies_to_equipment_type in ('ice_resurfacer','edger','hand_edger','other'));

-- Refresh table comments to match the new vocabulary.
comment on table public.ice_operations_equipment is
  'Ice Operations: equipment dropdown. equipment_type drives which submissions can pick this row (ice_resurfacer=>ice_make/circle_check, edger=>edging, hand_edger=>blade_change, other=>any). hours_count is admin-maintained cumulative hours; staff-side forms display the latest value.';

comment on table public.ice_operations_circle_check_items is
  'Ice Operations: per-facility circle-check checklist (up to 50 active rows; enforced in app). applies_to_equipment_type filters which items show for the selected equipment; null = applies to all equipment types.';

commit;
