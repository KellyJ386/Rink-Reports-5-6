-- 00000000000090_unify_permission_helpers.sql
--
-- Unifies the permission model: the three legacy RLS helper functions
--   public.has_module_access(text)
--   public.has_module_admin_access(text)
--   public.has_area_access(text, uuid)
-- (originally defined in migration 3, null-guarded in migration 25) still
-- read the DEPRECATED public.module_permissions / public.module_area_permissions
-- tables (columns can_view / can_admin). Everything else in the app moved to
-- public.user_permissions in migration 77 (resolvers effective_module_permission /
-- current_employee_module_permission / current_user_has_permission). The
-- modern seeding chain (migrations 79/81/82) and employee creation (migration 53)
-- write ONLY user_permissions / role_permission_defaults — never the legacy
-- module_permissions table.
--
-- Result before this migration: a user provisioned under the current model has
-- ZERO module_permissions rows, so has_module_access() returns false and the
-- SELECT policies on the config / settings tables for every module
-- (refrigeration_sections, communication_groups, ice_depth_rinks,
-- ice_operations_fuel_types, etc.) return 0 rows — e.g. the refrigeration form
-- renders with no sections even though the user's submission INSERT (gated by
-- the user_permissions resolvers) would be permitted. Split-brain.
--
-- This migration redefines the three helpers to read public.user_permissions
-- as the single source of truth for the MODULE-level checks, while keeping
-- public.module_area_permissions as the per-AREA source of truth. Signatures,
-- volatility (STABLE), SECURITY DEFINER, search_path, and grants are preserved
-- exactly as in migration 3 / 25 so every RLS policy that calls them keeps
-- working without change.
--
-- Semantics (agreed design):
--   has_module_access(module)       = is_super_admin()
--                                      OR enabled `view`  on (current_facility, module)
--                                         in user_permissions.
--   has_module_admin_access(module) = is_super_admin()
--                                      OR enabled `admin` on (current_facility, module)
--                                         in user_permissions.
--   has_area_access(module, area)   = is_super_admin()
--                                      OR has_module_admin_access(module)
--                                      OR ( has_module_access(module)
--                                           AND ( the current employee has NO
--                                                 module_area_permissions rows for
--                                                 this module  ->  full access
--                                             OR  has a matching module_area_permissions
--                                                 row for area with can_view = true ) ).
--   Rationale: per-area restriction only bites when explicit area rows exist
--   (as they do for daily reports, backfilled by migration 89). A user whose
--   access comes only from user_permissions (no area rows) is NOT locked out.
--
-- has_area_submit_access(module, area) (introduced in migration 89) is realigned
-- the same way: its module-level gate now reads user_permissions (enabled
-- `submit`) instead of the deprecated module_permissions path, while keeping the
-- per-area module_area_permissions.can_submit check and the "no area rows = full
-- access" rule.
--
-- The current employee is resolved via auth.uid() + current_facility_id() exactly
-- as migrations 3 and 89 do (employees.user_id = auth.uid(), is_active = true).
--
-- NOTE: This migration does NOT drop public.module_permissions /
-- public.module_area_permissions — other policies and the rls_isolation test may
-- still touch them, and module_area_permissions remains the per-area source.
-- Once the per-area helpers and any remaining direct readers are verified, the
-- legacy module_permissions table (and its can_view / can_admin columns) can be
-- dropped in a follow-up migration; the helpers in this file no longer depend
-- on it.

begin;

-- -----------------------------------------------------------------------------
-- has_module_access(module_key) -> bool
--   Reads user_permissions (view) for (auth.uid(), current_facility, module).
-- -----------------------------------------------------------------------------
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
          from public.user_permissions up
         where up.user_id     = auth.uid()
           and up.facility_id = public.current_facility_id()
           and up.module_name = p_module_key
           and up.action      = 'view'::public.user_action
           and up.enabled     = true
      )
    );
$$;

comment on function public.has_module_access(text) is
  'True if super admin OR the current user has an enabled `view` grant on the '
  'named module at their current facility (public.user_permissions). '
  'Migrated off the deprecated module_permissions table in migration 90.';

-- -----------------------------------------------------------------------------
-- has_module_admin_access(module_key) -> bool
--   Reads user_permissions (admin) for (auth.uid(), current_facility, module).
-- -----------------------------------------------------------------------------
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
          from public.user_permissions up
         where up.user_id     = auth.uid()
           and up.facility_id = public.current_facility_id()
           and up.module_name = p_module_key
           and up.action      = 'admin'::public.user_action
           and up.enabled     = true
      )
    );
