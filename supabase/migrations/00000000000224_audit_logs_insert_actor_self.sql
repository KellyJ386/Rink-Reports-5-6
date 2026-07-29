-- =============================================================================
-- 00000000000224_audit_logs_insert_actor_self.sql
--
-- D-1 (RLS hardening audit): the audit_logs INSERT policy trusted a
-- client-supplied actor. Introduced in migration 4 and recreated identically at
-- the partitioning cutover (migration 222), its WITH CHECK was
-- `is_super_admin() OR facility_id = current_facility_id()`, so any
-- authenticated staff member could POST an audit_logs row carrying an ARBITRARY
-- actor_user_id — framing a colleague. The hash chain (migration 217) makes the
-- log tamper-EVIDENT, but it does not stop FABRICATION: a forged row is a
-- perfectly valid, correctly-chained new page.
--
-- New rule: a non-super-admin authenticated insert must additionally name
-- ITSELF as the actor (actor_user_id = auth.uid()). This is exactly the app's
-- own behavior — logAudit()/buildAuditRow() (src/lib/audit) always stamp
-- actor_user_id with the caller's auth.uid() — so the legitimate write path is
-- unaffected.
--
-- The privileged write paths are also unaffected:
--   * The DML audit trigger audit_row_change() (migration 41/213) and the
--     governed RPCs that append their own rows (e.g. approve_audit_destruction,
--     migration 217) are SECURITY DEFINER owned by a BYPASSRLS role, so they run
--     as the table owner ('postgres'), not `authenticated` — this RLS policy
--     never applies to them.
--   * super_admin keeps the unrestricted branch for system rows, and
--     service_role bypasses RLS entirely.
--
-- Policy-only change: no table shape changes, so the generated DB types and the
-- schema snapshot are unaffected.
-- =============================================================================

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and actor_user_id = (select auth.uid())
    )
  );
