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
