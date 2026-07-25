-- =============================================================================
-- 00000000000213_audit_two_phase_destruction.sql
--
-- Two-phase destruction for audit logs (review decision A3).
--
-- Until now the retention purge hard-DELETEd expired audit rows — if it ever
-- ran against the wrong records there was no version of "oops" that got them
-- back. The purge now MOVES expired rows into a quarantine table
-- (audit_logs_pending_destruction), grouped into per-facility destruction
-- batches. Rows stay fully recoverable there until TWO DIFFERENT admins
-- approve the batch's destruction (mirroring the schedule publish-request
-- two-person rule); a single admin can instead cancel the batch, which
-- restores every row to audit_logs unchanged (original id and created_at).
--
-- Scope is deliberately audit_logs only (user decision): other module purges
-- keep their direct per-facility keep_days behavior.
--
-- RLS: both tables are SELECT-only for facility admins / super admins; there
-- are NO insert/update/delete policies — every mutation flows through the
-- SECURITY DEFINER functions below, which self-audit into audit_logs.
-- =============================================================================

create table if not exists public.audit_destruction_batches (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  staged_count  integer not null default 0,
  status        text not null default 'staged'
                  check (status in ('staged', 'destroyed', 'cancelled')),
  -- Two-person destruction rule: both approvals recorded, must differ.
  approved_by_1 uuid references public.users(id) on delete set null,
  approved_at_1 timestamptz,
  approved_by_2 uuid references public.users(id) on delete set null,
  approved_at_2 timestamptz,
  destroyed_at  timestamptz,
  cancelled_by  uuid references public.users(id) on delete set null,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint audit_destruction_two_person
    check (approved_by_2 is null
           or approved_by_1 is null
           or approved_by_2 <> approved_by_1)
);

comment on table public.audit_destruction_batches is
  'One row per retention-purge staging run per facility. Audit rows moved to '
  'audit_logs_pending_destruction reference a batch; destroying the batch '
  'requires two different admins (approve RPC), cancelling restores the rows.';

create index if not exists idx_audit_destruction_batches_facility
  on public.audit_destruction_batches (facility_id, status, created_at desc);

-- Quarantine copy of expired audit rows. Column-for-column copy of
-- audit_logs plus provenance. Actor columns are PLAIN uuids on purpose —
-- morgue rows must never block deleting a user/employee.
create table if not exists public.audit_logs_pending_destruction (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null
                        references public.audit_destruction_batches(id)
                        on delete restrict,
  original_id         uuid not null,
  facility_id         uuid not null,
  actor_user_id       uuid,
  actor_employee_id   uuid,
  action              text not null,
  entity_type         text not null,
  entity_id           uuid,
  before              jsonb,
  after               jsonb,
  ip                  inet,
  user_agent          text,
  original_created_at timestamptz not null,
  staged_at           timestamptz not null default now()
);

comment on table public.audit_logs_pending_destruction is
  'Expired audit_logs rows staged for destruction ("the locked bin"). Fully '
  'restorable until the owning batch gets its second destruction approval.';

create index if not exists idx_audit_pending_destruction_batch
  on public.audit_logs_pending_destruction (batch_id);
create index if not exists idx_audit_pending_destruction_facility
  on public.audit_logs_pending_destruction (facility_id, original_created_at);

alter table public.audit_destruction_batches enable row level security;
alter table public.audit_logs_pending_destruction enable row level security;

drop policy if exists audit_destruction_batches_select on public.audit_destruction_batches;
create policy audit_destruction_batches_select
  on public.audit_destruction_batches
  for select to authenticated
  using (public.is_super_admin() or public.is_facility_admin(facility_id));

drop policy if exists audit_pending_destruction_select on public.audit_logs_pending_destruction;
create policy audit_pending_destruction_select
  on public.audit_logs_pending_destruction
  for select to authenticated
  using (public.is_super_admin() or public.is_facility_admin(facility_id));

-- No INSERT/UPDATE/DELETE policies: append/restore/destroy only via the
-- SECURITY DEFINER functions below.

