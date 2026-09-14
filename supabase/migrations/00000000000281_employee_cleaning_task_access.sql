-- Let employees receive locker-room work without granting either Scheduling
-- module. Managers retain the rink-scheduling access introduced in migration
-- 280; the employee branch is deliberately both facility- and recipient-scoped.

begin;

drop policy if exists locker_room_cleaning_tasks_select
  on public.locker_room_cleaning_tasks;
create policy locker_room_cleaning_tasks_select on public.locker_room_cleaning_tasks
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
    or (facility_id = public.current_facility_id()
        and assigned_employee_id = public.current_employee_id())
  );

-- The general task surface needs the assigned room's display name, but must
-- not turn into a back door to the facility's locker-room configuration.
drop policy if exists facility_locker_rooms_select
  on public.facility_locker_rooms;
create policy facility_locker_rooms_select on public.facility_locker_rooms
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
    or (facility_id = public.current_facility_id()
        and exists (
          select 1
            from public.locker_room_cleaning_tasks task
           where task.facility_id = facility_locker_rooms.facility_id
             and task.locker_room_id = facility_locker_rooms.id
             and task.assigned_employee_id = public.current_employee_id()
        ))
  );

commit;
