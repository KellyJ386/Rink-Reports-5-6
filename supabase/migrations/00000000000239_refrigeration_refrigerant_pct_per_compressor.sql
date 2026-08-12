-- =============================================================================
-- 00000000000239_refrigeration_refrigerant_pct_per_compressor.sql
-- Refrigeration follow-up (Kelly, 2026-08-12): refrigerant level belongs on
-- EACH compressor as a percentage-full reading, not on the plant as a
-- Low/OK/High dropdown.
--
-- 1. Adds a numeric `refrigerant_level_pct` field (unit %) to every active
--    compressor. Numeric (not free text) so thresholds / out-of-range alerts
--    can be configured later in the Admin Control Center; no starting
--    threshold is seeded.
-- 2. Deactivates the plant-level `chiller_refrigerant_level` select seeded in
--    migration 237 (is_active = false — never deleted; snapshots preserve any
--    history). Plant & Ambient keeps Outside air temp.
--
-- Same conventions as 237: slug/key-resolved (no hardcoded UUIDs), no-op on
-- databases without the Tennity config, idempotent via WHERE NOT EXISTS
-- matching the partial unique indexes.
-- =============================================================================
begin;

-- 1. Per-compressor refrigerant level (percentage full).
with tmpl(section_slug, key, label, field_type, unit, options, sort_order, is_required) as (
  values
  ('compressors','refrigerant_level_pct','Refrigerant level','numeric','%','[]'::jsonb,12,false)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required, is_active)
select s.facility_id, s.id, e.id, t.key, t.label, t.field_type, t.unit, t.options, t.sort_order, t.is_required, true
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
join public.refrigeration_equipment e on e.section_id = s.id and e.is_active
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key
    and f.equipment_id is not distinct from e.id
);

-- 2. Retire the plant-level dropdown, guarded on its replacement existing.
update public.refrigeration_fields f
   set is_active = false
  from public.refrigeration_sections s
 where f.section_id = s.id
   and s.slug = 'plant'
   and f.key = 'chiller_refrigerant_level'
   and f.is_active
   and exists (
     select 1
     from public.refrigeration_fields g
     join public.refrigeration_sections cs on cs.id = g.section_id
     where cs.facility_id = s.facility_id
       and cs.slug = 'compressors'
       and g.key = 'refrigerant_level_pct'
       and g.is_active
   );

commit;
