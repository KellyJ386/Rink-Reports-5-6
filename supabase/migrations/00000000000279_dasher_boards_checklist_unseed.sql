-- =============================================================================
-- 00000000000279_dasher_boards_checklist_unseed.sql
-- Dasher Boards checklist items are meant to be entirely facility-authored
-- (see the "Checklist items" card in /admin/dasher-boards — the config is a
-- blank list the facility fills in itself, matching the daily/yearly
-- cadences which already shipped empty by design). Migration 194 hardcoded
-- a starter set of weekly/monthly items for the Tennity rink; remove those
-- so the checklist has no preset entries. Guarded with NOT EXISTS against
-- responses/issues so a row a walk has already touched is left in place
-- (the rink_id/facility_id FKs are ON DELETE RESTRICT) rather than failing
-- the migration.
-- =============================================================================

begin;

delete from public.dasher_boards_checklist_items i
using public.dasher_boards_rinks r, public.facilities f
where i.rink_id = r.id
  and r.facility_id = f.id
  and f.slug = 'tennity-ice-skating-pavilion'
  and r.slug = 'main-rink'
  and i.label in (
    'Systematic fastener check with driver',
    'Floor anchor torque',
    'Stanchion clamp/base hardware torque',
    'Protective netting condition',
    'Benches mounted secure',
    'Overall safety review',
    'Glass suspension cables (if cable-supported)',
    'Support posts end-to-end',
    'Timekeeper''s table',
    'Door hardware lubrication (hinges, latches, contact surfaces)',
    'Bleachers/spectator seating',
    'Shielding gasket inspection',
    'Full wall plumb sight-check',
    'Framing inspection behind panels'
  )
  and not exists (
    select 1 from public.dasher_boards_checklist_responses resp
    where resp.item_id = i.id
  )
  and not exists (
    select 1 from public.dasher_boards_issues iss
    where iss.checklist_item_id = i.id
  );

commit;
