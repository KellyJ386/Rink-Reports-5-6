-- =============================================================================
-- 00000000000097_security_hardening_v3.sql
--
-- Closes the SECURITY-advisor gaps found in the scale audit:
--
-- 1. public.trg_seed_role_permission_defaults() is a TRIGGER function. It was
--    reachable as a PostgREST RPC (/rest/v1/rpc/...) because it still carried
--    the default PUBLIC EXECUTE grant. Revoke from PUBLIC (and anon/
--    authenticated explicitly); postgres + service_role keep EXECUTE so the
--    trigger path is unaffected.
--
-- 2. Pin a non-mutable `search_path` on the app-owned functions that lacked the
--    full (public, pg_temp) setting (advisor: function_search_path_mutable).
--    Extension-owned functions (citext_*, gtrgm_*, regexp_*, etc.) are left
--    untouched on purpose.
-- =============================================================================

revoke execute on function public.trg_seed_role_permission_defaults() from public, anon, authenticated;

alter function public.canonical_role_permission_grants() set search_path = public, pg_temp;
alter function public.get_employee_counts_by_facility() set search_path = public, pg_temp;
alter function public.hide_dashboard_module(p_module_key text) set search_path = public, pg_temp;
alter function public.show_dashboard_module(p_module_key text) set search_path = public, pg_temp;
alter function public.touch_role_permission_defaults() set search_path = public, pg_temp;
