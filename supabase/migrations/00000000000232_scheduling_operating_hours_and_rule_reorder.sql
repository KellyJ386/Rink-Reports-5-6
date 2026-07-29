-- Scheduling: make operating hours configurable, and make compliance-rule
-- reordering atomic.
--
-- 1. Operating hours moved onto schedule_settings.
--    The grid's visible hour window and the "falls outside operating hours"
--    advisory (src/app/admin/scheduling/_lib/operating-hours.ts) read
--    facilities.settings -> scheduling.operating_hours (documented in
--    migration 128). But facilities is super-admin-write-only
--    (facilities_update in migration 4), so a scheduling admin could never
--    set it — the module read a setting no in-app writer could produce, and
--    every facility was pinned to the 06:00-23:00 fallback forever.
--
--    schedule_settings is already the scheduling module's own admin-writable
--    config table, so the columns belong here. The resolver keeps reading the
--    legacy facilities.settings location as a fallback, and this migration
--    backfills any value a super admin had hand-set, so nothing regresses.
--
--    Stored as minutes-since-midnight integers rather than `time` so that
--    "closes at midnight" is expressible as 1440 — a real case for rinks with
--    late ice that a `time` column cannot represent (23:59 is not midnight).
--
-- 2. scheduling_move_compliance_rule(): atomic sort_order swap.
--    The previous client-side implementation issued three sequential UPDATEs
--    (park A at a negative temp value, move B, move A). A failure between them
--    left the rule stranded at the negative placeholder, corrupting the order.
--    One SECURITY DEFINER function does the swap in a single statement.

-- ---------------------------------------------------------------------------
-- 1. Operating hours
-- ---------------------------------------------------------------------------

alter table public.schedule_settings
  add column if not exists operating_hours_start_minute integer not null default 360,
  add column if not exists operating_hours_end_minute integer not null default 1380;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'schedule_settings_operating_hours_check'
  ) then
    alter table public.schedule_settings
      add constraint schedule_settings_operating_hours_check
      check (
        operating_hours_start_minute >= 0
        and operating_hours_start_minute < 1440
        and operating_hours_end_minute > operating_hours_start_minute
        and operating_hours_end_minute <= 1440
      );
  end if;
end
$$;

comment on column public.schedule_settings.operating_hours_start_minute is
  'Facility opening time as minutes since local midnight (0-1439). Drives the scheduling grid''s first visible hour row and the outside-operating-hours advisory.';
comment on column public.schedule_settings.operating_hours_end_minute is
  'Facility closing time as minutes since local midnight (1-1440). 1440 means midnight, so a rink with late ice can be modelled exactly.';

-- Backfill from the legacy facilities.settings -> scheduling.operating_hours
-- location for any facility where a super admin had set it by hand. Only
-- well-formed "HH:MM" pairs that form a non-empty range are taken; everything
-- else keeps the column defaults (which equal the old hardcoded fallback).
update public.schedule_settings s
set
  operating_hours_start_minute = v.start_minute,
  operating_hours_end_minute = v.end_minute
from (
  select
    f.id as facility_id,
    (split_part(f.settings #>> '{scheduling,operating_hours,start}', ':', 1))::int * 60
      + (split_part(f.settings #>> '{scheduling,operating_hours,start}', ':', 2))::int as start_minute,
    (split_part(f.settings #>> '{scheduling,operating_hours,end}', ':', 1))::int * 60
      + (split_part(f.settings #>> '{scheduling,operating_hours,end}', ':', 2))::int as end_minute
  from public.facilities f
  where f.settings #>> '{scheduling,operating_hours,start}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and f.settings #>> '{scheduling,operating_hours,end}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
) v
where s.facility_id = v.facility_id
  and v.end_minute > v.start_minute;

-- ---------------------------------------------------------------------------
-- 2. Atomic compliance-rule reorder
-- ---------------------------------------------------------------------------

create or replace function public.scheduling_move_compliance_rule(
  p_rule_id uuid,
  p_delta integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
  v_rule record;
  v_neighbor record;
begin
  if p_delta not in (1, -1) then
    return jsonb_build_object('ok', false, 'error', 'delta must be 1 or -1');
  end if;

  -- SECURITY DEFINER bypasses RLS, so this gate replaces it: the caller must
  -- hold scheduling-admin rights, and the rule must live in the caller's own
  -- facility (has_module_admin_access is implicitly scoped to
  -- current_facility_id(), so the explicit facility match below is what stops
  -- a crafted id from reaching another tenant's rules).
  select r.id, r.facility_id, r.sort_order
    into v_rule
  from public.schedule_compliance_rules r
  where r.id = p_rule_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Rule not found.');
  end if;

  v_facility_id := v_rule.facility_id;

  if not (
    public.is_super_admin()
    or (
      public.has_module_admin_access('scheduling')
      and v_facility_id = public.current_facility_id()
    )
  ) then
    -- Same message as a genuine miss, so the RPC can't be used to probe for
    -- the existence of another facility's rule ids.
    return jsonb_build_object('ok', false, 'error', 'Rule not found.');
  end if;

  -- Lock the whole facility's rule set so two concurrent moves serialize.
  perform 1
  from public.schedule_compliance_rules
  where facility_id = v_facility_id
  for update;

  -- Re-read under the lock, then find the adjacent rule in the same ordering
  -- the console displays (sort_order nulls first, then id).
  select r.id, r.sort_order into v_rule
  from public.schedule_compliance_rules r
  where r.id = p_rule_id;

  if p_delta = -1 then
    select r.id, r.sort_order into v_neighbor
    from public.schedule_compliance_rules r
    where r.facility_id = v_facility_id
      and (
        coalesce(r.sort_order, -2147483648), r.id
      ) < (coalesce(v_rule.sort_order, -2147483648), v_rule.id)
    order by coalesce(r.sort_order, -2147483648) desc, r.id desc
    limit 1;
  else
    select r.id, r.sort_order into v_neighbor
    from public.schedule_compliance_rules r
    where r.facility_id = v_facility_id
      and (
        coalesce(r.sort_order, -2147483648), r.id
      ) > (coalesce(v_rule.sort_order, -2147483648), v_rule.id)
    order by coalesce(r.sort_order, -2147483648) asc, r.id asc
    limit 1;
  end if;

  if v_neighbor.id is null then
    return jsonb_build_object('ok', false, 'error', 'Cannot move further.');
  end if;

  -- Single statement: both rows swap, or neither does. Nulls are resolved to
  -- concrete positions so a never-ordered rule set still reorders sanely.
  update public.schedule_compliance_rules r
  set sort_order = case
        when r.id = v_rule.id
          then coalesce(v_neighbor.sort_order, coalesce(v_rule.sort_order, 0) + p_delta)
        else coalesce(v_rule.sort_order, coalesce(v_neighbor.sort_order, 0) - p_delta)
      end
  where r.id in (v_rule.id, v_neighbor.id);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.scheduling_move_compliance_rule(uuid, integer) from public;
grant execute on function public.scheduling_move_compliance_rule(uuid, integer) to authenticated;

comment on function public.scheduling_move_compliance_rule(uuid, integer) is
  'Swap a compliance rule with its neighbour in one statement. Replaces the three-UPDATE client-side dance that could strand a rule at a negative placeholder sort_order if it failed partway.';
