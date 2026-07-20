-- =============================================================================
-- 00000000000189_fix_communication_recipients_cross_tenant_select.sql
--
-- Cross-tenant isolation fix for communication_recipients SELECT.
--
-- The policy recreated in migration 170 (communications_security_remediation)
-- carried a top-level `OR has_module_admin_access('communications')` branch
-- with NO row facility_id filter. has_module_admin_access() is a CALLER-level
-- check — it returns true when the caller holds the enabled `admin` action on
-- `communications` at THEIR OWN current_facility_id(); it says nothing about
-- the ROW's facility_id. Because that branch is a bare OR with no row filter,
-- it evaluated true for EVERY row in the table, so any facility's
-- communications admin could read every other tenant's recipient rosters
-- (employee UUIDs), message ids, and delivery/read/ack timestamps.
--
-- Every sibling policy (communication_messages/_alerts/_acknowledgements) and
-- the third branch of THIS policy already gate as
-- `facility_id = current_facility_id() AND has_module_admin_access(...)`. This
-- pairs the admin branch with the row facility the same way, matching the
-- remediation pattern established in migration 133.
-- =============================================================================

begin;

drop policy if exists communication_recipients_select on public.communication_recipients;
create policy communication_recipients_select on public.communication_recipients
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('communications')
        or employee_id = public.current_employee_id()
        or exists (
          select 1
          from public.communication_messages m
          where m.id = message_id
            and m.sender_employee_id = public.current_employee_id()
        )
      )
    )
  );

commit;
