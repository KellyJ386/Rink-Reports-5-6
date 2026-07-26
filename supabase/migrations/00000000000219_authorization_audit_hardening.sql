-- =============================================================================
-- 00000000000219_authorization_audit_hardening.sql
--
-- Two DB-side gaps found by the I-5 authorization audit
-- (docs/authorization-audit-2026-07.md). Both are SECURITY DEFINER functions
-- callable by ordinary users with effects beyond the caller's own rights.
--
-- GAP 1 — user_has_permission(user, facility, module, action): a cross-tenant
--   permission ORACLE. SECURITY DEFINER, granted to authenticated, no internal
--   gate, and all four arguments are attacker-controlled — so any user could
--   probe whether ANY user holds ANY permission (or is a super-admin) in ANY
--   facility. Read-only, but a cross-facility enumeration leak. No RLS policy
--   or function calls it (facility-scoped policies use the auth.uid()-keyed
--   current_user_has_permission / has_module_* helpers), so gating it is safe.
--   Fix: an internal gate — the caller may only ask about themselves, their
--   own facility (as its admin), or anything (as super-admin).
--
-- GAP 2 — check_rate_limit(bucket, identifier, max, window): granted to anon +
--   authenticated with no gate, and every call increments the counter for an
--   arbitrary (bucket, identifier). An attacker could pre-exhaust a victim's
--   window (e.g. bucket 'login_email', a known email) to lock them out. The
--   only legitimate callers are two SERVER paths (login action, public
--   information-requests route); those now use the service-role client, so we
--   revoke anon/authenticated EXECUTE — clients can no longer forge counters.
-- =============================================================================

-- GAP 1 -----------------------------------------------------------------------
create or replace function public.user_has_permission(
  p_user_id     uuid,
  p_facility_id uuid,
  p_module_name text,
  p_action      public.user_action
) returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Internal gate: only reveal a permission bit the caller is entitled to see.
  if not (
    p_user_id = auth.uid()
    or public.is_super_admin()
    or (p_facility_id = public.current_facility_id()
        and public.is_facility_admin(p_facility_id))
  ) then
    raise exception 'user_has_permission: not authorized to query this user/facility'
      using errcode = '42501';
  end if;

  return coalesce(
    (select u.is_super_admin from public.users u where u.id = p_user_id),
    false
  )
  or exists (
    select 1 from public.user_permissions
    where user_id     = p_user_id
      and facility_id = p_facility_id
      and module_name = p_module_name
      and action      = p_action
      and enabled     = true
  );
end;
$$;

comment on function public.user_has_permission(uuid, uuid, text, public.user_action) is
  'Permission-bit lookup. Internally gated (migration 219): the caller may '
  'only query themselves, their own facility as its admin, or — as a '
  'super-admin — anyone. Prevents cross-tenant permission enumeration.';

-- GAP 2 -----------------------------------------------------------------------
-- Server-only now: the login action and information-requests route call this
-- through the service-role client. Clients (anon/authenticated) can no longer
-- increment arbitrary counters.
revoke execute on function public.check_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant  execute on function public.check_rate_limit(text, text, integer, integer)
  to service_role;
