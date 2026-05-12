-- =============================================================================
-- 00000000000046_audit_triggers_expansion.sql
--
-- Phase 5 of the production permission model. Extends the audit_row_change()
-- coverage introduced in migration 41 to every table whose changes a security
-- review will want to see, including the new tables added in migrations 43
-- (department/facility permission defaults) and 45 (notification outbox).
--
-- Only attaches triggers; the function itself is unchanged. All triggers are
-- AFTER INSERT/UPDATE/DELETE except notification_outbox which uses INSERT
-- and UPDATE only (DELETE is restricted to super_admin and is rare).
-- =============================================================================

-- Roles and role-related --------------------------------------------------
drop trigger if exists trg_audit_roles on public.roles;
create trigger trg_audit_roles
  after insert or update or delete on public.roles
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_departments on public.departments;
create trigger trg_audit_departments
  after insert or update or delete on public.departments
  for each row execute function public.audit_row_change();

-- employee_departments has facility_id from migration 2.
drop trigger if exists trg_audit_employee_departments on public.employee_departments;
create trigger trg_audit_employee_departments
  after insert or update or delete on public.employee_departments
  for each row execute function public.audit_row_change();

-- New permission tiers (migration 43) ------------------------------------
drop trigger if exists trg_audit_department_module_permission_defaults
  on public.department_module_permission_defaults;
create trigger trg_audit_department_module_permission_defaults
  after insert or update or delete on public.department_module_permission_defaults
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_facility_module_permission_defaults
  on public.facility_module_permission_defaults;
create trigger trg_audit_facility_module_permission_defaults
  after insert or update or delete on public.facility_module_permission_defaults
  for each row execute function public.audit_row_change();

-- Submission tables ------------------------------------------------------
-- incident_reports and accident_reports already have triggers (migration 41).
drop trigger if exists trg_audit_daily_report_submissions on public.daily_report_submissions;
create trigger trg_audit_daily_report_submissions
  after insert or update or delete on public.daily_report_submissions
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_refrigeration_reports on public.refrigeration_reports;
create trigger trg_audit_refrigeration_reports
  after insert or update or delete on public.refrigeration_reports
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_air_quality_reports on public.air_quality_reports;
create trigger trg_audit_air_quality_reports
  after insert or update or delete on public.air_quality_reports
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_ice_depth_sessions on public.ice_depth_sessions;
create trigger trg_audit_ice_depth_sessions
  after insert or update or delete on public.ice_depth_sessions
  for each row execute function public.audit_row_change();

do $$
begin
  if to_regclass('public.ice_operation_reports') is not null then
    execute $sql$
      drop trigger if exists trg_audit_ice_operation_reports on public.ice_operation_reports;
      create trigger trg_audit_ice_operation_reports
        after insert or update or delete on public.ice_operation_reports
        for each row execute function public.audit_row_change();
    $sql$;
  end if;
end$$;

-- Communications: groups, members, routing rules -------------------------
drop trigger if exists trg_audit_communication_groups on public.communication_groups;
create trigger trg_audit_communication_groups
  after insert or update or delete on public.communication_groups
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_communication_group_members
  on public.communication_group_members;
create trigger trg_audit_communication_group_members
  after insert or update or delete on public.communication_group_members
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_communication_routing_rules
  on public.communication_routing_rules;
create trigger trg_audit_communication_routing_rules
  after insert or update or delete on public.communication_routing_rules
  for each row execute function public.audit_row_change();

-- Notification outbox (migration 45) -------------------------------------
drop trigger if exists trg_audit_notification_outbox on public.notification_outbox;
create trigger trg_audit_notification_outbox
  after insert or update or delete on public.notification_outbox
  for each row execute function public.audit_row_change();
