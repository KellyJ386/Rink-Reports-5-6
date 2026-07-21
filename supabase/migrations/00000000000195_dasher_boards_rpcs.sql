-- =============================================================================
-- 00000000000195_dasher_boards_rpcs.sql
-- Dasher Boards: atomic perimeter helpers.
--
-- Both functions are SECURITY INVOKER (the default) on purpose: they run with
-- the caller's rights, so the RLS admin gate on dasher_boards_assets still
-- decides who may generate or shift. They exist only because the operations
-- need single-transaction atomicity a chain of PostgREST statements cannot
-- give:
--   * generate_perimeter inserts N board rows + N 1:1 glass rows as one unit;
--   * shift_positions renumbers a contiguous run of sequence_positions using
--     the two-step negative flip (same idea as the admin reorder swap trick)
--     so the partial unique index on (rink_id, sequence_position) never sees
--     a transient collision mid-shift.
-- Neither function bypasses anything: a caller without the module admin grant
-- gets an RLS error from generate (insert WITH CHECK) and a 0-row no-op from
-- shift (update USING).
-- =============================================================================

create or replace function public.dasher_boards_generate_perimeter(
  p_rink_id uuid,
  p_count   int
) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
  v_existing    int;
  v_board_id    uuid;
  i             int;
begin
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'dasher_boards: position count must be between 1 and 500';
  end if;

  select facility_id into v_facility_id
    from public.dasher_boards_rinks
   where id = p_rink_id;
  if v_facility_id is null then
    raise exception 'dasher_boards: rink not found';
  end if;

  select count(*) into v_existing
    from public.dasher_boards_assets
   where rink_id = p_rink_id;
  if v_existing > 0 then
    raise exception 'dasher_boards: rink already has perimeter assets; use the granular editor instead';
  end if;

  for i in 1..p_count loop
    insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, label, sequence_position)
    values
      (v_facility_id, p_rink_id, 'board_panel', 'B' || i, i)
    returning id into v_board_id;

    insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, label, parent_board_id)
    values
      (v_facility_id, p_rink_id, 'glass_panel', 'G' || i, v_board_id);
  end loop;

  return p_count;
end;
$$;

comment on function public.dasher_boards_generate_perimeter(uuid, int) is
  'Atomically creates p_count uniform board panels (B1..Bn at positions 1..n) each with a 1:1 glass row (G1..Gn). Rejects when the rink already has assets — post-generation edits go through the granular editor. SECURITY INVOKER: RLS admin gates apply to the caller.';

create or replace function public.dasher_boards_shift_positions(
  p_rink_id uuid,
  p_from    int,
  p_delta   int
) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if p_delta is null or p_delta not in (-1, 1) then
    raise exception 'dasher_boards: shift delta must be -1 or 1';
  end if;

  -- Negative flip: matched rows first move to distinct negative positions,
  -- then flip back positive with the delta applied — one transaction, no
  -- transient duplicates against untouched rows.
  update public.dasher_boards_assets
     set sequence_position = -(sequence_position + p_delta)
   where rink_id = p_rink_id
     and sequence_position >= p_from;
  get diagnostics v_count = row_count;

  update public.dasher_boards_assets
     set sequence_position = -sequence_position
   where rink_id = p_rink_id
     and sequence_position < 0;

  return v_count;
end;
$$;

comment on function public.dasher_boards_shift_positions(uuid, int, int) is
  'Shifts sequence_position by ±1 for every asset at position >= p_from on the rink (open/close a gap for insertAsset/removeAsset). Two-step negative flip keeps the partial unique index happy mid-shift. SECURITY INVOKER: a caller without the module admin grant updates 0 rows.';

revoke execute on function public.dasher_boards_generate_perimeter(uuid, int) from public, anon;
revoke execute on function public.dasher_boards_shift_positions(uuid, int, int) from public, anon;
grant execute on function public.dasher_boards_generate_perimeter(uuid, int) to authenticated;
grant execute on function public.dasher_boards_shift_positions(uuid, int, int) to authenticated;
