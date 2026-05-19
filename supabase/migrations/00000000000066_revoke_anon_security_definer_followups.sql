-- =============================================================================
-- 00000000000066_revoke_anon_security_definer_followups.sql
--
-- Supabase database-linter follow-ups (lint 0028 / 0011) flagged after the
-- 00000000000026_revoke_anon_function_execute.sql sweep:
--
--   * handle_new_user()                  - auth.users trigger; was being
--                                          surfaced via PostgREST RPC.
--   * enforce_accident_witnesses_cap()   - row trigger added in
--                                          00000000000051_accident_witnesses_and_age.sql;
--                                          also exposed as RPC by default.
--   * get_employee_counts_by_facility()  - already revoked from anon in
--                                          migration 26 but the grant came
--                                          back; lock it down explicitly
--                                          (REVOKE is idempotent).
--   * sync_module_permission_columns()   - trigger function with role-mutable
--                                          search_path (lint 0011). Pin it
--                                          to public so a hostile schema on
--                                          the session search_path cannot
--                                          shadow referenced objects.
--
-- All four are trigger / utility helpers that should never be reachable via
-- /rest/v1/rpc. Revoking EXECUTE from public + anon removes the unauth
-- attack surface; revoking from authenticated on the two pure trigger
-- helpers removes the signed-in RPC surface too. Triggers fire as table
-- owner (postgres) and do not need EXECUTE on the role calling INSERT/UPDATE.
-- =============================================================================

revoke execute on function public.handle_new_user()                from public, anon, authenticated;
revoke execute on function public.enforce_accident_witnesses_cap() from public, anon, authenticated;

revoke execute on function public.get_employee_counts_by_facility() from public, anon;

alter function public.sync_module_permission_columns() set search_path = public;
