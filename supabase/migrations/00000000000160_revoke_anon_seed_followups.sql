-- =============================================================================
-- 00000000000160_revoke_anon_seed_followups.sql
-- Security hardening: stop exposing two facility-bootstrap SECURITY DEFINER seed
-- functions as PostgREST RPC endpoints for anon/authenticated callers.
--
-- Migrations 66 and 122 established the pattern of revoking anon/authenticated
-- EXECUTE on seed/trigger SECURITY DEFINER functions, but two seed helpers added
-- AFTER those migrations were never locked down:
--   * seed_default_facility_air_quality_config(uuid)  -- migration 147
--   * seed_default_facility_modules(uuid)             -- migration 144
--
-- Both are SECURITY DEFINER, take a facility_id, and write seed config; both are
-- reachable unauthenticated over /rest/v1/rpc. They are only ever invoked
-- server-side during facility provisioning (which runs as service_role, or from
-- other SECURITY DEFINER orchestrators that run in definer context regardless of
-- the caller's grant), so revoking the anon/authenticated RPC surface is safe.
--
-- The original definitions already did `revoke ... from public; grant ... to
-- service_role`, but PUBLIC's revoke does not cover the `anon`/`authenticated`
-- roles that PostgREST authenticates as when they have been granted EXECUTE
-- elsewhere; revoke from them explicitly to remove the RPC surface. service_role
-- retains EXECUTE from the original grant.
-- =============================================================================

revoke execute on function public.seed_default_facility_air_quality_config(uuid) from anon, authenticated;
revoke execute on function public.seed_default_facility_modules(uuid)            from anon, authenticated;
