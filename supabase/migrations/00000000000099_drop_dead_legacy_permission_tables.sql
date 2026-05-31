-- =============================================================================
-- 00000000000099_drop_dead_legacy_permission_tables.sql
--
-- Removes the legacy permission tables that no longer have any reader:
--
--   * public.module_permissions              -- frozen by migration 77; the RLS
--       helpers were repointed to user_permissions in migration 91
--       (unify_permission_helpers). Verified 0 `.from("module_permissions")`
--       reads in src on origin/main, and 0 function/policy/FK references.
--   * public.department_module_permission_defaults  -- orphan (0 rows, 0 code).
--   * public.facility_module_permission_defaults    -- orphan (0 rows, 0 code).
--
-- KEPT (still load-bearing, do NOT drop here):
--   * public.module_area_permissions          -- per-AREA source of truth
--       (daily-report area gating; see migrations 89/91).
--   * public.role_module_permission_defaults  -- still read/written by the admin
--       roles UI (admin/roles/*). Migrating that UI onto role_permission_defaults
--       is a separate, code-first change.
--
-- CASCADE removes only each table's own attached triggers (audit / updated_at /
-- column-sync); no foreign key points at these tables.
-- =============================================================================

drop table if exists public.module_permissions cascade;
drop table if exists public.department_module_permission_defaults cascade;
drop table if exists public.facility_module_permission_defaults cascade;

-- sync_module_permission_columns() existed solely to mirror columns on
-- module_permissions; its trigger died with the table above. Drop the orphan.
drop function if exists public.sync_module_permission_columns() cascade;
