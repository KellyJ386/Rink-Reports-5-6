-- =============================================================================
-- 00000000000004_backbone_rls.sql
-- Row-Level Security policies for the shared backbone.
--
-- Standard pattern (per table):
--   SELECT  : super_admin OR same-facility
--   INSERT  : super_admin OR (same-facility AND role in admin/gm/super_admin)
--   UPDATE  : super_admin OR (same-facility AND role in admin/gm/super_admin)
--   DELETE  : super_admin only
--
-- Exceptions noted at each table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------
alter table public.facilities                enable row level security;
alter table public.roles                     enable row level security;
alter table public.departments               enable row level security;
alter table public.users                     enable row level security;
alter table public.employees                 enable row level security;
alter table public.employee_departments      enable row level security;
alter table public.module_permissions        enable row level security;
alter table public.module_area_permissions   enable row level security;
alter table public.audit_logs                enable row level security;

-- =============================================================================
-- facilities
-- A user can SEE their own facility (or all, if super admin).
-- Only super admins may write.
-- =============================================================================
drop policy if exists facilities_select on public.facilities;
create policy facilities_select on public.facilities
  for select to authenticated
  using (
    public.is_super_admin()
    or id = public.current_facility_id()
  );

drop policy if exists facilities_insert on public.facilities;
create policy facilities_insert on public.facilities
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists facilities_update on public.facilities;
create policy facilities_update on public.facilities
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists facilities_delete on public.facilities;
create policy facilities_delete on public.facilities
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- roles
-- =============================================================================
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- departments
-- =============================================================================
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists departments_delete on public.departments;
create policy departments_delete on public.departments
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- users
-- A user can ALWAYS read their own row (so bootstrap helpers work even when
-- facility_id is unset). Otherwise standard same-facility rule applies.
-- Updates restricted to admin/gm/super_admin (or super_admin).
-- =============================================================================
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = auth.uid());

drop policy if exists users_select_facility on public.users;
create policy users_select_facility on public.users
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists users_delete on public.users;
create policy users_delete on public.users
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- employees
-- =============================================================================
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- employee_departments
-- =============================================================================
drop policy if exists employee_departments_select on public.employee_departments;
create policy employee_departments_select on public.employee_departments
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists employee_departments_insert on public.employee_departments;
create policy employee_departments_insert on public.employee_departments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists employee_departments_update on public.employee_departments;
create policy employee_departments_update on public.employee_departments
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists employee_departments_delete on public.employee_departments;
create policy employee_departments_delete on public.employee_departments
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- module_permissions
-- =============================================================================
drop policy if exists module_permissions_select on public.module_permissions;
create policy module_permissions_select on public.module_permissions
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists module_permissions_insert on public.module_permissions;
create policy module_permissions_insert on public.module_permissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists module_permissions_update on public.module_permissions;
create policy module_permissions_update on public.module_permissions
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists module_permissions_delete on public.module_permissions;
create policy module_permissions_delete on public.module_permissions
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- module_area_permissions
-- =============================================================================
drop policy if exists module_area_permissions_select on public.module_area_permissions;
create policy module_area_permissions_select on public.module_area_permissions
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists module_area_permissions_insert on public.module_area_permissions;
create policy module_area_permissions_insert on public.module_area_permissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists module_area_permissions_update on public.module_area_permissions;
create policy module_area_permissions_update on public.module_area_permissions
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists module_area_permissions_delete on public.module_area_permissions;
create policy module_area_permissions_delete on public.module_area_permissions
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- audit_logs
-- SELECT: admin/gm/super_admin only.
-- INSERT: any authenticated user, but only into their own facility.
-- UPDATE/DELETE: forbidden (append-only). No policies => denied under RLS.
-- =============================================================================
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- No UPDATE policy: audit log rows are immutable.
-- No DELETE policy: audit log rows are permanent.
