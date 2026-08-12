-- =============================================================================
-- 00000000000237_seed_refrigeration_apex_merge_config.sql
-- Refrigeration: merge the Apex Ice Arena paper compressor-log fields into
-- Tennity's config, and activate per-sheet deviation-from-setpoint computed
-- fields (Tennity has two ice sheets: Main / Aux — zone-scoped metrics are
-- seeded twice with `_main` / `_aux` key suffixes).
--
-- Facility-scoped by design (mirrors migrations 109/113): everything is
-- resolved by section slug / equipment slug / field key, which only exist for
-- the production (Tennity) facility, so this is a no-op on fresh/local
-- databases. No generated UUIDs are hardcoded.
--
-- Idempotent: inserts are guarded by WHERE NOT EXISTS clauses that match the
-- partial unique indexes (sections: facility_id+slug; fields: section_id+key
-- [+equipment_id]; thresholds: field_id where equipment_id is null and
-- is_active). UPDATEs are absolute assignments, stable on re-run. Re-running
-- never duplicates rows.
--
-- Additive only, with two deliberate non-destructive touches:
--   * section sort_order values are reassigned so "Plant & Ambient" leads and
--     "Balance Tanks" follows Pumps (presentational only — report history
--     snapshots labels, never section order);
--   * the per-compressor `oil_level_ok` boolean is deactivated (NOT deleted)
--     in favor of the richer `oil_level_glass` select; historical values keep
--     their snapshots.
--
-- COMPUTED options schema is the shipped one from migration 113
-- ({"formula":"a-b","operands":{"a":<key>,"b":<key>}}), evaluated server-side
-- at submit; operands resolve among submitted values in the same section.
-- The three inactive example computed fields from 113 are left untouched.
-- =============================================================================
begin;

-- ----------------------------------------------------------------------------
-- 1. New sections: plant (Plant & Ambient), balance_tanks (Balance Tanks).
--    Seeded for every facility that already has a refrigeration config
--    (identified by owning a 'compressors' section).
-- ----------------------------------------------------------------------------
with tmpl(slug, name, sort_order) as (
  values
  ('plant', 'Plant & Ambient', 1),
  ('balance_tanks', 'Balance Tanks', 4)
)
insert into public.refrigeration_sections (facility_id, name, slug, sort_order, is_active)
select c.facility_id, t.name, t.slug, t.sort_order, true
from tmpl t
join public.refrigeration_sections c on c.slug = 'compressors'
where not exists (
  select 1 from public.refrigeration_sections s
  where s.facility_id = c.facility_id and s.slug = t.slug
);

-- Deterministic section order: plant, compressors, pumps, balance_tanks,
-- condensers, supply-return, machine-hours (inactive), alarms.
update public.refrigeration_sections s
   set sort_order = v.sort_order
  from (values
    ('plant', 1),
    ('compressors', 2),
    ('pumps', 3),
    ('balance_tanks', 4),
    ('condensers', 5),
    ('supply-return', 6),
    ('machine-hours', 7),
    ('alarms', 8)
  ) as v(slug, sort_order)
 where s.slug = v.slug
   and s.sort_order is distinct from v.sort_order;

-- ----------------------------------------------------------------------------
-- 2. Plant & Ambient fields (section-scoped).
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, label, field_type, unit, options, sort_order, is_required) as (
  values
  ('plant','outside_air_temp','Outside air temp','numeric','°F','[]'::jsonb,1,true),
  ('plant','chiller_refrigerant_level','Chiller refrigerant level','select',null,
    '[{"key":"Low","label":"Low"},{"key":"OK","label":"OK"},{"key":"High","label":"High"}]'::jsonb,2,false)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required, is_active)
select s.facility_id, s.id, null, t.key, t.label, t.field_type, t.unit, t.options, t.sort_order, t.is_required, true
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key and f.equipment_id is null
);

