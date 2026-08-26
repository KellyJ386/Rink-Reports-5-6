-- =============================================================================
-- 00000000000256_publish_lock_rls_backstop.sql
--
-- Give the scheduling publish lock an RLS fence of its own.
--
-- Until now the four schedule_shifts policies were status-blind: RLS alone
-- permitted a scheduling admin (via raw PostgREST) to INSERT a row born
-- 'published', UPDATE or DELETE a published row, and flip draft->published.
-- The ONLY thing enforcing the lock was trg_schedule_shifts_publish_lock —
-- sound (148/164/181, GUC gated by 226), but a single point of failure:
-- drop that one trigger and the entire invariant vanishes with no backstop.
--
-- This migration re-creates the write policies with a status fence so RLS
-- and the trigger are two INDEPENDENT layers:
--   * INSERT  with check .. and status <> 'published'  -> a row cannot be
--     born published (raises 42501, like the trigger did).
--   * UPDATE  using .. and status <> 'published'       -> published rows are
--     not updatable targets (statement runs, affects 0 rows — the same
--     silent-scope semantics RLS already gives cross-facility writes);
--            with check .. and status <> 'published'   -> nothing can
--     transition INTO published (raises 42501).
--   * DELETE  using .. and status <> 'published'       -> published rows are
--     not deletable targets (0 rows).
-- The governed SECURITY DEFINER RPCs (scheduling_admin_*, approve-publish,
-- claim/drop) run as the table owner, which RLS does not bind, so every
-- governed transition keeps working. The super-admin arm is inside the
-- fence on purpose: like the trigger, the lock binds super admins too —
-- only the governed RPCs may move published rows.
--
-- ALSO: schedule_publish_requests_update previously allowed a decider to
-- set status to 'published' OR 'rejected' by direct UPDATE. Marking a
-- request published without the RPC skipped re-validation, the
-- schedule_publish_events audit row, open-shift seeding, and notifications
-- (the shifts stayed drafts — a governance/audit defect, not a lock
-- bypass). Direct updates may now only record a REJECTION; the approve
-- path is the RPC, which as owner is unaffected by this policy.
--
-- HYGIENE: the two trigger functions added in migration 210 never got the
-- EXECUTE revoke that 163 established for their peers. Inert (they return
-- trigger and are uncallable from PostgREST), but restore the pattern.
--
-- rls_isolation.sql: SCHED-148/DND direct-write probes updated to the
-- 0-row semantics, plus new PLRB-256 assertions (fence holds with the
-- bypass GUC set as authenticated; cancelled rows can't be re-published;
-- publish requests can't be decided 'published' by direct PATCH).
-- =============================================================================

-- schedule_shifts: status-aware write policies -------------------------------

drop policy if exists schedule_shifts_insert on public.schedule_shifts;
create policy schedule_shifts_insert on public.schedule_shifts
  for insert to authenticated
  with check (
    (
      public.is_super_admin()
      or (facility_id = public.current_facility_id()
          and public.has_module_admin_access('scheduling'))
    )
    and status <> 'published'
  );

drop policy if exists schedule_shifts_update on public.schedule_shifts;
create policy schedule_shifts_update on public.schedule_shifts
  for update to authenticated
  using (
    (
      public.is_super_admin()
      or (facility_id = public.current_facility_id()
          and public.has_module_admin_access('scheduling'))
    )
    and status <> 'published'
  )
  with check (
    (
      public.is_super_admin()
      or (facility_id = public.current_facility_id()
          and public.has_module_admin_access('scheduling'))
    )
    and status <> 'published'
  );

drop policy if exists schedule_shifts_delete on public.schedule_shifts;
create policy schedule_shifts_delete on public.schedule_shifts
  for delete to authenticated
  using (
    (
      public.is_super_admin()
      or (facility_id = public.current_facility_id()
          and public.has_module_admin_access('scheduling'))
    )
    and status <> 'published'
  );

-- schedule_publish_requests: direct updates may only record a rejection ------

drop policy if exists schedule_publish_requests_update on public.schedule_publish_requests;
create policy schedule_publish_requests_update on public.schedule_publish_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.current_employee_module_permission('scheduling') >= 'publish'
        and requested_by_employee_id <> public.current_employee_id()
        and status = 'pending')
  )
  with check (
    (
      public.is_super_admin()
      or (facility_id = public.current_facility_id()
          and public.current_employee_module_permission('scheduling') >= 'publish'
          and requested_by_employee_id <> public.current_employee_id()
          and decided_by_employee_id = public.current_employee_id())
    )
    and status = 'rejected'
  );

-- Hygiene: EXECUTE revokes migration 210's trigger functions never received --

revoke execute on function public.schedule_open_shifts_lock() from public, anon, authenticated;
revoke execute on function public.schedule_swap_requests_apply_guard() from public, anon, authenticated;
