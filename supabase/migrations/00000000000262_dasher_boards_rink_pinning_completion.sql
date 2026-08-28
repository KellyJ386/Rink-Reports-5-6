-- =============================================================================
-- 00000000000262_dasher_boards_rink_pinning_completion.sql
--
-- Dasher Boards: finish the (rink_id, facility_id) tenant pinning.
--
-- Migration 259 pinned dasher_boards_zones and dasher_boards_assets to
-- dasher_boards_rinks(id, facility_id) after the Phase-1 security review
-- showed RLS validates facility_id against the caller while rink_id is
-- client-suppliable. The same review flagged (non-blocking) that the three
-- remaining rink-scoped child tables carry the identical shape: a facility-A
-- writer could, in principle, place an issue / inspection / checklist item
-- onto facility B's rink — invisible to B, but squatting B's per-rink
-- uniqueness domains (checklist labels) and polluting B's rink-keyed queries.
-- This closes those three with the same composite FK; server actions already
-- derive both ids from the caller's context, so legitimate rows all satisfy
-- it (a failed ADD CONSTRAINT on a live database would itself be evidence
-- the old gap was hit and needs cleanup first).
-- =============================================================================

alter table public.dasher_boards_issues
  drop constraint if exists dasher_boards_issues_rink_same_facility_fkey;
alter table public.dasher_boards_issues
  add constraint dasher_boards_issues_rink_same_facility_fkey
    foreign key (rink_id, facility_id)
    references public.dasher_boards_rinks (id, facility_id);

alter table public.dasher_boards_inspections
  drop constraint if exists dasher_boards_inspections_rink_same_facility_fkey;
alter table public.dasher_boards_inspections
  add constraint dasher_boards_inspections_rink_same_facility_fkey
    foreign key (rink_id, facility_id)
    references public.dasher_boards_rinks (id, facility_id);

alter table public.dasher_boards_checklist_items
  drop constraint if exists dasher_boards_checklist_items_rink_same_facility_fkey;
alter table public.dasher_boards_checklist_items
  add constraint dasher_boards_checklist_items_rink_same_facility_fkey
    foreign key (rink_id, facility_id)
    references public.dasher_boards_rinks (id, facility_id);

-- dasher_boards_retired_labels also carries (rink_id, facility_id), but its
-- rows are written by the label-permanence triggers from the parent asset row
-- (already pinned by migration 259) — pinned transitively; left unchanged to
-- keep the retire trigger's insert path untouched.
