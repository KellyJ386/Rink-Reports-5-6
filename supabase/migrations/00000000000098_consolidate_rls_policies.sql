-- =============================================================================
-- 00000000000098_consolidate_rls_policies.sql
--
-- Two behavior-preserving RLS cleanups flagged by the scale audit:
--
-- 1. auth_rls_initplan: policies that called auth.uid() re-evaluate it PER ROW.
--    Wrapping as (select auth.uid()) makes Postgres evaluate it once per query
--    (an InitPlan). Pure planner optimization -- identical semantics.
--
-- 2. multiple_permissive_policies: several tables had two PERMISSIVE policies
--    for the same (command, role). Permissive policies are already OR-ed, so
--    merging them into ONE policy whose predicate is the OR of the originals is
--    exactly behavior-preserving while removing the per-row double evaluation.
--    For tables with an ALL policy overlapping a SELECT policy
--    (user_permissions, employee_invites, employee_certifications) the ALL
--    policy is split into explicit INSERT/UPDATE/DELETE with identical
--    predicates, so SELECT is served by a single policy.
--
-- The retired 'gm' role (removed in 00000000000087) is also dropped from the
-- current_user_role() admin arrays it appears in here; current_user_role() can
-- no longer return 'gm', so this is inert cleanup.
-- =============================================================================

begin;

-- ===================== users =====================
drop policy if exists users_select_self on public.users;
drop policy if exists users_select_facility on public.users;
create policy users_select on public.users
  for select to authenticated
  using (
    is_super_admin()
    or (facility_id = current_facility_id())
    or (id = (select auth.uid()))
  );

drop policy if exists users_insert on public.users;
drop policy if exists users_insert_self on public.users;
create policy users_insert on public.users
  for insert to authenticated
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (current_user_role() = any (array['admin'::text, 'super_admin'::text])))
    or ((id = (select auth.uid())) and (facility_id is null) and (is_super_admin = false))
  );

drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (is_super_admin() or ((facility_id = current_facility_id()) and (current_user_role() = any (array['admin'::text, 'super_admin'::text]))))
  with check (is_super_admin() or ((facility_id = current_facility_id()) and (current_user_role() = any (array['admin'::text, 'super_admin'::text]))));

-- ===================== offline_sync_queue =====================
drop policy if exists offline_sync_queue_select on public.offline_sync_queue;
create policy offline_sync_queue_select on public.offline_sync_queue
  for select to authenticated
  using (
    is_super_admin()
    or ((facility_id = current_facility_id())
        and ((employee_id in (select employees.id from employees where employees.user_id = (select auth.uid()) and employees.is_active = true))
             or (current_user_role() = any (array['admin'::text, 'super_admin'::text]))))
  );

drop policy if exists offline_sync_queue_insert on public.offline_sync_queue;
create policy offline_sync_queue_insert on public.offline_sync_queue
  for insert to authenticated
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id())
        and (employee_id in (select employees.id from employees where employees.user_id = (select auth.uid()) and employees.is_active = true)))
  );

drop policy if exists offline_sync_queue_update on public.offline_sync_queue;
create policy offline_sync_queue_update on public.offline_sync_queue
  for update to authenticated
  using (
    is_super_admin()
    or ((facility_id = current_facility_id())
        and (employee_id in (select employees.id from employees where employees.user_id = (select auth.uid()) and employees.is_active = true)))
  )
  with check (is_super_admin() or (facility_id = current_facility_id()));

-- ===================== user_permissions ===================== (split ALL; wrap auth.uid())
drop policy if exists user_permissions_select on public.user_permissions;
create policy user_permissions_select on public.user_permissions
  for select to authenticated
  using (is_super_admin() or (user_id = (select auth.uid())) or is_facility_admin(facility_id));

drop policy if exists user_permissions_write on public.user_permissions;
create policy user_permissions_insert on public.user_permissions
  for insert to authenticated
  with check (is_super_admin() or is_facility_admin(facility_id));
create policy user_permissions_update on public.user_permissions
  for update to authenticated
  using (is_super_admin() or is_facility_admin(facility_id))
  with check (is_super_admin() or is_facility_admin(facility_id));
create policy user_permissions_delete on public.user_permissions
  for delete to authenticated
  using (is_super_admin() or is_facility_admin(facility_id));

-- ===================== employee_invites ===================== (split ALL; public role; wrap auth.uid())
drop policy if exists employee_invites_write on public.employee_invites;
create policy employee_invites_insert on public.employee_invites
  for insert
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (exists (
      select 1 from employees me join roles r on r.id = me.role_id
      where me.user_id = (select auth.uid()) and me.is_active and r.key = any (array['admin'::text, 'super_admin'::text]))))
  );
