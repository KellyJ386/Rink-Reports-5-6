-- =============================================================================
-- 00000000000214_audit_log_hash_chain.sql
--
-- Tamper-evident audit log (review project I-2): number the logbook pages.
--
-- Every audit_logs row now carries:
--   seq       — monotone per-table identity (chain ORDER; the old ordering
--               signals were a random uuid PK and tx-time created_at, whose
--               ties made chain order undefined),
--   prev_hash — the row_hash of the previous row in the SAME facility's
--               chain (null = genesis),
--   row_hash  — sha256 over prev_hash + the row's canonical payload.
--
-- A BEFORE INSERT trigger computes both under a per-facility advisory lock,
-- so BOTH insert paths (the audit_row_change() DML triggers and the app's
-- logAudit helper) are chained with no call-site changes. Tearing a page
-- out, rewriting one, or reordering now breaks the numbering:
-- verify_audit_chain() recomputes every hash and walks the linkage.
--
-- Interplay with two-phase destruction (migration 213): retention staging
-- legitimately removes chain links. At STAGING time the hash METADATA of the
-- moved rows ({seq, prev_hash, row_hash} — no payload) is archived on the
-- batch as chain_anchors, and verification "bridges" a linkage gap by
-- walking those archived hashes — so the chain verifies during the
-- staged-awaiting-approval window, after destruction, and across
-- cancel-restores (restored rows re-link at the tail; the anchors keep
-- explaining the historical gap). Destroyed content stays destroyed; the
-- numbering stays verifiable.
--
-- audit_logs is also now append-only AT THE TRIGGER LEVEL (UPDATE/DELETE
-- raise), closing the service-role/table-owner hole the RLS-omission model
-- left open. Governed staging sets a transaction-local bypass
-- (rr.audit_chain_bypass), same pattern as the schedule publish lock.
--
-- NOTE for the phase-5 partitioning plan (docs/phase5-partitioning-plan.md):
-- audit_logs is its pilot table. The chain trigger reads "previous row by
-- max seq per facility" — fine under range partitioning by created_at, but
-- revisit the advisory-lock key and the seq index when that lands.
-- =============================================================================

alter table public.audit_logs
  add column if not exists seq bigint generated always as identity,
  add column if not exists prev_hash text,
  add column if not exists row_hash  text;

create index if not exists idx_audit_logs_facility_seq
  on public.audit_logs (facility_id, seq desc);

-- sha256 → hex. search_path includes `extensions` because Supabase installs
-- pgcrypto there; falls back to public for stacks that installed it bare.
create or replace function public.audit_sha256(p_input text)
returns text
language sql
immutable
set search_path = extensions, public, pg_temp
as $$
  select encode(digest(convert_to(p_input, 'utf8'), 'sha256'), 'hex')
$$;

revoke execute on function public.audit_sha256(text) from public, anon;
grant  execute on function public.audit_sha256(text) to authenticated, service_role;

-- Canonical row hash. Timestamps hash as epoch (timestamptz::text renders in
-- the SESSION timezone and would make hashes environment-dependent).
create or replace function public.audit_row_chain_hash(
  p_prev_hash         text,
  p_facility_id       uuid,
  p_actor_user_id     uuid,
  p_actor_employee_id uuid,
  p_action            text,
  p_entity_type       text,
  p_entity_id         uuid,
  p_before            jsonb,
  p_after             jsonb,
  p_ip                inet,
  p_user_agent        text,
  p_created_at        timestamptz
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.audit_sha256(
    coalesce(p_prev_hash, 'genesis')
    || '|' || p_facility_id::text
    || '|' || coalesce(p_actor_user_id::text, '')
    || '|' || coalesce(p_actor_employee_id::text, '')
    || '|' || p_action
    || '|' || p_entity_type
    || '|' || coalesce(p_entity_id::text, '')
    || '|' || coalesce(p_before::text, '')
    || '|' || coalesce(p_after::text, '')
    || '|' || coalesce(p_ip::text, '')
    || '|' || coalesce(p_user_agent, '')
    || '|' || extract(epoch from p_created_at)::text)
$$;

revoke execute on function public.audit_row_chain_hash(text, uuid, uuid, uuid, text, text, uuid, jsonb, jsonb, inet, text, timestamptz)
  from public, anon;
grant execute on function public.audit_row_chain_hash(text, uuid, uuid, uuid, text, text, uuid, jsonb, jsonb, inet, text, timestamptz)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Chain trigger: BEFORE INSERT, per-facility advisory lock so concurrent
-- transactions can't fork the chain.
-- -----------------------------------------------------------------------------
create or replace function public.audit_logs_hash_chain()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('audit_chain:' || new.facility_id::text, 42));

  select row_hash into v_prev
    from public.audit_logs
   where facility_id = new.facility_id
   order by seq desc
   limit 1;

  new.prev_hash := v_prev;
  new.row_hash  := public.audit_row_chain_hash(
    v_prev, new.facility_id, new.actor_user_id, new.actor_employee_id,
    new.action, new.entity_type, new.entity_id, new.before, new.after,
    new.ip, new.user_agent, new.created_at);
  return new;
