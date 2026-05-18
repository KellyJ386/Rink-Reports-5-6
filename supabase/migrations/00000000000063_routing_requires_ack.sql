-- =============================================================================
-- 00000000000063_routing_requires_ack.sql
--
-- Closes the last "still deferred" item in
-- src/lib/notifications/scheduler-todo.md: per-rule acknowledgement
-- requirement on routed communications.
--
-- Before this migration, drain_notification_outbox() hard-coded
-- requires_acknowledgement = false on every message it created. There was
-- no way for an admin to say "any critical accident report should be
-- acknowledged by every member of the on-call group" — the column existed
-- on communication_messages but not on the routing rule that produced it.
--
-- Changes:
--   1. communication_routing_rules gains requires_acknowledgement
--      (boolean, default false).
--   2. notification_outbox gains requires_acknowledgement so the drain
--      can copy it onto the message without re-joining the rule.
--   3. dispatch_rules_for_submission() now copies the rule's flag onto
--      the outbox row.
--   4. drain_notification_outbox() now reads the outbox flag into the
--      message insert instead of hard-coding false.
--
-- The two SECURITY DEFINER functions are recreated wholesale rather than
-- patched in place so the search_path pin and authorization checks stay
-- intact and reviewable.
-- =============================================================================

alter table public.communication_routing_rules
  add column if not exists requires_acknowledgement boolean not null default false;

comment on column public.communication_routing_rules.requires_acknowledgement is
  'When true, communication_messages produced by this rule are stamped '
  'requires_acknowledgement=true so recipients must explicitly acknowledge '
  'them in the inbox.';

alter table public.notification_outbox
  add column if not exists requires_acknowledgement boolean not null default false;

comment on column public.notification_outbox.requires_acknowledgement is
  'Carried from the routing rule into the outbox so the drain can stamp '
  'communication_messages without re-joining the rule.';

-- ---------------------------------------------------------------------------
-- dispatch_rules_for_submission — propagates v_rule.requires_acknowledgement
-- into the new outbox column. Otherwise identical to the migration-45 body.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_rules_for_submission(
  p_facility_id      uuid,
  p_source_module    text,
  p_source_record_id uuid,
  p_severity         text default null,
  p_area_id          uuid default null,
  p_subject          text default null,
  p_body             text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule    record;
  v_emp_id  uuid;
  v_sched   timestamptz;
  v_count   integer := 0;
begin
  if p_facility_id is null or p_source_module is null then
    return 0;
  end if;

  for v_rule in
    select *
    from public.communication_routing_rules
    where facility_id = p_facility_id
      and source_module = p_source_module
      and is_active = true
      and (severity is null or severity = p_severity)
      and (area_id is null or area_id = p_area_id)
    order by priority desc, created_at asc
  loop
    case v_rule.timing
      when 'immediate'    then v_sched := now();
      when 'end_of_day'   then v_sched := date_trunc('day', now()) + interval '23 hours 59 minutes';
      when 'weekly'       then
        v_sched := date_trunc('week', now() + interval '1 week') + interval '9 hours';
      when 'manual'       then v_sched := null;
      else                     v_sched := now();
    end case;

    for v_emp_id in select employee_id from public.resolve_rule_recipients(v_rule.id)
    loop
      insert into public.notification_outbox (
        facility_id, rule_id, source_module, source_record_id,
        recipient_employee_id, subject, body, attach_pdf,
        requires_acknowledgement, scheduled_for, status
      ) values (
        p_facility_id, v_rule.id, p_source_module, p_source_record_id,
        v_emp_id, p_subject, p_body, coalesce(v_rule.attach_pdf, false),
        coalesce(v_rule.requires_acknowledgement, false),
        coalesce(v_sched, now() + interval '100 years'),
        case
          when v_rule.timing = 'manual' then 'pending'
          when v_rule.timing = 'immediate' then 'sent'
          else 'pending'
        end
      );
      v_count := v_count + 1;
    end loop;

    update public.communication_routing_rules
      set last_run_at = now(), last_run_status = 'dispatched'
    where id = v_rule.id;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text)
  from public, anon;
grant  execute on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- drain_notification_outbox — reads requires_acknowledgement off the outbox
-- row instead of hard-coding false on the message insert. Body is the
-- migration-50 version with two changes:
--   (a) _drain_claim temp table gains a requires_acknowledgement column.
--   (b) The communication_messages INSERT reads c.requires_acknowledgement
--       instead of literal false.
-- Everything else (authorization, super-admin scope-warning, grouping,
-- per-group fan-out, sent/failed accounting) is preserved verbatim.
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
  if not (public.is_super_admin() or session_user = 'postgres' or session_user = 'service_role') then
    raise exception 'drain_notification_outbox: not authorised';
  end if;

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

revoke execute on function public.drain_notification_outbox(integer, uuid) from public, anon;
grant  execute on function public.drain_notification_outbox(integer, uuid) to authenticated;
