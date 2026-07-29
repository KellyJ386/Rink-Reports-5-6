-- =============================================================================
-- 00000000000230_offline_sync_queue_protect_synced_token.sql
--
-- E-3: migration 225 gave every user DELETE on their OWN offline_sync_queue
-- rows (so releaseClaim() could free a stale claim) but did not scope it by
-- sync_status. `local_id` is the SOLE replay dedup key —
-- src/app/api/offline-sync/route.ts upserts with
-- `{ onConflict: "local_id", ignoreDuplicates: true }` and treats a zero-row
-- claim on an already-`synced` row as "already processed" (claimQueueSlot in
-- src/lib/offline/claim.ts). Deleting one's own `synced` row therefore destroys
-- the idempotency token: re-POSTing the identical body to /api/offline-sync
-- claims cleanly and persists the report a SECOND time — duplicate
-- incident/accident/daily/air-quality records, created by a plain staff user.
--
-- FIX: keep migration 225's ownership predicate verbatim and AND on
-- `sync_status <> 'synced'`. sync_status is NOT NULL with a
-- check (pending|synced|failed) (migration 31), so the term is total.
--
-- Verified nothing legitimate deletes a `synced` row as the user:
--   * releaseClaim() (src/lib/offline/claim.ts) is called only on a persist
--     FAILURE, i.e. while the row is still `pending` — the sole reason
--     migration 225 exists. markClaimSynced() is the UPDATE that sets 'synced'
--     and is untouched here (this is a DELETE policy).
--   * purge_old_offline_sync_queue() (migration 134) is the only thing that
--     removes synced rows (>90 days). It is SECURITY DEFINER owned by
--     `postgres` (BYPASSRLS) with EXECUTE revoked from public/anon/authenticated
--     and granted to service_role, invoked by /api/cron/run-retention-purge —
--     so it never evaluates this policy.
--   * src/app/admin/page.tsx only COUNTs queue rows.
--   * public/sw.js deletes from the device-side IndexedDB store, not the table.
--   * super_admin keeps unrestricted DELETE, exactly as in migrations 31/224.
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
      -- A synced row IS the replay dedup token; destroying it re-opens the
      -- local_id for a duplicate submission.
      sync_status <> 'synced'
      and facility_id = public.current_facility_id()
      and employee_id in (
        select employees.id from public.employees
         where employees.user_id = (select auth.uid())
           and employees.is_active = true
      )
    )
  );
