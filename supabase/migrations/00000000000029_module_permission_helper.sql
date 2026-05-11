-- =============================================================================
-- 00000000000029_module_permission_helper.sql
--
-- Adds a DB-level helper function that RLS policies call to confirm the
-- current authenticated user's employee record has can_submit (or can_view)
-- permission for a given module.
--
-- This closes the app-layer-only gap: even a direct Supabase REST/SDK call
-- is blocked if module_permissions.can_submit = false for the user's employee.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- has_module_permission(module_key, perm_type)
--
-- Returns TRUE when:
--   a) The user is a super_admin (always allowed), OR
--   b) The user has an active employee row in their facility AND
--      that employee has the requested permission flag set to TRUE.
--
-- perm_type: 'view' | 'submit' | 'admin'
-- -----------------------------------------------------------------------------
create or replace function public.has_module_permission(
  p_module_key text,
  p_perm_type  text   -- 'view' | 'submit' | 'admin'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_result      boolean := false;
begin
  -- Super admins bypass everything
  if public.is_super_admin() then
    return true;
  end if;

  -- Resolve the active employee for this user within their facility
  select e.id into v_employee_id
  from public.employees e
  where e.user_id    = auth.uid()
    and e.facility_id = public.current_facility_id()
    and e.is_active   = true
  limit 1;

  if v_employee_id is null then
    return false;
  end if;

  -- Check the permission flag
  select
    case p_perm_type
      when 'view'   then mp.can_view
      when 'submit' then mp.can_submit
      when 'admin'  then mp.can_admin
      else false
    end
  into v_result
  from public.module_permissions mp
  where mp.employee_id = v_employee_id
    and mp.module_key  = p_module_key
  limit 1;

  return coalesce(v_result, false);
end;
$$;

comment on function public.has_module_permission(text, text) is
  'Returns true when the current user''s active employee has the given '
  'permission flag (view/submit/admin) for the specified module_key. '
  'Super admins always return true.';

-- Revoke public execute; only authenticated users should call it via RLS
revoke execute on function public.has_module_permission(text, text) from public, anon;
grant  execute on function public.has_module_permission(text, text) to authenticated;
