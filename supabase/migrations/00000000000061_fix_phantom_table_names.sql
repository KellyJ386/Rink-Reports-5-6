-- =============================================================================
-- 00000000000061_fix_phantom_table_names.sql
--
-- Migrations 30, 33, and 43 referenced two table names that have never
-- existed in this codebase:
--   * public.air_quality_submissions  (real table: public.air_quality_reports,
--                                       created in mig 12)
--   * public.ice_operation_reports    (real table: public.ice_operations_submissions,
--                                       created in mig 13)
--
-- The mistaken statements were CREATE POLICY (mig 30, mig 43) and an FK
-- target on the air_quality_change_log.submission_id column (mig 33). On
-- a fresh database those statements error and abort migration apply,
-- which kept the rls-isolation CI workflow red on every migration-touching
-- PR since the workflow was added.
--
-- Resolution:
--   1. Migrations 30, 33, and 43 are patched to wrap the phantom-table
--      references in `to_regclass()` guards. On environments where the
--      phantom tables happen to exist (e.g. created out-of-band on a
--      long-lived staging DB), the original statements still apply and
--      preserve historical semantics.
--   2. This migration recreates the intended policies on the REAL tables
--      (air_quality_reports, ice_operations_submissions) using the
--      latest-intent semantics from migration 43.
--   3. air_quality_change_log.submission_id gets its FK retargeted to
--      air_quality_reports if it isn't already correctly bound.
--
-- The policy bodies match what migration 43 was supposed to install.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- air_quality_reports: the policy migrations 30 and 43 intended to create.
-- Migration 12 already installed an `air_quality_reports_insert` policy with a
-- simpler facility-scope check; we replace it with the module-permission gate.
-- -----------------------------------------------------------------------------
drop policy if exists air_quality_reports_insert on public.air_quality_reports;
create policy air_quality_reports_insert on public.air_quality_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('air_quality')
            >= 'submit'::public.module_permission_level
    )
  );

-- -----------------------------------------------------------------------------
-- ice_operations_submissions: same fix.
-- -----------------------------------------------------------------------------
drop policy if exists ice_operations_submissions_insert
  on public.ice_operations_submissions;
create policy ice_operations_submissions_insert
  on public.ice_operations_submissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('ice_operations')
            >= 'submit'::public.module_permission_level
    )
  );

-- -----------------------------------------------------------------------------
-- schedule_open_shifts (intended target of the "shift_requests" phantom).
-- This is what staff claim against; the insert pathway uses the
-- scheduling_claim_open_shift RPC, but the gate also belongs on direct
-- inserts as defence-in-depth.
-- -----------------------------------------------------------------------------
drop policy if exists schedule_open_shifts_insert on public.schedule_open_shifts;
create policy schedule_open_shifts_insert on public.schedule_open_shifts
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('scheduling')
            >= 'submit'::public.module_permission_level
    )
  );

-- -----------------------------------------------------------------------------
-- schedule_time_off_requests (intended target of the "time_off_requests"
-- phantom).
-- -----------------------------------------------------------------------------
drop policy if exists schedule_time_off_requests_insert
  on public.schedule_time_off_requests;
create policy schedule_time_off_requests_insert
  on public.schedule_time_off_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('scheduling')
            >= 'submit'::public.module_permission_level
    )
  );

-- -----------------------------------------------------------------------------
-- Retarget air_quality_change_log.submission_id FK to air_quality_reports.
--
-- On a clean DB after the patched migration 33, the column has no FK at all.
-- On legacy environments where the phantom table existed, the FK points to
-- it. Either way, drop any existing FK on submission_id and add the correct
-- one. Idempotent on re-run.
-- -----------------------------------------------------------------------------
do $$
declare
  v_constraint text;
begin
  if to_regclass('public.air_quality_change_log') is null then
    return;
  end if;

  for v_constraint in
    select conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and t.relname = 'air_quality_change_log'
      and a.attname = 'submission_id'
  loop
    execute format(
      'alter table public.air_quality_change_log drop constraint %I',
      v_constraint
    );
  end loop;

  alter table public.air_quality_change_log
    add constraint air_quality_change_log_submission_id_fkey
    foreign key (submission_id)
    references public.air_quality_reports(id)
    on delete cascade;
end$$;

-- -----------------------------------------------------------------------------
-- Same FK retarget for ice_operation_change_log.report_id (mig 34 phantom).
-- -----------------------------------------------------------------------------
do $$
declare
  v_constraint text;
begin
  if to_regclass('public.ice_operation_change_log') is null then
    return;
  end if;

  for v_constraint in
    select conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and t.relname = 'ice_operation_change_log'
      and a.attname = 'report_id'
  loop
    execute format(
      'alter table public.ice_operation_change_log drop constraint %I',
      v_constraint
    );
  end loop;

  alter table public.ice_operation_change_log
    add constraint ice_operation_change_log_report_id_fkey
    foreign key (report_id)
    references public.ice_operations_submissions(id)
    on delete cascade;
end$$;
