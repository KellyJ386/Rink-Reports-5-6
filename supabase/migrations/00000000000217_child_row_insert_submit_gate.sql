-- =============================================================================
-- 00000000000217_child_row_insert_submit_gate.sql
--
-- I-5 authorization audit, GAP: four child/measurement tables accepted
-- VIEW-level inserts while their parent report required SUBMIT.
--
--   air_quality_readings, ice_depth_measurements,
--   ice_operations_circle_check_results   → has_module_access (view) only
--   daily_report_submission_items         → module permission >= view only
--
-- The submit* actions require currentUserCan(module,'submit') and the parent
-- report row is submit-gated, so a view-only user can't create a report
-- through the app. But the child INSERT policies didn't require submit AND
-- didn't check the parent's ownership, so a same-facility user holding only a
-- VIEW grant could POST child rows referencing ANOTHER user's existing report
-- — padding or corrupting line items they could never submit. (Same-facility
-- integrity only; no cross-tenant or privilege escalation. The only app code
-- that inserts these rows is each module's staff submit.ts, under the user's
-- RLS client, always alongside a freshly-created own parent — so tightening
-- the policy doesn't affect the legitimate path.)
--
-- New rule for each: submit-level permission AND the referenced parent belongs
-- to the caller (employee_id = current_employee_id()), OR the caller is a
-- module editor/admin. Super-admin unchanged. Facility scoping unchanged.
-- =============================================================================

drop policy if exists air_quality_readings_insert on public.air_quality_readings;
create policy air_quality_readings_insert on public.air_quality_readings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('air_quality')
        or public.has_module_edit_access('air_quality')
        or (
          public.current_employee_module_permission('air_quality')
            >= 'submit'::public.module_permission_level
          and exists (
            select 1 from public.air_quality_reports r
             where r.id = air_quality_readings.report_id
               and r.facility_id = air_quality_readings.facility_id
               and r.employee_id = public.current_employee_id()
          )
        )
      )
    )
  );

drop policy if exists ice_depth_measurements_insert on public.ice_depth_measurements;
create policy ice_depth_measurements_insert on public.ice_depth_measurements
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('ice_depth')
        or public.has_module_edit_access('ice_depth')
        or (
          public.current_employee_module_permission('ice_depth')
            >= 'submit'::public.module_permission_level
          and exists (
            select 1 from public.ice_depth_sessions s
             where s.id = ice_depth_measurements.session_id
               and s.facility_id = ice_depth_measurements.facility_id
               and s.employee_id = public.current_employee_id()
          )
        )
      )
    )
  );

drop policy if exists ice_operations_circle_check_results_insert on public.ice_operations_circle_check_results;
create policy ice_operations_circle_check_results_insert on public.ice_operations_circle_check_results
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('ice_operations')
        or public.has_module_edit_access('ice_operations')
        or (
          public.current_employee_module_permission('ice_operations')
            >= 'submit'::public.module_permission_level
          and exists (
            select 1 from public.ice_operations_submissions o
             where o.id = ice_operations_circle_check_results.submission_id
               and o.facility_id = ice_operations_circle_check_results.facility_id
               and o.employee_id = public.current_employee_id()
          )
        )
      )
    )
  );

drop policy if exists daily_report_submission_items_insert on public.daily_report_submission_items;
create policy daily_report_submission_items_insert on public.daily_report_submission_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or public.has_module_edit_access('daily_reports')
        or (
          public.current_employee_module_permission('daily_reports')
            >= 'submit'::public.module_permission_level
          and exists (
            select 1 from public.daily_report_submissions s
             where s.id = daily_report_submission_items.submission_id
               and s.facility_id = daily_report_submission_items.facility_id
               and s.employee_id = public.current_employee_id()
          )
        )
      )
    )
  );
