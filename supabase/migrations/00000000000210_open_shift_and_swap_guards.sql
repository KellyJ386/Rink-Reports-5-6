-- =============================================================================
-- 00000000000210_open_shift_and_swap_guards.sql
--
-- Extends the publish lock to the two scheduling tables adjacent to
-- schedule_shifts that were still directly writable over PostgREST
-- (prompt-library Defect 4, claims A and B — both confirmed by adversarial
-- re-verification; claim C was refuted as framed and is not addressed here).
--
-- WHY schedule_shifts BEING LOCKED WAS NOT ENOUGH
-- -----------------------------------------------
-- Migrations 148/164/181 froze schedule_shifts: a published row cannot be
-- updated or deleted by an end-user role, a row cannot be inserted as
-- published, and draft -> published is reserved to the two-person publish
-- request. None of that covers the satellite tables that DESCRIBE how a
-- published shift may be filled.
--
-- A. schedule_open_shifts. Its RLS comes from migration 15 (loosened from admin
--    to submit for INSERT by migration 61); nothing since has altered it. UPDATE
--    and DELETE are gated only on has_module_admin_access('scheduling') — no
--    column restriction and no publish predicate. The sole trigger on the table
--    is set_updated_at, and the only CHECK enumerates legal claim_status VALUES,
--    not legal transitions.
--
--    A direct write cannot actually assign anybody — the parent shift is still
--    frozen — so the exposure is not "unauthorized assignment". It is:
--
--      * Approval-gate bypass, the one that matters. Setting
--        approval_required = false flips a listing from "a manager must decide"
--        to first-come. scheduling_claim_open_shift branches purely on that
--        column, so the next staff claim auto-fills a published shift that
--        facility policy required a human to approve. Assignment violations are
--        still checked; it is the APPROVAL STEP that disappears. The table's own
--        design treats the listing as a snapshot fixed at creation, so this was
--        already contrary to intent.
--      * Silent staffing desync. claim_status = 'filled' marks the queue as
--        staffed while the published shift stays unassigned. Both the staff
--        queue and the admin governance panel read this table, so nobody is
--        scheduled and nobody sees a gap.
--      * Listing removal / expiry tampering. Deleting a listing leaves a
--        published, unassigned shift with no claim path; expires_at can be
--        pushed past the scheduling_expire_open_claims sweeper.
--
-- B. schedule_swap_requests. The employee branches of the UPDATE policy are
--    tightly transition-constrained, but the admin branch is an unqualified
--    has_module_admin_access('scheduling') on both USING and WITH CHECK, so
--    'manager_approved' is reachable in a single PATCH. No trigger or CHECK
--    constrains status transitions.
--
--    Approving directly moves no shift — scheduling_apply_swap is the only
--    writer of the exchange. The damage is that the divergence is ONE-WAY AND
--    UNRECOVERABLE: scheduling_apply_swap then refuses the swap (its guard is
--    status in ('pending','accepted')), and denySwap/cancelSwap both refuse on
--    'manager_approved'. The request is bricked in a state that reads
--    "Approved & applied" while nothing happened and neither employee was
--    notified.
--
-- WHY THIS IS SAFE
-- ----------------
-- Both guards reuse the exemption from schedule_shifts_publish_lock (migration
-- 181): the table owner, service_role, and an explicit transaction-local bypass
-- GUC pass straight through. Every governed path — scheduling_claim_open_shift,
-- scheduling_decide_open_claim, scheduling_admin_assign_open_shift,
-- scheduling_apply_swap, scheduling_expire_open_claims and
-- scheduling_expire_stale_swaps — is SECURITY DEFINER and runs as the owner, so
-- all of them are unaffected.
--
-- No application change accompanies this migration. Nothing in src/ writes
-- schedule_open_shifts directly, and the swap guard is deliberately scoped to
-- the single transition the app never performs: governance-actions.ts writes
-- 'denied' and 'cancelled' directly as authenticated and must keep working,
-- while no code anywhere sets 'manager_approved' (every occurrence in src/ is a
-- read, comparison, or display label).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. schedule_open_shifts — the listing is fixed at creation for end users.
-- ---------------------------------------------------------------------------

