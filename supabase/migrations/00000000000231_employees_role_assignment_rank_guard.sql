-- =============================================================================
-- 00000000000231_employees_role_assignment_rank_guard.sql
--
-- E-1, final sibling hole. employees_update (live definition: migration 58,
-- unchanged since) is:
--
--   using / with check (
--     is_super_admin()
--     or (facility_id = current_facility_id()
--         and current_user_role() = any(array['admin','super_admin'])))
--
-- i.e. any facility admin may rewrite ANY column of ANY employee in their
-- facility, INCLUDING role_id — with no check on the RANK of the new role. So a
-- facility admin can PATCH /rest/v1/employees?id=eq.<peer> setting role_id to
-- the facility's `admin` role, then call reapply_role_defaults_for_role()
-- (EXECUTE granted to `authenticated`, migration 81) -> apply_role_permission_
-- defaults() seeds an ENABLED admin/admin user_permissions row AS postgres
-- (BYPASSRLS), sidestepping the migration-227 WITH CHECK that fences that cell.
-- Net: a facility admin mints a peer admin despite 227/228.
--
-- The rank guard lives only in app code — canAssignRoleLevel() /
-- assertCanAssignRole() (ADMIN_TIER_LEVEL = 1) in
-- src/lib/permissions/role-assignment-core.ts + role-assignment.ts, applied by
-- the employee-console server actions (src/app/admin/employees/actions.ts). The
-- runtime role change there is a direct `.from("employees").update({role_id})`
-- via the invoker Supabase client, so RLS is the only backstop and it does not
-- enforce rank. LOWER number = HIGHER rank; canonical seed is super_admin=0,
-- admin=1, manager=2, staff=3 (migration 188).
--
-- WHY NOT A PLAIN WITH CHECK on employees_update: the rule is "the NEW role's
-- hierarchy_level must be STRICTLY GREATER THAN the caller's floor" (a floor-1
-- admin may assign level >= 2 = manager/staff, NOT level 1 = another admin, and
-- NOT level 0). But a facility admin legitimately edits peers who ALREADY hold
-- the `admin` role (level 1) for non-role fields (name, phone, is_active) — a
-- blanket "new role level > floor" WITH CHECK would reject those harmless edits
-- because the row's level IS the floor. The guard must therefore fire ONLY when
-- role_id actually CHANGES, which a stateless WITH CHECK (NEW-row only) cannot
-- express. Hence a BEFORE UPDATE trigger comparing OLD.role_id vs NEW.role_id.
--
-- WHY NOT SECURITY DEFINER (deliberate — mirrors the guard-trigger family
-- 148/164/181/185/210): the exemption must see the INVOKING role. A SECURITY
-- DEFINER trigger owned by `postgres` would make current_user = 'postgres'
-- unconditionally and the exemption would ALWAYS fire, disabling the guard —
-- exactly the trap migration 185 calls out ("NOT security definer: ... a definer
-- trigger would always run as postgres and bypass itself"). So this function is
-- SECURITY INVOKER with a pinned search_path, matching every other
-- current_user-gated guard trigger in this schema. RLS-bypassing reads it needs
-- (the caller's floor) go through current_role_hierarchy_floor() (migration 228),
-- which is itself SECURITY DEFINER and reads employees/roles without re-entering
-- RLS; the NEW role's level is read from public.roles under the invoker's
-- roles_select policy, which always exposes roles in the caller's own facility.
--
-- Exempt callers, so legitimate backend / SECURITY DEFINER employee flows keep
-- working:
--   * current_user in ('postgres','supabase_admin','service_role') — trusted
--     backend roles, and any SECURITY DEFINER function owned by the table owner
--     (which runs as 'postgres'). NOTE: create_employee_complete() (migrations
--     53/108, SECURITY DEFINER, owner postgres) is the only SECURITY DEFINER
--     writer of employees.role_id, and it INSERTs — a BEFORE UPDATE trigger
--     never fires for it, so employee creation is untouched regardless. No
--     SECURITY DEFINER function UPDATEs role_id (there is no update_employee_role
--     DB function; the console's role change is the invoker-context table write
--     above, which SHOULD be guarded — and now is).
--   * is_super_admin() — a platform super admin may assign any role, matching
--     canAssignRoleLevel()'s `if (isSuperAdmin) return true`.
--
-- Rank rule, matching canAssignRoleLevel() precisely:
--   const effectiveFloor = floor ?? ADMIN_TIER_LEVEL   // role-assignment-core.ts:34
--   const level          = targetLevel ?? 0            // role-assignment-core.ts:35
--   return level > effectiveFloor                      // role-assignment-core.ts:36
-- A NULL floor (caller has no active employee row in the facility — e.g. an
-- admin granted purely via a user_permissions admin/admin row) coalesces to
-- ADMIN_TIER_LEVEL = 1, NOT "no restriction" — this is the OPPOSITE of the
-- roles_update case in migration 228, and is taken verbatim from line 34. A NULL
-- target level (role row not visible / hierarchy_level null) coalesces to 0
-- (top rank), so it is denied — matching `targetLevel ?? 0`.
--
-- Function/trigger-only change: no table shape changes, so the generated DB
-- types are unaffected (a trigger function isn't PostgREST-callable and so
-- doesn't appear there); the schema snapshot picks up the new function/trigger.
-- =============================================================================

create or replace function public.guard_employee_role_assignment()
returns trigger
language plpgsql
-- SECURITY INVOKER (default): current_user must reflect the role that issued the
-- UPDATE. search_path pinned per the migration-162 hardening convention.
set search_path = public, pg_temp
as $$
declare
  v_new_level integer;
  v_floor     integer;
begin
  -- 1. Only fire when the role actually CHANGES. Non-role edits (name, phone,
  --    is_active, user_id linking, etc.) are never blocked — this is what keeps
  --    a facility admin able to edit peers who already hold the `admin` role.
  if new.role_id is not distinct from old.role_id then
    return new;
  end if;

  -- 2. Exempt trusted backend roles and SECURITY DEFINER flows owned by the
  --    table owner (current_user = 'postgres' inside them), plus platform super
  --    admins (canAssignRoleLevel: `if (isSuperAdmin) return true`).
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or public.is_super_admin() then
    return new;
  end if;

  -- 3. Rank check for a non-exempt caller changing role_id.
  --    NEW role's rank; `targetLevel ?? 0` -> an unknown/invisible role (e.g. a
  --    cross-facility role_id filtered out by roles_select, or a null level) is
  --    treated as top-rank and denied.
  select r.hierarchy_level into v_new_level
  from public.roles r
  where r.id = new.role_id;
  v_new_level := coalesce(v_new_level, 0);

  --    Caller's floor in the row's facility; `floor ?? ADMIN_TIER_LEVEL` -> a
  --    null floor is the admin tier (1), NOT unrestricted (role-assignment-core.ts:34).
  v_floor := coalesce(public.current_role_hierarchy_floor(new.facility_id), 1);

  --    canAssignRoleLevel: assignable iff level > effectiveFloor.
  if not (v_new_level > v_floor) then
    raise exception using
      errcode = '42501',
      message = format(
        'guard_employee_role_assignment: cannot assign a role at hierarchy level %s; '
        'your hierarchy floor is %s. You may only assign roles that rank strictly '
        'below you (hierarchy_level > %s). Assigning the admin tier requires a super admin.',
        v_new_level, v_floor, v_floor);
  end if;

  return new;
end;
$$;

comment on function public.guard_employee_role_assignment() is
  'BEFORE UPDATE guard on public.employees: when role_id changes, a non-super, '
  'non-backend caller may only set a role whose hierarchy_level ranks strictly '
  'below the caller''s floor in the row''s facility (SQL mirror of '
  'canAssignRoleLevel() / assertCanAssignRole() in '
  'src/lib/permissions/role-assignment-core.ts; null floor => ADMIN_TIER_LEVEL=1, '
  'null target level => 0). SECURITY INVOKER so current_user reflects the caller; '
  'backend roles and SECURITY DEFINER owner flows (current_user=postgres) and '
  'super admins are exempt. Closes the last employees.role_id privilege-'
  'escalation route behind migrations 227/228.';

drop trigger if exists trg_employees_role_assignment_guard on public.employees;
create trigger trg_employees_role_assignment_guard
  before update on public.employees
  for each row execute function public.guard_employee_role_assignment();