-- ----------------------------------------------------------------------------
-- 3. Compressors: per-equipment additions (Compressor 1/2/3).
--    oil_added_strokes: expectation is 0 strokes on a normal round.
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, label, field_type, unit, options, sort_order, is_required) as (
  values
  ('compressors','jacket_temp','Jacket temp','numeric','°F','[]'::jsonb,9,false),
  ('compressors','oil_added_strokes','Oil added','numeric','strokes','[]'::jsonb,10,false),
  ('compressors','oil_level_glass','Oil level (sight glass)','select',null,
    '[{"key":"Low","label":"Low"},{"key":"OK","label":"OK"},{"key":"High","label":"High"}]'::jsonb,11,false)
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

-- Retire the coarse boolean in favor of the sight-glass select. Deactivate
-- only — snapshots keep history readable; do NOT delete.
update public.refrigeration_fields f
   set is_active = false
  from public.refrigeration_sections s
 where f.section_id = s.id
   and s.slug = 'compressors'
   and f.key = 'oil_level_ok'
   and f.is_active
   and exists (
     select 1 from public.refrigeration_fields g
     where g.section_id = f.section_id
       and g.equipment_id is not distinct from f.equipment_id
       and g.key = 'oil_level_glass'
   );

-- ----------------------------------------------------------------------------
-- 4. Pumps: section-scoped loop gauge PSI fields, per sheet (Main / Aux).
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, label, field_type, unit, options, sort_order, is_required) as (
  values
  ('pumps','cold_floor_psi_main','Cold floor PSI (Main)','numeric','psi','[]'::jsonb,10,false),
  ('pumps','cold_floor_psi_aux','Cold floor PSI (Aux)','numeric','psi','[]'::jsonb,11,false),
  ('pumps','warm_floor_psi_main','Warm floor PSI (Main)','numeric','psi','[]'::jsonb,12,false),
  ('pumps','warm_floor_psi_aux','Warm floor PSI (Aux)','numeric','psi','[]'::jsonb,13,false),
  ('pumps','jacket_cooling_psi_main','Jacket cooling PSI (Main)','numeric','psi','[]'::jsonb,14,false),
  ('pumps','jacket_cooling_psi_aux','Jacket cooling PSI (Aux)','numeric','psi','[]'::jsonb,15,false),
  ('pumps','snow_melt_psi_main','Snow melt PSI (Main)','numeric','psi','[]'::jsonb,16,false),
  ('pumps','snow_melt_psi_aux','Snow melt PSI (Aux)','numeric','psi','[]'::jsonb,17,false)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required, is_active)
select s.facility_id, s.id, null, t.key, t.label, t.field_type, t.unit, t.options, t.sort_order, t.is_required, true
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key and f.equipment_id is null
);

-- ----------------------------------------------------------------------------
-- 5. Balance Tanks fields (section-scoped level checks).
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, label, field_type, unit, options, sort_order, is_required) as (
  values
  ('balance_tanks','warm_floor_brine_level','Warm floor / brine','select',null,
    '[{"key":"Low","label":"Low"},{"key":"OK","label":"OK"},{"key":"High","label":"High"}]'::jsonb,1,false),
  ('balance_tanks','cold_floor_brine_level','Cold floor / brine','select',null,
    '[{"key":"Low","label":"Low"},{"key":"OK","label":"OK"},{"key":"High","label":"High"}]'::jsonb,2,false),
  ('balance_tanks','jacket_cooling_glycol_level','Jacket cooling / glycol','select',null,
    '[{"key":"Low","label":"Low"},{"key":"OK","label":"OK"},{"key":"High","label":"High"}]'::jsonb,3,false),
  ('balance_tanks','snow_melt_glycol_level','Snow melt / glycol','select',null,
    '[{"key":"Low","label":"Low"},{"key":"OK","label":"OK"},{"key":"High","label":"High"}]'::jsonb,4,false)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required, is_active)
select s.facility_id, s.id, null, t.key, t.label, t.field_type, t.unit, t.options, t.sort_order, t.is_required, true
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key and f.equipment_id is null
);

