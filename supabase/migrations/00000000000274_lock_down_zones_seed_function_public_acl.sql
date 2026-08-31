-- =============================================================================
-- 00000000000274_lock_down_zones_seed_function_public_acl.sql
--
-- Closes an anon/authenticated EXECUTE leak on seed_default_dasher_boards_zones,
-- the same class of bug migration 201 already closed for
-- seed_default_dasher_boards_config / seed_default_door_types.
--
-- Root cause (identical to migrations 163 and 201): "a privilege held via the
-- PUBLIC pseudo-role is NOT removed by `revoke ... from anon`", and the inverse
-- is also true. seed_default_dasher_boards_zones and its trigger companion
-- tg_seed_dasher_boards_zones (migration 259) were each created with only
-- `revoke execute ... from public;` -- the narrower form migration 163 flagged
-- as insufficient. Their actual ACLs (pg_proc.proacl) still list anon and
-- authenticated with EXECUTE, so the narrower revoke never touched them.
--
-- seed_default_dasher_boards_zones is SECURITY DEFINER, resolves facility_id
-- from the passed rink id, and inserts default zone rows -- reachable with the
-- public anon key via POST /rest/v1/rpc/seed_default_dasher_boards_zones and no
-- session at all. Damage is bounded (idempotent `on conflict do nothing`, and
-- targeting needs a known random rink UUID), but it is a tenant-table writer
-- that must never be callable by a client role. Migration 259's own comment
-- claims "internal-only execute (service_role)" -- this makes that true.
--
-- The trigger runs the seed on `after insert on dasher_boards_rinks`; trigger
-- execution ignores EXECUTE grants entirely, and the only intended direct
-- caller is the service-role backfill path, which keeps its explicit grant. So
-- this is a pure close, not a behavior change.
--
-- Also brings three trigger-only functions onto the standard
-- `public, anon, authenticated` revoke (they return `trigger` and so are not
-- PostgREST-exposed -- not exploitable, but the narrow revoke is the same
-- latent pattern this migration exists to retire; production-readiness L-2):
--   * tg_seed_dasher_boards_zones           (migration 259)
--   * dasher_boards_assets_log_display_events (migration 259)
--   * stamp_business_date_from               (migration 267)
-- =============================================================================

revoke execute on function public.seed_default_dasher_boards_zones(uuid)
  from public, anon, authenticated;

revoke execute on function public.tg_seed_dasher_boards_zones()
  from public, anon, authenticated;

revoke execute on function public.dasher_boards_assets_log_display_events()
  from public, anon, authenticated;

revoke execute on function public.stamp_business_date_from()
  from public, anon, authenticated;
