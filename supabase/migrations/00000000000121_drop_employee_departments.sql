-- =============================================================================
-- 00000000000121_drop_employee_departments.sql
-- Scheduling remediation L2: retire the redundant employee<->department junction.
--
-- The Employee Scheduling audit found two parallel employee-grouping systems:
--   * employee_departments        (this table) -- 0 rows, app-layer removed
--   * employee_job_area_assignments (kept)     -- the canonical cross-training
--                                                 system used by scheduling
-- Shifts still scope by departments.department_id; employee qualification now
-- flows through job areas. The employee<->department junction is therefore dead
-- weight and is dropped here.
--
-- CASCADE removes the table's own RLS policies, indexes and triggers. The
-- create_employee_complete() RPC still contains a guarded INSERT into this
-- table, but the application no longer passes department ids, so that branch is
-- never reached (plpgsql binds the statement lazily on execution).
-- =============================================================================

drop table if exists public.employee_departments cascade;
