-- =============================================================================
-- 00000000000244_policies_explicit_to_authenticated.sql
--
-- Add an explicit `TO authenticated` to the 23 policies that omitted a TO
-- clause and therefore defaulted to PUBLIC (which includes anon). All 23
-- were fail-closed in practice only because their USING/WITH CHECK
-- expressions call helper functions (is_super_admin / current_facility_id /
-- ...) whose EXECUTE was revoked from anon in migration 26 — i.e. the
-- function ACL, not the policy, was the load-bearing gate. Making the role
-- explicit removes that fragile dependency and brings these in line with
-- the other 469 policies, which all declare their roles.
--
-- ALTER POLICY ... TO changes only the role list; USING/WITH CHECK
-- expressions are untouched, so no behavior changes for authenticated users.
-- =============================================================================

alter policy audit_logs_select on public.audit_logs to authenticated;
alter policy employee_invites_delete on public.employee_invites to authenticated;
alter policy employee_invites_insert on public.employee_invites to authenticated;
alter policy employee_invites_select on public.employee_invites to authenticated;
alter policy employee_invites_update on public.employee_invites to authenticated;
alter policy employees_insert on public.employees to authenticated;
alter policy employees_update on public.employees to authenticated;
alter policy export_settings_insert on public.export_settings to authenticated;
alter policy export_settings_update on public.export_settings to authenticated;
alter policy module_area_permissions_delete on public.module_area_permissions to authenticated;
alter policy module_area_permissions_insert on public.module_area_permissions to authenticated;
alter policy module_area_permissions_update on public.module_area_permissions to authenticated;
alter policy retention_settings_insert on public.retention_settings to authenticated;
alter policy retention_settings_update on public.retention_settings to authenticated;
alter policy role_mp_defaults_delete on public.role_module_permission_defaults to authenticated;
alter policy role_mp_defaults_insert on public.role_module_permission_defaults to authenticated;
alter policy role_mp_defaults_update on public.role_module_permission_defaults to authenticated;
alter policy role_permission_defaults_delete on public.role_permission_defaults to authenticated;
alter policy role_permission_defaults_insert on public.role_permission_defaults to authenticated;
alter policy role_permission_defaults_select on public.role_permission_defaults to authenticated;
alter policy role_permission_defaults_update on public.role_permission_defaults to authenticated;
alter policy roles_insert on public.roles to authenticated;
alter policy roles_update on public.roles to authenticated;
