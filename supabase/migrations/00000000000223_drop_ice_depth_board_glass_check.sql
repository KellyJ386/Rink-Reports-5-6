-- =============================================================================
-- 00000000000223_drop_ice_depth_board_glass_check.sql
--
-- Removes the session-level Board/Glass Pass-Fail checkoff added in migration
-- 206. The feature is being retired from the Ice Depth module; the separate
-- Dasher Boards module remains the spatial board/panel tracker.
-- =============================================================================

alter table public.ice_depth_sessions
  drop column if exists board_pass,
  drop column if exists board_fail_notes,
  drop column if exists glass_pass,
  drop column if exists glass_fail_notes;
