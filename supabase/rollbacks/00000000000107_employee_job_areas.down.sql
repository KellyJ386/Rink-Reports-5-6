-- =============================================================================
-- 00000000000107_employee_job_areas.down.sql
-- Rollback for 00000000000107_employee_job_areas.sql
--
-- Drops ONLY the objects introduced by the up migration. Existing tables
-- (employees, facilities, daily_report_areas, ...) are untouched.
-- Order: policies -> trigger -> tables (assignments before reference, FK order)
--        -> cap function.
-- =============================================================================

-- Policies (dropped implicitly with the tables, but listed for clarity) -------
drop policy if exists employee_job_area_assignments_delete on public.employee_job_area_assignments;
drop policy if exists employee_job_area_assignments_update on public.employee_job_area_assignments;
drop policy if exists employee_job_area_assignments_insert on public.employee_job_area_assignments;
drop policy if exists employee_job_area_assignments_select on public.employee_job_area_assignments;

drop policy if exists employee_job_areas_delete on public.employee_job_areas;
drop policy if exists employee_job_areas_update on public.employee_job_areas;
drop policy if exists employee_job_areas_insert on public.employee_job_areas;
drop policy if exists employee_job_areas_select on public.employee_job_areas;

-- Triggers --------------------------------------------------------------------
drop trigger if exists trg_employee_job_area_assignments_cap on public.employee_job_area_assignments;
drop trigger if exists trg_employee_job_area_assignments_updated_at on public.employee_job_area_assignments;
drop trigger if exists trg_employee_job_areas_updated_at on public.employee_job_areas;

-- Tables (junction first: it FKs the reference table) -------------------------
drop table if exists public.employee_job_area_assignments;
drop table if exists public.employee_job_areas;

-- Cap function (after its dependent trigger/table are gone) --------------------
drop function if exists public.enforce_employee_job_area_cap();
