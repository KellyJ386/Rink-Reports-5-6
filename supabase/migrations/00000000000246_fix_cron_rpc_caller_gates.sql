-- =============================================================================
-- 00000000000246_fix_cron_rpc_caller_gates.sql
--
-- The first real production cron runs (2026-08-20, after CRON_SECRET was
-- finally configured) surfaced a latent authorization bug in every
-- service-path RPC gate built on `session_user`:
--
--   if not (... or session_user = 'service_role') then raise ...
--
-- Through the Supabase API this can NEVER pass. PostgREST logs in as
-- `authenticator` and switches to the key's role with SET ROLE, so for a
-- service-role request `session_user` is 'authenticator' — and inside a
-- SECURITY DEFINER function `current_user` is the function owner, so neither
-- identifier reflects the caller. The only faithful signal is the request JWT:
-- auth.role() = 'service_role'. The gates only ever passed in psql (where
-- session_user really is 'postgres'), which is exactly how they were tested —
-- migration 221's header even noted a session_user branch cannot be negatively
-- tested under SET ROLE, and the first PostgREST invocation proved the point:
-- /api/cron/drain-notifications failed with 'not authorised' (P0001) on all 32
-- of its first recorded cron_runs rows.
--
-- Three functions carry this gate; each is restated verbatim except the gate:
--
--   drain_notification_outbox   (migration 63)  — was failing every 5 minutes.
--   verify_all_audit_chains     (migration 221) — would have failed at its
--                                first scheduled run (04:47 UTC).
--   snapshot_closed_daily_assignment_days (migration 185) — its runs succeed,
--                                but only because its `current_user` branch is
--                                a no-op that admits ANY caller with EXECUTE
--                                (current_user is the definer inside SECURITY
--                                DEFINER). The EXECUTE grants (service_role
--                                only) are the real fence; the gate is aligned
--                                so it enforces what it claims.
--
-- The corrected gate, uniformly:
--
--   public.is_super_admin()                       -- human admin paths
--   or coalesce(auth.role(), '') = 'service_role' -- PostgREST service key
--   or session_user in ('postgres', 'supabase_admin')  -- direct psql/maintenance
--
-- The EXECUTE grants on all three functions are unchanged and remain the
-- primary authorization boundary; the in-body gate is defense-in-depth.
-- supabase/tests/rls_isolation.sql gains GATE-246 assertions: a functional
-- service-role call of each function, plus prosrc pins so a future restatement
-- that resurrects `session_user = 'service_role'` (this repo's known
-- lost-in-restatement failure mode, cf. the notification_type CHECK) fails CI.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. drain_notification_outbox — body is the migration-63 version; only the
--    authorization gate and the super-admin scope-warning predicate change.
-- ---------------------------------------------------------------------------
create or replace function public.drain_notification_outbox(
  p_max_rows    integer default 500,
  p_facility_id uuid    default null
)
returns table (
  sent_count    integer,
  failed_count  integer,
  message_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sent         int := 0;
  v_failed       int := 0;
  v_message_cnt  int := 0;
  v_grp          record;
  v_msg_id       uuid;
  v_outbox_ids   uuid[];
begin
  if not (
    public.is_super_admin()
    or coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
  ) then
    raise exception 'drain_notification_outbox: not authorised';
  end if;

  if p_facility_id is null
     and public.is_super_admin()
     and coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise notice 'drain_notification_outbox: super_admin called without p_facility_id; draining all tenants';
  end if;

  create temp table if not exists _drain_claim (
    id uuid primary key,
    facility_id uuid,
    rule_id uuid,
    source_module text,
    source_record_id uuid,
    recipient_employee_id uuid,
    subject text,
    body text,
    pdf_url text,
    requires_acknowledgement boolean
  ) on commit drop;

  delete from _drain_claim;

  insert into _drain_claim (
    id, facility_id, rule_id, source_module, source_record_id,
    recipient_employee_id, subject, body, pdf_url, requires_acknowledgement
  )
  select id, facility_id, rule_id, source_module, source_record_id,
         recipient_employee_id, subject, body, pdf_url, requires_acknowledgement
  from public.notification_outbox
  where status = 'pending'
    and scheduled_for <= now()
    and (p_facility_id is null or facility_id = p_facility_id)
  order by scheduled_for asc
  limit greatest(p_max_rows, 1)
  for update skip locked;

  if not exists (select 1 from _drain_claim) then
    return query select 0, 0, 0;
    return;
  end if;

  for v_grp in
    select facility_id,
           coalesce(rule_id::text, '~no-rule~') as rule_bucket,
           coalesce(source_record_id::text, '~no-record~') as record_bucket,
           coalesce(subject, source_module) as subject_bucket
    from _drain_claim
    group by 1, 2, 3, 4
  loop
    -- One message per group. requires_acknowledgement is identical inside
    -- a group because all rows came from the same dispatch call against the
    -- same rule, so the representative row's value is authoritative.
    insert into public.communication_messages (
      facility_id, sender_employee_id, subject, body,
      requires_acknowledgement, pdf_url
    )
    select c.facility_id, null, c.subject, c.body,
           coalesce(c.requires_acknowledgement, false), c.pdf_url
    from _drain_claim c
    where c.facility_id = v_grp.facility_id
      and coalesce(c.rule_id::text, '~no-rule~') = v_grp.rule_bucket
      and coalesce(c.source_record_id::text, '~no-record~') = v_grp.record_bucket
      and coalesce(c.subject, c.source_module) = v_grp.subject_bucket
    limit 1
    returning id into v_msg_id;

    v_message_cnt := v_message_cnt + 1;

    insert into public.communication_recipients (
      facility_id, message_id, employee_id
    )
    select distinct c.facility_id, v_msg_id, c.recipient_employee_id
    from _drain_claim c
    where c.facility_id = v_grp.facility_id
      and coalesce(c.rule_id::text, '~no-rule~') = v_grp.rule_bucket
      and coalesce(c.source_record_id::text, '~no-record~') = v_grp.record_bucket
      and coalesce(c.subject, c.source_module) = v_grp.subject_bucket
    on conflict (message_id, employee_id) do nothing;

    select array_agg(c.id) into v_outbox_ids
    from _drain_claim c
    where c.facility_id = v_grp.facility_id
      and coalesce(c.rule_id::text, '~no-rule~') = v_grp.rule_bucket
      and coalesce(c.source_record_id::text, '~no-record~') = v_grp.record_bucket
      and coalesce(c.subject, c.source_module) = v_grp.subject_bucket;

    update public.notification_outbox
      set status = 'sent', sent_at = now()
    where id = any(v_outbox_ids);
  end loop;

  select count(*) into v_sent
  from public.notification_outbox o
  where o.id in (select id from _drain_claim)
    and o.status = 'sent';

  select count(*) into v_failed
  from public.notification_outbox o
  where o.id in (select id from _drain_claim)
    and o.status = 'failed';

  return query select v_sent, v_failed, v_message_cnt;
end;
$$;

-- ACLs unchanged (CREATE OR REPLACE preserves them); restated to match the
-- repo convention of keeping the intended grant set visible per restatement.
revoke execute on function public.drain_notification_outbox(integer, uuid) from public, anon;
grant  execute on function public.drain_notification_outbox(integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. verify_all_audit_chains — body is the migration-221 version; only the
--    gate changes.
-- ---------------------------------------------------------------------------
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
    or coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
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

-- ---------------------------------------------------------------------------
-- 3. snapshot_closed_daily_assignment_days — body is the migration-185
--    version; the no-op current_user branch becomes the auth.role() check.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_closed_daily_assignment_days()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fac   uuid;
  v_total integer := 0;
begin
  -- Internal-only: cron route with the service key (or a superuser).
  if not (
    public.is_super_admin()
    or coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
  ) then
    raise exception 'snapshot_closed_daily_assignment_days: not authorized'
      using errcode = '42501';
  end if;

  for v_fac in
    select distinct facility_id from public.report_area_assignments
  loop
    v_total := v_total + public.snapshot_daily_assignment_days(v_fac);
  end loop;

  return v_total;
end;
$$;

revoke execute on function public.snapshot_closed_daily_assignment_days()
  from public, anon, authenticated;
grant execute on function public.snapshot_closed_daily_assignment_days() to service_role;

commit;
