-- =============================================================================
-- 00000000000123_module_access_any_enabled_action.sql
-- Fix the submit-vs-view read gate: has_module_access() now grants module READ
-- access for ANY enabled action, not just an explicit `view` grant.
--
-- The bug: the staff submission pages gate on `submit` (e.g.
-- reports/refrigeration/page.tsx -> currentUserCan(..., 'submit')) and the
-- value-INSERT RLS requires `submit` (migration 114), but the SELECT RLS that
-- loads a module's *config* (sections / fields / equipment / thresholds /
-- settings, and the analogous config tables for every other module) is gated on
-- public.has_module_access(), which only returned true for an enabled `view`
-- grant. A user provisioned with `submit` but no `view` therefore passed the
-- page gate and then read ZERO config rows under RLS — the form rendered
-- "Not configured yet" even though the user can submit.
--
-- A user can never submit (or edit / admin) a module they cannot see, so any
-- enabled grant must imply read access. Drop the action = 'view' filter so the
-- helper matches its name: "has access to this module at all". Facility scoping
-- and the super-admin short-circuit are unchanged; this only widens which
-- *actions* satisfy the read gate, never which *facility* a user can read.
--
-- has_module_admin_access() (the admin-write gate) is intentionally left as-is.
--
-- ROLLBACK (restore migration 91 behaviour — require enabled `view`):
--   create or replace function public.has_module_access(p_module_key text)
--   returns boolean language sql stable security definer
--   set search_path = public, pg_temp as $fn$
--     select p_module_key is not null and (
--       public.is_super_admin() or exists (
--         select 1 from public.user_permissions up
--          where up.user_id = auth.uid()
--            and up.facility_id = public.current_facility_id()
--            and up.module_name = p_module_key
--            and up.action = 'view'::public.user_action
--            and up.enabled = true));
--   $fn$;
-- =============================================================================
begin;

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
           and up.enabled     = true
      )
    );
$$;

comment on function public.has_module_access(text) is
  'True if super admin OR the current user has ANY enabled grant (view / submit '
  '/ edit / admin) on the named module at their current facility '
  '(public.user_permissions). Any enabled action implies the user must be able '
  'to read the module''s config, so the read gate is no longer view-only '
  '(migration 123, was view-only in migration 91).';

-- CREATE OR REPLACE preserves privileges, but re-assert the lockdown so the
-- grant posture is explicit and matches migrations 91 / 26 / 66.
revoke execute on function public.has_module_access(text) from public, anon;
grant  execute on function public.has_module_access(text) to authenticated;

commit;
