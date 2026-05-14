-- 00000000000058_drop_gm_from_admin_role_lists.sql
--
-- Migration 55 collapsed 'gm' into 'admin' across all facilities (no
-- employee carries the 'gm' role and no roles row exists with key='gm').
-- The remaining RLS policies that still reference 'gm' in their admin
-- role lists are no-ops at runtime, but we recreate them with the new
-- canonical role list so pg_policies reads cleanly and so future audits
-- don't waste time tracing a phantom role.
--
-- Every recreated policy preserves its prior semantics: super_admin
-- gate first, then facility match + (admin or super_admin). Manager is
-- only added back on the policies it already permitted; here, none.
--
-- Tables touched: audit_logs, departments, employee_departments,
-- employees, export_settings, module_area_permissions, module_permissions,
-- offline_sync_queue, retention_settings, role_module_permission_defaults,
-- roles, users. (Other tables in earlier policy snapshots — dept/facility
-- defaults and employee_custom_fields/_values — are dropped by migrations
-- 53 and 54.)

begin;

-- audit_logs
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- departments
drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- employee_departments
drop policy if exists employee_departments_insert on public.employee_departments;
create policy employee_departments_insert on public.employee_departments
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists employee_departments_update on public.employee_departments;
create policy employee_departments_update on public.employee_departments
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- employees
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- export_settings
drop policy if exists export_settings_insert on public.export_settings;
create policy export_settings_insert on public.export_settings
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists export_settings_update on public.export_settings;
create policy export_settings_update on public.export_settings
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- module_area_permissions
drop policy if exists module_area_permissions_delete on public.module_area_permissions;
create policy module_area_permissions_delete on public.module_area_permissions
  for delete
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists module_area_permissions_insert on public.module_area_permissions;
create policy module_area_permissions_insert on public.module_area_permissions
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists module_area_permissions_update on public.module_area_permissions;
create policy module_area_permissions_update on public.module_area_permissions
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- module_permissions
drop policy if exists module_permissions_insert on public.module_permissions;
create policy module_permissions_insert on public.module_permissions
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists module_permissions_update on public.module_permissions;
create policy module_permissions_update on public.module_permissions
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- offline_sync_queue (select only — preserves "employee can see their own
-- queued rows OR admin can see all in their facility")
drop policy if exists offline_sync_queue_select on public.offline_sync_queue;
create policy offline_sync_queue_select on public.offline_sync_queue
  for select
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        employee_id in (
          select employees.id
          from public.employees
          where employees.user_id = auth.uid()
            and employees.is_active = true
        )
        or public.current_user_role() = any (array['admin', 'super_admin'])
      )
    )
  );

-- retention_settings
drop policy if exists retention_settings_insert on public.retention_settings;
create policy retention_settings_insert on public.retention_settings
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists retention_settings_update on public.retention_settings;
create policy retention_settings_update on public.retention_settings
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- role_module_permission_defaults
drop policy if exists role_mp_defaults_delete on public.role_module_permission_defaults;
create policy role_mp_defaults_delete on public.role_module_permission_defaults
  for delete
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists role_mp_defaults_insert on public.role_module_permission_defaults;
create policy role_mp_defaults_insert on public.role_module_permission_defaults
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists role_mp_defaults_update on public.role_module_permission_defaults;
create policy role_mp_defaults_update on public.role_module_permission_defaults
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- roles
drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- users
drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

commit;
