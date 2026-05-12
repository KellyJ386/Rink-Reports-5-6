-- =============================================================================
-- 00000000000047_notification_outbox_drain.sql
--
-- Follow-up to phase 4. Adds drain_notification_outbox(): a worker function
-- that processes due rows in notification_outbox by inserting into
-- communication_messages + communication_recipients (in-app inbox only —
-- email/SMS is out of scope).
--
-- Rows are batched by (facility_id, rule_id, source_record_id, subject) so a
-- single source event fans out to one message with N recipient rows rather
-- than N duplicate messages.
--
-- Called either by:
--   1. A Next.js cron route at /api/cron/drain-notifications (current setup)
--   2. pg_cron, if enabled in a later migration
--
-- Both invocation paths are safe to run concurrently because the SELECT ...
-- FOR UPDATE SKIP LOCKED claim prevents double-sends.
-- =============================================================================

create or replace function public.drain_notification_outbox(
  p_max_rows integer default 500
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

  -- Claim due rows. SKIP LOCKED prevents racing workers from grabbing the
  -- same row. The claim moves rows from 'pending' to a transient state by
  -- collecting their ids; we then group/send and mark sent.
  create temp table if not exists _drain_claim (
    id uuid primary key,
    facility_id uuid,
    rule_id uuid,
    source_module text,
    source_record_id uuid,
    recipient_employee_id uuid,
    subject text,
    body text
  ) on commit drop;

  delete from _drain_claim;

  insert into _drain_claim (
    id, facility_id, rule_id, source_module, source_record_id,
    recipient_employee_id, subject, body
  )
  select id, facility_id, rule_id, source_module, source_record_id,
         recipient_employee_id, subject, body
  from public.notification_outbox
  where status = 'pending'
    and scheduled_for <= now()
  order by scheduled_for asc
  limit greatest(p_max_rows, 1)
  for update skip locked;

  if not exists (select 1 from _drain_claim) then
    return query select 0, 0, 0;
    return;
  end if;

  -- One message per (facility, rule, source_record, subject) — fan recipients
  -- under it. NULL rule_id (manual sends without a rule) falls into its own
  -- per-source-record bucket.
  for v_grp in
    select facility_id,
           coalesce(rule_id::text, '~no-rule~') as rule_bucket,
           coalesce(source_record_id::text, '~no-record~') as record_bucket,
           coalesce(subject, source_module) as subject_bucket
    from _drain_claim
    group by 1, 2, 3, 4
  loop
    -- Pick one representative row for body/subject (they're identical inside
    -- a group because they came from the same dispatch call).
    insert into public.communication_messages (
      facility_id, sender_employee_id, subject, body,
      requires_acknowledgement
    )
    select c.facility_id, null, c.subject, c.body, false
    from _drain_claim c
    where c.facility_id = v_grp.facility_id
      and coalesce(c.rule_id::text, '~no-rule~') = v_grp.rule_bucket
      and coalesce(c.source_record_id::text, '~no-record~') = v_grp.record_bucket
      and coalesce(c.subject, c.source_module) = v_grp.subject_bucket
    limit 1
    returning id into v_msg_id;

    v_message_cnt := v_message_cnt + 1;

    -- Fan recipients under that message, dedup'd, and capture which outbox
    -- rows belong to this message so we can mark them sent.
    with recip as (
      insert into public.communication_recipients (
        facility_id, message_id, employee_id
      )
      select distinct c.facility_id, v_msg_id, c.recipient_employee_id
      from _drain_claim c
      where c.facility_id = v_grp.facility_id
        and coalesce(c.rule_id::text, '~no-rule~') = v_grp.rule_bucket
        and coalesce(c.source_record_id::text, '~no-record~') = v_grp.record_bucket
        and coalesce(c.subject, c.source_module) = v_grp.subject_bucket
      on conflict (message_id, employee_id) do nothing
      returning employee_id
    )
    select count(*) into v_sent
    from recip;
    v_sent := coalesce(v_sent, 0);

    -- Mark all matching outbox rows sent.
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

  -- Recompute sent_count across all groups (the per-loop assignment above
  -- was per-group and gets overwritten).
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

comment on function public.drain_notification_outbox(integer) is
  'Worker function: processes due notification_outbox rows by inserting into '
  'communication_messages/communication_recipients. Restricted to platform '
  'super_admins and the postgres/service_role session users (cron workers). '
  'Returns (sent_count, failed_count, message_count).';

revoke execute on function public.drain_notification_outbox(integer) from public, anon;
grant  execute on function public.drain_notification_outbox(integer) to authenticated;
