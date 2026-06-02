-- =============================================================================
-- 00000000000105_facility_spaces_incident_admin_write.sql
-- Broaden facility_spaces write access so an Incident Reports module admin can
-- manage the spaces that feed the incident form (the list is surfaced as a tab
-- in the Incident admin). Facility admins and super admins keep access.
--
-- SELECT policy is unchanged (any same-facility user can read). Cross-facility
-- isolation is preserved: writes still require facility_id = current_facility_id().
-- =============================================================================

drop policy if exists facility_spaces_insert on public.facility_spaces;
create policy facility_spaces_insert on public.facility_spaces
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('incident_reports')
      )
    )
  );

drop policy if exists facility_spaces_update on public.facility_spaces;
create policy facility_spaces_update on public.facility_spaces
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('incident_reports')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('incident_reports')
      )
    )
  );

drop policy if exists facility_spaces_delete on public.facility_spaces;
create policy facility_spaces_delete on public.facility_spaces
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('incident_reports')
      )
    )
  );
