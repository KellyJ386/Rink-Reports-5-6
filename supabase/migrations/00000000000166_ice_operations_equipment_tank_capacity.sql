-- Ice Operations: tank capacity so ice_make water usage can be logged as a
-- percentage of tank in addition to a volume (gallons/liters). Canonical
-- storage of water_used_gal stays in gallons; the staff-facing unit toggle
-- converts a % of tank entry to gallons using this per-machine capacity.
alter table public.ice_operations_equipment
  add column if not exists tank_capacity_gal numeric;

comment on column public.ice_operations_equipment.tank_capacity_gal is
  'Admin-maintained water tank capacity in gallons. Enables the ice_make water-usage unit toggle to convert a "% of tank" entry to/from gallons. Null means the percentage option is unavailable for this machine.';
