-- =============================================================================
-- 00000000000030_submission_rls_module_permissions.sql
--
-- Tightens INSERT policies on all module submission tables so that
-- can_submit is enforced at the database level, not just the app layer.
--
-- Pattern applied to each submission table:
--   INSERT: super_admin
--           OR (same facility AND active employee AND has_module_permission(key, 'submit'))
--
-- SELECT / UPDATE / DELETE policies are unchanged from their module schemas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- daily_report_submissions
-- -----------------------------------------------------------------------------
drop policy if exists daily_report_submissions_insert on public.daily_report_submissions;
create policy daily_report_submissions_insert on public.daily_report_submissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('daily_reports', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- incident_reports
-- -----------------------------------------------------------------------------
drop policy if exists incident_reports_insert on public.incident_reports;
create policy incident_reports_insert on public.incident_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('incident_reports', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- accident_reports
-- -----------------------------------------------------------------------------
drop policy if exists accident_reports_insert on public.accident_reports;
create policy accident_reports_insert on public.accident_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('accident_reports', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- refrigeration_reports
-- -----------------------------------------------------------------------------
drop policy if exists refrigeration_reports_insert on public.refrigeration_reports;
create policy refrigeration_reports_insert on public.refrigeration_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('refrigeration', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- air_quality_submissions
-- -----------------------------------------------------------------------------
drop policy if exists air_quality_submissions_insert on public.air_quality_submissions;
create policy air_quality_submissions_insert on public.air_quality_submissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('air_quality', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- ice_operation_reports
-- -----------------------------------------------------------------------------
drop policy if exists ice_operation_reports_insert on public.ice_operation_reports;
create policy ice_operation_reports_insert on public.ice_operation_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('ice_operations', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- ice_depth_sessions
-- -----------------------------------------------------------------------------
drop policy if exists ice_depth_sessions_insert on public.ice_depth_sessions;
create policy ice_depth_sessions_insert on public.ice_depth_sessions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('ice_depth', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_messages
-- -----------------------------------------------------------------------------
drop policy if exists communication_messages_insert on public.communication_messages;
create policy communication_messages_insert on public.communication_messages
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('communications', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- schedule_swap_requests  (scheduling module)
-- -----------------------------------------------------------------------------
drop policy if exists schedule_swap_requests_insert on public.schedule_swap_requests;
create policy schedule_swap_requests_insert on public.schedule_swap_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('scheduling', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- shift_requests  (scheduling module — staff requesting open shifts)
-- -----------------------------------------------------------------------------
drop policy if exists shift_requests_insert on public.shift_requests;
create policy shift_requests_insert on public.shift_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('scheduling', 'submit')
    )
  );

-- -----------------------------------------------------------------------------
-- time_off_requests  (scheduling module)
-- -----------------------------------------------------------------------------
drop policy if exists time_off_requests_insert on public.time_off_requests;
create policy time_off_requests_insert on public.time_off_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('scheduling', 'submit')
    )
  );
