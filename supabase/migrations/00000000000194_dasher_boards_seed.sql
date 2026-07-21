-- =============================================================================
-- 00000000000194_dasher_boards_seed.sql
-- Dasher Boards seeds.
--
-- 1. seed_default_dasher_boards_config(facility): door subtypes + issue
--    categories, idempotent; auto-runs for new facilities via AFTER INSERT
--    trigger (facility_modules pattern, migration 144); backfilled for every
--    existing facility.
-- 2. Tennity: one rink row ("Main Rink") — perimeter assets are NOT seeded;
--    the entire perimeter is generated from facility-entered setup data via
--    the wizard (product decision: nothing hardcoded).
-- 3. Cadenced checklist items for the Tennity rink: weekly + monthly ONLY.
--    Daily and yearly ship EMPTY by design — the spatial exception model
--    carries daily; yearly items are facility-authored.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Per-facility config seeder (subtypes + issue categories)
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_dasher_boards_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Door subtypes.
  insert into public.dasher_boards_asset_subtypes (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'door', s.label, s.sort_order
  from (values
    ('Bench', 0),
    ('Scoreboard', 1),
    ('Public Skate', 2),
    ('Zamboni', 3)
  ) as s(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: board panels.
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'board_panel', c.label, c.sort_order
  from (values
    ('Facing damage', 0),
    ('Protruding/missing fastener', 1),
    ('Panel joint misalignment', 2),
    ('Kickplate damage', 3),
    ('Caprail damage', 4),
    ('Resurfacer impact', 5),
    ('Other', 6)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: glass panels.
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'glass_panel', c.label, c.sort_order
  from (values
    ('Crack', 0),
    ('Chip/sharp edge', 1),
    ('Not seated/rattle', 2),
    ('Crazing at clamp', 3),
    ('Gasket damaged/missing', 4),
    ('Other', 5)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: doors.
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'door', c.label, c.sort_order
  from (values
    ('Latch not holding', 0),
    ('Hinge/sag', 1),
    ('Not flush with board line', 2),
    ('Threshold damage', 3),
    ('Door glass damage', 4),
    ('Hardware protruding ice-side', 5),
    ('Other', 6)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;
end;
$$;

comment on function public.seed_default_dasher_boards_config(uuid) is
  'Seeds Dasher Boards door subtypes and per-asset-type issue categories for a facility. Idempotent (on conflict do nothing). Internal-only execute, mirroring seed_default_facility_modules.';

revoke execute on function public.seed_default_dasher_boards_config(uuid) from public;
grant  execute on function public.seed_default_dasher_boards_config(uuid) to service_role;

-- Auto-seed for new facilities (path-independent, migration 144 pattern).
create or replace function public.tg_seed_dasher_boards_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_dasher_boards_config(new.id);
  return new;
end;
$$;

revoke execute on function public.tg_seed_dasher_boards_config() from public;

drop trigger if exists facilities_seed_dasher_boards on public.facilities;
create trigger facilities_seed_dasher_boards
  after insert on public.facilities
  for each row execute function public.tg_seed_dasher_boards_config();

-- Backfill every existing facility.
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_dasher_boards_config(f.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Tennity rink (assets deliberately NOT seeded — wizard-generated)
-- -----------------------------------------------------------------------------
insert into public.dasher_boards_rinks
  (facility_id, name, slug, rink_template, perimeter_anchor_label,
   perimeter_direction, inspection_weekday, sort_order, is_default)
select f.id, 'Main Rink', 'main-rink', 'nhl_200x85', 'Zamboni gate',
       'clockwise', 1, 0, true
from public.facilities f
where f.slug = 'tennity-ice-skating-pavilion'
on conflict (facility_id, slug) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Tennity checklist items: WEEKLY + MONTHLY only (daily/yearly empty by design)
-- -----------------------------------------------------------------------------
insert into public.dasher_boards_checklist_items
  (facility_id, rink_id, label, cadence, sort_order)
select r.facility_id, r.id, i.label, i.cadence, i.sort_order
from public.dasher_boards_rinks r
join public.facilities f on f.id = r.facility_id
cross join (values
  -- weekly
  ('Systematic fastener check with driver', 'weekly', 0),
  ('Floor anchor torque', 'weekly', 1),
  ('Stanchion clamp/base hardware torque', 'weekly', 2),
  ('Protective netting condition', 'weekly', 3),
  ('Benches mounted secure', 'weekly', 4),
  ('Overall safety review', 'weekly', 5),
  -- monthly
  ('Glass suspension cables (if cable-supported)', 'monthly', 10),
  ('Support posts end-to-end', 'monthly', 11),
  ('Timekeeper''s table', 'monthly', 12),
  ('Door hardware lubrication (hinges, latches, contact surfaces)', 'monthly', 13),
  ('Bleachers/spectator seating', 'monthly', 14),
  ('Shielding gasket inspection', 'monthly', 15),
  ('Full wall plumb sight-check', 'monthly', 16),
  ('Framing inspection behind panels', 'monthly', 17)
) as i(label, cadence, sort_order)
where f.slug = 'tennity-ice-skating-pavilion'
  and r.slug = 'main-rink'
on conflict (rink_id, label) do nothing;

commit;
