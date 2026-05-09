-- Adds the four missing RLS policies for schedule_swap_requests.
-- The table had RLS enabled in migration 00000000000015 but no policies were
-- ever created, leaving it fully open to cross-facility reads and writes.

drop policy if exists schedule_swap_requests_select on public.schedule_swap_requests;
create policy schedule_swap_requests_select on public.schedule_swap_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
      and (
        public.has_module_admin_access('scheduling')
        or requester_employee_id = public.current_employee_id()
        or target_employee_id    = public.current_employee_id()
      )
    )
  );

drop policy if exists schedule_swap_requests_insert on public.schedule_swap_requests;
create policy schedule_swap_requests_insert on public.schedule_swap_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
      and requester_employee_id = public.current_employee_id()
    )
  );

drop policy if exists schedule_swap_requests_update on public.schedule_swap_requests;
create policy schedule_swap_requests_update on public.schedule_swap_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or (
          requester_employee_id = public.current_employee_id()
          and status = 'pending'
        )
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('scheduling')
        or (
          requester_employee_id = public.current_employee_id()
          and status = 'cancelled'
        )
      )
    )
  );

drop policy if exists schedule_swap_requests_delete on public.schedule_swap_requests;
create policy schedule_swap_requests_delete on public.schedule_swap_requests
  for delete to authenticated
  using (public.is_super_admin());
