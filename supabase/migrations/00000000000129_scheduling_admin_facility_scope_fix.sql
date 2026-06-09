-- =============================================================================
-- 00000000000129_scheduling_admin_facility_scope_fix.sql
--
-- SECURITY FIX (cross-tenant leak). Four scheduling tables had RLS policies
-- whose admin branch was a BARE `has_module_admin_access('scheduling')`, not
-- paired with `facility_id = current_facility_id()`:
--
--   schedule_availability        (SELECT, INSERT, UPDATE, DELETE)
--   schedule_notifications       (SELECT, UPDATE, DELETE)
--   schedule_time_off_requests   (SELECT, UPDATE, DELETE)
--   schedule_swap_requests       (SELECT, UPDATE, DELETE)
--
-- has_module_admin_access(key) returns true when the caller holds the `admin`
-- action on that module IN THEIR OWN facility (it reads user_permissions
-- scoped to current_facility_id()). It says nothing about the ROW's facility.
-- So a scheduling admin in Facility A could SELECT/UPDATE/DELETE Facility B's
-- availability, time-off, swap, and notification rows — and, on the
-- availability INSERT check, write rows tagged with a foreign facility.
--
-- The sibling tables schedule_shifts and schedule_open_shifts already gate
-- correctly as `(facility_id = current_facility_id() AND
-- has_module_admin_access('scheduling'))`; this migration brings the four
-- leaky tables in line. Every other (employee-self) branch is preserved
-- verbatim — those are already safe because current_employee_id() cannot
-- match a foreign facility's employee.
--
-- Regression coverage: supabase/tests/rls_isolation.sql section 2L asserts a
-- Facility-A scheduling admin sees zero Facility-B rows across all four
-- tables.
-- =============================================================================

-- Drop legacy policy NAMES that predate the migration-98 rename. The
-- time-off table in particular still carried migration-15's
-- `schedule_time_off_{select,update,delete}` policies (only the INSERT pair
-- was de-duplicated in 98) — and because permissive policies OR together,
-- those bare-admin survivors re-opened the very leak the renamed policies
-- below close. Drop every historical name so exactly one policy per command
-- remains.
drop policy if exists schedule_time_off_select on public.schedule_time_off_requests;
drop policy if exists schedule_time_off_insert on public.schedule_time_off_requests;
drop policy if exists schedule_time_off_update on public.schedule_time_off_requests;
drop policy if exists schedule_time_off_delete on public.schedule_time_off_requests;
drop policy if exists schedule_swap_select on public.schedule_swap_requests;
drop policy if exists schedule_swap_insert on public.schedule_swap_requests;
drop policy if exists schedule_swap_update on public.schedule_swap_requests;
drop policy if exists schedule_swap_delete on public.schedule_swap_requests;

-- ---------------------------------------------------------------------------
-- schedule_availability
-- ---------------------------------------------------------------------------
drop policy if exists schedule_availability_select on public.schedule_availability;
create policy schedule_availability_select on public.schedule_availability
  for select to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id())
  );

drop policy if exists schedule_availability_insert on public.schedule_availability;
create policy schedule_availability_insert on public.schedule_availability
  for insert to authenticated
  with check (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id() and facility_id = current_facility_id())
  );

drop policy if exists schedule_availability_update on public.schedule_availability;
create policy schedule_availability_update on public.schedule_availability
  for update to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id() and facility_id = current_facility_id())
  )
  with check (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id() and facility_id = current_facility_id())
  );

drop policy if exists schedule_availability_delete on public.schedule_availability;
create policy schedule_availability_delete on public.schedule_availability
  for delete to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id() and facility_id = current_facility_id())
  );

-- ---------------------------------------------------------------------------
-- schedule_notifications
-- ---------------------------------------------------------------------------
drop policy if exists schedule_notifications_select on public.schedule_notifications;
create policy schedule_notifications_select on public.schedule_notifications
  for select to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id())
  );

drop policy if exists schedule_notifications_update on public.schedule_notifications;
create policy schedule_notifications_update on public.schedule_notifications
  for update to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id())
  )
  with check (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id())
  );

drop policy if exists schedule_notifications_delete on public.schedule_notifications;
create policy schedule_notifications_delete on public.schedule_notifications
  for delete to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
  );

-- ---------------------------------------------------------------------------
-- schedule_time_off_requests
-- ---------------------------------------------------------------------------
drop policy if exists schedule_time_off_requests_select on public.schedule_time_off_requests;
create policy schedule_time_off_requests_select on public.schedule_time_off_requests
  for select to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id())
  );

drop policy if exists schedule_time_off_requests_update on public.schedule_time_off_requests;
create policy schedule_time_off_requests_update on public.schedule_time_off_requests
  for update to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id())
  )
  with check (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (employee_id = current_employee_id())
  );

drop policy if exists schedule_time_off_requests_delete on public.schedule_time_off_requests;
create policy schedule_time_off_requests_delete on public.schedule_time_off_requests
  for delete to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
  );

-- ---------------------------------------------------------------------------
-- schedule_swap_requests
-- ---------------------------------------------------------------------------
drop policy if exists schedule_swap_requests_select on public.schedule_swap_requests;
create policy schedule_swap_requests_select on public.schedule_swap_requests
  for select to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
    or (
      facility_id = current_facility_id()
      and has_module_access('scheduling')
      and (requester_employee_id = current_employee_id() or target_employee_id = current_employee_id())
    )
    or (
      facility_id = current_facility_id()
      and (requester_employee_id = current_employee_id() or target_employee_id = current_employee_id())
    )
  );

drop policy if exists schedule_swap_requests_update on public.schedule_swap_requests;
create policy schedule_swap_requests_update on public.schedule_swap_requests
  for update to authenticated
  using (
    is_super_admin()
    or (
      facility_id = current_facility_id()
      and (
        has_module_admin_access('scheduling')
        or ((requester_employee_id = current_employee_id()) and (status = 'pending'))
        or (requester_employee_id = current_employee_id())
        or (target_employee_id = current_employee_id())
      )
    )
  )
  with check (
    is_super_admin()
    or (
      facility_id = current_facility_id()
      and (
        has_module_admin_access('scheduling')
        or ((requester_employee_id = current_employee_id()) and (status = 'cancelled'))
        or (requester_employee_id = current_employee_id())
        or (target_employee_id = current_employee_id())
      )
    )
  );

drop policy if exists schedule_swap_requests_delete on public.schedule_swap_requests;
create policy schedule_swap_requests_delete on public.schedule_swap_requests
  for delete to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id() and has_module_admin_access('scheduling'))
  );
