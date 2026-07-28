-- =============================================================================
-- 00000000000224_offline_sync_queue_owner_delete.sql
--
-- D-2 (RLS hardening audit): offline_sync_queue had no DELETE policy for
-- regular users. Migration 31 granted DELETE only to super_admin, and migration
-- 98 recreated the select/insert/update policies but left that super_admin-only
-- delete in place. So releaseClaim() in src/lib/offline/claim.ts — which
-- deletes a row by local_id under the caller's OWN session to release a stale
-- claim — silently affected 0 rows for ordinary staff. Abandoned `pending`
-- rows then accumulated with no way for the owner to clear them.
--
-- Add a DELETE policy scoped to the caller's OWN queue rows, mirroring EXACTLY
-- the ownership predicate of the migration-98 insert policy (own active
-- employee row + facility scope; super_admin unrestricted). Deliberately NOT
-- widened to facility admins: a claim is released only by its own owner (or a
-- super admin), matching who the INSERT policy already lets create the row.
--
-- Policy-only change: no table shape changes, so the generated DB types and the
-- schema snapshot are unaffected.
-- =============================================================================

drop policy if exists offline_sync_queue_delete on public.offline_sync_queue;
create policy offline_sync_queue_delete on public.offline_sync_queue
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and employee_id in (
        select employees.id from public.employees
         where employees.user_id = (select auth.uid())
           and employees.is_active = true
      )
    )
  );
