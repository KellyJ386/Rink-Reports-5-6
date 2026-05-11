-- =============================================================================
-- 00000000000031_offline_sync_queue.sql
--
-- Offline submission queue for PWA support.
--
-- When a staff member submits a report while offline, the service worker
-- stores the payload in IndexedDB. When connectivity is restored, the SW
-- replays the queue FIFO (by started_at) against this table's upsert endpoint.
--
-- local_id (client-generated UUID) is used for deduplication: if the same
-- payload is replayed twice (e.g. after a forced SW restart), the ON CONFLICT
-- clause on local_id is a no-op.
-- =============================================================================

create table if not exists public.offline_sync_queue (
  id             uuid        primary key default gen_random_uuid(),
  local_id       uuid        not null unique,           -- client-generated; dedup key
  facility_id    uuid        not null references public.facilities(id) on delete restrict,
  employee_id    uuid        not null references public.employees(id)  on delete cascade,
  module_key     text        not null,
  action         text        not null default 'submit', -- 'submit' | 'update'
  payload        jsonb       not null default '{}'::jsonb,
  sync_status    text        not null default 'pending'
                             check (sync_status in ('pending', 'synced', 'failed')),
  retry_count    int         not null default 0,
  error_message  text,
  started_at     timestamptz not null default now(),    -- when client queued this
  synced_at      timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.offline_sync_queue is
  'FIFO queue for submissions captured offline. Rows are inserted by the SW '
  'sync handler and marked synced/failed after server-side processing. '
  'local_id prevents duplicate inserts on replay.';

comment on column public.offline_sync_queue.local_id is
  'Client-generated UUID. The service worker sets this before going offline. '
  'ON CONFLICT(local_id) DO NOTHING prevents double-submission on replay.';

comment on column public.offline_sync_queue.started_at is
  'Timestamp set on the client when the form was submitted. '
  'Used for FIFO ordering during sync replay.';

create index if not exists idx_offline_sync_queue_facility_id
  on public.offline_sync_queue (facility_id);
create index if not exists idx_offline_sync_queue_employee_id
  on public.offline_sync_queue (employee_id);
create index if not exists idx_offline_sync_queue_sync_status
  on public.offline_sync_queue (sync_status);
create index if not exists idx_offline_sync_queue_started_at
  on public.offline_sync_queue (started_at asc);

-- RLS
alter table public.offline_sync_queue enable row level security;

-- Staff can see their own pending queue items
drop policy if exists offline_sync_queue_select on public.offline_sync_queue;
create policy offline_sync_queue_select on public.offline_sync_queue
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        -- Own items
        employee_id in (
          select id from public.employees
          where user_id = auth.uid() and is_active = true
        )
        -- Admins can see all facility items
        or public.current_user_role() in ('admin', 'gm', 'super_admin')
      )
    )
  );

-- Only the owning employee (or admin) may insert
drop policy if exists offline_sync_queue_insert on public.offline_sync_queue;
create policy offline_sync_queue_insert on public.offline_sync_queue
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and employee_id in (
        select id from public.employees
        where user_id = auth.uid() and is_active = true
      )
    )
  );

-- SW sync handler may update status (pending → synced/failed)
drop policy if exists offline_sync_queue_update on public.offline_sync_queue;
create policy offline_sync_queue_update on public.offline_sync_queue
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and employee_id in (
        select id from public.employees
        where user_id = auth.uid() and is_active = true
      )
    )
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- Only super admin may hard-delete queue rows
drop policy if exists offline_sync_queue_delete on public.offline_sync_queue;
create policy offline_sync_queue_delete on public.offline_sync_queue
  for delete to authenticated
  using (public.is_super_admin());
