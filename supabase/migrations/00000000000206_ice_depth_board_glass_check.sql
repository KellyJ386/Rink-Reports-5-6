-- =============================================================================
-- 00000000000206_ice_depth_board_glass_check.sql
--
-- Adds a simple session-level Pass/Fail check for the dasher board and glass
-- to the Ice Depth submission, alongside the existing free-text `notes`
-- column. This is a lightweight whole-facility checkoff (not the per-panel
-- spatial tracking that the separate Dasher Boards module provides) done as
-- part of the same measurement session.
--
-- Fail notes are required at the application layer (mirroring the
-- ice-operations circle-check convention) when the corresponding *_pass
-- column is false; null means "not answered."
-- =============================================================================

alter table public.ice_depth_sessions
  add column if not exists board_pass boolean,
  add column if not exists board_fail_notes text,
  add column if not exists glass_pass boolean,
  add column if not exists glass_fail_notes text;

comment on column public.ice_depth_sessions.board_pass is
  'Pass/Fail checkoff for the dasher boards, recorded as part of this ice-depth session. Null = not answered.';
comment on column public.ice_depth_sessions.board_fail_notes is
  'Required free-text note describing the issue when board_pass = false.';
comment on column public.ice_depth_sessions.glass_pass is
  'Pass/Fail checkoff for the rink glass, recorded as part of this ice-depth session. Null = not answered.';
comment on column public.ice_depth_sessions.glass_fail_notes is
  'Required free-text note describing the issue when glass_pass = false.';
