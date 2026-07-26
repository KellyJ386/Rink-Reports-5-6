-- =============================================================================
-- 00000000000218_verify_audit_chain_service_role.sql
--
-- Make the audit hash chain (migration 214) actually CHECKED, not just
-- checkable, on a schedule.
--
-- verify_audit_chain(facility) is admin-gated, so a cron running as
-- service_role can't call it. Rather than weaken that gate (a `session_user`
-- bypass can't be negatively tested in the RLS harness — SET ROLE doesn't
-- change session_user — and would blunt the admin check), the verification
-- LOOP is extracted into an ungated internal impl callable only by the two
-- SECURITY DEFINER wrappers:
--
--   _audit_chain_verify_impl(facility)  — the walk; no gate; revoked from all.
--   verify_audit_chain(facility)        — admin gate, then the impl (unchanged
--                                         external contract, migration 214).
--   verify_all_audit_chains()           — service-role/super-admin sweep across
--                                         every facility; the cron entry point.
-- =============================================================================

-- The walk, gate-free. SECURITY DEFINER so it can read audit_logs regardless
-- of the caller, but revoked from every client role — only the wrappers below
-- (running as owner) reach it.
create or replace function public._audit_chain_verify_impl(p_facility_id uuid)
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
  for r in
    select * from public.audit_logs
     where facility_id = p_facility_id
     order by seq
  loop
    if r.row_hash is distinct from public.audit_row_chain_hash(
         r.prev_hash, r.facility_id, r.actor_user_id, r.actor_employee_id,
         r.action, r.entity_type, r.entity_id, r.before, r.after,
         r.ip, r.user_agent, r.created_at) then
      return jsonb_build_object(
        'ok', false, 'checked', v_checked,
        'first_break_seq', r.seq, 'reason', 'row_hash mismatch (payload altered)');
    end if;

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
          exit;
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

revoke execute on function public._audit_chain_verify_impl(uuid) from public, anon, authenticated, service_role;

-- Admin-gated wrapper (unchanged external contract from migration 214).
create or replace function public.verify_audit_chain(p_facility_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_super_admin() or public.is_facility_admin(p_facility_id)) then
    raise exception 'verify_audit_chain: admin access required'
      using errcode = '42501';
  end if;
  return public._audit_chain_verify_impl(p_facility_id);
end;
$$;

revoke execute on function public.verify_audit_chain(uuid) from public, anon;
grant  execute on function public.verify_audit_chain(uuid) to authenticated, service_role;

-- Service-role sweep across every facility. Returns
--   { ok, checked_facilities, total_rows_checked, broken: [ {facility_id, first_break_seq, reason} ] }
create or replace function public.verify_all_audit_chains()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f        record;
  v_res    jsonb;
  v_broken jsonb := '[]'::jsonb;
  v_facs   integer := 0;
  v_rows   integer := 0;
begin
  if not (
    public.is_super_admin()
    or session_user in ('postgres', 'service_role', 'supabase_admin')
  ) then
    raise exception 'verify_all_audit_chains: service-role or super-admin only'
      using errcode = '42501';
  end if;

  for f in select id from public.facilities loop
    v_res  := public._audit_chain_verify_impl(f.id);
    v_facs := v_facs + 1;
    v_rows := v_rows + coalesce((v_res->>'checked')::int, 0);
    if (v_res->>'ok') = 'false' then
      v_broken := v_broken || jsonb_build_object(
        'facility_id',     f.id,
        'first_break_seq', v_res->'first_break_seq',
        'reason',          v_res->>'reason');
    end if;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_broken) = 0,
    'checked_facilities', v_facs,
    'total_rows_checked', v_rows,
    'broken', v_broken);
end;
$$;

revoke execute on function public.verify_all_audit_chains() from public, anon, authenticated;
grant  execute on function public.verify_all_audit_chains() to service_role;

comment on function public.verify_all_audit_chains() is
  'Service-role sweep: runs the audit-chain verification across every facility '
  'and returns a compact break report. Called by /api/cron/verify-audit-chain '
  'so audit tamper-evidence is checked on a schedule, not only on demand.';
