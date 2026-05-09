-- Adds explicit NULL parameter guards to the three parameterized helper
-- functions. Previously, NULL parameters caused the EXISTS subquery to match
-- zero rows (safe by accident). Now the guard is explicit and self-documenting.

create or replace function public.has_module_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_module_key is not null
    and (
      public.is_super_admin()
      or exists (
        select 1
          from public.module_permissions mp
          join public.employees e on e.id = mp.employee_id
         where e.user_id   = auth.uid()
           and e.is_active = true
           and mp.module_key = p_module_key
           and mp.can_view  = true
      )
    );
$$;

create or replace function public.has_module_admin_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_module_key is not null
    and (
      public.is_super_admin()
      or exists (
        select 1
          from public.module_permissions mp
          join public.employees e on e.id = mp.employee_id
         where e.user_id    = auth.uid()
           and e.is_active  = true
           and mp.module_key = p_module_key
           and mp.can_admin = true
      )
    );
$$;

create or replace function public.has_area_access(p_module_key text, p_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_module_key is not null
    and p_area_id is not null
    and (
      public.is_super_admin()
      or public.has_module_admin_access(p_module_key)
      or exists (
        select 1
          from public.module_area_permissions map
          join public.employees e on e.id = map.employee_id
         where e.user_id    = auth.uid()
           and e.is_active  = true
           and map.module_key = p_module_key
           and map.area_id   = p_area_id
           and map.can_view  = true
      )
    );
$$;

-- Reaffirm grants (create or replace resets them).
revoke execute on function public.has_module_access(text)       from public;
revoke execute on function public.has_module_admin_access(text) from public;
revoke execute on function public.has_area_access(text, uuid)   from public;

grant execute on function public.has_module_access(text)       to authenticated;
grant execute on function public.has_module_admin_access(text) to authenticated;
grant execute on function public.has_area_access(text, uuid)   to authenticated;
