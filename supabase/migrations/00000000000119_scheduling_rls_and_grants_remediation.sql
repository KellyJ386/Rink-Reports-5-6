-- =============================================================================
-- 00000000000119_scheduling_rls_and_grants_remediation.sql
-- Scheduling remediation P0 (C1, M5) + L3.
--
--   C1: revoke the RPC EXECUTE on the cap trigger fn from anon/authenticated.
--   M5: align employee_certifications write policies to include 'gm' and use the
--       standard current_user_role() helper (was a bespoke employees⋈roles join
--       that excluded gm).
--   L3: make departments + employee_departments write/delete gating consistent
--       with the rest of the scheduling config (module-admin), instead of
--       DELETE being super-admin-only.
-- =============================================================================

-- ---- C1 -------------------------------------------------------------------
-- enforce_employee_job_area_cap() is a trigger function; it should never be
-- invokable directly through PostgREST.
revoke execute on function public.enforce_employee_job_area_cap() from anon, authenticated;

-- ---- M5: employee_certifications ------------------------------------------
-- Drop every prior policy name this table may have had (migration 57 used
-- _select/_write; migration 98 split into 4).
drop policy if exists employee_certifications_select on public.employee_certifications;
drop policy if exists employee_certifications_write  on public.employee_certifications;
drop policy if exists employee_certifications_insert on public.employee_certifications;
drop policy if exists employee_certifications_update on public.employee_certifications;
drop policy if exists employee_certifications_delete on public.employee_certifications;

create policy employee_certifications_select on public.employee_certifications
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

create policy employee_certifications_insert on public.employee_certifications
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin','gm','super_admin'])
    )
  );

create policy employee_certifications_update on public.employee_certifications
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin','gm','super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin','gm','super_admin'])
    )
  );

create policy employee_certifications_delete on public.employee_certifications
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin','gm','super_admin'])
    )
  );

-- ---- L3: departments + employee_departments write gating ------------------
-- SELECT policies are left untouched (facility-scoped read). Only the write
-- side is realigned so DELETE matches INSERT/UPDATE (module-admin), instead of
-- DELETE being super-admin-only.
drop policy if exists departments_insert on public.departments;
drop policy if exists departments_update on public.departments;
drop policy if exists departments_delete on public.departments;

create policy departments_insert on public.departments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.has_module_admin_access('scheduling'))
  );

create policy departments_update on public.departments
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.has_module_admin_access('scheduling'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.has_module_admin_access('scheduling'))
  );

create policy departments_delete on public.departments
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.has_module_admin_access('scheduling'))
  );

drop policy if exists employee_departments_insert on public.employee_departments;
drop policy if exists employee_departments_update on public.employee_departments;
drop policy if exists employee_departments_delete on public.employee_departments;

create policy employee_departments_insert on public.employee_departments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.has_module_admin_access('scheduling'))
  );

create policy employee_departments_update on public.employee_departments
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.has_module_admin_access('scheduling'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.has_module_admin_access('scheduling'))
  );

create policy employee_departments_delete on public.employee_departments
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.has_module_admin_access('scheduling'))
  );
