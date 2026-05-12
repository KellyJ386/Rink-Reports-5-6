-- =============================================================================
-- 00000000000041_audit_triggers.sql
--
-- Phase 2b of the Admin Control Center redesign: populate the audit_logs
-- table that has existed (empty) since migration 2.
--
-- Adds a single generic audit_row_change() trigger function and attaches it
-- to the tables an admin will most want to investigate. The function uses
-- to_jsonb(NEW) / to_jsonb(OLD) so it works on any table without per-table
-- column lists. The facility_id source column defaults to 'facility_id' but
-- can be overridden via the first trigger argument (used for the facilities
-- table itself where the tenant id IS the row id).
--
-- The function is SECURITY DEFINER so it can always write into audit_logs
-- regardless of the caller's facility — RLS on audit_logs still applies for
-- SELECTs from the admin UI. ip / user_agent are intentionally left NULL by
-- the trigger; the app-side logAudit() helper (src/lib/audit/log.ts) is the
-- canonical place for header-derived metadata if/when callers need it.
-- =============================================================================

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fac_col   text := coalesce(tg_argv[0], 'facility_id');
  v_action    text;
  v_before    jsonb;
  v_after     jsonb;
  v_facility  uuid;
  v_entity_id uuid;
  v_row       jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after  := to_jsonb(new);
    v_row    := v_after;
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_row    := v_after;
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_before := to_jsonb(old);
    v_after  := null;
    v_row    := v_before;
  else
    return coalesce(new, old);
  end if;

  begin
    v_facility := (v_row ->> v_fac_col)::uuid;
  exception when others then
    v_facility := null;
  end;

  begin
    v_entity_id := (v_row ->> 'id')::uuid;
  exception when others then
    v_entity_id := null;
  end;

  -- audit_logs.facility_id is NOT NULL. If we cannot resolve a tenant id
  -- (very unusual: orphaned row, table doesn't carry facility_id at all)
  -- skip the audit entry rather than failing the original DML.
  if v_facility is null then
    return coalesce(new, old);
  end if;

  insert into public.audit_logs (
    facility_id,
    actor_user_id,
    actor_employee_id,
    action,
    entity_type,
    entity_id,
    before,
    after
  ) values (
    v_facility,
    auth.uid(),
    public.current_employee_id(),
    v_action,
    tg_table_name::text,
    v_entity_id,
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;

comment on function public.audit_row_change() is
  'Generic AFTER trigger function: appends a row to audit_logs describing the '
  'INSERT/UPDATE/DELETE. Pass the facility-id column name as the first trigger '
  'argument; defaults to ''facility_id''. Skips silently if facility cannot be '
  'resolved so it never blocks the underlying DML.';

revoke execute on function public.audit_row_change() from public, anon;
-- No grant needed: triggers run as the function owner under SECURITY DEFINER.

-- -----------------------------------------------------------------------------
-- Attach triggers
-- -----------------------------------------------------------------------------

-- 1. employees ----------------------------------------------------------------
drop trigger if exists trg_audit_employees on public.employees;
create trigger trg_audit_employees
  after insert or update or delete on public.employees
  for each row execute function public.audit_row_change();

-- 2. module_permissions -------------------------------------------------------
drop trigger if exists trg_audit_module_permissions on public.module_permissions;
create trigger trg_audit_module_permissions
  after insert or update or delete on public.module_permissions
  for each row execute function public.audit_row_change();

-- 3. role_module_permission_defaults -----------------------------------------
drop trigger if exists trg_audit_role_module_permission_defaults
  on public.role_module_permission_defaults;
create trigger trg_audit_role_module_permission_defaults
  after insert or update or delete on public.role_module_permission_defaults
  for each row execute function public.audit_row_change();

-- 4. facilities (facility id IS the row id) ----------------------------------
drop trigger if exists trg_audit_facilities on public.facilities;
create trigger trg_audit_facilities
  after insert or update or delete on public.facilities
  for each row execute function public.audit_row_change('id');

-- 5. incident_reports ---------------------------------------------------------
drop trigger if exists trg_audit_incident_reports on public.incident_reports;
create trigger trg_audit_incident_reports
  after insert or update or delete on public.incident_reports
  for each row execute function public.audit_row_change();

-- 6. accident_reports ---------------------------------------------------------
drop trigger if exists trg_audit_accident_reports on public.accident_reports;
create trigger trg_audit_accident_reports
  after insert or update or delete on public.accident_reports
  for each row execute function public.audit_row_change();

-- 7. schedule_publish_requests -----------------------------------------------
drop trigger if exists trg_audit_schedule_publish_requests
  on public.schedule_publish_requests;
create trigger trg_audit_schedule_publish_requests
  after insert or update or delete on public.schedule_publish_requests
  for each row execute function public.audit_row_change();

-- 8. schedule_publish_events (append-only — INSERT only fires here) ----------
drop trigger if exists trg_audit_schedule_publish_events
  on public.schedule_publish_events;
create trigger trg_audit_schedule_publish_events
  after insert on public.schedule_publish_events
  for each row execute function public.audit_row_change();
