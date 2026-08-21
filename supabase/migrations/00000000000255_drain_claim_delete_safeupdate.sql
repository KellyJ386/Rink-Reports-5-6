-- =============================================================================
-- 00000000000255_drain_claim_delete_safeupdate.sql
--
-- Follow-up to migration 246 (fix_cron_rpc_caller_gates), found the moment
-- that fix reached production: with the caller gate no longer rejecting the
-- service-role cron, drain_notification_outbox immediately failed on its next
-- statement — `delete from _drain_claim` — with 21000 "DELETE requires a
-- WHERE clause".
--
-- Supabase loads **pg_safeupdate** on PostgREST sessions, and it rejects any
-- unqualified DELETE, even inside a SECURITY DEFINER function. No psql
-- session and no CI-harness session loads it, which is why the drain worked
-- everywhere except the one path that matters — the same
-- only-fails-via-PostgREST failure class as the migration-246 gates
-- themselves. `where true` satisfies safeupdate verbatim and changes nothing
-- else about the statement.
--
-- The function body below is migration 246's verbatim except that one line.
-- The GATE-246 source pins in supabase/tests/rls_isolation.sql now also
-- reject the unqualified form, so a future restatement cannot silently
-- reintroduce it.
-- =============================================================================

begin;

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

  -- pg_safeupdate is loaded on Supabase's PostgREST sessions and rejects an
  -- unqualified DELETE (21000: "DELETE requires a WHERE clause") even inside a
  -- SECURITY DEFINER function. WHERE true satisfies it verbatim.
  delete from _drain_claim where true;

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

-- ACLs unchanged (CREATE OR REPLACE preserves them); restated to keep the
-- intended grant set visible per restatement, matching the repo convention.
revoke execute on function public.drain_notification_outbox(integer, uuid) from public, anon;
grant  execute on function public.drain_notification_outbox(integer, uuid) to authenticated;

commit;
