-- =============================================================================
-- 00000000000201_lock_down_seed_function_public_acl.sql
--
-- Closes an anon/authenticated EXECUTE leak on four facility "seed" functions
-- that CI's rls_isolation.sql caught (OVR: anon/authenticated CAN execute
-- seed_default_door_types — expected denied).
--
-- Root cause, per migration 163's own note: "a privilege held via the PUBLIC
-- pseudo-role is NOT removed by `revoke ... from anon`" — and the inverse is
-- also true here. seed_default_dasher_boards_config/tg_seed_dasher_boards_config
-- (migration 194) and seed_default_door_types/tg_seed_door_types (migration
-- 199) were each created with only `revoke execute ... from public;` — the
-- narrower form migration 163 flagged as insufficient and already fixed
-- elsewhere. Their actual ACLs (pg_proc.proacl) explicitly list anon and
-- authenticated with EXECUTE, so the narrower revoke never touched them.
-- These are the same "mutate a facility's config, reachable via
-- /rest/v1/rpc/<name>" class of function migration 163 locked down; they
-- simply postdate that pass and were never brought into it.
--
-- No app code calls any of the four directly as authenticated/anon — trigger
-- execution ignores EXECUTE grants entirely, seed_default_dasher_boards_config
-- already kept its explicit service_role grant (migration 194) for the
-- backfill path, and seed_default_door_types is intentionally service_role
-- only per src/app/admin/ice-depth/overlay-actions.ts's own comment (the app
-- replicates its insert inline, RLS-gated, instead of calling the RPC). So
-- this is a pure close, not a behavior change.
-- =============================================================================

revoke execute on function public.seed_default_dasher_boards_config(uuid)
  from public, anon, authenticated;
revoke execute on function public.tg_seed_dasher_boards_config()
  from public, anon, authenticated;

revoke execute on function public.seed_default_door_types(uuid)
  from public, anon, authenticated;
revoke execute on function public.tg_seed_door_types()
  from public, anon, authenticated;
