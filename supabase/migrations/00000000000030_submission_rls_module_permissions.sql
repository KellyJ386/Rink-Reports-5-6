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
-- air_quality_submissions (PHANTOM TABLE — see migration 61)
-- Original name was a typo; the real table is public.air_quality_reports.
-- Guarded with to_regclass so the migration applies cleanly on environments
-- that never had the phantom table. The intended policy is recreated on the
-- correct table in migration 61.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.air_quality_submissions') is not null then
    drop policy if exists air_quality_submissions_insert on public.air_quality_submissions;
    execute $sql$
      create policy air_quality_submissions_insert on public.air_quality_submissions
        for insert to authenticated
        with check (
          public.is_super_admin()
          or (
            facility_id = public.current_facility_id()
            and public.has_module_permission('air_quality', 'submit')
          )
        )
    $sql$;
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- ice_operation_reports (PHANTOM TABLE — see migration 61)
-- Original name was a typo; the real table is public.ice_operations_submissions.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.ice_operation_reports') is not null then
    drop policy if exists ice_operation_reports_insert on public.ice_operation_reports;
    execute $sql$
      create policy ice_operation_reports_insert on public.ice_operation_reports
        for insert to authenticated
        with check (
          public.is_super_admin()
          or (
            facility_id = public.current_facility_id()
            and public.has_module_permission('ice_operations', 'submit')
          )
        )
    $sql$;
  end if;
end$$;

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
-- shift_requests (PHANTOM — see migration 61)
-- Real table for staff claiming open shifts is public.schedule_open_shifts.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.shift_requests') is not null then
    drop policy if exists shift_requests_insert on public.shift_requests;
    execute $sql$
      create policy shift_requests_insert on public.shift_requests
        for insert to authenticated
        with check (
          public.is_super_admin()
          or (
            facility_id = public.current_facility_id()
            and public.has_module_permission('scheduling', 'submit')
          )
        )
    $sql$;
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- time_off_requests (PHANTOM — see migration 61)
-- Real table is public.schedule_time_off_requests.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.time_off_requests') is not null then
    drop policy if exists time_off_requests_insert on public.time_off_requests;
    execute $sql$
      create policy time_off_requests_insert on public.time_off_requests
        for insert to authenticated
        with check (
          public.is_super_admin()
          or (
            facility_id = public.current_facility_id()
            and public.has_module_permission('scheduling', 'submit')
          )
        )
    $sql$;
  end if;
end$$;
