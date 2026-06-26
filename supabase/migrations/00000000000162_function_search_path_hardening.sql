-- =============================================================================
-- 00000000000162_function_search_path_hardening.sql
-- Advisor: function_search_path_mutable. Two trigger functions were created
-- without an explicit `search_path`, so they resolve unqualified names against
-- the caller's search_path. Pin both to `public, pg_temp` (identical bodies,
-- no behavior change) so name resolution can't be influenced by the caller.
--
--   * schedule_shifts_publish_lock()  -- migration 148
--   * schedule_swap_set_expiry()      -- migration 158
--
-- Both already schema-qualify the objects they touch; this just removes the
-- mutable-search_path warning and the associated injection surface.
-- =============================================================================

-- 1. Publish-lock trigger (migration 148) — body unchanged; add SET search_path.
create or replace function public.schedule_shifts_publish_lock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Governed contexts may mutate a published shift:
  --   * SECURITY DEFINER scheduling RPCs run as the table owner ('postgres');
  --   * trusted backend roles (service_role / supabase_admin);
  --   * an explicit transaction-local bypass flag set by a future governed
  --     writer (select set_config('rr.publish_lock_bypass','on',true)).
  -- A direct write from an end-user role — i.e. the grid/edit server actions or
  -- a crafted request — is rejected once the shift is published.
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
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

-- 2. Swap-expiry trigger (migration 158) — body unchanged; add SET search_path.
create or replace function public.schedule_swap_set_expiry() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_hours int; v_shift_start timestamptz;
begin
  if new.expires_at is null then
    select swap_expiry_hours into v_hours from public.schedule_settings where facility_id = new.facility_id;
    select starts_at into v_shift_start from public.schedule_shifts where id = new.requester_shift_id;
    new.expires_at := least(coalesce(new.created_at, now()) + make_interval(hours => coalesce(v_hours, 72)), v_shift_start);
  end if;
  return new;
end $$;
