-- =============================================================================
-- 00000000000165_fix_superadmin_immutability_guard.sql
--
-- Close a DB-boundary privilege-escalation vector (audit D-01).
--
-- guard_users_profile_update() (migration 100) early-returns for ANY
-- is_facility_admin(old.facility_id), which exempted facility admins from the
-- is_super_admin / id immutability check entirely. Combined with the
-- users_update RLS policy (which lets a facility admin UPDATE any same-facility
-- users row), a facility admin could raw-PostgREST
--   update public.users set is_super_admin = true
-- on any user in their facility (including themselves) — minting a global,
-- cross-tenant super-admin. No server action exposes this, but the DB boundary
-- permitted it.
--
-- Fix: gate the escalation-sensitive columns (id, is_super_admin) to
-- super-admins ONLY, evaluated BEFORE the facility-admin exemption. Facility
-- admins keep their legitimate rights over the remaining privileged columns
-- (activate/deactivate, move facility within the RLS with-check boundary).
--
-- Function body only — no table shape change, so src/types/database.ts does NOT
-- need regeneration. SECURITY DEFINER / search_path / comment / the revoke off
-- the PostgREST RPC surface are preserved exactly as migration 100. The trigger
-- users_profile_update_guard already points at this function name and is
-- unchanged (create-or-replace keeps the existing trigger binding); neighbor
-- migration 164 only recreated its trigger because it changed the firing
-- events, which is not the case here.
-- =============================================================================

begin;

create or replace function public.guard_users_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Internal / service-role / migration flows (no end-user JWT) are exempt;
  -- RLS does not apply to them either.
  if auth.uid() is null then
    return new;
  end if;

  -- Super admins may change anything.
  if public.is_super_admin() then
    return new;
  end if;

  -- Only super admins may EVER change super-admin status or a user id,
  -- regardless of facility-admin status. This is the fix for D-01: the check
  -- runs BEFORE the facility-admin exemption below.
  if new.id is distinct from old.id
     or new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'Only super admins may modify super-admin status'
      using errcode = '42501';
  end if;

  -- Facility admins may still change the remaining privileged columns
  -- (activate/deactivate, move facility) for users in their facility.
  if public.is_facility_admin(old.facility_id) then
    return new;
  end if;

  -- Everyone else (self-service / supervisor profile edits) must not be able
  -- to toggle active status or relocate a user.
  if new.is_active   is distinct from old.is_active
     or new.facility_id is distinct from old.facility_id then
    raise exception 'Not allowed to modify privileged account fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_users_profile_update() is
  'BEFORE UPDATE guard on public.users: blocks non-admin edits from changing '
  'id / is_super_admin / is_active / facility_id (privilege escalation).';

-- Trigger functions fire under the table owner regardless of EXECUTE grants;
-- revoking keeps it off the PostgREST RPC surface. (Matches migration 100.)
revoke execute on function public.guard_users_profile_update() from public, anon, authenticated;

commit;
