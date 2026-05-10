-- Revokes execute on all SECURITY DEFINER helper functions from the anon role.
-- None of these functions should be callable by unauthenticated users.
-- The authenticated role retains execute on the RLS helpers and utility
-- functions. The service_role-only purge/seed functions keep their existing
-- grants (service_role); authenticated is revoked from those as well.

-- ---------------------------------------------------------------------------
-- RLS session helpers — authenticated only
-- ---------------------------------------------------------------------------
revoke execute on function public.current_employee_id()    from anon;
revoke execute on function public.current_facility_id()    from anon;
revoke execute on function public.current_user_id()        from anon;
revoke execute on function public.current_user_record()    from anon;
revoke execute on function public.current_user_role()      from anon;
revoke execute on function public.is_super_admin()         from anon;
revoke execute on function public.has_module_access(text)       from anon;
revoke execute on function public.has_module_admin_access(text) from anon;
revoke execute on function public.has_area_access(text, uuid)   from anon;

-- ---------------------------------------------------------------------------
-- Utility functions — authenticated only
-- ---------------------------------------------------------------------------
revoke execute on function public.get_employee_counts_by_facility() from anon;
revoke execute on function public.scheduling_claim_open_shift(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Purge functions — service_role only (revoke from anon and authenticated)
-- ---------------------------------------------------------------------------
revoke execute on function public.purge_old_daily_reports()              from anon;
revoke execute on function public.purge_old_communications()             from anon;
revoke execute on function public.purge_old_accident_reports()           from anon;
revoke execute on function public.purge_old_incident_reports()           from anon;
revoke execute on function public.purge_old_refrigeration_reports()      from anon;
revoke execute on function public.purge_old_air_quality_reports()        from anon;
revoke execute on function public.purge_old_ice_operations_submissions() from anon;
revoke execute on function public.purge_old_audit_logs()                 from anon;

revoke execute on function public.purge_old_daily_reports()              from authenticated;
revoke execute on function public.purge_old_communications()             from authenticated;
revoke execute on function public.purge_old_accident_reports()           from authenticated;
revoke execute on function public.purge_old_incident_reports()           from authenticated;
revoke execute on function public.purge_old_refrigeration_reports()      from authenticated;
revoke execute on function public.purge_old_air_quality_reports()        from authenticated;
revoke execute on function public.purge_old_ice_operations_submissions() from authenticated;
revoke execute on function public.purge_old_audit_logs()                 from authenticated;

-- ---------------------------------------------------------------------------
-- Seed functions — service_role only (revoke from anon and authenticated)
-- ---------------------------------------------------------------------------
revoke execute on function public.seed_default_roles_for_facility(uuid)           from anon;
revoke execute on function public.seed_default_accident_dropdowns(uuid)           from anon;
revoke execute on function public.seed_default_air_quality_config(uuid)           from anon;
revoke execute on function public.seed_default_ice_depth_settings(uuid)           from anon;
revoke execute on function public.seed_default_ice_operations_config(uuid)        from anon;
revoke execute on function public.seed_default_incident_types_and_severities(uuid) from anon;
revoke execute on function public.seed_default_refrigeration_sections(uuid)       from anon;
revoke execute on function public.seed_default_scheduling_config(uuid)            from anon;

revoke execute on function public.seed_default_roles_for_facility(uuid)           from authenticated;
revoke execute on function public.seed_default_accident_dropdowns(uuid)           from authenticated;
revoke execute on function public.seed_default_air_quality_config(uuid)           from authenticated;
revoke execute on function public.seed_default_ice_depth_settings(uuid)           from authenticated;
revoke execute on function public.seed_default_ice_operations_config(uuid)        from authenticated;
revoke execute on function public.seed_default_incident_types_and_severities(uuid) from authenticated;
revoke execute on function public.seed_default_refrigeration_sections(uuid)       from authenticated;
revoke execute on function public.seed_default_scheduling_config(uuid)            from authenticated;
