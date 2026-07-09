-- =============================================================================
-- 00000000000181_scheduling_publish_lock_update_guard.sql
--
-- Back-port of an out-of-band hardening that was applied DIRECTLY to the linked
-- Supabase project (remote migration 20260708150033) but never committed to the
-- repo — found by the RR56 pre-launch migration-parity check. This file restores
-- the repo as the source of truth and puts the fix under CI (rls_isolation +
-- schema-drift). It is an idempotent `create or replace`, so re-applying it to a
-- project that already has the function is a no-op.
--
-- What it adds over migration 164: a fourth guard leg. Migration 164 blocked a
-- direct INSERT of a `published` row and a direct UPDATE/DELETE of an
-- already-`published` row, but deliberately ALLOWED the draft -> published
-- transition (its comment noted "that is how the publish RPC works"). That left
-- a bypass: an end-user PostgREST role could `UPDATE ... SET status='published'`
-- on a draft shift directly, minting a locked shift and skipping the two-person
-- publish-request approval. This adds:
--
--     if new.status = 'published' and old.status is distinct from 'published'
--       -> reject (42501)
--
-- The governed publish path is unaffected: the publish-request approval RPC runs
-- SECURITY DEFINER as the table owner, so it hits the `current_user in
-- ('postgres','supabase_admin','service_role')` bypass at the top and still
-- flips the row to published. Only DIRECT end-user writes are blocked.
-- =============================================================================

create or replace function public.schedule_shifts_publish_lock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

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

  if old.status = 'published' then
    raise exception
      'Schedule is published and locked: edits to a published shift require an explicit republish by a facility manager.'
      using errcode = '42501';
  end if;

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
