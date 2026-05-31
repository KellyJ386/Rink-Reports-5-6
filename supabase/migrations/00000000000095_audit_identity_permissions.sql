-- =============================================================================
-- 00000000000093_audit_identity_permissions.sql
--
-- Security-relevant audit coverage for identity / permission tables that the
-- existing audit triggers (migrations 41 + 46) missed:
--
--   * public.users               — written by the service-role invite flow
--                                   (src/lib/auth/invite-employee.ts).
--   * public.user_permissions     — the CURRENT permission source of truth
--                                   (migration 77). The DEPRECATED
--                                   module_permissions IS audited but its
--                                   replacement was not.
--   * public.role_permission_defaults — per-role default matrix (migration 79),
--                                   also unaudited.
--
-- These all reuse the generic public.audit_row_change() function from
-- migration 41 (to_jsonb(NEW)/(OLD); facility-id column defaults to
-- 'facility_id'; row id read from 'id'). No change to that function is needed:
--
--   * user_permissions      has NOT NULL facility_id + uuid id  -> generic fits.
--   * role_permission_defaults has NOT NULL facility_id + uuid id -> generic fits.
--   * users                 has uuid id + facility_id, BUT facility_id is
--                           NULLABLE (NULL for super admins, per migration 2).
--
-- SHAPE DECISION (per task option b, scoped to the NULL case only):
--   audit_row_change() already null-guards facility_id: when it cannot resolve
--   a tenant id it RETURNs without writing an audit row, because
--   audit_logs.facility_id is NOT NULL with an FK to facilities (migration 2)
--   and there is no valid facility to attribute a super-admin user row to.
--   We deliberately do NOT extend the function to invent a facility for those
--   rows — doing so would either violate the NOT NULL/FK constraint or
--   mis-attribute a cross-tenant super admin to an arbitrary facility, and it
--   would risk the 8 existing triggers that rely on the skip-on-null behavior.
--   Net effect: facility-scoped users.* changes (the common case: inviting /
--   editing / deactivating staff) ARE audited; the rare super-admin row whose
--   facility_id is NULL is intentionally skipped, exactly as every other table
--   with an unresolvable tenant id already is. This keeps the change minimal
--   and the 8 prior triggers untouched.
--
-- Only attaches triggers; the function itself is unchanged.
-- =============================================================================

begin;

-- 1. users --------------------------------------------------------------------
-- INSERT (invite/provision), UPDATE (profile, is_super_admin, is_active,
-- facility reassignment), DELETE (deprovision). facility_id is the default
-- column the generic function reads; NULL-facility super-admin rows are
-- skipped per the shape note above.
drop trigger if exists trg_audit_users on public.users;
create trigger trg_audit_users
  after insert or update or delete on public.users
  for each row execute function public.audit_row_change();

-- 2. user_permissions ---------------------------------------------------------
-- Current permission source of truth (migration 77). NOT NULL facility_id, so
-- every row resolves a tenant and is audited.
drop trigger if exists trg_audit_user_permissions on public.user_permissions;
create trigger trg_audit_user_permissions
  after insert or update or delete on public.user_permissions
  for each row execute function public.audit_row_change();

-- 3. role_permission_defaults -------------------------------------------------
-- Per-role default matrix (migration 79). NOT NULL facility_id.
drop trigger if exists trg_audit_role_permission_defaults
  on public.role_permission_defaults;
create trigger trg_audit_role_permission_defaults
  after insert or update or delete on public.role_permission_defaults
  for each row execute function public.audit_row_change();

commit;
