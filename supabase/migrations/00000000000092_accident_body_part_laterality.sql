-- =============================================================================
-- 00000000000092_accident_body_part_laterality.sql
--
-- Adds left/right laterality to accident body-part selections so paired
-- regions (arms, legs, shoulders, etc.) on the SVG diagram are independently
-- selectable per side.
--
-- Until this migration, `accident_body_part_selections.side` carried only the
-- view (front / back / both / none) and each paired region was a single
-- selectable unit. The diagram now splits paired regions into independently
-- clickable left and right groups, so we need a per-row laterality column.
--
-- Backwards-compatible by design: `laterality` is NULL on every existing row.
-- The read-only renderer treats NULL on a paired region as "applies to both
-- left and right" — matching what those reports visually showed before. New
-- submissions write a non-null laterality for paired regions and NULL for
-- midline regions (head, face_jaw, neck, torso, hips).
--
-- The unique constraint widens to include laterality. We use NULLS NOT
-- DISTINCT so legacy NULL values still dedupe at the (accident, region, side)
-- level, preserving the previous invariant for midline rows.
-- =============================================================================

alter table public.accident_body_part_selections
  add column if not exists laterality text null
    check (laterality in ('left','right'));

comment on column public.accident_body_part_selections.laterality is
  'Left/right laterality for paired regions (arms, legs, shoulders, etc.). NULL for midline regions (head, neck, torso, hips, face_jaw) and for legacy rows submitted before paired-region splitting; the renderer treats NULL on a paired region as both sides.';

-- Replace the unique constraint so (accident_id, region, side, laterality) is
-- the natural row identity. NULLS NOT DISTINCT keeps the previous
-- (accident_id, region, side) invariant for midline rows where laterality is
-- NULL — two NULLs collide just like two equal text values would.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'accident_body_part_selections_uniq'
      and conrelid = 'public.accident_body_part_selections'::regclass
  ) then
    alter table public.accident_body_part_selections
      drop constraint accident_body_part_selections_uniq;
  end if;
end$$;

alter table public.accident_body_part_selections
  add constraint accident_body_part_selections_uniq
  unique nulls not distinct
  (accident_id, body_part_dropdown_id, side, laterality);
