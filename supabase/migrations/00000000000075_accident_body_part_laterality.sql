-- -----------------------------------------------------------------------------
-- Track left/right laterality on accident body-part selections.
--
-- Previously a selection only recorded which *view* (front/back/both) a body
-- part was marked on. The diagram now lets staff pick the left or right limb
-- independently, so we record the anatomical side too. Midline parts (head,
-- neck, torso, hips, ...) use 'center'. Existing rows default to 'center',
-- which is also what the diagram renders for non-bilateral parts.
-- -----------------------------------------------------------------------------

alter table public.accident_body_part_selections
  add column if not exists laterality text not null default 'center';

alter table public.accident_body_part_selections
  drop constraint if exists accident_body_part_selections_laterality_check;
alter table public.accident_body_part_selections
  add constraint accident_body_part_selections_laterality_check
  check (laterality in ('left', 'right', 'center'));

-- Widen the uniqueness to include laterality so the left and right of the same
-- part on the same view are distinct rows.
alter table public.accident_body_part_selections
  drop constraint if exists accident_body_part_selections_uniq;
alter table public.accident_body_part_selections
  add constraint accident_body_part_selections_uniq
  unique (accident_id, body_part_dropdown_id, side, laterality);

comment on column public.accident_body_part_selections.laterality is
  'Anatomical side of the affected body part: left, right, or center (midline parts). Defaults to center for backward compatibility.';
