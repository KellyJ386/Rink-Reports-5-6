-- =============================================================================
-- 00000000000087_retire_gm_supervisor_roles.sql
--
-- DRAFT FOR REVIEW — do not deploy without reading
-- docs/permission-model-consolidation.md.
--
-- Completes the canonical role consolidation that migration 055 described but
-- never executed against the "Rink Reports 5-6" database. (During the
-- migration-history reconciliation, 055 was recorded as applied WITHOUT being
-- run, because this database had diverged and 055's body assumed the old role
-- model. This migration does the work in a DB-aware, idempotent way.)
--
-- Collapses the role set to the 4 canonical roles:
--   super_admin (0), admin (1), manager (2), staff (3)
-- 'gm' folds into 'admin'; 'supervisor' folds into 'manager'. At authoring time
-- this database had 0 employees on either retired role, but the reassignment
-- UPDATEs are kept for safety and portability to other facilities.
--
-- Verified FK ON DELETE behaviour on this database:
--   employees.role_id                       -> RESTRICT  (so reassign first)
--   role_permission_defaults.role_id        -> CASCADE   (~67 seed rows removed)
--   role_module_permission_defaults.role_id -> CASCADE   (~10 legacy rows removed)
-- The CASCADE rows are role-level *defaults* only. Live access is resolved from
-- user_permissions (per-user), which is untouched, so no current user loses
-- access.
--
-- RLS POLICY NOTE — read this before adding a policy rewrite here.
-- 33 policies across 15 tables still list 'gm' in their current_user_role()
-- admin arrays (audit_logs, departments, employee_departments, employees,
-- export_settings, module_area_permissions, module_permissions,
-- offline_sync_queue, retention_settings, role_module_permission_defaults,
-- role_permission_defaults, roles, users, department_module_permission_defaults,
-- facility_module_permission_defaults). Once the 'gm' role rows are deleted,
-- current_user_role() can never return 'gm', so those references become inert
-- no-ops — there is no security or behavioural impact from leaving them.
-- A mechanical strip of 'gm' from those arrays is cosmetic only and is
-- intentionally NOT bundled here: this database's policy set diverged from main
-- (migration 058's curated rewrite covered ~24 of these, the rest came from the
-- DB's own lineage), and blanket-recreating 33 policies risks regressing that
-- diverged logic. If the cosmetic cleanup is wanted, do it as a separate,
-- individually-reviewed pass — see docs/permission-model-consolidation.md.
-- =============================================================================

begin;

-- 1. Reassign any employees off the retired roles (defensive; 0 expected).
update public.employees e
set role_id = tgt.id
from public.roles src
join public.roles tgt
  on tgt.facility_id = src.facility_id and tgt.key = 'admin'
where e.role_id = src.id and src.key = 'gm';

update public.employees e
set role_id = tgt.id
from public.roles src
join public.roles tgt
  on tgt.facility_id = src.facility_id and tgt.key = 'manager'
where e.role_id = src.id and src.key = 'supervisor';

-- 2. Remove the retired role rows. role_permission_defaults and
--    role_module_permission_defaults rows for these roles are removed by
--    ON DELETE CASCADE; employees.role_id is RESTRICT but step 1 cleared it.
delete from public.roles where key in ('gm', 'supervisor');

-- 3. Align hierarchy_level with the 4-role canon (matches migration 055 intent).
update public.roles set hierarchy_level = 2 where key = 'manager';
update public.roles set hierarchy_level = 3 where key = 'staff';

commit;
