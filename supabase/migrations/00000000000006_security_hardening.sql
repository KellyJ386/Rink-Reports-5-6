-- =============================================================================
-- 00000000000006_security_hardening.sql
-- Address Supabase security advisor warnings.
--   * Pin search_path on the set_updated_at trigger function.
--   * Revoke EXECUTE from PUBLIC on every SECURITY DEFINER helper so only
--     `authenticated` (or `service_role` for the seed helper) can call them.
-- =============================================================================

-- 1. Pin search_path on the updated_at trigger fn (was role-mutable).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 2. Revoke implicit PUBLIC execute on SECURITY DEFINER helpers.
revoke execute on function public.current_user_id()                 from public;
revoke execute on function public.current_user_record()             from public;
revoke execute on function public.current_employee_id()             from public;
revoke execute on function public.current_facility_id()             from public;
revoke execute on function public.is_super_admin()                  from public;
revoke execute on function public.current_user_role()               from public;
revoke execute on function public.has_module_access(text)           from public;
revoke execute on function public.has_module_admin_access(text)     from public;
revoke execute on function public.has_area_access(text, uuid)       from public;
-- seed_default_roles_for_facility was already locked down; reaffirm.
revoke execute on function public.seed_default_roles_for_facility(uuid) from public;
