-- =============================================================================
-- 00000000000259_dasher_boards_apply_template_rpc.sql
--
-- Dasher Boards: atomic typed-template seeding for the Perimeter Builder.
--
-- dasher_boards_generate_perimeter (migration 195) creates a UNIFORM ring of
-- board+glass pairs. The Phase-3 builder offers a standard-rink starting
-- template instead — a typed sequence (side/end panels, corner radius groups,
-- gates with subtypes, zone assignments) the admin then edits — so nobody
-- builds ~50 segments by hand. That means inserting ~80 typed rows as ONE
-- unit: this RPC exists for the same reason generate_perimeter does
-- (single-transaction atomicity a chain of PostgREST statements cannot give)
-- and follows the same rules:
--
--   * SECURITY INVOKER — the caller's own RLS admin gate decides; a caller
--     without the module admin grant fails the first insert's WITH CHECK.
--   * Empty-rink only — an existing perimeter is edited granularly, never
--     re-templated over.
--   * Labels are allocated per type prefix (B/G/D/C/P) exactly as the app's
--     nextLabel() does on an empty rink, so template output is
--     indistinguishable from hand-built rows.
--   * Door subtypes and zones arrive as NAMES (the template is a pure,
--     DB-agnostic artifact) and resolve against the caller's facility/rink;
--     an unknown name fails the whole batch loudly.
-- =============================================================================

create or replace function public.dasher_boards_apply_template(
  p_rink_id       uuid,
  p_types         text[],
  p_door_subtypes text[],
  p_zone_names    text[]
) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_len         int;
  v_facility_id uuid;
  v_existing    int;
  v_type        text;
  v_subtype_id  uuid;
  v_zone_id     uuid;
  v_board_id    uuid;
  v_b int := 0;
  v_g int := 0;
  v_d int := 0;
  v_c int := 0;
  v_p int := 0;
  v_label text;
  i int;
begin
  v_len := coalesce(array_length(p_types, 1), 0);
  if p_rink_id is null or v_len = 0 or v_len > 500 then
    raise exception 'dasher_boards: template must have between 1 and 500 segments';
  end if;
  if coalesce(array_length(p_door_subtypes, 1), 0) <> v_len
     or coalesce(array_length(p_zone_names, 1), 0) <> v_len then
    raise exception 'dasher_boards: template arrays must be the same length';
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

  for i in 1..v_len loop
    v_type := p_types[i];
    if v_type not in ('board_panel', 'door', 'corner_radius', 'post_gap') then
      raise exception 'dasher_boards: template segment % has invalid type "%"', i, v_type;
    end if;

    v_subtype_id := null;
    if p_door_subtypes[i] is not null then
      if v_type <> 'door' then
        raise exception 'dasher_boards: template segment % is not a door but names a subtype', i;
      end if;
      select s.id into v_subtype_id
        from public.dasher_boards_asset_subtypes s
       where s.facility_id = v_facility_id
         and s.asset_type = 'door'
         and s.label = p_door_subtypes[i]
         and s.is_active;
      if v_subtype_id is null then
        raise exception 'dasher_boards: door subtype "%" not found for this facility', p_door_subtypes[i];
      end if;
    end if;

    v_zone_id := null;
    if p_zone_names[i] is not null then
      select z.id into v_zone_id
        from public.dasher_boards_zones z
       where z.rink_id = p_rink_id
         and z.name = p_zone_names[i]
         and z.is_active;
      if v_zone_id is null then
        raise exception 'dasher_boards: zone "%" not found on this rink', p_zone_names[i];
      end if;
    end if;

    if v_type = 'board_panel' then
      v_b := v_b + 1; v_label := 'B' || v_b;
    elsif v_type = 'door' then
      v_d := v_d + 1; v_label := 'D' || v_d;
    elsif v_type = 'corner_radius' then
      v_c := v_c + 1; v_label := 'C' || v_c;
    else
      v_p := v_p + 1; v_label := 'P' || v_p;
    end if;

    insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, subtype_id, label, sequence_position, zone_id)
    values
      (v_facility_id, p_rink_id, v_type, v_subtype_id, v_label, i, v_zone_id)
    returning id into v_board_id;

    -- Boards carry the 1:1 glass row (doors/corners carry their own spec).
    if v_type = 'board_panel' then
      v_g := v_g + 1;
      insert into public.dasher_boards_assets
        (facility_id, rink_id, asset_type, label, parent_board_id, zone_id)
      values
        (v_facility_id, p_rink_id, 'glass_panel', 'G' || v_g, v_board_id, v_zone_id);
    end if;
  end loop;

  return v_len;
end;
$$;

comment on function public.dasher_boards_apply_template(uuid, text[], text[], text[]) is
  'Atomically seeds an EMPTY rink from a typed template: positioned segments in perimeter order (board_panel/door/corner_radius/post_gap) with optional door-subtype and zone names resolved against the caller''s facility/rink; boards get their 1:1 glass row. Labels allocated per type prefix exactly as the granular editor would. SECURITY INVOKER — the caller''s RLS admin gate decides; unknown names or a non-empty rink fail the whole batch.';

revoke execute on function public.dasher_boards_apply_template(uuid, text[], text[], text[]) from public, anon;
grant  execute on function public.dasher_boards_apply_template(uuid, text[], text[], text[]) to authenticated, service_role;
