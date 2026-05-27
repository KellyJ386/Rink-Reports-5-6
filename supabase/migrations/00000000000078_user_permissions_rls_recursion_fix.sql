-- 00000000000078_user_permissions_rls_recursion_fix.sql
--
-- The user_permissions_select / _write policies created in migration 77
-- contained an EXISTS subquery against user_permissions itself, which
-- re-enters the same policy and triggers Postgres' "infinite recursion
-- detected in policy" error the first time anyone other than super_admin
-- or the row's own user_id tries to read the table.
--
-- Fix: move the "is this caller a facility admin?" check into a
-- SECURITY DEFINER helper (is_facility_admin) that bypasses RLS when
-- it queries user_permissions, then rewrite both policies to call it.

begin;

create or replace function public.is_facility_admin(p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_permissions
    where user_id     = auth.uid()
      and facility_id = p_facility_id
      and module_name = 'admin'
      and action      = 'admin'
      and enabled     = true
  );
$$;

comment on function public.is_facility_admin(uuid) is
  'True iff the calling user has the admin action on the admin module for the given facility. SECURITY DEFINER to avoid recursing into user_permissions RLS.';

revoke execute on function public.is_facility_admin(uuid) from public, anon;
grant  execute on function public.is_facility_admin(uuid) to authenticated;

drop policy if exists user_permissions_select on public.user_permissions;
create policy user_permissions_select on public.user_permissions
  for select to authenticated
  using (
    public.is_super_admin()
    or user_id = auth.uid()
    or public.is_facility_admin(facility_id)
  );

drop policy if exists user_permissions_write on public.user_permissions;
create policy user_permissions_write on public.user_permissions
  for all to authenticated
  using (
    public.is_super_admin()
    or public.is_facility_admin(facility_id)
  )
  with check (
    public.is_super_admin()
    or public.is_facility_admin(facility_id)
  );

commit;
