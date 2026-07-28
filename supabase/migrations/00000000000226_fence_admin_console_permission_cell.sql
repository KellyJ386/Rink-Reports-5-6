-- =============================================================================
-- 00000000000226_fence_admin_console_permission_cell.sql
--
-- E-1 (privilege escalation): the `admin`/`admin` permission cell is what
-- requireAdmin() and the RLS helper is_facility_admin() key off, so ENABLING it
-- mints another Admin Center holder. That rule ("only a super admin may grant
-- Admin Center access") was enforced ONLY in app code — isAdminConsoleGrant()
-- in src/lib/permissions/actions.ts, called from every server action that
-- writes user_permissions / role_permission_defaults. The browser holds the
-- anon key and the user's JWT (src/lib/supabase/client.ts), so a facility admin
-- could skip all of it with one PostgREST call:
--
--   POST /rest/v1/user_permissions
--     {user_id:<peer>, facility_id:<own>, module_name:'admin',
--      action:'admin', enabled:true}
--
-- and mint a peer facility admin. The same hole existed on
-- role_permission_defaults: an enabled admin/admin default plus
-- reapply_role_defaults_for_role() (EXECUTE granted to `authenticated`,
-- migration 81) pushes the cell onto every active holder of that role.
--
-- Live policy definitions before this migration:
--   * user_permissions_insert / _update — migration 98
--       with check (is_super_admin() or is_facility_admin(facility_id))
--   * role_permission_defaults_insert / _update — created migration 79,
--     last altered migration 212
--       with check (is_super_admin()
--                   or (facility_id = current_facility_id()
--                       and current_user_role() = any(array['admin','super_admin'])))
--
-- FIX: keep every predicate above and AND on one extra term for the
-- non-super-admin branch — the row being written may not be an ENABLED
-- admin/admin cell.
--
-- Deliberately still permitted, to preserve legitimate behavior:
--   * module_name <> 'admin' with action = 'admin' — granting the `admin`
--     ACTION on a report module is normal delegation (configure that module)
--     and is untouched.
--   * Writing admin/admin with enabled = false. This is a REVOKE, and the app
--     depends on it: upsertUserPermission(enabled:false),
--     applyPresetToUser() (every preset writes admin/admin = false for a
--     non-super caller), bulkImportUserPermissionsCsv(), setRoleModuleAction()
--     and copyRoleDefaults() all emit a disabled admin/admin row rather than
--     skipping the cell. Fencing revoke would break the admin console; letting
--     a facility admin take Admin Center access AWAY is not an escalation.
--   * The UPDATE policies keep their USING clause UNCHANGED for the same
--     reason: narrowing USING would hide existing admin/admin rows from the
--     facility admin and break revoke. Escalation is caught by WITH CHECK,
--     which is evaluated against the NEW row — so flipping an existing
--     disabled admin/admin row to enabled, or re-pointing some other row's
--     module_name/action onto the admin cell, is rejected either way.
--
-- Verified NOT affected (they must keep working):
--   * apply_role_permission_defaults(uuid,uuid,uuid) (migration 81) and its
--     entry point reapply_role_defaults_for_role(uuid,uuid) — both SECURITY
--     DEFINER, owned by `postgres`, which has BYPASSRLS on the Supabase stack,
--     so table RLS does not apply inside them. A super-admin-initiated reapply
--     still seeds admin/admin; an admin-initiated one can no longer introduce
--     the cell because the role_permission_defaults SOURCE row can no longer be
--     enabled by a facility admin.
--   * seed_role_permission_defaults_for_facility(uuid) /
--     trg_seed_role_permission_defaults() (migration 82) — likewise SECURITY
--     DEFINER; they only ever write the canonical matrix from
--     canonical_role_permission_grants().
--
-- Policy-only change: no table shape changes, so the generated DB types and the
-- schema snapshot are unaffected.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- user_permissions — the cell requireAdmin() reads directly.
-- ---------------------------------------------------------------------------
alter policy user_permissions_insert on public.user_permissions
  with check (
    public.is_super_admin()
    or (
      public.is_facility_admin(facility_id)
      and not (
        module_name = 'admin'
        and action = 'admin'::public.user_action
        and enabled
      )
    )
  );

alter policy user_permissions_update on public.user_permissions
  using (
    public.is_super_admin()
    or public.is_facility_admin(facility_id)
  )
  with check (
    public.is_super_admin()
    or (
      public.is_facility_admin(facility_id)
      and not (
        module_name = 'admin'
        and action = 'admin'::public.user_action
        and enabled
      )
    )
  );

-- ---------------------------------------------------------------------------
-- role_permission_defaults — the seed matrix reapply_role_defaults_for_role()
-- pushes onto every holder of a role.
-- ---------------------------------------------------------------------------
alter policy role_permission_defaults_insert on public.role_permission_defaults
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
      and not (
        module_name = 'admin'
        and action = 'admin'::public.user_action
        and enabled
      )
    )
  );

alter policy role_permission_defaults_update on public.role_permission_defaults
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
      and not (
        module_name = 'admin'
        and action = 'admin'::public.user_action
        and enabled
      )
    )
  );
