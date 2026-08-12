-- =============================================================================
-- 00000000000238_refrigeration_report_value_edit_rls.sql
-- Refrigeration recompute-on-edit: let facility refrigeration ADMINS correct a
-- submitted report value.
--
-- Before: refrigeration_report_values UPDATE was super-admin only, so the new
-- admin "edit reading" flow (which re-runs threshold checks, recomputes
-- dependent computed fields, and writes refrigeration_change_log entries) had
-- no non-super-admin path. This widens UPDATE to module admins WITHIN THEIR
-- OWN FACILITY, mirroring refrigeration_fields_update exactly.
--
-- Deliberately plain RLS — no SECURITY DEFINER function (that class of bypass
-- was flagged in a prior audit of this codebase). has_module_admin_access is
-- the standard per-module gate from migration 91 (reads user_permissions).
-- DELETE remains super-admin only; INSERT stays at >= submit (migration 114).
--
-- refrigeration_change_log INSERT already allows >= submit within facility
-- (migration 32), so the edit flow's audit rows need no policy change.
--
-- Idempotent: drop-if-exists + create.
-- Covered by supabase/tests/rls_isolation.sql (REFRIG-EDIT block).
-- =============================================================================
begin;

drop policy if exists refrigeration_report_values_update
  on public.refrigeration_report_values;

create policy refrigeration_report_values_update
  on public.refrigeration_report_values
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

commit;
