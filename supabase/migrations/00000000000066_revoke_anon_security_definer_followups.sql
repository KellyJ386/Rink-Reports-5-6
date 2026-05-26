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

-- handle_new_user() is the auth.users trigger created out-of-band by Supabase
-- (the managed auth stack creates it), not by any migration in this repo. On a
-- bare supabase/postgres instance — e.g. the rls-isolation CI job, which applies
-- migrations on the raw image without the managed auth setup — the function is
-- absent and an unconditional REVOKE aborts the whole migration run. Guard it so
-- the migration applies whether or not the function exists; environments that
-- have it (production) still get the lockdown.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'handle_new_user'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    revoke execute on function public.handle_new_user() from public, anon, authenticated;
  end if;
end $$;

revoke execute on function public.enforce_accident_witnesses_cap() from public, anon, authenticated;

revoke execute on function public.get_employee_counts_by_facility() from public, anon;

alter function public.sync_module_permission_columns() set search_path = public;
