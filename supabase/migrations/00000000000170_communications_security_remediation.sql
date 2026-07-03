-- =============================================================================
-- 00000000000170_communications_security_remediation.sql
--
-- Security remediation for the communications module, from the 2026-07
-- 360-degree module audit. Four fixes plus two small follow-ons:
--
--   1. communication_recipients: a recipient could UPDATE their own row's
--      email-delivery columns (email_status / email_sent_at / email_error /
--      email_attempts / email_next_attempt_at / email_claim_token /
--      delivered_at) because RLS has no column granularity — e.g. set
--      email_status='sent' to suppress their own pending email, or forge
--      delivery state. A BEFORE UPDATE trigger now rejects changes to those
--      columns unless the writer is the service role (the send/drain crons),
--      a super admin, or a communications admin (the Deliveries retry action).
--      Recipients keep updating read_at / acknowledged_at as before.
--
--   2. communication_alerts INSERT required only VIEW access on the row's
--      source_module, so any viewer could inject arbitrary alerts
--      (attacker-controlled title/body/severity) into the facility inbox.
--      The gate is now submit-or-higher on the source module — the same bar
--      migration 86 restored for dispatch_rules_for_submission.
--
--   3. communication_audit_log INSERT was open to any authenticated user in
--      the facility with no binding between the row's actor_employee_id and
--      the caller — an audit-forgery surface. Inserts now require
--      communications module access and actor_employee_id must equal the
--      caller's employee id (both may be NULL: admin accounts without an
--      employee row legitimately write actor-less audit rows).
--
--   4. notification_outbox INSERT/UPDATE still gated on
--      current_user_role() in ('admin','gm','super_admin') — 'gm' was
--      retired in migration 87, and role-name checks predate the
--      user_permissions model. Both policies now use
--      has_module_admin_access('communications') like the rest of the
--      module. (SELECT and DELETE policies are unchanged.)
--
-- Follow-ons folded in:
--
--   5. communication_recipients SELECT: the sender of a message can now read
--      its recipient rows (read/ack receipts). Mirrors the sender clause the
--      INSERT policy has had since migration 9.
--
--   6. Audit triggers (audit_row_change) for communication_templates and
--      communication_recurring_reminders, completing migration 46's
--      communications coverage. Messages / recipients / alerts /
--      acknowledgements deliberately stay untriggered: they are high-volume
--      data tables whose lifecycle is app-audited into
--      communication_audit_log.
--
-- Decision recorded, not changed here: communication_messages SELECT stays
-- facility-wide for any communications viewer. Messages are operational
-- facility communications, not private DMs; facility-wide readability is
-- intentional and also what sender receipts and the admin inbox rely on.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Recipients: protect delivery-state columns from the recipient themselves.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_recipient_delivery_column_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.email_status            is distinct from old.email_status
     or new.email_sent_at        is distinct from old.email_sent_at
     or new.email_error          is distinct from old.email_error
     or new.email_attempts       is distinct from old.email_attempts
     or new.email_next_attempt_at is distinct from old.email_next_attempt_at
     or new.email_claim_token    is distinct from old.email_claim_token
     or new.delivered_at         is distinct from old.delivered_at
  then
    -- Service-role / postgres sessions (the send + drain crons) carry no JWT
    -- subject; comms admins run the Deliveries-tab retry under their own
    -- session and legitimately reset email_status / email_attempts.
    if auth.uid() is null
       or public.is_super_admin()
       or public.has_module_admin_access('communications')
    then
      return new;
    end if;
    raise exception
      'communication_recipients delivery columns are managed by the delivery pipeline';
  end if;
  return new;
end;
$$;

comment on function public.enforce_recipient_delivery_column_guard() is
  'BEFORE UPDATE trigger on communication_recipients: RLS lets a recipient '
  'update their own row (read_at / acknowledged_at), but Postgres RLS has no '
  'column granularity, so this trigger rejects changes to the email-delivery '
  'state columns unless the writer is the service role, a super admin, or a '
  'communications admin.';

drop trigger if exists trg_recipient_delivery_column_guard
  on public.communication_recipients;
create trigger trg_recipient_delivery_column_guard
  before update on public.communication_recipients
  for each row execute function public.enforce_recipient_delivery_column_guard();

-- -----------------------------------------------------------------------------
-- 2. Alerts INSERT: require submit-or-higher on the source module.
-- -----------------------------------------------------------------------------
drop policy if exists communication_alerts_insert on public.communication_alerts;
create policy communication_alerts_insert on public.communication_alerts
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.current_employee_module_permission(source_module)
          >= 'submit'::public.module_permission_level
        or public.has_module_admin_access('communications')
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Audit log INSERT: bind the actor to the caller.
-- -----------------------------------------------------------------------------
drop policy if exists communication_audit_log_insert on public.communication_audit_log;
create policy communication_audit_log_insert on public.communication_audit_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
      -- IS NOT DISTINCT FROM: admin accounts without an employee row write
      -- actor_employee_id = NULL, and current_employee_id() is NULL for them
      -- too. A strict `=` would silently reject those legitimate writes.
      and actor_employee_id is not distinct from public.current_employee_id()
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Outbox INSERT/UPDATE: user_permissions model instead of retired roles.
-- -----------------------------------------------------------------------------
drop policy if exists notification_outbox_insert on public.notification_outbox;
create policy notification_outbox_insert
  on public.notification_outbox
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists notification_outbox_update on public.notification_outbox;
create policy notification_outbox_update
  on public.notification_outbox
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Recipients SELECT: let the message sender read their receipts.
-- -----------------------------------------------------------------------------
drop policy if exists communication_recipients_select on public.communication_recipients;
create policy communication_recipients_select on public.communication_recipients
  for select to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('communications')
    or (
      facility_id = public.current_facility_id()
      and (
        employee_id = public.current_employee_id()
        or exists (
          select 1
          from public.communication_messages m
          where m.id = message_id
            and m.sender_employee_id = public.current_employee_id()
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 6. Audit triggers for the remaining communications config tables.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_audit_communication_templates
  on public.communication_templates;
create trigger trg_audit_communication_templates
  after insert or update or delete on public.communication_templates
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_communication_recurring_reminders
  on public.communication_recurring_reminders;
create trigger trg_audit_communication_recurring_reminders
  after insert or update or delete on public.communication_recurring_reminders
  for each row execute function public.audit_row_change();
