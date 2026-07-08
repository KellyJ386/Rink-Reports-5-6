-- =============================================================================
-- 00000000000180_scheduling_publish_lock_update_guard.sql
--
-- Closes the UPDATE leg of the publish-lock bypass (RR56-SEC-FIX security
-- re-audit). Migrations 148/164 froze an ALREADY-published row (any UPDATE or
-- DELETE where OLD.status = 'published' is rejected for an end-user role) and
-- rejected a direct INSERT of a published row. But the UPDATE branch of
-- schedule_shifts_publish_lock() only ever inspected OLD.status — a row whose
-- OLD.status was 'draft' (or 'cancelled') was allowed through unconditionally,
-- with NO check on NEW.status. That is exactly the transition that is supposed
-- to be governed exclusively by scheduling_approve_publish_request() (the
-- two-person publish-request flow): the trigger's own comments assumed "only
-- the RPC does draft -> published," but nothing enforced that assumption.
--
-- grid-actions.ts's updateGridShift() accepted an optional client-supplied
-- `status` field on its update schema and forwarded it into a direct
-- `.from("schedule_shifts").update(patch)` whenever the shift's CURRENT status
-- wasn't already 'published' (the isPublished branch only intercepts edits to
-- an already-published row). So `updateGridShift({ id: <draftShiftId>, status:
-- "published" })`, called by any user holding has_module_admin_access
-- ('scheduling') (the ordinary scheduling-admin write grant — no elevated role
-- required), published a shift unilaterally: no second approver, no
-- scheduling_assignment_violations re-validation, no schedule_publish_events
-- audit row, no schedule_open_shifts listing for an unassigned shift, no
-- notify_on_publish notification. The app-layer fix (same PR) removes `status`
-- from updateGridShift's accepted input entirely, since no real caller
-- (week-board.tsx) ever sends it. This migration is the DB-boundary backstop:
-- even a crafted direct PostgREST UPDATE against schedule_shifts can no longer
-- perform a draft/cancelled -> published transition from an end-user role,
-- full stop. The governed RPC is unaffected: it runs SECURITY DEFINER as the
-- table owner ('postgres'), which the trigger's existing current_user bypass
-- already exempts.
-- =============================================================================

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
  --     (select set_config('rr.publish_lock_bypass','on',true)).
  -- A direct write from an end-user role — i.e. the grid/edit/create server
  -- actions or a crafted request — is rejected per the rules below.
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on' then
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

comment on function public.schedule_shifts_publish_lock() is
  'Publish-lock backstop: rejects a direct INSERT of a published row, a direct UPDATE/DELETE of an already-published row, and a direct UPDATE transitioning a row TO published, all from an end-user PostgREST role. Governed SECURITY DEFINER RPCs (run as the table owner) and trusted backend roles are allowed, so swap/claim/publish/cancel/open-fill keep working. Closes the publish-lock bypass (create + edit + delete + direct-publish legs).';

-- Trigger definition (targets, timing) is unchanged from migration 164 — only
-- the function body changed above, so no DROP/CREATE TRIGGER needed here.
