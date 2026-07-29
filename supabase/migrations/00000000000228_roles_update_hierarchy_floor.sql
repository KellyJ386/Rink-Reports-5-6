-- =============================================================================
-- 00000000000228_roles_update_hierarchy_floor.sql
--
-- E-1, sibling hole. roles_update (live definition: migration 58, unchanged
-- since) is:
--
--   using / with check (
--     is_super_admin()
--     or (facility_id = current_facility_id()
--         and current_user_role() = any(array['admin','super_admin'])))
--
-- i.e. any facility admin may rewrite ANY column of ANY role in their facility,
-- including hierarchy_level. The rank guard lives only in app code —
-- callerHierarchyFloor() in src/lib/permissions/role-assignment.ts, applied by
-- createRole / renameRole / setRoleHierarchy in src/app/admin/roles/actions.ts
-- — and the browser can PATCH /rest/v1/roles directly. A facility admin could
-- therefore hoist a role they control (e.g. `staff`, level 3) to level 0 and
-- outrank the admin tier, defeating canAssignRoleLevel() and
-- can_edit_user_profile() (migration 100), both of which compare
-- hierarchy_level numbers. LOWER number = HIGHER rank; canonical seed is
-- super_admin=0, admin=1, manager=2, staff=3 (migration 188).
--
-- FIX: mirror the two rules the app already enforces, at the policy layer.
--   1. USING  — you may not touch a role that ALREADY outranks you
--               (setRoleHierarchy / renameRole: "Cannot modify a role that
--               already outranks you.").
--   2. CHECK  — the resulting hierarchy_level may not outrank you
--               ("Hierarchy level must be >= <floor>").
--
-- The floor is the caller's strongest (lowest-numbered) active role IN THAT
-- FACILITY, exactly as callerHierarchyFloor() computes it, via a new helper.
-- A NULL floor (no active employee row in the facility — e.g. an admin granted
-- purely through a user_permissions admin/admin row) is coalesced to "no
-- restriction", matching callerHierarchyFloor() returning null and the app
-- skipping both checks. Super admins are unaffected (first branch).
--
-- Nothing legitimate loses access:
--   * A facility admin (role `admin`, level 1) can still edit its own `admin`
--     role (1 >= 1), `manager` (2) and `staff` (3) and any custom role at or
--     below its rank — every edit the admin console offers today.
--   * It can no longer rename/re-rank `super_admin` (level 0) — which
--     renameRole/setRoleHierarchy already refused.
--   * deactivate_role() / reactivate_role() (migration 212) are SECURITY
--     DEFINER owned by `postgres` (BYPASSRLS), so the activate/deactivate path
--     does not go through this policy at all.
--   * roles_insert is untouched: createRole's floor check is a separate rule
--     (level < floor, equal allowed) and its RLS gate is unchanged.
--
-- The helper is SECURITY DEFINER for the same reason is_facility_admin()
-- (migration 78) is: it reads employees + roles from inside a roles policy, and
-- must not re-enter RLS.
--
-- Policy/function-only change: no table shape changes, so the generated DB
-- types and the schema snapshot are unaffected.
-- =============================================================================

create or replace function public.current_role_hierarchy_floor(p_facility_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select min(r.hierarchy_level)
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.user_id = (select auth.uid())
    and e.facility_id = p_facility_id
    and e.is_active = true;
$$;

comment on function public.current_role_hierarchy_floor(uuid) is
  'The calling user''s strongest (lowest-numbered) active role hierarchy_level '
  'in the given facility, or NULL when they have no active employee row there. '
  'SQL mirror of callerHierarchyFloor() in src/lib/permissions/role-assignment.ts. '
  'SECURITY DEFINER so it can be called from the roles RLS policy without '
  're-entering RLS.';

revoke execute on function public.current_role_hierarchy_floor(uuid)
  from public, anon;
grant  execute on function public.current_role_hierarchy_floor(uuid)
  to authenticated, service_role;

alter policy roles_update on public.roles
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
      -- Cannot modify a role that already outranks you.
      and hierarchy_level >= coalesce(
            public.current_role_hierarchy_floor(facility_id), hierarchy_level)
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
      -- Cannot leave a role ranked above your own floor.
      and hierarchy_level >= coalesce(
            public.current_role_hierarchy_floor(facility_id), hierarchy_level)
    )
  );
