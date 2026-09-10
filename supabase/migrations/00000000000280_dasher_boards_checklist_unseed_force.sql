-- =============================================================================
-- 00000000000280_dasher_boards_checklist_unseed_force.sql
-- Follow-up to 00000000000279_dasher_boards_checklist_unseed.sql. Of the
-- original 20 hardcoded Tennity checklist items, 8 monthly items each had
-- exactly one recorded inspection response, so 279's NOT EXISTS guard left
-- them in place (dasher_boards_checklist_responses_item_id_fkey is ON
-- DELETE RESTRICT, and dasher_boards_checklist_responses_guard raises once
-- the parent inspection is completed).
--
-- Per explicit operator request the checklist is to carry zero preset
-- entries, full stop — so this removes those 8 items and their responses,
-- using the guard's privileged bypass GUC
-- (rr.dasher_boards_guard_bypass, gated to postgres/supabase_admin/
-- service_role by dasher_boards_guard_exempt()) to get past the
-- completed-inspection immutability check. This permanently discards
-- those 8 logged inspection answers.
-- =============================================================================

begin;

set local rr.dasher_boards_guard_bypass = 'on';

delete from public.dasher_boards_checklist_responses resp
using public.dasher_boards_checklist_items i, public.dasher_boards_rinks r, public.facilities f
where resp.item_id = i.id
  and i.rink_id = r.id
  and r.facility_id = f.id
  and f.slug = 'tennity-ice-skating-pavilion'
  and r.slug = 'main-rink'
  and i.label in (
    'Glass suspension cables (if cable-supported)',
    'Support posts end-to-end',
    'Timekeeper''s table',
    'Door hardware lubrication (hinges, latches, contact surfaces)',
    'Bleachers/spectator seating',
    'Shielding gasket inspection',
    'Full wall plumb sight-check',
    'Framing inspection behind panels'
  );

delete from public.dasher_boards_checklist_items i
using public.dasher_boards_rinks r, public.facilities f
where i.rink_id = r.id
  and r.facility_id = f.id
  and f.slug = 'tennity-ice-skating-pavilion'
  and r.slug = 'main-rink'
  and i.label in (
    'Glass suspension cables (if cable-supported)',
    'Support posts end-to-end',
    'Timekeeper''s table',
    'Door hardware lubrication (hinges, latches, contact surfaces)',
    'Bleachers/spectator seating',
    'Shielding gasket inspection',
    'Full wall plumb sight-check',
    'Framing inspection behind panels'
  );

commit;
