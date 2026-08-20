-- =============================================================================
-- 00000000000251_rink_scheduling_retention.sql
-- Retention for module #12 'rink_scheduling'.
--
-- WHY THE FLOOR IS 2555 DAYS (7 YEARS)
-- This module is the only one in the app that stores financial records —
-- invoices, line items and payments are accounts-receivable history, not
-- operational logs. Seven years is the customary retention for AR records and
-- matches the floor already applied to audit_logs (migration 215). The floor
-- is enforced the same way every other module's is: retention_module_floors
-- clamps whatever an admin types into the retention console, so a facility
-- cannot set this module to 30 days and quietly destroy its billing history.
--
-- WHAT IS AND IS NOT PURGED
-- Purged past the cutoff: bookings (with their locker-room assignments, which
-- cascade), invoices (with their line items, which cascade), and the payments
-- recorded against those invoices.
--
-- NEVER purged by age: customers, rate cards, booking types, payment methods,
-- rinks, locker rooms, operating hours and module settings. Those are
-- CONFIGURATION, not history — deleting a customer because its oldest booking
-- aged out would orphan newer bookings and break the FK, and deleting a rate
-- card would strand the rate snapshots that justify past invoices.
--
-- ORDER MATTERS, because the FKs are deliberately RESTRICT:
--   1. payments  -> rink_payments.invoice_id is ON DELETE RESTRICT, so payments
--      must go before their invoice.
--   2. invoices  -> line items cascade off invoice_id.
--   3. bookings  -> assignments cascade off booking_id, but a booking still
--      referenced by a line item on a NEWER invoice is skipped
--      (rink_invoice_line_items.booking_id is ON DELETE RESTRICT). A five-year-
--      old booking invoiced last month is still live billing evidence; letting
--      the delete fail loudly would abort the whole purge, and forcing it would
--      destroy the line item's provenance. Skipping is the only correct
--      behaviour, and it is why the booking delete carries a NOT EXISTS guard.
-- =============================================================================

begin;

-- 1. Retention floor ----------------------------------------------------------
insert into public.retention_module_floors (module_key, min_days, note) values
  ('rink_scheduling', 2555,
   'Accounts-receivable records. Invoices, payments and the bookings they bill are financial history; 7 years matches the audit_logs floor and customary AR retention. Customers, rate cards and facility setup are configuration and are never purged by age.')
on conflict (module_key) do nothing;

