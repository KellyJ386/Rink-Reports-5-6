-- =============================================================================
-- 00000000000035_ice_depth_change_log.sql
--
-- Append-only change log for ice depth session corrections.
-- Ice depth sessions capture multiple cell readings per session.
-- When a reading needs correction, a log entry is inserted here.
-- =============================================================================

create table if not exists public.ice_depth_change_log (
  id              uuid        primary key default gen_random_uuid(),
  facility_id     uuid        not null references public.facilities(id) on delete restrict,
  session_id      uuid        not null references public.ice_depth_sessions(id) on delete cascade,
  changed_by      uuid        not null references public.employees(id) on delete restrict,
  reason          text        not null,
  before          jsonb       not null default '{}'::jsonb,
  after           jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.ice_depth_change_log is
  'Append-only correction log for ice depth sessions. '
  'Original session and cell value rows are immutable; corrections are logged here.';

create index if not exists idx_ice_depth_change_log_facility_id
  on public.ice_depth_change_log (facility_id);
create index if not exists idx_ice_depth_change_log_session_id
  on public.ice_depth_change_log (session_id);
create index if not exists idx_ice_depth_change_log_changed_by
  on public.ice_depth_change_log (changed_by);
create index if not exists idx_ice_depth_change_log_created_at
  on public.ice_depth_change_log (created_at desc);

-- RLS
alter table public.ice_depth_change_log enable row level security;

drop policy if exists ice_depth_change_log_select on public.ice_depth_change_log;
create policy ice_depth_change_log_select on public.ice_depth_change_log
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists ice_depth_change_log_insert on public.ice_depth_change_log;
create policy ice_depth_change_log_insert on public.ice_depth_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_permission('ice_depth', 'submit')
    )
  );

-- No UPDATE or DELETE: append-only