end;
$$;

drop trigger if exists trg_audit_logs_hash_chain on public.audit_logs;
create trigger trg_audit_logs_hash_chain
  before insert on public.audit_logs
  for each row execute function public.audit_logs_hash_chain();

-- -----------------------------------------------------------------------------
-- Backfill the existing rows, per facility in seq order (runs before the
-- append-only guard exists, so plain UPDATEs are fine here).
-- -----------------------------------------------------------------------------
do $$
declare
  r      record;
  v_prev text;
  v_fac  uuid;
  v_hash text;
begin
  v_fac := null;
  for r in
    select * from public.audit_logs order by facility_id, seq
  loop
    if v_fac is distinct from r.facility_id then
      v_prev := null;
      v_fac  := r.facility_id;
    end if;
    v_hash := public.audit_row_chain_hash(
      v_prev, r.facility_id, r.actor_user_id, r.actor_employee_id,
      r.action, r.entity_type, r.entity_id, r.before, r.after,
      r.ip, r.user_agent, r.created_at);
    update public.audit_logs
       set prev_hash = v_prev,
           row_hash  = v_hash
     where id = r.id;
    v_prev := v_hash;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Append-only guard: UPDATE/DELETE raise for EVERYONE (including
-- service_role and the table owner) unless the transaction-local governed
-- bypass is set. Only stage_audit_logs_for_destruction sets it.
-- -----------------------------------------------------------------------------
create or replace function public.audit_logs_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('rr.audit_chain_bypass', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception
    'audit_logs is append-only: % is not allowed (retention goes through the governed two-person destruction flow)',
    tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_audit_logs_append_only on public.audit_logs;
create trigger trg_audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_append_only();

-- -----------------------------------------------------------------------------
-- Destruction bookkeeping: quarantine keeps the chain columns; the batch
-- archives hash metadata (chain_anchors) at destruction time so verification
-- can bridge the destroyed span.
-- -----------------------------------------------------------------------------
alter table public.audit_logs_pending_destruction
  add column if not exists original_seq       bigint,
  add column if not exists original_prev_hash text,
  add column if not exists original_row_hash  text;

alter table public.audit_destruction_batches
  add column if not exists chain_anchors jsonb;

comment on column public.audit_destruction_batches.chain_anchors is
  'Hash metadata ({seq, prev_hash, row_hash}, no payload) of the rows this '
  'batch staged, archived at staging time — lets verify_audit_chain() bridge '
  'the gap while staged, after destruction, and across cancel-restores, '
  'without retaining destroyed content.';

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

  -- Governed bypass of the append-only guard (transaction-local), mirroring
  -- the schedule publish-lock pattern.
  perform set_config('rr.audit_chain_bypass', 'on', true);

  with moved as (
    delete from public.audit_logs
     where facility_id = p_facility_id
       and created_at < p_cutoff
     returning *
  )
  insert into public.audit_logs_pending_destruction
    (batch_id, original_id, facility_id, actor_user_id, actor_employee_id,
     action, entity_type, entity_id, before, after, ip, user_agent,
     original_created_at, original_seq, original_prev_hash, original_row_hash)
  select v_batch, id, facility_id, actor_user_id, actor_employee_id,
         action, entity_type, entity_id, before, after, ip, user_agent,
         created_at, seq, prev_hash, row_hash
    from moved;

  perform set_config('rr.audit_chain_bypass', '', true);

  -- Archive the chain anchors NOW (not at destruction) so verification can
  -- bridge the gap for as long as the batch exists in any state.
  update public.audit_destruction_batches b
     set chain_anchors = (
       select jsonb_agg(
                jsonb_build_object(
                  'seq', p.original_seq,
                  'prev_hash', p.original_prev_hash,
                  'row_hash', p.original_row_hash)
                order by p.original_seq)
         from public.audit_logs_pending_destruction p
        where p.batch_id = v_batch)
   where b.id = v_batch;

  return v_n;
end;
$$;

revoke execute on function public.stage_audit_logs_for_destruction(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.stage_audit_logs_for_destruction(uuid, timestamptz)
  to service_role;

-- Approve RPC: chain anchors are already archived at staging; the second
-- approval just destroys the quarantined rows.
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

  -- Second, distinct approver: destroy (anchors already on the batch).
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

-- (grants for approve_audit_destruction carry over from migration 213)

-- Cancel RPC: unchanged logic, but the restore INSERT flows through the
-- chain trigger, which re-links restored rows at the tail of the chain
-- (fresh seq/hashes; original id and created_at preserved).

-- -----------------------------------------------------------------------------
-- Verification: recompute every hash and walk the linkage in seq order.
-- A prev_hash that doesn't match the previous surviving row is bridged
-- through destroyed-batch chain_anchors (hash metadata) when possible;
-- otherwise it is reported as a break. Result:
--   { ok, checked, first_break_seq?, reason? }
-- -----------------------------------------------------------------------------
create or replace function public.verify_audit_chain(p_facility_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r          record;
  v_prev     text := null;   -- row_hash of the previous SURVIVING row
  v_checked  integer := 0;
  v_first    boolean := true;
  v_cursor   text;
  v_hop_prev text;
  v_hops     integer;
  v_bridged  boolean;
begin
  if not (public.is_super_admin() or public.is_facility_admin(p_facility_id)) then
    raise exception 'verify_audit_chain: admin access required'
      using errcode = '42501';
  end if;

  for r in
    select * from public.audit_logs
     where facility_id = p_facility_id
     order by seq
  loop
    -- Self-integrity: the stored row_hash must recompute from the stored
    -- prev_hash + payload. Catches any payload edit.
    if r.row_hash is distinct from public.audit_row_chain_hash(
         r.prev_hash, r.facility_id, r.actor_user_id, r.actor_employee_id,
         r.action, r.entity_type, r.entity_id, r.before, r.after,
         r.ip, r.user_agent, r.created_at) then
      return jsonb_build_object(
        'ok', false, 'checked', v_checked,
        'first_break_seq', r.seq, 'reason', 'row_hash mismatch (payload altered)');
    end if;

    -- Linkage: prev_hash must reach the previous surviving row's hash,
    -- possibly hopping backwards through destroyed-row hash metadata.
    if not v_first and r.prev_hash is distinct from v_prev then
      v_bridged := false;
      v_cursor  := r.prev_hash;
      v_hops    := 0;
      while v_cursor is not null and v_hops < 100000 loop
        select a->>'prev_hash' into v_hop_prev
          from public.audit_destruction_batches b
               cross join lateral jsonb_array_elements(coalesce(b.chain_anchors, '[]'::jsonb)) as a
         where b.facility_id = p_facility_id
           and a->>'row_hash' = v_cursor
         limit 1;
        if not found then
          exit; -- dead end: not a destroyed row we have metadata for
        end if;
        v_hops   := v_hops + 1;
        v_cursor := v_hop_prev;
        if v_cursor is not distinct from v_prev then
          v_bridged := true;
          exit;
        end if;
      end loop;
      if not v_bridged then
        return jsonb_build_object(
          'ok', false, 'checked', v_checked,
          'first_break_seq', r.seq,
          'reason', 'prev_hash linkage broken (row missing or reordered)');
      end if;
    end if;

    if v_first and r.prev_hash is not null then
      -- Oldest retained row points at destroyed history: acceptable only if
      -- the pointer resolves into archived anchors.
      if not exists (
        select 1
          from public.audit_destruction_batches b
               cross join lateral jsonb_array_elements(coalesce(b.chain_anchors, '[]'::jsonb)) as a
         where b.facility_id = p_facility_id
           and a->>'row_hash' = r.prev_hash
      ) then
        return jsonb_build_object(
          'ok', false, 'checked', v_checked,
          'first_break_seq', r.seq,
          'reason', 'genesis prev_hash does not resolve to destroyed history');
      end if;
    end if;

    v_first   := false;
    v_prev    := r.row_hash;
    v_checked := v_checked + 1;
  end loop;

  return jsonb_build_object('ok', true, 'checked', v_checked);
end;
$$;

revoke execute on function public.verify_audit_chain(uuid) from public, anon;
grant  execute on function public.verify_audit_chain(uuid) to authenticated, service_role;

comment on function public.verify_audit_chain(uuid) is
  'Recomputes every audit_logs hash for a facility and walks the seq-ordered '
  'linkage, bridging destroyed spans via audit_destruction_batches.'
  'chain_anchors. Admin-gated. Any payload edit, missing row, or reorder '
  'returns ok=false with the first breaking seq.';
