-- =============================================================================
-- 00000000000225_guard_bypass_guc_privileged_only.sql
--
-- D-3 (RLS hardening audit): trigger-only write-locks that stand down on a
-- namespaced transaction-local GUC could, in principle, be unlocked by the very
-- role they are meant to constrain. Any role may `SET rr.publish_lock_bypass`
-- (or `rr.dasher_boards_guard_bypass`) on its own session, and the guard
-- functions honored the flag from ANY caller:
--
--   * schedule_shifts_publish_lock()            (migrations 148/162/164/181)
--   * schedule_open_shifts_lock()               (migration 210)
--   * schedule_swap_requests_apply_guard()      (migration 210)
--   * dasher_boards_guard_exempt()              (migration 192)
--
-- Not reachable through PostgREST's single-statement transactions today (an
-- end user cannot issue a separate SET and then the DML in the same
-- transaction), but fragile: it makes a client-settable GUC part of the
-- security boundary.
--
-- VERIFICATION (why this is safe):
--   * No function anywhere in the codebase actually SETS either GUC — a
--     repository-wide search finds them only in comments (documented escape
--     hatch) and in the RLS test harness. Every genuinely-governed writer is a
--     SECURITY DEFINER RPC that runs as the table owner ('postgres'), so it is
--     already exempt via the existing `current_user in
--     ('postgres','supabase_admin','service_role')` branch (publish-lock) or via
--     is_super_admin()/service_role (dasher) — it never needed the GUC.
--
-- FIX: honor each bypass GUC ONLY when current_user is one of the privileged
-- owner/backend roles. For the publish-lock guards this makes the GUC branch a
-- documented no-op behind the role check (an end-user 'authenticated' role can
-- no longer stand the guard down by setting the flag); for dasher — whose other
-- exempt branches do NOT check current_user — it is a genuine tightening. A
-- maintenance operator connected AS an owner role keeps the working escape
-- hatch. Nothing in src/ changes, and the RLS harness only ever sets
-- rr.dasher_boards_guard_bypass while `set local role postgres` is active, so it
-- still exercises the exemption.
--
-- Function-body-only change (no signatures, no table shape): the generated DB
-- types and the schema snapshot are unaffected.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- schedule_shifts_publish_lock() — body identical to migration 181 except the
-- GUC bypass is now gated on a privileged current_user.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_shifts_publish_lock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Governed contexts may mutate / create / publish a shift:
  --   * SECURITY DEFINER scheduling RPCs run as the table owner ('postgres');
  --   * trusted backend roles (service_role / supabase_admin);
  --   * an explicit transaction-local bypass flag set by a governed writer
  --     (select set_config('rr.publish_lock_bypass','on',true)) — honored ONLY
  --     from a privileged owner role, so an end-user PostgREST role can no
  --     longer stand this guard down by setting the GUC itself (D-3).
  -- A direct write from an end-user role — i.e. the grid/edit/create server
  -- actions or a crafted request — is rejected per the rules below.
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or (coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on'
         and current_user in ('postgres', 'supabase_admin', 'service_role')) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- INSERT: a brand-new shift must be a draft. Publishing happens only through
  -- the governed two-person publish-request RPC (draft -> published UPDATE,
  -- which runs as the table owner). Minting a 'published' row directly is the
  -- create-leg of the publish-lock bypass.
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      raise exception
        'Schedule is published and locked: a published shift cannot be created directly. Create a draft and publish it through the publish-request approval.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception
        'Schedule is published and locked: a published shift cannot be deleted directly. Cancel it through the scheduling tools or republish.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE, already-published row: locked regardless of the new values.
  if old.status = 'published' then
    raise exception
      'Schedule is published and locked: edits to a published shift require an explicit republish by a facility manager.'
      using errcode = '42501';
  end if;

  -- UPDATE, draft/cancelled row transitioning TO published: this is the
  -- update-leg of the publish-lock bypass. Publishing is exclusively the
  -- two-person scheduling_approve_publish_request() flow; a direct end-user
  -- UPDATE may never perform this transition, no matter how it currently got
  -- routed at the app layer.
  if new.status = 'published' and old.status is distinct from 'published' then
    raise exception
      'Schedule cannot be published directly: publishing requires the two-person publish-request approval.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- schedule_open_shifts_lock() — body identical to migration 210 except the GUC
-- bypass is now gated on a privileged current_user.
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
  -- owner, plus trusted backend roles and an explicit transaction-local bypass
  -- honored ONLY from a privileged owner role (D-3).
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or (coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on'
         and current_user in ('postgres', 'supabase_admin', 'service_role')) then
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

-- ---------------------------------------------------------------------------
-- schedule_swap_requests_apply_guard() — body identical to migration 210 except
-- the GUC bypass is now gated on a privileged current_user.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_swap_requests_apply_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or (coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on'
         and current_user in ('postgres', 'supabase_admin', 'service_role')) then
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

-- ---------------------------------------------------------------------------
-- dasher_boards_guard_exempt() — body identical to migration 192 except the GUC
-- bypass is now gated on a privileged current_user. Unlike the publish-lock
-- guards, this function's other exempt branches (is_super_admin, service_role)
-- do NOT check current_user, so this is a genuine (non-redundant) tightening.
-- ---------------------------------------------------------------------------
create or replace function public.dasher_boards_guard_exempt()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select
    public.is_super_admin()
    or coalesce(auth.role(), '') = 'service_role'
    or (
      coalesce(current_setting('rr.dasher_boards_guard_bypass', true), '') = 'on'
      and current_user in ('postgres', 'supabase_admin', 'service_role')
    );
$$;

comment on function public.dasher_boards_guard_exempt() is
  'True when Dasher Boards guard triggers should stand down: super admin, '
  'service-role backend, or the governed rr.dasher_boards_guard_bypass setting '
  'HONORED ONLY FROM A PRIVILEGED OWNER ROLE (D-3: a client-settable GUC alone '
  'can no longer exempt an end-user role).';
