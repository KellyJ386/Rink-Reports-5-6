-- =============================================================================
-- 00000000000040_schedule_publish_requests.sql
--
-- Phase 6 of the Admin Control Center redesign: introduces a request /
-- approval lifecycle for schedule publishing so the same person cannot
-- both request and approve a publish (defense in depth at both RLS and
-- the server action layer).
--
-- Lifecycle:
--   pending  -> published   (approved by a different admin)
--   pending  -> rejected    (rejected by a different admin)
--
-- The existing schedule_publish_events table remains the append-only audit
-- of *successful* publishes. This table is the gate that produces those
-- events.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'schedule_publish_request_status') then
    create type public.schedule_publish_request_status as enum (
      'pending', 'rejected', 'published'
    );
  end if;
end$$;

create table if not exists public.schedule_publish_requests (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  requested_by_employee_id    uuid not null references public.employees(id) on delete restrict,
  range_starts_at             timestamptz not null,
  range_ends_at               timestamptz not null,
  notes                       text,
  status                      public.schedule_publish_request_status not null default 'pending',
  decided_by_employee_id      uuid references public.employees(id) on delete set null,
  decided_at                  timestamptz,
  rejection_reason            text,
  published_event_id          uuid references public.schedule_publish_events(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz,
  constraint schedule_publish_requests_range_chk
    check (range_ends_at > range_starts_at),
  constraint schedule_publish_requests_decision_chk
    check (
      (status = 'pending'   and decided_by_employee_id is null and decided_at is null)
      or
      (status <> 'pending'  and decided_by_employee_id is not null and decided_at is not null)
    ),
  constraint schedule_publish_requests_no_self_approve
    check (
      status = 'pending'
      or decided_by_employee_id <> requested_by_employee_id
    )
);

comment on table public.schedule_publish_requests is
  'Two-person rule gate for scheduling publish. A request is created by '
  'someone with scheduling >= submit; approval (which triggers the publish) '
  'or rejection must be performed by a different employee with '
  'scheduling >= publish.';

create index if not exists idx_schedule_publish_requests_facility_status
  on public.schedule_publish_requests (facility_id, status, created_at desc);
create index if not exists idx_schedule_publish_requests_requester
  on public.schedule_publish_requests (requested_by_employee_id);

drop trigger if exists trg_schedule_publish_requests_updated_at
  on public.schedule_publish_requests;
create trigger trg_schedule_publish_requests_updated_at
  before update on public.schedule_publish_requests
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.schedule_publish_requests enable row level security;

drop policy if exists schedule_publish_requests_select
  on public.schedule_publish_requests;
create policy schedule_publish_requests_select
  on public.schedule_publish_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('scheduling')
            >= 'view'::module_permission_level
    )
  );

drop policy if exists schedule_publish_requests_insert
  on public.schedule_publish_requests;
create policy schedule_publish_requests_insert
  on public.schedule_publish_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('scheduling')
            >= 'submit'::module_permission_level
      and requested_by_employee_id = public.current_employee_id()
      and status = 'pending'
      and decided_by_employee_id is null
      and decided_at is null
    )
  );

-- UPDATE: only a *different* employee with publish-or-higher may transition
-- a pending request out of pending. The CHECK constraint additionally
-- enforces the two-person rule at the row level (defense in depth).
drop policy if exists schedule_publish_requests_update
  on public.schedule_publish_requests;
create policy schedule_publish_requests_update
  on public.schedule_publish_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('scheduling')
            >= 'publish'::module_permission_level
      and requested_by_employee_id <> public.current_employee_id()
      and status = 'pending'
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('scheduling')
            >= 'publish'::module_permission_level
      and requested_by_employee_id <> public.current_employee_id()
      and status in ('published', 'rejected')
      and decided_by_employee_id = public.current_employee_id()
    )
  );

-- No DELETE policy: requests are immutable history. If wrong, reject with a note.
