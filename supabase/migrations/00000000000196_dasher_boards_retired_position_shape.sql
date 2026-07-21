-- =============================================================================
-- 00000000000196_dasher_boards_retired_position_shape.sql
--
-- removeAsset soft-retires an asset that has issue history (history is
-- preserved forever) and then closes the sequence gap. A retired board/door
-- therefore must give up its sequence_position — otherwise shifting the
-- assets behind it down by one would collide with the retired row's position.
--
-- Migration 191's position_shape check required positioned types to ALWAYS
-- carry a sequence_position. Relax it: an INACTIVE board/door may float with
-- a null position; active ones still require it. Glass rows are unchanged.
-- =============================================================================

alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_position_shape;

alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_position_shape check (
    (
      asset_type in ('board_panel', 'door')
      and parent_board_id is null
      and (sequence_position is not null or is_active = false)
    )
    or (
      asset_type = 'glass_panel'
      and parent_board_id is not null
      and sequence_position is null
    )
  );

comment on constraint dasher_boards_assets_position_shape
  on public.dasher_boards_assets is
  'Active boards/doors are positioned; retired (is_active=false) ones float with a null position so the sequence gap can close without renumbering labels. Glass rows always ride their parent board.';
