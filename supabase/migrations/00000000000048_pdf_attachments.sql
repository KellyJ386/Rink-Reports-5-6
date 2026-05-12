-- =============================================================================
-- 00000000000048_pdf_attachments.sql
--
-- Phase 4 follow-up: real PDF attachments on notification messages.
--
-- Adds:
--   - notification_outbox.pdf_url       (text, nullable)
--   - communication_messages.pdf_url    (text, nullable)
--   - storage bucket 'notification-pdfs' (private)
--   - storage.objects RLS so service-role uploads + authenticated reads
--     scoped to the caller's facility (the path layout is
--     "<facility_id>/<source_module>/<source_record_id>.pdf")
--
-- Updates drain_notification_outbox() to carry pdf_url from the representative
-- outbox row onto the inserted communication_messages row.
-- =============================================================================

alter table public.notification_outbox
  add column if not exists pdf_url text;

alter table public.communication_messages
  add column if not exists pdf_url text;

comment on column public.notification_outbox.pdf_url is
  'Storage object path (within the notification-pdfs bucket) for the rendered '
  'PDF, populated by the cron route before drain. NULL means no PDF attached.';

comment on column public.communication_messages.pdf_url is
  'Storage object path (within the notification-pdfs bucket) for the rendered '
  'PDF. The inbox server-component signs this on read; never publicly exposed.';

-- -----------------------------------------------------------------------------
-- Storage bucket. Private — RLS on storage.objects controls access.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('notification-pdfs', 'notification-pdfs', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- storage.objects RLS for this bucket only.
--
-- Path layout: '<facility_uuid>/<source_module>/<source_record_uuid>.pdf'
-- The first segment IS the facility id; we use storage.foldername(name)[1]
-- which is the standard Supabase pattern.
-- -----------------------------------------------------------------------------
drop policy if exists notif_pdfs_select on storage.objects;
create policy notif_pdfs_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'notification-pdfs'
    and (
      public.is_super_admin()
      or (storage.foldername(name))[1]::uuid = public.current_facility_id()
    )
  );

-- Inserts/updates/deletes are restricted to service-role / postgres. The
-- cron route uses the service-role key; ordinary authenticated callers
-- have no write access.
drop policy if exists notif_pdfs_insert on storage.objects;
create policy notif_pdfs_insert
  on storage.objects
  for insert to authenticated
  with check (false);

drop policy if exists notif_pdfs_update on storage.objects;
create policy notif_pdfs_update
  on storage.objects
  for update to authenticated
  using (false);

drop policy if exists notif_pdfs_delete on storage.objects;
create policy notif_pdfs_delete
  on storage.objects
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- Rewrite drain_notification_outbox() to carry pdf_url.
--
-- Identical to the migration-47 version except the messages-insert now
-- selects pdf_url from the representative outbox row.
-- -----------------------------------------------------------------------------
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

comment on function public.drain_notification_outbox(integer) is
  'Worker function: processes due notification_outbox rows by inserting into '
  'communication_messages/communication_recipients. Carries pdf_url through '
  'from the representative outbox row. Restricted to platform super_admins '
  'and the postgres/service_role session users (cron workers).';

revoke execute on function public.drain_notification_outbox(integer) from public, anon;
grant  execute on function public.drain_notification_outbox(integer) to authenticated;
