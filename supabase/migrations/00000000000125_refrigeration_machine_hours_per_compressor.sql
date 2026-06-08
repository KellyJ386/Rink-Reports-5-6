-- =============================================================================
-- 00000000000125_refrigeration_machine_hours_per_compressor.sql
-- Refrigeration item 1b: group machine hours with each compressor.
--
-- Previously "Machine Hours" was its own section with three standalone,
-- hardcoded section-level fields (compressor_1/2/3 runtime). That split a single
-- compressor's reading across two places and did not scale with the
-- admin-configurable compressor count.
--
-- This adds an equipment-scoped `machine_hours` numeric field (unit hrs) to
-- every active equipment row in the `compressors` section, so a compressor's
-- readings + machine hours are entered together. The standalone machine-hours
-- section (and its fields) are deactivated. The staff form is metadata-driven,
-- so it now renders the new per-compressor field automatically with no UI code
-- change. Compressor count stays admin-configurable (equipment rows in the
-- Compressors section); adding a compressor in admin will need the same
-- machine_hours field added, which the admin field editor supports.
--
-- Facility-scoped by design (resolves sections/equipment by slug, which only
-- exist for production), idempotent via WHERE NOT EXISTS, and never clobbers
-- admin edits. No-op on fresh/local DBs.
--
-- ROLLBACK:
--   delete from public.refrigeration_fields
--     where key = 'machine_hours'
--       and section_id in (select id from public.refrigeration_sections where slug = 'compressors');
--   update public.refrigeration_fields f
--     set is_active = true
--    from public.refrigeration_sections s
--    where f.section_id = s.id and s.slug = 'machine-hours';
--   update public.refrigeration_sections set is_active = true where slug = 'machine-hours';
-- =============================================================================
begin;

-- 1. Add a per-compressor machine-hours field on each active compressor.
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required)
select s.facility_id, s.id, e.id,
       'machine_hours', 'Machine hours', 'numeric', 'hrs', '[]'::jsonb, 8, false
  from public.refrigeration_sections s
  join public.refrigeration_equipment e
    on e.section_id = s.id and e.is_active
 where s.slug = 'compressors'
   and not exists (
     select 1 from public.refrigeration_fields f
      where f.section_id = s.id
        and f.key = 'machine_hours'
        and f.equipment_id is not distinct from e.id
   );

-- 2. Retire the standalone Machine Hours section + its fields.
update public.refrigeration_fields f
   set is_active = false,
       updated_at = now()
  from public.refrigeration_sections s
 where f.section_id = s.id
   and s.slug = 'machine-hours'
   and f.is_active;

update public.refrigeration_sections
   set is_active = false,
       updated_at = now()
 where slug = 'machine-hours'
   and is_active;

commit;
