-- =============================================================================
-- 00000000000054_module_area_permissions_rls_tighten.sql
--
-- Closes a small policy inconsistency on module_area_permissions:
--
--   The INSERT and UPDATE policies allow facility-scoped admin/gm/super_admin
--   roles to write rows, but the DELETE policy was restricted to platform
--   super_admins only. This meant facility admins could insert area-permission
--   rows they could not remove without escalating to a super_admin.
--
--   Fix: bring DELETE in line with INSERT/UPDATE — facility admins and GMs
--   can delete rows within their own facility; platform super_admins can
--   delete anything.
--
-- area_id validation note:
--   area_id is a soft FK (see table comment in migration 2). It references a
--   UUID from a module-specific "areas" table (e.g. daily_report_areas). There
--   is no single generic FK we can enforce at the DB level without knowing the
--   module. The existing facility_id guard in INSERT/UPDATE is the primary
--   tenant isolation boundary; application code is responsible for confirming
--   that area_id belongs to the same facility before writing.
-- =============================================================================

drop policy if exists module_area_permissions_delete on public.module_area_permissions;
create policy module_area_permissions_delete
  on public.module_area_permissions
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

comment on table public.module_area_permissions is
  'Per-area access within a module. area_id is a soft reference into module-specific '
  'tables (e.g. daily_report_areas.id); no FK is enforced here because the target '
  'table varies by module. Facility isolation is enforced via the facility_id column; '
  'callers must validate that area_id belongs to the same facility before inserting.';