-- -----------------------------------------------------------------------------
-- Staging helper shared by both purge paths: move expired audit rows for one
-- facility into a new batch. Returns staged count (0 = nothing expired, no
-- batch created).
-- -----------------------------------------------------------------------------
create or replace function public.stage_audit_logs_for_destruction(
  p_facility_id uuid,
  p_cutoff      timestamptz
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch uuid;
  v_n     integer;
begin
  select count(*) into v_n
    from public.audit_logs
   where facility_id = p_facility_id
     and created_at < p_cutoff;
  if v_n = 0 then
    return 0;
  end if;

  insert into public.audit_destruction_batches (facility_id, staged_count)
  values (p_facility_id, v_n)
  returning id into v_batch;

  with moved as (
    delete from public.audit_logs
     where facility_id = p_facility_id
       and created_at < p_cutoff
     returning *
  )
  insert into public.audit_logs_pending_destruction
    (batch_id, original_id, facility_id, actor_user_id, actor_employee_id,
     action, entity_type, entity_id, before, after, ip, user_agent,
     original_created_at)
  select v_batch, id, facility_id, actor_user_id, actor_employee_id,
         action, entity_type, entity_id, before, after, ip, user_agent,
         created_at
    from moved;

  return v_n;
end;
$$;

revoke execute on function public.stage_audit_logs_for_destruction(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.stage_audit_logs_for_destruction(uuid, timestamptz)
  to service_role;

-- -----------------------------------------------------------------------------
-- Nightly worker: unchanged signature; now STAGES instead of deleting.
-- -----------------------------------------------------------------------------
create or replace function public.purge_old_audit_logs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staged integer := 0;
  f        record;
begin
  for f in
    select fac.id,
           coalesce(rs.keep_days, 2555) as keep_days
      from public.facilities fac
      left join public.retention_settings rs
        on rs.facility_id = fac.id
       and rs.module_key  = 'audit_logs'
  loop
    if f.keep_days = 0 then
      continue; -- Forever (no purge)
    end if;
    v_staged := v_staged + public.stage_audit_logs_for_destruction(
      f.id,
      now() - make_interval(days => greatest(f.keep_days, 2555)));
  end loop;
  return v_staged;
end;
$$;

revoke execute on function public.purge_old_audit_logs() from public, anon, authenticated;
grant  execute on function public.purge_old_audit_logs() to service_role;

comment on function public.purge_old_audit_logs() is
  'Retention worker for audit_logs. Per-facility window from retention_settings '
  '(module_key=audit_logs), default 7 years, hard floor 2555 days (0 = never). '
  'Since migration 213 it STAGES expired rows into '
  'audit_logs_pending_destruction (recoverable) instead of deleting; actual '
  'destruction requires two-admin approval. Service-role only.';

-- Manual per-facility purge: audit branch stages through the same helper.
-- Body otherwise identical to live (migration 212 version).
CREATE OR REPLACE FUNCTION public.purge_module_data(p_facility_id uuid, p_module_key text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_keep_days integer;
  v_cutoff    timestamptz;
  v_deleted   integer;
  v_total     integer := 0;
begin
  if not (
    public.is_super_admin()
    or public.is_facility_admin(p_facility_id)
  ) then
    raise exception 'Not authorized to purge data for this facility.';
  end if;

  if p_module_key = 'scheduling' then
    raise exception 'Manual purge is not supported for scheduling.';
  end if;

  if p_module_key = 'audit_logs' then
    -- Compliance window: per-facility retention_settings (default 7 years),
    -- clamped to the 2555-day floor; keep_days = 0 disables purging
    -- (migration 212). Since migration 213 expired rows are STAGED into
    -- audit_logs_pending_destruction (recoverable until two admins approve
    -- destruction) instead of deleted.
    select keep_days into v_keep_days
      from public.retention_settings
     where facility_id = p_facility_id
       and module_key  = 'audit_logs';
    v_keep_days := coalesce(v_keep_days, 2555);
    if v_keep_days = 0 then
      return 0;
    end if;
    return public.stage_audit_logs_for_destruction(
      p_facility_id,
      now() - make_interval(days => greatest(v_keep_days, 2555)));
  end if;

  select keep_days into v_keep_days
    from public.retention_settings
   where facility_id = p_facility_id
     and module_key = p_module_key;

  if v_keep_days is null then
    raise exception 'No retention rule configured for this module. Save one first.';
  end if;
  if v_keep_days = 0 then
    raise exception 'Retention for this module is set to keep records forever.';
  end if;

  v_cutoff := now() - (v_keep_days || ' days')::interval;

  case p_module_key
    when 'daily_reports' then
      delete from public.daily_report_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'communications' then
      delete from public.communication_messages
       where facility_id = p_facility_id and sent_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_alerts
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_audit_log
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'accident_reports' then
      delete from public.accident_reports
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'incident_reports' then
      delete from public.incident_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'refrigeration' then
      delete from public.refrigeration_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'air_quality' then
      delete from public.air_quality_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_operations' then
      delete from public.ice_operations_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_depth' then
      delete from public.ice_depth_sessions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    else
      raise exception 'Unknown module key: %', p_module_key;
  end case;

  return v_total;
end;
$function$
;

-- -----------------------------------------------------------------------------
-- Approval RPC. First call records approval #1; a second call by a DIFFERENT
-- admin destroys the batch's rows atomically. Self-second-approval refused.
-- -----------------------------------------------------------------------------
create or replace function public.approve_audit_destruction(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.audit_destruction_batches%rowtype;
  v_uid   uuid := auth.uid();
  v_n     integer;
begin
  select * into v_batch
    from public.audit_destruction_batches
   where id = p_batch_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Batch not found.');
  end if;
  if not (public.is_super_admin() or public.is_facility_admin(v_batch.facility_id)) then
    raise exception 'approve_audit_destruction: admin access required'
      using errcode = '42501';
  end if;
  if v_batch.status <> 'staged' then
    return jsonb_build_object('ok', false, 'error',
      format('Batch is already %s.', v_batch.status));
  end if;

  if v_batch.approved_by_1 is null then
    update public.audit_destruction_batches
       set approved_by_1 = v_uid,
           approved_at_1 = now()
     where id = p_batch_id;
    insert into public.audit_logs
      (facility_id, actor_user_id, actor_employee_id, action, entity_type, entity_id, after)
    values
      (v_batch.facility_id, v_uid, public.current_employee_id(),
       'audit_destruction.approve_first', 'audit_destruction_batches', p_batch_id,
       jsonb_build_object('staged_count', v_batch.staged_count));
    return jsonb_build_object('ok', true, 'state', 'pending_second_approval');
  end if;

  if v_batch.approved_by_1 = v_uid then
    return jsonb_build_object('ok', false, 'error',
      'Destruction requires a second approval from a DIFFERENT admin.');
  end if;

  -- Second, distinct approver: destroy.
  delete from public.audit_logs_pending_destruction
   where batch_id = p_batch_id;
  get diagnostics v_n = row_count;

  update public.audit_destruction_batches
     set approved_by_2 = v_uid,
         approved_at_2 = now(),
         status        = 'destroyed',
         destroyed_at  = now()
   where id = p_batch_id;

  insert into public.audit_logs
    (facility_id, actor_user_id, actor_employee_id, action, entity_type, entity_id, after)
  values
    (v_batch.facility_id, v_uid, public.current_employee_id(),
     'audit_destruction.execute', 'audit_destruction_batches', p_batch_id,
     jsonb_build_object('destroyed_count', v_n,
                        'first_approved_by', v_batch.approved_by_1));

  return jsonb_build_object('ok', true, 'state', 'destroyed', 'destroyed_count', v_n);
end;
$$;

revoke execute on function public.approve_audit_destruction(uuid) from public, anon;
grant  execute on function public.approve_audit_destruction(uuid) to authenticated, service_role;

comment on function public.approve_audit_destruction(uuid) is
  'Two-person destruction of a staged audit batch: first call records '
  'approval, a second call by a DIFFERENT facility admin deletes the '
  'quarantined rows. Self-second-approval refused. Both steps self-audit.';

-- -----------------------------------------------------------------------------
-- Cancel RPC: restore every quarantined row (original id + created_at) and
-- close the batch. Any single admin may cancel — recovery is the safe
-- direction and needs no second signature.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_audit_destruction(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.audit_destruction_batches%rowtype;
  v_uid   uuid := auth.uid();
  v_n     integer;
begin
  select * into v_batch
    from public.audit_destruction_batches
   where id = p_batch_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Batch not found.');
  end if;
  if not (public.is_super_admin() or public.is_facility_admin(v_batch.facility_id)) then
    raise exception 'cancel_audit_destruction: admin access required'
      using errcode = '42501';
  end if;
  if v_batch.status <> 'staged' then
    return jsonb_build_object('ok', false, 'error',
      format('Batch is already %s.', v_batch.status));
  end if;

  with restored as (
    delete from public.audit_logs_pending_destruction
     where batch_id = p_batch_id
     returning *
  )
  insert into public.audit_logs
    (id, facility_id, actor_user_id, actor_employee_id, action, entity_type,
     entity_id, before, after, ip, user_agent, created_at)
  select original_id, facility_id, actor_user_id, actor_employee_id, action,
         entity_type, entity_id, before, after, ip, user_agent,
         original_created_at
    from restored;
  get diagnostics v_n = row_count;

  update public.audit_destruction_batches
     set status       = 'cancelled',
         cancelled_by = v_uid,
         cancelled_at = now()
   where id = p_batch_id;

  insert into public.audit_logs
    (facility_id, actor_user_id, actor_employee_id, action, entity_type, entity_id, after)
  values
    (v_batch.facility_id, v_uid, public.current_employee_id(),
     'audit_destruction.cancel', 'audit_destruction_batches', p_batch_id,
     jsonb_build_object('restored_count', v_n));

  return jsonb_build_object('ok', true, 'state', 'cancelled', 'restored_count', v_n);
end;
$$;

revoke execute on function public.cancel_audit_destruction(uuid) from public, anon;
grant  execute on function public.cancel_audit_destruction(uuid) to authenticated, service_role;

comment on function public.cancel_audit_destruction(uuid) is
  'Restores every row of a staged audit-destruction batch back into '
  'audit_logs (original id and created_at preserved) and closes the batch. '
  'Single-admin: recovery is the safe direction.';
