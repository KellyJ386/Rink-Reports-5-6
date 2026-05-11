-- =============================================================================
-- 00000000000033_air_quality_change_log.sql
--
-- Append-only change log for air quality submission corrections.
-- =============================================================================

create table if not exists public.air_quality_change_log (
  id              uuid        primary key default gen_random_uuid(),
  facility_id     uuid        not null references public.facilities(id) on delete restrict,
  submission_id   uuid        not null references public.air_quality_submissions(id) on delete cascade,
  changed_by      uuid        not null references public.employees(id) on delete restrict,
  reason          text        not null,
  before          jsonb       not null default '{}'::jsonb,
  after           jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.air_quality_change_log is
  'Append-only correction log for air quality submissions. '
  'Original submission rows are immutable; all changes are recorded here.';

create index if not exists idx_air_quality_change_log_facility_id
  on public.air_quality_change_log (facility_id);
create index if not exists idx_air_quality_change_log_submission_id
  on public.air_quality_change_log (submission_id);
create index if not exists idx_air_quality_change_log_changed_by
  on public.air_quality_change_log (changed_by);
create index if not exists idx_air_quality_change_log_created_at
  on public.air_quality_change_log (created_at desc);

-- RLS
alter table public.air_quality_change_log enable row level security;

drop policy if exists air_quality_change_log_select on public.air_quality_change_log;
create policy air_quality_change_log_select on public.air_quality_change_log
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists air_quality_change_log_insert on public.air_quality_change_log;
create policy air_quality_change_log_insert on public.air_quality_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('air_quality', 'submit')
    )
  );

-- No UPDATE or DELETE: append-only
