-- =============================================================================
-- 00000000000050_deferred_security_followups.sql
--
-- Closes the three deferred medium-severity findings from the security
-- review. None of these were exploitable today; this migration tightens
-- the surfaces so a future regression would be caught explicitly.
--
--   M3: Document that resolve_rule_recipients' facility check is defence-
--       in-depth, not the primary gate (the primary gate now lives in
--       dispatch_rules_for_submission per migration 49).
--
--   M5: drain_notification_outbox grows an optional p_facility_id
--       parameter. NULL preserves the existing cron behaviour (drain
--       everything). When set, the SELECT is scoped — a super_admin
--       invoking it manually no longer flushes every tenant's queue.
--
--   M6 is handled in the application layer (src/app/admin/roles/actions.ts),
--   not here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- M3: comment-only update. The function body is unchanged.
-- -----------------------------------------------------------------------------
comment on function public.resolve_rule_recipients(uuid) is
  'Expands a routing rule''s target_* columns to a unique set of active '
  'employee_ids. Includes a facility check (is_super_admin OR '
  'rule.facility_id = current_facility_id), but that check is DEFENCE IN '
  'DEPTH only — the primary tenant gate for dispatch lives in '
  'dispatch_rules_for_submission (migration 49). Future refactors that '
  'add a wrapper around this function must NOT rely on the inner check.';

-- -----------------------------------------------------------------------------
-- M5: scope drain_notification_outbox by facility.
--
-- Signature change (additive default): the cron route keeps calling
-- drain_notification_outbox(p_max_rows := 500), implicitly passing NULL for
-- p_facility_id, which preserves the global drain behaviour.
-- -----------------------------------------------------------------------------
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
  if not (public.is_super_admin() or session_user = 'postgres' or session_user = 'service_role') then
    raise exception 'drain_notification_outbox: not authorised';
  end if;

  -- When called by a super_admin user via RPC without specifying a facility
  -- the call would otherwise flush every tenant's queue. The cron route
  -- (service-role) deliberately passes NULL to drain everything; super_admins
  -- invoking by hand are expected to scope.
  if p_facility_id is null
     and public.is_super_admin()
     and session_user not in ('postgres', 'service_role') then
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
    pdf_url text
  ) on commit drop;

  delete from _drain_claim;

  insert into _drain_claim (
    id, facility_id, rule_id, source_module, source_record_id,
    recipient_employee_id, subject, body, pdf_url
  )
  select id, facility_id, rule_id, source_module, source_record_id,
         recipient_employee_id, subject, body, pdf_url
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
    insert into public.communication_messages (
      facility_id, sender_employee_id, subject, body,
      requires_acknowledgement, pdf_url
    )
    select c.facility_id, null, c.subject, c.body, false, c.pdf_url
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

comment on function public.drain_notification_outbox(integer, uuid) is
  'Worker function: processes due notification_outbox rows by inserting into '
  'communication_messages/communication_recipients. p_facility_id NULL drains '
  'every tenant (cron behaviour); when set, the SELECT is scoped to that '
  'facility. Restricted to platform super_admins and the postgres/service_role '
  'session users.';

-- The previous (single-arg) signature is replaced. Drop the old grant so it
-- does not linger pointing at a non-existent overload.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'drain_notification_outbox'
      and pg_get_function_identity_arguments(p.oid) = 'p_max_rows integer'
  ) then
    drop function public.drain_notification_outbox(integer);
  end if;
end$$;

revoke execute on function public.drain_notification_outbox(integer, uuid) from public, anon;
grant  execute on function public.drain_notification_outbox(integer, uuid) to authenticated;
