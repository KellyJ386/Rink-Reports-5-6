-- =============================================================================
-- 00000000000171_backfill_role_default_permissions.sql
--
-- The 2026-07 communications audit found accounts that pass the admin console
-- guard via its employee-role fallback (requireAdmin: active employee with an
-- admin-tier role) but hold ZERO user_permissions rows — typically accounts
-- provisioned before migration 77/82's auto-seeding. For those accounts every
-- RLS write gated on has_module_admin_access(...) silently fails: the console
-- renders, the mutation returns an RLS error. The same gap affects non-admin
-- staff whose submit-level grants were never seeded.
--
-- Fix the data: for every active employee whose (user_id, facility_id) has no
-- user_permissions rows at all, apply that facility's role defaults via the
-- existing idempotent helper (migration 81). The helper only fills gaps
-- (ON CONFLICT preserves explicit per-user overrides) and skips super admins,
-- so re-running is safe. Scoped to accounts with ZERO rows so we never touch
-- anyone an admin has already configured (even partially) in the permissions
-- UI.
--
-- Going forward the auto-seed trigger chain (migration 82) covers new
-- accounts; this is a one-time catch-up for the stragglers.
-- =============================================================================

do $$
declare
  v_emp record;
  v_count integer := 0;
begin
  for v_emp in
    select e.user_id, e.facility_id, e.role_id
      from public.employees e
     where e.is_active
       and e.user_id is not null
       and e.role_id is not null
       and e.facility_id is not null
       and not exists (
         select 1
           from public.user_permissions up
          where up.user_id = e.user_id
            and up.facility_id = e.facility_id
       )
  loop
    perform public.apply_role_permission_defaults(
      v_emp.user_id, v_emp.facility_id, v_emp.role_id
    );
    v_count := v_count + 1;
  end loop;

  raise notice 'backfill_role_default_permissions: seeded % account(s)', v_count;
end $$;
