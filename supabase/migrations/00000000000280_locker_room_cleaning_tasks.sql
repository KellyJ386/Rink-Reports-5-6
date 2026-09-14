-- =============================================================================
-- Audit locker-room cleaning task lifecycle changes.
--
-- The generic audit trigger is deliberately used here, as it is for the other
-- operational tables: it takes facility_id from the changed row, records the
-- authenticated user/employee when there is one, and stores the complete
-- before/after images.  Reconciliation jobs run without an auth JWT, so their
-- audit rows intentionally have NULL actor columns; change_origin preserves an
-- explicit, queryable system/trigger attribution in the audited row image.
-- =============================================================================

begin;

create table if not exists public.locker_room_cleaning_tasks (
  id                    uuid primary key default gen_random_uuid(),
  facility_id           uuid not null references public.facilities(id) on delete restrict,
  locker_room_id        uuid not null,
  booking_id            uuid,
  locker_room_assignment_id uuid,
  scheduled_for         timestamptz not null,
  assigned_employee_id  uuid,
  assignment_route      text,
  status                text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled')),
  completed_at          timestamptz,
  completed_by          uuid,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  change_origin         text not null default 'trigger'
    check (change_origin in ('employee', 'manager', 'system', 'trigger')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint locker_room_cleaning_tasks_id_facility_uniq unique (id, facility_id),
  constraint locker_room_cleaning_tasks_room_fk
    foreign key (locker_room_id, facility_id)
    references public.facility_locker_rooms (id, facility_id) on delete restrict,
  constraint locker_room_cleaning_tasks_booking_fk
    foreign key (booking_id, facility_id)
    references public.rink_bookings (id, facility_id) on delete cascade,
  constraint locker_room_cleaning_tasks_assignment_fk
    foreign key (locker_room_assignment_id, facility_id)
    references public.rink_locker_room_assignments (id, facility_id) on delete cascade,
  constraint locker_room_cleaning_tasks_assignee_fk
    foreign key (assigned_employee_id, facility_id)
    references public.employees (id, facility_id) on delete set null (assigned_employee_id),
  constraint locker_room_cleaning_tasks_completed_by_fk
    foreign key (completed_by, facility_id)
    references public.employees (id, facility_id) on delete set null (completed_by),
  constraint locker_room_cleaning_tasks_lifecycle_chk check (
    (status = 'completed' and completed_at is not null and completed_by is not null
                          and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null
                           and completed_by is null)
    or (status = 'scheduled' and completed_at is null and completed_by is null
                           and cancelled_at is null)
  )
);

comment on table public.locker_room_cleaning_tasks is
  'Facility-scoped locker-room cleaning work. Every lifecycle mutation is copied to audit_logs by trg_audit_locker_room_cleaning_tasks.';
comment on column public.locker_room_cleaning_tasks.change_origin is
  'Origin copied into the audit before/after image: employee, manager, system, or trigger. Automated reconciliation must set system or trigger.';

create index if not exists idx_locker_room_cleaning_tasks_facility_schedule
  on public.locker_room_cleaning_tasks (facility_id, scheduled_for);

create unique index if not exists idx_locker_room_cleaning_tasks_active_assignment
  on public.locker_room_cleaning_tasks (locker_room_assignment_id)
  where locker_room_assignment_id is not null and status = 'scheduled';

-- Keep the derived cleaning work in lockstep with the booking.  A tentative
-- booking is deliberately treated just like any other inactive source record:
-- it cannot create active work and a demotion from confirmed cancels both the
-- scheduled task and any notification which has not left the outbox yet.
create or replace function public.reconcile_locker_room_cleaning_task(
  p_assignment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.rink_locker_room_assignments%rowtype;
  v_booking public.rink_bookings%rowtype;
  v_task_id uuid;
begin
  select * into v_assignment
    from public.rink_locker_room_assignments
   where id = p_assignment_id;

  if found then
    select * into v_booking
      from public.rink_bookings
     where id = v_assignment.booking_id
       and facility_id = v_assignment.facility_id;
  end if;

  if not found or v_booking.status <> 'confirmed' then
    update public.locker_room_cleaning_tasks
       set status = 'cancelled',
           cancelled_at = now(),
           cancellation_reason = 'source booking is not confirmed',
           change_origin = 'trigger'
     where locker_room_assignment_id = p_assignment_id
       and status = 'scheduled'
    returning id into v_task_id;

    if v_task_id is not null then
      update public.notification_outbox
         set status = 'cancelled'
       where source_module = 'locker_room_cleaning_tasks'
         and source_record_id = v_task_id
         and status = 'pending';
    end if;
    return;
  end if;

  select id into v_task_id
    from public.locker_room_cleaning_tasks
   where locker_room_assignment_id = p_assignment_id
     and status = 'scheduled';

  if v_task_id is null then
    insert into public.locker_room_cleaning_tasks
      (facility_id, locker_room_id, booking_id, locker_room_assignment_id,
       scheduled_for, change_origin)
    values
      (v_assignment.facility_id, v_assignment.locker_room_id,
       v_assignment.booking_id, v_assignment.id,
       v_assignment.occupies_until, 'trigger');
  else
    update public.locker_room_cleaning_tasks
       set locker_room_id = v_assignment.locker_room_id,
           booking_id = v_assignment.booking_id,
           scheduled_for = v_assignment.occupies_until,
           change_origin = 'trigger'
     where id = v_task_id;
  end if;
end;
$$;

revoke execute on function public.reconcile_locker_room_cleaning_task(uuid)
  from public, anon, authenticated;

create or replace function public.reconcile_locker_room_cleaning_task_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment record;
begin
  if tg_table_name = 'rink_locker_room_assignments' then
    perform public.reconcile_locker_room_cleaning_task(coalesce(new.id, old.id));
  else
    for v_assignment in
      select id from public.rink_locker_room_assignments
       where booking_id = coalesce(new.id, old.id)
    loop
      perform public.reconcile_locker_room_cleaning_task(v_assignment.id);
    end loop;
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.reconcile_locker_room_cleaning_task_trigger()
  from public, anon, authenticated;

drop trigger if exists trg_reconcile_locker_room_cleaning_assignment
  on public.rink_locker_room_assignments;
create trigger trg_reconcile_locker_room_cleaning_assignment
  after insert or update on public.rink_locker_room_assignments
  for each row execute function public.reconcile_locker_room_cleaning_task_trigger();

drop trigger if exists trg_reconcile_locker_room_cleaning_booking
  on public.rink_bookings;
create trigger trg_reconcile_locker_room_cleaning_booking
  after update of status on public.rink_bookings
  for each row execute function public.reconcile_locker_room_cleaning_task_trigger();

-- Existing confirmed rentals receive tasks during rollout.
do $$
declare
  v_assignment record;
begin
  for v_assignment in
    select a.id
      from public.rink_locker_room_assignments a
      join public.rink_bookings b
        on b.id = a.booking_id and b.facility_id = a.facility_id
     where b.status = 'confirmed'
  loop
    perform public.reconcile_locker_room_cleaning_task(v_assignment.id);
  end loop;
end;
$$;

drop trigger if exists trg_locker_room_cleaning_tasks_updated_at
  on public.locker_room_cleaning_tasks;
create trigger trg_locker_room_cleaning_tasks_updated_at
  before update on public.locker_room_cleaning_tasks
  for each row execute function public.set_updated_at();

alter table public.locker_room_cleaning_tasks enable row level security;

drop policy if exists locker_room_cleaning_tasks_select
  on public.locker_room_cleaning_tasks;
create policy locker_room_cleaning_tasks_select on public.locker_room_cleaning_tasks
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists locker_room_cleaning_tasks_write
  on public.locker_room_cleaning_tasks;
create policy locker_room_cleaning_tasks_write on public.locker_room_cleaning_tasks
  for all to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop trigger if exists trg_audit_locker_room_cleaning_tasks
  on public.locker_room_cleaning_tasks;
create trigger trg_audit_locker_room_cleaning_tasks
  after insert or update or delete on public.locker_room_cleaning_tasks
  for each row execute function public.audit_row_change();

commit;
