-- =============================================================================
-- 00000000000258_dasher_boards_reorder_and_bulk_label_rpcs.sql
--
-- Dasher Boards: two transactional RPCs backing the Phase-2 server actions.
-- Both are multi-row writes that must be atomic — a crash or constraint
-- violation midway through per-row supabase-js updates would strand the rink
-- half-reordered / half-relabeled, so each runs as one function call = one
-- transaction that rolls back whole.
--
-- Both are SECURITY INVOKER (like dasher_boards_shift_positions, migration
-- 203): every row they touch passes through the caller's own RLS policies and
-- the dasher_boards_assets_guard column guard, so they add NO privilege —
-- a view/submit-tier caller's updates match zero rows (raised as an error
-- below), and an edit-tier caller is rejected by the guard's column freeze
-- (sequence_position / custom_label are admin-only columns).
--
--   * dasher_boards_reorder_assets(rink, ids[]) — drag-to-reorder: reassigns
--     sequence_position 1..N in the given order via the established
--     park-negative two-phase swap (shift_positions / ice-depth renumber
--     pattern) so the (rink_id, sequence_position) unique index never sees a
--     transient collision. The list must be exactly the rink's active
--     positioned assets — a stale board state fails loudly rather than
--     silently dropping a segment to the end.
--
--   * dasher_boards_apply_custom_labels(rink, ids[], labels[]) — bulk-label
--     commit: sets custom_label per asset (null clears the override). The
--     relabel audit events are written by the AFTER UPDATE trigger from
--     migration 257 (one per changed asset); the case-insensitive per-rink
--     unique index and the label shape CHECK enforce validity, surfaced as
--     clean single-batch errors.
-- =============================================================================

create or replace function public.dasher_boards_reorder_assets(
  p_rink_id   uuid,
  p_asset_ids uuid[]
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_len      int;
  v_expected int;
  v_touched  int;
begin
  v_len := coalesce(array_length(p_asset_ids, 1), 0);
  if p_rink_id is null or v_len = 0 then
    raise exception 'dasher_boards: nothing to reorder';
  end if;
  if (select count(distinct t.id) from unnest(p_asset_ids) as t(id)) <> v_len then
    raise exception 'dasher_boards: duplicate asset in reorder list';
  end if;

  -- The list must cover the rink's active positioned assets exactly, as the
  -- caller sees them under RLS. Zero visible assets = wrong rink or no access.
  select count(*) into v_expected
    from public.dasher_boards_assets a
   where a.rink_id = p_rink_id
     and a.is_active
     and a.sequence_position is not null;
  if v_expected = 0 then
    raise exception 'dasher_boards: rink not found or not authorized';
  end if;
  if v_expected <> v_len
     or exists (
       select 1 from unnest(p_asset_ids) as t(id)
        where not exists (
          select 1 from public.dasher_boards_assets a
           where a.id = t.id
             and a.rink_id = p_rink_id
             and a.is_active
             and a.sequence_position is not null
        )
     )
  then
    raise exception 'dasher_boards: reorder list does not match the rink''s current segments — reload and try again';
  end if;

  -- Two-phase swap: park every position in the negative range keyed by the
  -- NEW order, then flip the sign. The unique index never collides.
  update public.dasher_boards_assets a
     set sequence_position = -(t.ord::int)
    from unnest(p_asset_ids) with ordinality as t(id, ord)
   where a.id = t.id
     and a.rink_id = p_rink_id;
  get diagnostics v_touched = row_count;
  if v_touched <> v_len then
    raise exception 'dasher_boards: reorder was blocked for % segment(s)', v_len - v_touched;
  end if;

  update public.dasher_boards_assets a
     set sequence_position = -sequence_position
   where a.rink_id = p_rink_id
     and a.sequence_position < 0;
end;
$$;

comment on function public.dasher_boards_reorder_assets(uuid, uuid[]) is
  'Transactionally reassigns sequence_position 1..N over the given asset ids (drag-to-reorder). SECURITY INVOKER: rows pass the caller''s RLS and the assets column guard, so only module admins can actually move anything. Requires the list to match the rink''s active positioned assets exactly. Labels are never touched — position is drawing order, label is identity.';

revoke execute on function public.dasher_boards_reorder_assets(uuid, uuid[]) from public, anon;
grant  execute on function public.dasher_boards_reorder_assets(uuid, uuid[]) to authenticated, service_role;

create or replace function public.dasher_boards_apply_custom_labels(
  p_rink_id   uuid,
  p_asset_ids uuid[],
  p_labels    text[]
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_len     int;
  v_touched int;
begin
  v_len := coalesce(array_length(p_asset_ids, 1), 0);
  if p_rink_id is null or v_len = 0 then
    raise exception 'dasher_boards: nothing to relabel';
  end if;
  if coalesce(array_length(p_labels, 1), 0) <> v_len then
    raise exception 'dasher_boards: label list does not match the segment list';
  end if;
  if (select count(distinct t.id) from unnest(p_asset_ids) as t(id)) <> v_len then
    raise exception 'dasher_boards: duplicate asset in relabel list';
  end if;

  begin
    update public.dasher_boards_assets a
       set custom_label = t.lbl
      from unnest(p_asset_ids, p_labels) as t(id, lbl)
     where a.id = t.id
       and a.rink_id = p_rink_id;
    get diagnostics v_touched = row_count;
  exception
    when unique_violation then
      raise exception 'dasher_boards: a label in this batch is already used on this rink';
    when check_violation then
      raise exception 'dasher_boards: labels must be 1-40 characters with no leading/trailing spaces';
  end;

  if v_touched <> v_len then
    raise exception 'dasher_boards: % segment(s) were not found or not authorized', v_len - v_touched;
  end if;
end;
$$;

comment on function public.dasher_boards_apply_custom_labels(uuid, uuid[], text[]) is
  'Transactionally sets custom_label per asset (null element clears the override) — the bulk-labeling commit. SECURITY INVOKER: rows pass the caller''s RLS and the assets column guard (custom_label is admin-only). The AFTER UPDATE trigger from migration 257 writes one relabeled audit event per changed asset; the case-insensitive per-rink unique index rejects collisions atomically for the whole batch.';

revoke execute on function public.dasher_boards_apply_custom_labels(uuid, uuid[], text[]) from public, anon;
grant  execute on function public.dasher_boards_apply_custom_labels(uuid, uuid[], text[]) to authenticated, service_role;
