-- Permit an assigned employee to complete their own locker-room task without
-- granting the Scheduling modules or allowing assignment/context changes.

begin;

create or replace function public.guard_employee_cleaning_task_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Managers use the existing module-edit policy and retain the full workflow.
  -- Direct maintenance/trigger work does not run as the API's authenticated
  -- role and is likewise outside this employee-only guard.
  if current_user = 'authenticated'
     and not public.is_super_admin()
     and not public.has_module_edit_access('rink_scheduling') then
    if old.assigned_employee_id is distinct from public.current_employee_id()
       or new.assigned_employee_id is distinct from old.assigned_employee_id
       or new.facility_id is distinct from old.facility_id
       or new.locker_room_id is distinct from old.locker_room_id
       or new.scheduled_for is distinct from old.scheduled_for
       or new.assignment_route is distinct from old.assignment_route
       or new.created_at is distinct from old.created_at
       or old.status <> 'scheduled'
       or new.status <> 'completed'
       or new.completed_by is distinct from public.current_employee_id()
       or new.completed_at is null
       or new.cancelled_at is distinct from old.cancelled_at
       or new.cancellation_reason is distinct from old.cancellation_reason
       or new.change_origin <> 'employee' then
      raise exception 'assigned employees may only complete their own cleaning task'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_employee_cleaning_task_update()
  from public, anon, authenticated;

drop trigger if exists trg_guard_employee_cleaning_task_update
  on public.locker_room_cleaning_tasks;
create trigger trg_guard_employee_cleaning_task_update
  before update on public.locker_room_cleaning_tasks
  for each row execute function public.guard_employee_cleaning_task_update();

drop policy if exists locker_room_cleaning_tasks_employee_complete
  on public.locker_room_cleaning_tasks;
create policy locker_room_cleaning_tasks_employee_complete
  on public.locker_room_cleaning_tasks
  for update to authenticated
  using (
    facility_id = public.current_facility_id()
    and assigned_employee_id = public.current_employee_id()
    and status = 'scheduled'
  )
  with check (
    facility_id = public.current_facility_id()
    and assigned_employee_id = public.current_employee_id()
    and completed_by = public.current_employee_id()
    and status = 'completed'
    and completed_at is not null
    and change_origin = 'employee'
  );

commit;