$$;

comment on function public.has_module_admin_access(text) is
  'True if super admin OR the current user has an enabled `admin` grant on the '
  'named module at their current facility (public.user_permissions). '
  'Migrated off the deprecated module_permissions table in migration 90.';

-- -----------------------------------------------------------------------------
-- has_area_access(module_key, area_id) -> bool
--   Module-level gate now reads user_permissions (via has_module_access /
--   has_module_admin_access). Per-area gate keeps module_area_permissions, but
--   only restricts when explicit area rows exist for this employee + module
--   ("no area rows = full access").
-- -----------------------------------------------------------------------------
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
      or (
        public.has_module_access(p_module_key)
        and (
          -- No explicit per-area rows for this employee+module -> full access.
          not exists (
            select 1
              from public.module_area_permissions map
              join public.employees e on e.id = map.employee_id
             where e.user_id     = auth.uid()
               and e.is_active   = true
               and map.module_key = p_module_key
          )
          -- Otherwise require a matching area row with can_view = true.
          or exists (
            select 1
              from public.module_area_permissions map
              join public.employees e on e.id = map.employee_id
             where e.user_id     = auth.uid()
               and e.is_active   = true
               and map.module_key = p_module_key
               and map.area_id    = p_area_id
               and map.can_view   = true
          )
        )
      )
    );
$$;

comment on function public.has_area_access(text, uuid) is
  'True if super admin, module admin (user_permissions admin), OR the user has '
  'module view (user_permissions) AND either has no per-area rows for this '
  'module (full access) or an explicit module_area_permissions row with '
  'can_view = true for the area. Module-level checks migrated to '
  'user_permissions in migration 90; per-area source stays module_area_permissions.';

-- -----------------------------------------------------------------------------
-- has_area_submit_access(module_key, area_id) -> bool (introduced migration 89)
--   Realign the module-level gate to user_permissions (enabled `submit`),
--   keeping the per-area can_submit check and the "no area rows = full access"
--   rule consistent with has_area_access above.
-- -----------------------------------------------------------------------------
create or replace function public.has_area_submit_access(
  p_module_key text,
  p_area_id    uuid
)
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
      or (
        -- Module-level submit via user_permissions (was module_permissions path).
        exists (
          select 1
            from public.user_permissions up
           where up.user_id     = auth.uid()
             and up.facility_id = public.current_facility_id()
             and up.module_name = p_module_key
             and up.action      = 'submit'::public.user_action
             and up.enabled     = true
        )
        and (
          -- No explicit per-area rows for this employee+module -> full access.
          not exists (
            select 1
              from public.module_area_permissions map
              join public.employees e on e.id = map.employee_id
             where e.user_id     = auth.uid()
               and e.is_active   = true
               and map.module_key = p_module_key
          )
          -- Otherwise require a matching area row with can_submit = true.
          or exists (
            select 1
              from public.module_area_permissions map
              join public.employees e on e.id = map.employee_id
             where e.user_id     = auth.uid()
               and e.is_active   = true
               and map.module_key = p_module_key
               and map.area_id    = p_area_id
               and map.can_submit = true
          )
        )
      )
    );
$$;

comment on function public.has_area_submit_access(text, uuid) is
  'True iff the caller may SUBMIT in the given area for the module: super admin, '
  'module admin, OR module-level `submit` (user_permissions) AND either no '
  'per-area rows for this module (full access) or a matching '
  'module_area_permissions row with can_submit = true. Module-level gate '
  'migrated to user_permissions in migration 90.';

-- -----------------------------------------------------------------------------
-- Reaffirm grants (create or replace resets them). Match migration 3 / 25 / 89.
-- -----------------------------------------------------------------------------
revoke execute on function public.has_module_access(text)        from public, anon;
revoke execute on function public.has_module_admin_access(text)  from public, anon;
revoke execute on function public.has_area_access(text, uuid)    from public, anon;
revoke execute on function public.has_area_submit_access(text, uuid) from public, anon;

grant execute on function public.has_module_access(text)        to authenticated;
grant execute on function public.has_module_admin_access(text)  to authenticated;
grant execute on function public.has_area_access(text, uuid)    to authenticated;
grant execute on function public.has_area_submit_access(text, uuid) to authenticated;

commit;