create or replace function public.schedule_open_shifts_lock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_changed text;
begin
  -- Governed contexts: the SECURITY DEFINER scheduling RPCs run as the table
  -- owner, plus trusted backend roles and an explicit transaction-local bypass.
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    -- Removing the listing for a published shift strands it: published,
    -- unassigned, and with no claim path back.
    if exists (
      select 1 from public.schedule_shifts s
       where s.id = old.shift_id
         and s.status = 'published'
    ) then
      raise exception
        'This open-shift listing belongs to a published shift and cannot be deleted directly. Cancel or fill it through the scheduling tools so the shift keeps a claim path.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE. Named per column so a rejection says which field was refused;
  -- updated_at is intentionally absent so the set_updated_at trigger's own
  -- write passes.
  v_changed := case
    when new.shift_id                is distinct from old.shift_id                then 'shift_id'
    when new.claim_status            is distinct from old.claim_status            then 'claim_status'
    when new.claimed_by_employee_id  is distinct from old.claimed_by_employee_id  then 'claimed_by_employee_id'
    when new.claimed_at              is distinct from old.claimed_at              then 'claimed_at'
    when new.expires_at              is distinct from old.expires_at              then 'expires_at'
    when new.approval_required       is distinct from old.approval_required       then 'approval_required'
    when new.approved_by_employee_id is distinct from old.approved_by_employee_id then 'approved_by_employee_id'
    when new.approved_at             is distinct from old.approved_at             then 'approved_at'
    else null
  end;

  if v_changed is not null then
    raise exception
      'Open-shift listings are governed: "%" cannot be changed by a direct write. Use the scheduling RPCs (staff claim, admin decide, or admin assign), which re-validate the assignment, guard against lost updates, and notify the claimant.',
      v_changed
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.schedule_open_shifts_lock() is
  'BEFORE UPDATE/DELETE guard on schedule_open_shifts. For end-user roles the '
  'listing is immutable after creation and cannot be deleted while its parent '
  'shift is published; the SECURITY DEFINER scheduling RPCs are exempt because '
  'they run as the table owner. Closes the approval_required bypass, which let a '
  'scheduling admin turn a manager-approval listing into first-come with one '
  'direct PATCH (Defect 4A, migration 210).';

drop trigger if exists trg_schedule_open_shifts_lock on public.schedule_open_shifts;
create trigger trg_schedule_open_shifts_lock
  before update or delete on public.schedule_open_shifts
  for each row execute function public.schedule_open_shifts_lock();

-- ---------------------------------------------------------------------------
-- B. schedule_swap_requests — only the governed RPC may apply a swap.
-- ---------------------------------------------------------------------------

create or replace function public.schedule_swap_requests_apply_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on' then
    return new;
  end if;

  -- Deliberately narrow: this rejects ONLY the transition into the applied
  -- state. 'accepted', 'denied' and 'cancelled' are written directly by the app
  -- as authenticated and must continue to work.
  if new.status = 'manager_approved'
     and old.status is distinct from 'manager_approved' then
    raise exception
      'A swap can only be applied through scheduling_apply_swap(), which exchanges the two shifts, re-validates both assignments, and notifies both employees. Marking it approved directly would leave the shifts unchanged and the swap permanently unrunnable.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.schedule_swap_requests_apply_guard() is
  'BEFORE UPDATE guard on schedule_swap_requests. Rejects an end-user transition '
  'into ''manager_approved'', which previously bricked the request: '
  'scheduling_apply_swap refuses a swap that is not pending/accepted, and both '
  'deny and cancel refuse one already approved, so a direct write left it '
  'reading as applied while no shift had moved (Defect 4B, migration 210). '
  'Other transitions are untouched.';

drop trigger if exists trg_schedule_swap_apply_guard on public.schedule_swap_requests;
create trigger trg_schedule_swap_apply_guard
  before update on public.schedule_swap_requests
  for each row execute function public.schedule_swap_requests_apply_guard();