create policy employee_invites_update on public.employee_invites
  for update
  using (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (exists (
      select 1 from employees me join roles r on r.id = me.role_id
      where me.user_id = (select auth.uid()) and me.is_active and r.key = any (array['admin'::text, 'super_admin'::text]))))
  )
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (exists (
      select 1 from employees me join roles r on r.id = me.role_id
      where me.user_id = (select auth.uid()) and me.is_active and r.key = any (array['admin'::text, 'super_admin'::text]))))
  );
create policy employee_invites_delete on public.employee_invites
  for delete
  using (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (exists (
      select 1 from employees me join roles r on r.id = me.role_id
      where me.user_id = (select auth.uid()) and me.is_active and r.key = any (array['admin'::text, 'super_admin'::text]))))
  );

-- ===================== employee_certifications ===================== (split ALL; public role; wrap auth.uid())
drop policy if exists employee_certifications_write on public.employee_certifications;
create policy employee_certifications_insert on public.employee_certifications
  for insert
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (exists (
      select 1 from employees me join roles r on r.id = me.role_id
      where me.user_id = (select auth.uid()) and me.is_active and r.key = any (array['admin'::text, 'super_admin'::text]))))
  );
create policy employee_certifications_update on public.employee_certifications
  for update
  using (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (exists (
      select 1 from employees me join roles r on r.id = me.role_id
      where me.user_id = (select auth.uid()) and me.is_active and r.key = any (array['admin'::text, 'super_admin'::text]))))
  )
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (exists (
      select 1 from employees me join roles r on r.id = me.role_id
      where me.user_id = (select auth.uid()) and me.is_active and r.key = any (array['admin'::text, 'super_admin'::text]))))
  );
create policy employee_certifications_delete on public.employee_certifications
  for delete
  using (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (exists (
      select 1 from employees me join roles r on r.id = me.role_id
      where me.user_id = (select auth.uid()) and me.is_active and r.key = any (array['admin'::text, 'super_admin'::text]))))
  );

-- ===================== schedule_swap_requests ===================== (merge duplicate pairs per command)
drop policy if exists schedule_swap_delete on public.schedule_swap_requests;
drop policy if exists schedule_swap_requests_delete on public.schedule_swap_requests;
create policy schedule_swap_requests_delete on public.schedule_swap_requests
  for delete to authenticated
  using (is_super_admin() or has_module_admin_access('scheduling'::text));

drop policy if exists schedule_swap_insert on public.schedule_swap_requests;
drop policy if exists schedule_swap_requests_insert on public.schedule_swap_requests;
create policy schedule_swap_requests_insert on public.schedule_swap_requests
  for insert to authenticated
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id())
        and ((requester_employee_id = current_employee_id())
             or (current_employee_module_permission('scheduling'::text) >= 'submit'::module_permission_level)))
  );

drop policy if exists schedule_swap_select on public.schedule_swap_requests;
drop policy if exists schedule_swap_requests_select on public.schedule_swap_requests;
create policy schedule_swap_requests_select on public.schedule_swap_requests
  for select to authenticated
  using (
    is_super_admin()
    or has_module_admin_access('scheduling'::text)
    or ((facility_id = current_facility_id())
        and has_module_access('scheduling'::text)
        and ((requester_employee_id = current_employee_id()) or (target_employee_id = current_employee_id())))
    or ((facility_id = current_facility_id())
        and ((requester_employee_id = current_employee_id()) or (target_employee_id = current_employee_id())))
  );

drop policy if exists schedule_swap_update on public.schedule_swap_requests;
drop policy if exists schedule_swap_requests_update on public.schedule_swap_requests;
create policy schedule_swap_requests_update on public.schedule_swap_requests
  for update to authenticated
  using (
    is_super_admin()
    or has_module_admin_access('scheduling'::text)
    or (requester_employee_id = current_employee_id())
    or (target_employee_id = current_employee_id())
    or ((facility_id = current_facility_id())
        and (has_module_admin_access('scheduling'::text) or ((requester_employee_id = current_employee_id()) and (status = 'pending'::text))))
  )
  with check (
    is_super_admin()
    or has_module_admin_access('scheduling'::text)
    or (requester_employee_id = current_employee_id())
    or (target_employee_id = current_employee_id())
    or ((facility_id = current_facility_id())
        and (has_module_admin_access('scheduling'::text) or ((requester_employee_id = current_employee_id()) and (status = 'cancelled'::text))))
  );

-- ===================== schedule_time_off_requests ===================== (merge duplicate INSERT pair)
drop policy if exists schedule_time_off_insert on public.schedule_time_off_requests;
drop policy if exists schedule_time_off_requests_insert on public.schedule_time_off_requests;
create policy schedule_time_off_requests_insert on public.schedule_time_off_requests
  for insert to authenticated
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id())
        and (((employee_id = current_employee_id()) and (status = 'pending'::text))
             or (current_employee_module_permission('scheduling'::text) >= 'submit'::module_permission_level)))
  );

commit;
