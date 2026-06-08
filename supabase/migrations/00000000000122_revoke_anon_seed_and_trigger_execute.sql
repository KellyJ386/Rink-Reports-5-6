-- =============================================================================
-- 00000000000122_revoke_anon_seed_and_trigger_execute.sql
-- Security hardening: stop exposing internal SECURITY DEFINER functions as
-- PostgREST RPC endpoints for anon/authenticated callers.
--
-- The advisor flagged three SECURITY DEFINER functions as executable by anon:
--   * enforce_incident_witnesses_cap()        -- a row trigger function
--   * seed_default_facility_spaces(uuid)       -- facility-bootstrap seed
--   * seed_default_incident_activities(uuid)   -- facility-bootstrap seed
--
-- None are meant to be called directly over /rest/v1/rpc. The trigger function
-- fires from its table trigger; the seed helpers are invoked only by other
-- SECURITY DEFINER orchestrators (which run in definer context regardless of the
-- caller's EXECUTE grant). Revoking from anon + authenticated removes the RPC
-- surface while leaving service_role (and internal definer callers) working.
--
-- Mirrors the established pattern in migrations 26, 66, and 119
-- (revoke_anon_function_execute / enforce_employee_job_area_cap).
-- =============================================================================

revoke execute on function public.enforce_incident_witnesses_cap()      from anon, authenticated;
revoke execute on function public.seed_default_facility_spaces(uuid)     from anon, authenticated;
revoke execute on function public.seed_default_incident_activities(uuid) from anon, authenticated;
