-- =============================================================================
-- 00000000000164_scheduling_publish_lock_insert_guard.sql
--
-- Close the CREATE leg of the publish-lock bypass.
--
-- Migration 148 froze published shifts at the DB boundary for UPDATE/DELETE
-- (trg_schedule_shifts_publish_lock fires BEFORE UPDATE OR DELETE), and the
-- grid/admin server actions route published-shift edits/cancels through the
-- governed SECURITY DEFINER RPCs. But INSERT was left unguarded: the
-- schedule_shifts_insert RLS policy gates only on facility + scheduling-admin,
-- never on status, and the trigger never fired on INSERT. So an end-user role
-- (the create server action, or a crafted PostgREST write) could INSERT a row
-- with status='published' directly — minting a locked shift outright and
-- skipping the two-person publish-request approval (requestSchedulePublish ->
-- scheduling_approve_publish_request).
--
-- The legitimate publish path never INSERTs a published row: it INSERTs drafts
-- and UPDATEs them to 'published' through the definer RPC (which runs as the
-- table owner and is therefore allowed). So rejecting a *published* INSERT from
-- an end-user role breaks nothing real and closes the bypass as defense-in-depth
-- behind the matching app-layer fix in grid-actions.ts (createGridShift always
-- writes status='draft').
-- =============================================================================

create or replace function public.schedule_shifts_publish_lock()
returns trigger
language plpgsql
as $$
begin
  -- Governed contexts may mutate / create a published shift:
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

  -- UPDATE: only a row that is ALREADY published is locked. Publishing a draft
  -- (old.status='draft' -> 'published') is how the publish RPC works, so it is
  -- allowed.
  if old.status = 'published' then
    raise exception
      'Schedule is published and locked: edits to a published shift require an explicit republish by a facility manager.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.schedule_shifts_publish_lock() is
  'Publish-lock backstop: rejects a direct INSERT of a published row, and a direct UPDATE/DELETE of an already-published row, from an end-user PostgREST role. Governed SECURITY DEFINER RPCs (run as the table owner) and trusted backend roles are allowed, so swap/claim/publish/cancel/open-fill keep working. Closes the publish-lock bypass (create + edit + delete legs).';

-- Recreate the trigger to also fire BEFORE INSERT.
drop trigger if exists trg_schedule_shifts_publish_lock on public.schedule_shifts;
create trigger trg_schedule_shifts_publish_lock
  before insert or update or delete on public.schedule_shifts
  for each row execute function public.schedule_shifts_publish_lock();
