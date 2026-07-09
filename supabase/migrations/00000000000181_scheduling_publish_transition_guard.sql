-- =============================================================================
-- 00000000000181_scheduling_publish_transition_guard.sql
--
-- Close the last leg of the publish-lock bypass: draft self-publish via UPDATE.
--
-- Migration 148 froze already-published shifts at the DB boundary (UPDATE/
-- DELETE) and migration 164 rejected INSERTing a row that is born 'published'.
-- But the UPDATE leg only checked OLD.status: a draft -> published transition
-- was allowed for every role, because that is how the governed publish RPC
-- flips rows. An end-user role (the grid update server action, which until the
-- matching app-layer fix accepted a client-supplied `status`, or a crafted
-- PostgREST write) could therefore UPDATE a draft straight to 'published' —
-- minting a locked shift while skipping the two-person publish-request
-- approval (requestSchedulePublish -> scheduling_approve_publish_request), its
-- self-approval prohibition, the re-validation of every draft against
-- scheduling_assignment_violations, the schedule_publish_events audit row,
-- open-shift seeding, and publish notifications.
--
-- The legitimate publish path is unaffected: scheduling_approve_publish_request
-- (and the republish leg of scheduling_admin_edit_published_shift) run as
-- SECURITY DEFINER owned by the table owner, so they hit the governed-context
-- bypass before any status check. Rejecting a *transition into* 'published'
-- from an end-user role breaks nothing real and completes the trigger's
-- coverage: INSERT-published, UPDATE-of-published, UPDATE-into-published, and
-- DELETE-of-published are now all governed. A draft -> cancelled transition
-- stays allowed — it is not governance-sensitive (drafts are directly
-- deletable anyway).
-- =============================================================================

-- search_path is pinned (migration 162 function-hardening) — keep it on the
-- replacement so this function stays consistent with the hardened set.
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
  -- actions or a crafted request — is rejected.
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

  -- UPDATE: an end-user role may never transition a row INTO 'published'.
  -- Publishing happens only through the governed two-person publish-request
  -- RPC (SECURITY DEFINER, runs as the table owner, so it took the governed
  -- bypass above and never reaches this check).
  if new.status = 'published' and old.status is distinct from 'published' then
    raise exception
      'Shifts cannot be published directly. Publish through the publish-request approval.'
      using errcode = '42501';
  end if;

  -- UPDATE: a row that is ALREADY published is locked.
  if old.status = 'published' then
    raise exception
      'Schedule is published and locked: edits to a published shift require an explicit republish by a facility manager.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.schedule_shifts_publish_lock() is
  'Publish-lock backstop: rejects a direct INSERT of a published row, a direct UPDATE/DELETE of an already-published row, and a direct UPDATE transitioning a row into published, from an end-user PostgREST role. Governed SECURITY DEFINER RPCs (run as the table owner) and trusted backend roles are allowed, so swap/claim/publish/cancel/open-fill keep working. Closes the publish-lock bypass (create + edit + delete + publish-transition legs).';
