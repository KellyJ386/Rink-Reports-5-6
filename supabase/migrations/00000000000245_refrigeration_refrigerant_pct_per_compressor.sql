-- =============================================================================
-- Refrigeration: per-compressor refrigerant level (%), replacing the single
-- plant-level chiller refrigerant field.
--
-- BACK-PORT. This change was applied to production on 2026-08-12 via the
-- management API under the timestamp version 20260812215123 and never landed
-- in the repo — the one divergence found while reconciling the migration
-- ledger to the repo's numeric version scheme (the stray ledger row was
-- removed in that reconciliation; this file restores the change to reviewable
-- history). Statements are verbatim from the applied migration.
--
-- Data-only (no DDL): seeds a `refrigerant_level_pct` numeric field on every
-- active compressor and deactivates the plant-level `chiller_refrigerant_level`
-- field it supersedes. Idempotent — the insert is guarded by WHERE NOT EXISTS
-- and the update only touches still-active rows — so re-applying on production
-- is a no-op, and on fresh/local databases (no refrigeration config seeded)
-- the joins match nothing and the whole file is a no-op.
-- =============================================================================
begin;

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
