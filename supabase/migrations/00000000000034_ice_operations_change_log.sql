-- =============================================================================
-- 00000000000034_ice_operations_change_log.sql
--
-- Append-only change log for ice operation report corrections.
-- =============================================================================

-- report_id originally FK'd to public.ice_operation_reports (phantom; real
-- table is public.ice_operations_submissions). On environments without the
-- phantom table, create the column without an FK; migration 61 binds the FK
-- to the real table.
do $$
begin
  if to_regclass('public.ice_operation_reports') is not null then
    create table if not exists public.ice_operation_change_log (
      id              uuid        primary key default gen_random_uuid(),
      facility_id     uuid        not null references public.facilities(id) on delete restrict,
      report_id       uuid        not null references public.ice_operation_reports(id) on delete cascade,
      changed_by      uuid        not null references public.employees(id) on delete restrict,
      reason          text        not null,
      before          jsonb       not null default '{}'::jsonb,
      after           jsonb       not null default '{}'::jsonb,
      created_at      timestamptz not null default now()
    );
  else
    create table if not exists public.ice_operation_change_log (
      id              uuid        primary key default gen_random_uuid(),
      facility_id     uuid        not null references public.facilities(id) on delete restrict,
      report_id       uuid        not null,
      changed_by      uuid        not null references public.employees(id) on delete restrict,
      reason          text        not null,
      before          jsonb       not null default '{}'::jsonb,
      after           jsonb       not null default '{}'::jsonb,
      created_at      timestamptz not null default now()
    );
  end if;
end$$;

comment on table public.ice_operation_change_log is
  'Append-only correction log for ice operation reports. '
  'Original report rows are immutable; all changes are recorded here.';

create index if not exists idx_ice_operation_change_log_facility_id
  on public.ice_operation_change_log (facility_id);
create index if not exists idx_ice_operation_change_log_report_id
  on public.ice_operation_change_log (report_id);
create index if not exists idx_ice_operation_change_log_changed_by
  on public.ice_operation_change_log (changed_by);
create index if not exists idx_ice_operation_change_log_created_at
  on public.ice_operation_change_log (created_at desc);

-- RLS
alter table public.ice_operation_change_log enable row level security;

drop policy if exists ice_operation_change_log_select on public.ice_operation_change_log;
create policy ice_operation_change_log_select on public.ice_operation_change_log
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists ice_operation_change_log_insert on public.ice_operation_change_log;
create policy ice_operation_change_log_insert on public.ice_operation_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('ice_operations', 'submit')
    )
  );

-- No UPDATE or DELETE: append-only
