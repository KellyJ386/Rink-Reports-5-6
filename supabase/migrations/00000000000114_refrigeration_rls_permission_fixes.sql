-- =============================================================================
-- 00000000000114_refrigeration_rls_permission_fixes.sql
-- Refrigeration section 5: RLS policy fixes from the live audit.
--
-- 1. refrigeration_report_values INSERT: require >= 'submit' (was has_module_access,
--    i.e. mere 'view'), matching the parent refrigeration_reports_insert policy so
--    a view-only user can no longer write child value rows.
-- 2. refrigeration_followup_notes INSERT: relax from has_module_admin_access to
--    >= 'submit' so submit-level operators can record corrective actions inline.
--
-- Super-admin clauses and facility scoping are preserved. The super_admin-only
-- UPDATE/DELETE immutability on refrigeration_reports / _report_values is
-- intentionally left untouched.
--
-- ROLLBACK (restore migration 11 behaviour):
--   drop policy if exists refrigeration_report_values_insert on public.refrigeration_report_values;
--   create policy refrigeration_report_values_insert on public.refrigeration_report_values
--     for insert to authenticated
--     with check (public.is_super_admin() or (facility_id = public.current_facility_id()
--       and public.has_module_access('refrigeration')));
--   drop policy if exists refrigeration_followup_notes_insert on public.refrigeration_followup_notes;
--   create policy refrigeration_followup_notes_insert on public.refrigeration_followup_notes
--     for insert to authenticated
--     with check (public.is_super_admin() or (facility_id = public.current_facility_id()
--       and public.has_module_admin_access('refrigeration')));
-- =============================================================================
begin;

drop policy if exists refrigeration_report_values_insert on public.refrigeration_report_values;
create policy refrigeration_report_values_insert on public.refrigeration_report_values
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('refrigeration')
            >= 'submit'::public.module_permission_level
    )
  );

drop policy if exists refrigeration_followup_notes_insert on public.refrigeration_followup_notes;
create policy refrigeration_followup_notes_insert on public.refrigeration_followup_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('refrigeration')
            >= 'submit'::public.module_permission_level
    )
  );

commit;
