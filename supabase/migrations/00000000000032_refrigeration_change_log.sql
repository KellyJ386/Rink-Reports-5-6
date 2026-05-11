-- =============================================================================
-- 00000000000032_refrigeration_change_log.sql
--
-- Append-only change log for refrigeration report corrections.
-- When a submitted refrigeration report requires a correction, a row is
-- inserted here capturing the before/after state and reason. The original
-- report row is NOT edited (immutability rule).
-- =============================================================================

create table if not exists public.refrigeration_change_log (
  id              uuid        primary key default gen_random_uuid(),
  facility_id     uuid        not null references public.facilities(id) on delete restrict,
  report_id       uuid        not null references public.refrigeration_reports(id) on delete cascade,
  changed_by      uuid        not null references public.employees(id) on delete restrict,
  reason          text        not null,
  before          jsonb       not null default '{}'::jsonb,
  after           jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.refrigeration_change_log is
  'Append-only correction log for refrigeration reports. '
  'Original report rows are immutable; all changes are recorded here.';

create index if not exists idx_refrigeration_change_log_facility_id
  on public.refrigeration_change_log (facility_id);
create index if not exists idx_refrigeration_change_log_report_id
  on public.refrigeration_change_log (report_id);
create index if not exists idx_refrigeration_change_log_changed_by
  on public.refrigeration_change_log (changed_by);
create index if not exists idx_refrigeration_change_log_created_at
  on public.refrigeration_change_log (created_at desc);

-- RLS
alter table public.refrigeration_change_log enable row level security;

drop policy if exists refrigeration_change_log_select on public.refrigeration_change_log;
create policy refrigeration_change_log_select on public.refrigeration_change_log
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- Any active facility member who has refrigeration submit permission may log a correction
drop policy if exists refrigeration_change_log_insert on public.refrigeration_change_log;
create policy refrigeration_change_log_insert on public.refrigeration_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('refrigeration', 'submit')
    )
  );

-- No UPDATE or DELETE: change log rows are immutable
