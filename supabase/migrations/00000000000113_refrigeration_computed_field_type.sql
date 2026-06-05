-- =============================================================================
-- 00000000000113_refrigeration_computed_field_type.sql
-- Refrigeration item 6: derived/computed readings.
--
-- 1. Extends the refrigeration_fields.field_type CHECK to allow 'computed'.
-- 2. Seeds three INACTIVE example computed fields (superheat, condenser approach,
--    dew-point spread) for the Tennity facility, resolved by section slug
--    (no hardcoded UUIDs), idempotent via WHERE NOT EXISTS.
--
-- COMPUTED options JSONB SCHEMA (evaluated server-side at submit):
--   {
--     "formula":  "a-b",                 -- whitelisted: a single "<op1> <operator> <op2>"
--                                         --   operator in (+, -, *, /); operands are keys below
--     "operands": { "a": "<field_key>",  -- operand letter -> another numeric field's key
--                   "b": "<field_key>" } --   resolved among submitted values in the same section
--   }
-- Computed values are read-only in the UI and persisted into value_numeric with
-- field_type_snapshot = 'computed'. Examples are seeded is_active=false so nothing
-- evaluates in production until an admin reviews/activates and re-points operands
-- at the commissioned field keys.
--
-- ROLLBACK:
--   delete from public.refrigeration_fields
--     where field_type = 'computed'
--       and key in ('superheat','condenser_approach','dew_point_spread')
--       and is_active = false;
--   -- (Re-point any activated computed fields off 'computed' first, then:)
--   alter table public.refrigeration_fields
--     drop constraint if exists refrigeration_fields_field_type_check,
--     add constraint refrigeration_fields_field_type_check
--       check (field_type in ('numeric','text','boolean','select'));
-- =============================================================================
begin;

-- 1. Allow the new field_type.
alter table public.refrigeration_fields
  drop constraint if exists refrigeration_fields_field_type_check,
  add constraint refrigeration_fields_field_type_check
    check (field_type in ('numeric','text','boolean','select','computed'));

-- 2. Seed inactive example computed fields. Section-scoped (equipment_id null);
--    operands reference real field keys within each section. Illustrative only.
with tmpl(section_slug, key, label, unit, options, sort_order) as (
  values
  ('compressors','superheat','Superheat (example)','°F',
    '{"formula":"a-b","operands":{"a":"discharge_pressure","b":"suction_pressure"}}'::jsonb, 90),
  ('condensers','condenser_approach','Condenser approach (example)','°F',
    '{"formula":"a-b","operands":{"a":"water_out_temp","b":"water_in_temp"}}'::jsonb, 90),
  ('supply-return','dew_point_spread','Dew-point spread (example)','°F',
    '{"formula":"a-b","operands":{"a":"brine_supply_temp","b":"brine_return_temp"}}'::jsonb, 90)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required, is_active)
select s.facility_id, s.id, null, t.key, t.label, 'computed', t.unit, t.options, t.sort_order, false, false
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key and f.equipment_id is null
);

commit;