-- 2. Manual purge -------------------------------------------------------------
-- Restates purge_module_data() from migration 239 with the rink_scheduling
-- branch added. Restated in full rather than edited in place, per the
-- migration rules; every pre-existing branch is byte-identical to 239.
CREATE OR REPLACE FUNCTION public.purge_module_data(p_facility_id uuid, p_module_key text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_keep_days integer;
  v_cutoff    timestamptz;
  v_deleted   integer;
  v_total     integer := 0;
begin
  if not (
    public.is_super_admin()
    or public.is_facility_admin(p_facility_id)
  ) then
    raise exception 'Not authorized to purge data for this facility.';
  end if;

  if p_module_key = 'scheduling' then
    raise exception 'Manual purge is not supported for scheduling.';
  end if;

  if p_module_key = 'audit_logs' then
    -- Compliance window: per-facility retention_settings (default 7 years),
    -- clamped to the 2555-day floor; keep_days = 0 disables purging
    -- (migration 215). Since migration 216 expired rows are STAGED into
    -- audit_logs_pending_destruction (recoverable until two admins approve
    -- destruction) instead of deleted.
    select keep_days into v_keep_days
      from public.retention_settings
     where facility_id = p_facility_id
       and module_key  = 'audit_logs';
    v_keep_days := coalesce(v_keep_days, 2555);
    if v_keep_days = 0 then
      return 0;
    end if;
    return public.stage_audit_logs_for_destruction(
      p_facility_id,
      now() - make_interval(days => greatest(v_keep_days, 2555)));
  end if;

  select keep_days into v_keep_days
    from public.retention_settings
   where facility_id = p_facility_id
     and module_key = p_module_key;

  if v_keep_days is null then
    raise exception 'No retention rule configured for this module. Save one first.';
  end if;
  if v_keep_days = 0 then
    raise exception 'Retention for this module is set to keep records forever.';
  end if;

  v_cutoff := now() - (v_keep_days || ' days')::interval;

  case p_module_key
    when 'daily_reports' then
      delete from public.daily_report_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'communications' then
      delete from public.communication_messages
       where facility_id = p_facility_id and sent_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_alerts
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_audit_log
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'accident_reports' then
      delete from public.accident_reports
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'incident_reports' then
      delete from public.incident_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'refrigeration' then
      delete from public.refrigeration_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'air_quality' then
      delete from public.air_quality_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_operations' then
      delete from public.ice_operations_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_depth' then
      delete from public.ice_depth_sessions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    -- Dasher Boards. Walks past the cutoff go, and dasher_boards_asset_checks /
    -- _checklist_responses cascade off the inspection FK. Issues do NOT: their
    -- inspection_id is ON DELETE SET NULL, so without the second delete below
    -- every issue ever raised would survive forever, detached from the walk
    -- that found it.
    --
    -- Only RESOLVED issues are purged. An unresolved issue is a live safety
    -- defect on the boards, not history, so it is kept regardless of age --
    -- deleting one because the walk that found it aged out would silently drop
    -- an open defect off the rink's record.
    when 'dasher_boards' then
      delete from public.dasher_boards_inspections
       where facility_id = p_facility_id and started_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.dasher_boards_issues
       where facility_id = p_facility_id
         and resolved_at is not null
         and resolved_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    -- Rink Scheduling & Billing. Financial history, floored at 7 years by
    -- retention_module_floors. See this migration's header for the ordering
    -- rationale; in short, payments before invoices (RESTRICT), and a booking
    -- still cited by a line item is kept whatever its age.
    when 'rink_scheduling' then
      delete from public.rink_payments p
       where p.facility_id = p_facility_id
         and exists (
           select 1 from public.rink_invoices i
            where i.id = p.invoice_id
              and i.facility_id = p_facility_id
              and i.issue_date < v_cutoff::date
         );
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.rink_invoices
       where facility_id = p_facility_id
         and issue_date < v_cutoff::date;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.rink_bookings b
       where b.facility_id = p_facility_id
         and b.starts_at < v_cutoff
         and not exists (
           select 1 from public.rink_invoice_line_items li
            where li.booking_id = b.id
         );
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    else
      raise exception 'Unknown module key: %', p_module_key;
  end case;

  return v_total;
end;
$function$;

comment on function public.purge_module_data(uuid, text) is
  'Manual per-module purge for a facility. Adds rink_scheduling (migration 251): '
  'payments, then their invoices (line items cascade), then bookings not cited by '
  'any invoice line. Customers, rate cards and facility setup are configuration '
  'and are never purged by age.';

-- 3. Nightly retention worker -------------------------------------------------
-- Mirrors migration 239's purge_old_dasher_boards_inspections(): loop the
-- auto_purge facilities, delete past the cutoff, return the row count.
-- keep_days = 0 means "keep forever" and cannot coexist with auto_purge = true
-- (migration 208), so the auto_purge filter already excludes those rows.
--
-- greatest(keep_days, 2555) is belt and braces: the console already clamps to
-- the floor, but a row written before this migration -- or by a future code
-- path that forgets -- must not be able to shorten a financial retention here.
create or replace function public.purge_old_rink_scheduling_records()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r         record;
  v_cutoff  timestamptz;
  v_deleted integer;
  v_total   integer := 0;
begin
  for r in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'rink_scheduling'
       and auto_purge = true
       and keep_days is not null
       and keep_days > 0
  loop
    v_cutoff := now() - make_interval(days => greatest(r.keep_days, 2555));

    delete from public.rink_payments p
     where p.facility_id = r.facility_id
       and exists (
         select 1 from public.rink_invoices i
          where i.id = p.invoice_id
            and i.facility_id = r.facility_id
            and i.issue_date < v_cutoff::date
       );
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.rink_invoices
     where facility_id = r.facility_id
       and issue_date < v_cutoff::date;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.rink_bookings b
     where b.facility_id = r.facility_id
       and b.starts_at < v_cutoff
       and not exists (
         select 1 from public.rink_invoice_line_items li
          where li.booking_id = b.id
       );
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    update public.retention_settings
       set last_purged_at  = now(),
           last_purge_count = v_total
     where facility_id = r.facility_id
       and module_key  = 'rink_scheduling';
  end loop;

  return v_total;
end;
$$;

comment on function public.purge_old_rink_scheduling_records() is
  'Nightly retention worker for Rink Scheduling & Billing. Financial records, so the cutoff is clamped to the 7-year floor regardless of the configured keep_days. Service-role only.';

revoke execute on function public.purge_old_rink_scheduling_records() from public;
revoke execute on function public.purge_old_rink_scheduling_records() from anon;
revoke execute on function public.purge_old_rink_scheduling_records() from authenticated;
grant  execute on function public.purge_old_rink_scheduling_records() to service_role;

commit;
