-- =============================================================================
-- 00000000000043_rls_use_effective_permission.sql
--
-- Final piece of the Admin Control Center redesign.
--
-- Migrations 30, 32, 33, 34, 35 ship INSERT policies that gate writes on
-- public.has_module_permission(module_key, perm_type). After migration 38
-- that function is a thin shim that delegates to
-- current_employee_module_permission() -> effective_module_permission().
--
-- This migration rewrites the 15 affected policies to call
-- current_employee_module_permission() directly with an enum comparison.
-- Same semantics; one less function call per policy evaluation; the
-- effective-permission resolver is now the only path the RLS uses to ask
-- "does this user have submit on module X?".
--
-- Once every policy has been migrated, public.has_module_permission(text,
-- text) has no callers anywhere in the schema and is dropped.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Policies from migration 30 (submission tables)
-- -----------------------------------------------------------------------------

-- daily_report_submissions ----------------------------------------------------
drop policy if exists daily_report_submissions_insert on public.daily_report_submissions;
create policy daily_report_submissions_insert on public.daily_report_submissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('daily_reports')
            >= 'submit'::public.module_permission_level
    )
  );

-- incident_reports ------------------------------------------------------------
drop policy if exists incident_reports_insert on public.incident_reports;
create policy incident_reports_insert on public.incident_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('incident_reports')
            >= 'submit'::public.module_permission_level
    )
  );

-- accident_reports ------------------------------------------------------------
drop policy if exists accident_reports_insert on public.accident_reports;
create policy accident_reports_insert on public.accident_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('accident_reports')
            >= 'submit'::public.module_permission_level
    )
  );

-- refrigeration_reports -------------------------------------------------------
drop policy if exists refrigeration_reports_insert on public.refrigeration_reports;
create policy refrigeration_reports_insert on public.refrigeration_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('refrigeration')
            >= 'submit'::public.module_permission_level
    )
  );

-- air_quality_submissions (PHANTOM — see migration 61) ------------------------
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
            and public.current_employee_module_permission('air_quality')
                  >= 'submit'::public.module_permission_level
          )
        )
    $sql$;
  end if;
end$$;

-- ice_operation_reports (PHANTOM — see migration 61) --------------------------
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
            and public.current_employee_module_permission('ice_operations')
                  >= 'submit'::public.module_permission_level
          )
        )
    $sql$;
  end if;
end$$;

-- ice_depth_sessions ----------------------------------------------------------
drop policy if exists ice_depth_sessions_insert on public.ice_depth_sessions;
create policy ice_depth_sessions_insert on public.ice_depth_sessions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('ice_depth')
            >= 'submit'::public.module_permission_level
    )
  );

-- communication_messages ------------------------------------------------------
drop policy if exists communication_messages_insert on public.communication_messages;
create policy communication_messages_insert on public.communication_messages
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('communications')
            >= 'submit'::public.module_permission_level
    )
  );

-- schedule_swap_requests ------------------------------------------------------
drop policy if exists schedule_swap_requests_insert on public.schedule_swap_requests;
create policy schedule_swap_requests_insert on public.schedule_swap_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('scheduling')
            >= 'submit'::public.module_permission_level
    )
  );

-- shift_requests (PHANTOM — see migration 61) ---------------------------------
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
            and public.current_employee_module_permission('scheduling')
                  >= 'submit'::public.module_permission_level
          )
        )
    $sql$;
  end if;
end$$;

-- time_off_requests (PHANTOM — see migration 61) ------------------------------
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
            and public.current_employee_module_permission('scheduling')
                  >= 'submit'::public.module_permission_level
          )
        )
    $sql$;
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- Policies from migrations 32-35 (per-module change logs)
-- -----------------------------------------------------------------------------

-- refrigeration_change_log (m32) ---------------------------------------------
drop policy if exists refrigeration_change_log_insert
  on public.refrigeration_change_log;
create policy refrigeration_change_log_insert
  on public.refrigeration_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('refrigeration')
            >= 'submit'::public.module_permission_level
    )
  );

-- air_quality_change_log (m33) -----------------------------------------------
drop policy if exists air_quality_change_log_insert
  on public.air_quality_change_log;
create policy air_quality_change_log_insert
  on public.air_quality_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('air_quality')
            >= 'submit'::public.module_permission_level
    )
  );

-- ice_operation_change_log (m34) ---------------------------------------------
drop policy if exists ice_operation_change_log_insert
  on public.ice_operation_change_log;
create policy ice_operation_change_log_insert
  on public.ice_operation_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('ice_operations')
            >= 'submit'::public.module_permission_level
    )
  );

-- ice_depth_change_log (m35) -------------------------------------------------
drop policy if exists ice_depth_change_log_insert on public.ice_depth_change_log;
create policy ice_depth_change_log_insert on public.ice_depth_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('ice_depth')
            >= 'submit'::public.module_permission_level
    )
  );

-- -----------------------------------------------------------------------------
-- Drop the legacy shim. No callers remain anywhere in the schema.
-- -----------------------------------------------------------------------------
drop function if exists public.has_module_permission(text, text);
