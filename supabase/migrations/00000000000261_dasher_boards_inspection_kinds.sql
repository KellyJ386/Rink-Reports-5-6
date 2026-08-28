-- =============================================================================
-- 00000000000261_dasher_boards_inspection_kinds.sql
--
-- Dasher Boards: annual contractor inspections + issue-category coverage.
--
-- Per ORFA guidance, dasher/shielding systems require regular inspection
-- INCLUDING an annual inspection by a qualified contractor, and the record
-- must show which specific panel was checked. The walk machinery already
-- produces the per-segment record (inspections + asset checks, migrations
-- 191/205); what it cannot yet express is WHICH KIND of inspection a walk
-- was, or who the qualified contractor was. This adds that as columns on the
-- walk record itself — an annual contractor inspection IS a walk, producing
-- the same per-segment checks, so the liability artifact stays one record
-- type with one immutability story (completed walks are frozen, policy +
-- guard, migration 192).
--
--   * inspection_kind: 'routine' (default — every existing walk backfills
--     correctly) | 'annual_contractor'.
--   * contractor_name / contractor_company: who performed the annual
--     inspection. Required for annual walks, forbidden on routine ones —
--     a half-filled record is worse than a loud error at start time.
--
-- Also completes the ORFA-shaped issue-category coverage: impact and crack
-- categories have existed since migration 194; this seeds the two that were
-- missing — hardware tightening (boards) and replacement (glass) — so the
-- walk flow can log every event type the guidance names without freeform
-- text. RLS is unchanged: kind/contractor ride the existing inspections
-- policies (inspector-owns-open-walk writes, frozen once completed).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Inspection kind + contractor attribution
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_inspections
  add column if not exists inspection_kind text not null default 'routine',
  add column if not exists contractor_name text,
  add column if not exists contractor_company text;

alter table public.dasher_boards_inspections
  drop constraint if exists dasher_boards_inspections_kind_check;
alter table public.dasher_boards_inspections
  add constraint dasher_boards_inspections_kind_check
    check (inspection_kind in ('routine', 'annual_contractor'));

alter table public.dasher_boards_inspections
  drop constraint if exists dasher_boards_inspections_contractor_iff_annual;
alter table public.dasher_boards_inspections
  add constraint dasher_boards_inspections_contractor_iff_annual check (
    (inspection_kind = 'annual_contractor'
      and contractor_name is not null
      and char_length(btrim(contractor_name)) > 0)
    or (inspection_kind = 'routine'
      and contractor_name is null
      and contractor_company is null)
  );

comment on column public.dasher_boards_inspections.inspection_kind is
  'What kind of walk this record attests: routine (the regular staff walk) or annual_contractor (the ORFA-required annual inspection by a qualified contractor). Same per-segment check record either way; frozen with the rest of the row once completed_at is set.';
comment on column public.dasher_boards_inspections.contractor_name is
  'The qualified contractor who performed an annual_contractor walk (required for that kind, forbidden on routine walks — CHECK-enforced).';
comment on column public.dasher_boards_inspections.contractor_company is
  'The contractor''s company, when the facility records it. Only on annual_contractor walks.';

create index if not exists idx_dasher_boards_inspections_rink_kind_completed
  on public.dasher_boards_inspections (rink_id, inspection_kind, completed_at desc);

-- -----------------------------------------------------------------------------
-- 2. Issue-category coverage: hardware tightening (boards), replacement
--    (glass). Restates the seed function (migration 257's body) with the two
--    added rows; idempotent backfill for existing facilities.
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_dasher_boards_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Door subtypes (the standard gate taxonomy: player/bench, scoreboard,
  -- spectator/public, machine/zamboni, penalty, emergency).
  insert into public.dasher_boards_asset_subtypes (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'door', s.label, s.sort_order
  from (values
    ('Bench', 0),
    ('Scoreboard', 1),
    ('Public Skate', 2),
    ('Zamboni', 3),
    ('Penalty', 4),
    ('Emergency', 5)
  ) as s(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: board panels (repair + cleaning + maintenance).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'board_panel', c.label, c.sort_order
  from (values
    ('Facing damage', 0),
    ('Protruding/missing fastener', 1),
    ('Panel joint misalignment', 2),
    ('Kickplate damage', 3),
    ('Caprail damage', 4),
    ('Resurfacer impact', 5),
    ('Hardware tightening', 6),
    ('Needs cleaning', 7),
    ('Debris/buildup', 8),
    ('Other', 9)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: glass panels (repair + cleaning + replacement).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'glass_panel', c.label, c.sort_order
  from (values
    ('Crack', 0),
    ('Chip/sharp edge', 1),
    ('Not seated/rattle', 2),
    ('Crazing at clamp', 3),
    ('Gasket damaged/missing', 4),
    ('Replacement', 5),
    ('Needs cleaning', 6),
    ('Film/residue', 7),
    ('Other', 8)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: doors (repair + cleaning).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'door', c.label, c.sort_order
  from (values
    ('Latch not holding', 0),
    ('Hinge/sag', 1),
    ('Not flush with board line', 2),
    ('Threshold damage', 3),
    ('Door glass damage', 4),
    ('Hardware protruding ice-side', 5),
    ('Needs cleaning', 7),
    ('Other', 8)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: corner radius segments (migration 257).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'corner_radius', c.label, c.sort_order
  from (values
    ('Facing damage', 0),
    ('Protruding/missing fastener', 1),
    ('Radius joint misalignment', 2),
    ('Needs cleaning', 3),
    ('Other', 4)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: post gaps (migration 257).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'post_gap', c.label, c.sort_order
  from (values
    ('Padding/trim damage', 0),
    ('Gap obstruction', 1),
    ('Other', 2)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;
end;
$$;

-- Backfill the two new categories for every existing facility (idempotent).
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_dasher_boards_config(f.id);
  end loop;
end;
$$;

commit;
