-- =============================================================================
-- 00000000000065_employee_hidden_modules.sql
--
-- Per-user dashboard preference: which module tiles the user has chosen to
-- hide from their own dashboard grid. All module tiles are visible by default;
-- the user can hide individual tiles and restore them later.
--
-- Tile visibility is a personal preference, not a permission gate. Access to
-- the underlying reports remains enforced by module_permissions /
-- has_module_permission() at the row-level security layer.
-- =============================================================================

alter table public.employees
  add column if not exists hidden_modules text[] not null default '{}';

comment on column public.employees.hidden_modules is
  'Module keys (e.g. daily_reports, scheduling) the employee has chosen to '
  'hide from their dashboard grid. Personal UI preference; does not affect '
  'access control.';

-- -----------------------------------------------------------------------------
-- Setter RPCs.
--
-- The employees table RLS limits UPDATE to admin/gm/super_admin. These
-- SECURITY DEFINER functions let a regular user toggle ONLY their own
-- hidden_modules column, scoped to their active employee row.
-- -----------------------------------------------------------------------------

create or replace function public.hide_dashboard_module(p_module_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.employees
     set hidden_modules =
           case
             when hidden_modules @> array[p_module_key]
               then hidden_modules
             else array_append(hidden_modules, p_module_key)
           end
   where user_id  = auth.uid()
     and is_active = true;
end;
$$;

comment on function public.hide_dashboard_module(text) is
  'Adds a module key to the caller''s own employees.hidden_modules array. '
  'No-op if already hidden. Only affects rows where user_id = auth.uid() '
  'and is_active = true.';

create or replace function public.show_dashboard_module(p_module_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.employees
     set hidden_modules = array_remove(hidden_modules, p_module_key)
   where user_id  = auth.uid()
     and is_active = true;
end;
$$;

comment on function public.show_dashboard_module(text) is
  'Removes a module key from the caller''s own employees.hidden_modules '
  'array. No-op if not currently hidden.';

revoke execute on function public.hide_dashboard_module(text) from public, anon;
revoke execute on function public.show_dashboard_module(text) from public, anon;
grant  execute on function public.hide_dashboard_module(text) to authenticated;
grant  execute on function public.show_dashboard_module(text) to authenticated;
