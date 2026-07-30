-- =============================================================================
-- 00000000000233_dasher_boards_glass_numbering.sql
--
-- Dasher Boards: let a facility number its glass to match the physical rink.
--
-- Glass labels (G1..Gn, allocated by nextLabel() and frozen by the
-- retired-labels trigger in migration 192) are PERMANENT IDENTITY — issue
-- history follows them forever and a label is never reused. They are therefore
-- unusable as "the number painted on the glass": a rink may start numbering at
-- the penalty box, run counterclockwise, start at 0 or 101, or use no prefix at
-- all, and an edited perimeter (insert/remove/door conversion) makes the
-- identity labels diverge from walk order by design.
--
-- This adds a DISPLAY layer resolved at read time, leaving identity untouched:
--
--   * a per-rink numbering scheme (start point, direction, first number,
--     prefix, whether doors consume a number), and
--   * an optional per-panel override for rinks whose numbering is not strictly
--     sequential (a "12A" between 12 and 13).
--
-- Nothing is renumbered in the database. `label` still means what it always
-- meant; the scheme only changes what the UI prints. Numbering is OPT-IN
-- (glass_numbering_enabled, default false) so every existing rink keeps
-- rendering its G-labels byte-for-byte until an admin turns it on.
--
-- Numbering is POSITIONAL: it walks board positions in sequence order, so
-- toggling a position's glass off (no shielding) does not shift the numbers of
-- the panels after it. A door carries its own glass (see convertAssetToDoor),
-- hence glass_number_include_doors defaults to true.
--
-- RLS: no policy change. Rink writes already gate through the admin-write
-- policy from migration 192 (same reasoning as migration 200's anchor offset).
-- The assets column guard from migration 202 IS updated below — display_number
-- is a structural/identity column, not part of the five-column spec that the
-- edit tier may write.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Per-rink numbering scheme.
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_rinks
  add column if not exists glass_numbering_enabled boolean not null default false,
  add column if not exists glass_number_prefix text not null default 'G',
  add column if not exists glass_number_start int not null default 1,
  add column if not exists glass_number_direction text not null default 'follow_boards',
  add column if not exists glass_number_anchor_offset numeric,
  add column if not exists glass_number_include_doors boolean not null default true;

alter table public.dasher_boards_rinks
  drop constraint if exists dasher_boards_rinks_glass_number_prefix_shape;
alter table public.dasher_boards_rinks
  add constraint dasher_boards_rinks_glass_number_prefix_shape
    check (glass_number_prefix ~ '^[A-Za-z0-9-]{0,8}$');

alter table public.dasher_boards_rinks
  drop constraint if exists dasher_boards_rinks_glass_number_start_range;
alter table public.dasher_boards_rinks
  add constraint dasher_boards_rinks_glass_number_start_range
    check (glass_number_start between 0 and 9999);

alter table public.dasher_boards_rinks
  drop constraint if exists dasher_boards_rinks_glass_number_direction;
alter table public.dasher_boards_rinks
  add constraint dasher_boards_rinks_glass_number_direction
    check (glass_number_direction in ('follow_boards', 'clockwise', 'counterclockwise'));

-- Null = "same start point as the boards" (reuse perimeter_anchor_offset), the
-- default an admin never has to think about. A value pins glass numbering to a
-- different spot on the boundary than sequence position 1.
alter table public.dasher_boards_rinks
  drop constraint if exists dasher_boards_rinks_glass_anchor_offset_range;
alter table public.dasher_boards_rinks
  add constraint dasher_boards_rinks_glass_anchor_offset_range
    check (
      glass_number_anchor_offset is null
      or (glass_number_anchor_offset >= 0 and glass_number_anchor_offset < 1)
    );

comment on column public.dasher_boards_rinks.glass_numbering_enabled is
  'Opt-in switch for the glass DISPLAY numbering scheme. False (default) = the UI prints the permanent G-labels exactly as it always has. True = it prints the computed scheme number instead. Never affects stored labels or issue history.';
comment on column public.dasher_boards_rinks.glass_number_prefix is
  'Prefix printed before the glass number (e.g. ''G'' -> G12, '''' -> 12). Up to 8 chars, letters/digits/hyphen.';
comment on column public.dasher_boards_rinks.glass_number_start is
  'The number given to the first glass panel at the numbering start point. Rinks that number from 0 or 101 set it here.';
comment on column public.dasher_boards_rinks.glass_number_direction is
  '''follow_boards'' (default) walks the same way as perimeter_direction; ''clockwise''/''counterclockwise'' pin glass numbering to run the opposite way from the board sequence when a rink numbers its glass against its board order.';
comment on column public.dasher_boards_rinks.glass_number_anchor_offset is
  'Fraction [0, 1) of the boundary arc length where glass numbering starts. NULL (default) = reuse perimeter_anchor_offset, i.e. start where sequence position 1 draws. Purely a display rotation.';
comment on column public.dasher_boards_rinks.glass_number_include_doors is
  'Whether a door position consumes a glass number. Default true: a door carries its own glass (convertAssetToDoor parks the position''s separate glass row), so it is a physical panel in the count.';

-- -----------------------------------------------------------------------------
-- 2. Per-panel override.
--
-- Partial unique index, not a plain unique constraint: NULL means "use the
-- computed number" and must stay repeatable across the whole rink.
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_assets
  add column if not exists display_number text;

alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_display_number_shape;
alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_display_number_shape
    check (display_number is null or display_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]{0,15}$');

comment on column public.dasher_boards_assets.display_number is
  'Optional per-panel override of the rink''s computed glass number, for rinks whose numbering is not strictly sequential (e.g. a ''12A'' between 12 and 13). NULL = use the computed value. Display only — `label` remains permanent identity and is what issue history follows.';

create unique index if not exists idx_dasher_boards_assets_display_number_uniq
  on public.dasher_boards_assets (rink_id, display_number)
  where display_number is not null;

-- -----------------------------------------------------------------------------
-- 3. Audit trail: renumbering is an asset lifecycle event.
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_asset_events
  drop constraint if exists dasher_boards_asset_events_event_type_check;
alter table public.dasher_boards_asset_events
  add constraint dasher_boards_asset_events_event_type_check
    check (event_type in (
      'created', 'converted_to_door', 'converted_to_board', 'relabeled',
      'deactivated', 'reactivated', 'glass_toggled', 'spec_updated',
      'renumbered'
    ));

-- -----------------------------------------------------------------------------
-- 4. Column guard (migration 202): freeze display_number for the edit tier.
--
-- The guard enumerates the columns an edit-tier caller may NOT change, so a
-- newly added column is writable by managers unless it is named here. Choosing
-- what number the rink prints on its glass is a setup decision that belongs
-- with the rest of the perimeter structure — admin only. Everything else in
-- this function is unchanged from migration 202.
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_assets_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.dasher_boards_guard_exempt() then
    return new;
  end if;

  -- Admins retain full write. This admin-first branch matters because the
  -- helpers have no hierarchy — an admin does NOT satisfy has_module_edit_access,
  -- so without it an admin would be caught by the edit-only freeze below.
  if public.has_module_admin_access('dasher_boards') then
    return new;
  end if;

  if public.has_module_edit_access('dasher_boards') then
    -- Edit tier (managers): the five spec columns only. `updated_at` is left
    -- free (the set_updated_at trigger maintains it).
    if new.id                is distinct from old.id
       or new.facility_id       is distinct from old.facility_id
       or new.rink_id           is distinct from old.rink_id
       or new.asset_type        is distinct from old.asset_type
       or new.subtype_id        is distinct from old.subtype_id
       or new.label             is distinct from old.label
       or new.display_number    is distinct from old.display_number
       or new.sequence_position is distinct from old.sequence_position
       or new.parent_board_id   is distinct from old.parent_board_id
       or new.is_active         is distinct from old.is_active
       or new.created_at        is distinct from old.created_at
    then
      raise exception 'dasher_boards: edit grant may only change the glass replacement spec';
    end if;
    return new;
  end if;

  -- Neither exempt, admin, nor edit: the RLS row gate should already have
  -- blocked this, so a reachable raise here means a policy/guard drift.
  raise exception 'dasher_boards: not authorized to modify assets';
end;
$$;

comment on function public.dasher_boards_assets_guard() is
  'BEFORE UPDATE column guard on dasher_boards_assets: exempt roles and module admins may change any column; edit-tier (managers) may change ONLY the glass replacement spec (glass_width_in/glass_height_in/glass_thickness_in/glass_material/spec_notes); all else — including display_number, the glass numbering override — is rejected. Pairs with the admin-OR-edit UPDATE policy so edit-tier cannot rewrite structural/identity columns via a direct request.';