-- ----------------------------------------------------------------------------
-- 6. Supply / Return: per-sheet floor temps + set points, plus snow melt
--    supply/return (single-zone by design). Existing brine supply/return
--    fields stay as-is; not duplicated.
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, label, field_type, unit, options, sort_order, is_required) as (
  values
  ('supply-return','cold_floor_temp_main','Cold floor temp (Main)','numeric','°F','[]'::jsonb,10,false),
  ('supply-return','cold_floor_temp_aux','Cold floor temp (Aux)','numeric','°F','[]'::jsonb,11,false),
  ('supply-return','cold_floor_setpoint_main','Cold floor set point (Main)','numeric','°F','[]'::jsonb,12,false),
  ('supply-return','cold_floor_setpoint_aux','Cold floor set point (Aux)','numeric','°F','[]'::jsonb,13,false),
  ('supply-return','cold_floor_return_temp_main','Cold floor return temp (Main)','numeric','°F','[]'::jsonb,14,false),
  ('supply-return','cold_floor_return_temp_aux','Cold floor return temp (Aux)','numeric','°F','[]'::jsonb,15,false),
  ('supply-return','warm_floor_temp_main','Warm floor temp (Main)','numeric','°F','[]'::jsonb,16,false),
  ('supply-return','warm_floor_temp_aux','Warm floor temp (Aux)','numeric','°F','[]'::jsonb,17,false),
  ('supply-return','warm_floor_setpoint_main','Warm floor set point (Main)','numeric','°F','[]'::jsonb,18,false),
  ('supply-return','warm_floor_setpoint_aux','Warm floor set point (Aux)','numeric','°F','[]'::jsonb,19,false),
  ('supply-return','warm_floor_return_temp_main','Warm floor return temp (Main)','numeric','°F','[]'::jsonb,20,false),
  ('supply-return','warm_floor_return_temp_aux','Warm floor return temp (Aux)','numeric','°F','[]'::jsonb,21,false),
  ('supply-return','snow_melt_supply_temp','Snow melt supply temp','numeric','°F','[]'::jsonb,22,false),
  ('supply-return','snow_melt_return_temp','Snow melt return temp','numeric','°F','[]'::jsonb,23,false)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required, is_active)
select s.facility_id, s.id, null, t.key, t.label, t.field_type, t.unit, t.options, t.sort_order, t.is_required, true
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key and f.equipment_id is null
);

-- ----------------------------------------------------------------------------
-- 7. ACTIVE computed deviation fields, per sheet. Schema per migration 113;
--    operands resolve by field key within the same section at submit time.
--    v1 supports exactly one binary operation — no expression parser.
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, label, options, sort_order) as (
  values
  ('supply-return','cold_floor_deviation_main','Cold floor deviation from set point (Main)',
    '{"formula":"a-b","operands":{"a":"cold_floor_temp_main","b":"cold_floor_setpoint_main"}}'::jsonb,30),
  ('supply-return','cold_floor_deviation_aux','Cold floor deviation from set point (Aux)',
    '{"formula":"a-b","operands":{"a":"cold_floor_temp_aux","b":"cold_floor_setpoint_aux"}}'::jsonb,31),
  ('supply-return','warm_floor_deviation_main','Warm floor deviation from set point (Main)',
    '{"formula":"a-b","operands":{"a":"warm_floor_temp_main","b":"warm_floor_setpoint_main"}}'::jsonb,32),
  ('supply-return','warm_floor_deviation_aux','Warm floor deviation from set point (Aux)',
    '{"formula":"a-b","operands":{"a":"warm_floor_temp_aux","b":"warm_floor_setpoint_aux"}}'::jsonb,33)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required, is_active)
select s.facility_id, s.id, null, t.key, t.label, 'computed', '°F', t.options, t.sort_order, false, true
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key and f.equipment_id is null
);

-- ----------------------------------------------------------------------------
-- 8. Starting thresholds for the deviation fields: ±2 °F, severity 'warn'.
--    STARTING DEFAULTS for Tennity — tune in the Admin Control Center
--    (Refrigeration → Setup → Thresholds); do not treat as commissioned values.
--    Guard matches uniq_refrigeration_thresholds_field_active_no_equipment.
-- ----------------------------------------------------------------------------
insert into public.refrigeration_thresholds
  (facility_id, field_id, equipment_id, min_value, max_value, severity, is_active)
select f.facility_id, f.id, null, -2, 2, 'warn', true
from public.refrigeration_fields f
join public.refrigeration_sections s on s.id = f.section_id
where s.slug = 'supply-return'
  and f.equipment_id is null
  and f.key in (
    'cold_floor_deviation_main','cold_floor_deviation_aux',
    'warm_floor_deviation_main','warm_floor_deviation_aux'
  )
  and not exists (
    select 1 from public.refrigeration_thresholds t
    where t.field_id = f.id and t.equipment_id is null and t.is_active
  );

commit;
