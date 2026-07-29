-- =============================================================================
-- 00000000000229_revoke_copy_role_permission_defaults_client_acl.sql
--
-- E-2: copy_role_permission_defaults(uuid, uuid) — created migration 44,
-- recreated migration 212 — is SECURITY DEFINER, EXECUTE-granted to
-- `authenticated`, and therefore callable straight from the browser at
-- /rest/v1/rpc/copy_role_permission_defaults. Its only gate is
--
--   is_super_admin()
--   or (target role's facility = current_facility_id()
--       and current_user_role() in ('admin','super_admin'))
--
-- with no admin-cell guard, so it is the same "copy a role's grid onto another
-- role" primitive that migration 227 just fenced on role_permission_defaults —
-- only unfenced. Today it writes the LEGACY role_module_permission_defaults
-- table, which no permission helper reads any more (the module-level helpers
-- moved to user_permissions in migration 91, and module_permissions was dropped
-- in migration 99), so the impact is currently inert — but it is a live,
-- client-reachable footgun aimed at the permission model.
--
-- Choice: REVOKE rather than add a guard. A repository-wide grep finds no
-- caller in src/ — `copy_role_permission_defaults` appears only in the
-- generated src/types/database.ts. The admin console's "copy defaults" action
-- (copyRoleDefaults in src/app/admin/roles/actions.ts) deliberately does the
-- copy inline against role_permission_defaults (the LIVE table) under RLS, then
-- calls reapply_role_defaults_for_role — it never touches this RPC. So removing
-- the client ACL is a pure close, not a behavior change.
--
-- Follows the established lock-down pattern of migrations 26 / 66 / 122 / 160 /
-- 163 / 201, including their finding that `revoke ... from anon` alone does not
-- remove a privilege held via the PUBLIC pseudo-role — hence public + anon +
-- authenticated in one statement. service_role keeps EXECUTE so an operator on
-- the backend can still run it.
--
-- Grant-only change: no signature, body, or table shape changes, so the
-- generated DB types and the schema snapshot are unaffected.
-- =============================================================================

revoke execute on function public.copy_role_permission_defaults(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.copy_role_permission_defaults(uuid, uuid)
  to service_role;

comment on function public.copy_role_permission_defaults(uuid, uuid) is
  'Copies one role''s LEGACY role_module_permission_defaults grid onto another '
  'role in the same facility. Not reachable from the client as of migration 229 '
  '(E-2): EXECUTE is service_role only, because it had no admin/admin cell '
  'guard and no app code calls it — the admin console copies '
  'role_permission_defaults inline under RLS instead.';
