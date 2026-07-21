-- =============================================================================
-- 00000000000200_dasher_boards_perimeter_anchor_offset.sql
-- Dasher Boards: a facility-settable geometric start point for the diagram.
--
-- perimeter_anchor_label (191) is free text ("Zamboni gate") with no effect on
-- rendering — position 1 has always drawn at a hardcoded spot (top-middle of
-- the diagram). This adds perimeter_anchor_offset: a fraction [0, 1) of the
-- boundary's arc length telling the diagram where to START drawing sequence
-- position 1 from. Admins set it by clicking a spot on the live diagram
-- (src/app/admin/dasher-boards/actions.ts: setPerimeterAnchor).
--
-- Changing it after a perimeter already exists is a pure ROTATION of the
-- rendered ring — no asset is renumbered or relabeled; whichever asset
-- currently holds sequence_position 1 simply redraws starting at the new
-- spot. No RLS change needed: writes already gate through the existing
-- dasher_boards_rinks admin-write policy from migration 192.
-- =============================================================================

alter table public.dasher_boards_rinks
  add column if not exists perimeter_anchor_offset numeric not null default 0;

alter table public.dasher_boards_rinks
  drop constraint if exists dasher_boards_rinks_anchor_offset_range;
alter table public.dasher_boards_rinks
  add constraint dasher_boards_rinks_anchor_offset_range
    check (perimeter_anchor_offset >= 0 and perimeter_anchor_offset < 1);

comment on column public.dasher_boards_rinks.perimeter_anchor_offset is
  'Fraction [0, 1) of the boundary arc length where sequence position 1 starts drawing. Purely a rendering rotation — never renumbers or relabels assets. Default 0 (top-middle of the diagram).';
