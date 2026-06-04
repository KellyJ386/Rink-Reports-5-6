-- =============================================================================
-- 00000000000109_seed_refrigeration_fields_thresholds.sql
-- Refrigeration module: fix the "Condeser" typo and seed reading-field
-- definitions + starting out-of-range thresholds for all 6 sections.
--
-- Facility-scoped by design (mirrors migrations 80 and 106): sections and
-- equipment are resolved by slug/name, which only exist for the production
-- (Tennity) facility, so this is a no-op on fresh/local databases (no matching
-- sections => zero inserts). No generated UUIDs are hardcoded.
--
-- Idempotent: every insert is guarded by WHERE NOT EXISTS (matching the
-- partial unique indexes on fields and thresholds), so re-running never
-- duplicates rows and never clobbers admin edits.
--
-- NOTE: refrigeration_thresholds below are GENERIC STARTING RANGES. Replace
-- them with Tennity's commissioned setpoints before relying on out-of-range
-- flags.
-- =============================================================================
begin;

-- ----------------------------------------------------------------------------
-- 1. Typo fix
-- ----------------------------------------------------------------------------
update public.refrigeration_equipment
   set name = 'Condenser',
       slug = 'condenser',
       updated_at = now()
 where name = 'Condeser';

-- ----------------------------------------------------------------------------
-- 2a. Equipment-scoped fields  (one row PER equipment in the section)
--     Sections: compressors, pumps, condensers
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, label, field_type, unit, options, sort_order, is_required) as (
  values
  -- Compressors (applied to Compressor 1/2/3)
  ('compressors','suction_pressure','Suction pressure','numeric','psig','[]'::jsonb,1,true),
  ('compressors','discharge_pressure','Discharge pressure','numeric','psig','[]'::jsonb,2,true),
  ('compressors','oil_pressure','Oil pressure','numeric','psig','[]'::jsonb,3,true),
  ('compressors','oil_temp','Oil temperature','numeric','°F','[]'::jsonb,4,false),
  ('compressors','motor_amps','Motor amps','numeric','A','[]'::jsonb,5,false),
  ('compressors','run_status','Status','select',NULL,'["Running","Staged","Off"]'::jsonb,6,true),
  ('compressors','oil_level_ok','Oil level OK','boolean',NULL,'[]'::jsonb,7,false),
  -- Pumps (applied to Brine Pump 1/2/3)
  ('pumps','pump_status','Status','select',NULL,'["Running","Off"]'::jsonb,1,true),
  ('pumps','pump_amps','Pump amps','numeric','A','[]'::jsonb,2,false),
  ('pumps','discharge_pressure','Discharge pressure','numeric','psi','[]'::jsonb,3,false),
  -- Condensers (applied to Condenser)
  ('condensers','water_in_temp','Water in temp','numeric','°F','[]'::jsonb,1,false),
  ('condensers','water_out_temp','Water out temp','numeric','°F','[]'::jsonb,2,false),
  ('condensers','head_pressure','Head pressure','numeric','psig','[]'::jsonb,3,false),
  ('condensers','fan_status','Fan status','select',NULL,'["Running","Off"]'::jsonb,4,false),
  ('condensers','sump_level_ok','Sump level OK','boolean',NULL,'[]'::jsonb,5,false)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required)
select s.facility_id, s.id, e.id, t.key, t.label, t.field_type, t.unit, t.options, t.sort_order, t.is_required
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
join public.refrigeration_equipment e on e.section_id = s.id and e.is_active
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key
    and f.equipment_id is not distinct from e.id
);

-- ----------------------------------------------------------------------------
-- 2b. Section-scoped fields  (equipment_id = NULL)
--     Sections: supply-return, machine-hours, alarms
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, label, field_type, unit, options, sort_order, is_required) as (
  values
  -- Supply / Return
  ('supply-return','brine_supply_temp','Brine supply temp','numeric','°F','[]'::jsonb,1,true),
  ('supply-return','brine_return_temp','Brine return temp','numeric','°F','[]'::jsonb,2,true),
  ('supply-return','brine_flow','Brine flow','numeric','gpm','[]'::jsonb,3,false),
  ('supply-return','ice_surface_temp','Ice surface temp','numeric','°F','[]'::jsonb,4,true),
  ('supply-return','subfloor_temp','Sub-floor temp','numeric','°F','[]'::jsonb,5,false),
  ('supply-return','subfloor_heat_status','Sub-floor heat status','select',NULL,'["On","Off"]'::jsonb,6,false),
  ('supply-return','header_overflow_level','Header / overflow level','numeric','%','[]'::jsonb,7,false),
  -- Machine Hours (per-compressor runtime)
  ('machine-hours','compressor_1_hours','Compressor 1 runtime','numeric','hrs','[]'::jsonb,1,false),
  ('machine-hours','compressor_2_hours','Compressor 2 runtime','numeric','hrs','[]'::jsonb,2,false),
  ('machine-hours','compressor_3_hours','Compressor 3 runtime','numeric','hrs','[]'::jsonb,3,false),
  -- Alarms / Safety
  ('alarms','gas_detection_ppm','Gas detection','numeric','ppm','[]'::jsonb,1,true),
  ('alarms','gas_alarm_state','Gas alarm state','select',NULL,'["Normal","Warning","Alarm"]'::jsonb,2,true),
  ('alarms','ventilation_status','Ventilation status','select',NULL,'["Running","Off"]'::jsonb,3,true),
  ('alarms','leak_observed','Leak / odor observed','boolean',NULL,'[]'::jsonb,4,true),
  ('alarms','safety_device_check_ok','Safety devices OK','boolean',NULL,'[]'::jsonb,5,false)
)
insert into public.refrigeration_fields
  (facility_id, section_id, equipment_id, key, label, field_type, unit, options, sort_order, is_required)
select s.facility_id, s.id, NULL, t.key, t.label, t.field_type, t.unit, t.options, t.sort_order, t.is_required
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
where not exists (
  select 1 from public.refrigeration_fields f
  where f.section_id = s.id and f.key = t.key and f.equipment_id is null
);

-- ----------------------------------------------------------------------------
-- 2c. Thresholds  (one per matching numeric field row; per-equipment where the
--     field is equipment-scoped, so each compressor gets its own overridable row)
--     >>> GENERIC STARTING VALUES — replace with commissioned setpoints. <<<
-- ----------------------------------------------------------------------------
with tmpl(section_slug, key, tmin, tmax, severity) as (
  values
  ('compressors','suction_pressure',   15::numeric, 35::numeric, 'high'),
  ('compressors','discharge_pressure', 120::numeric,185::numeric,'high'),
  ('compressors','oil_pressure',       40::numeric, 60::numeric, 'high'),
  ('compressors','oil_temp',           90::numeric, 140::numeric,'warn'),
  ('condensers','water_in_temp',       60::numeric, 90::numeric, 'warn'),
  ('condensers','water_out_temp',      70::numeric, 100::numeric,'warn'),
  ('condensers','head_pressure',       120::numeric,185::numeric,'high'),
  ('supply-return','brine_supply_temp',14::numeric, 24::numeric, 'high'),
  ('supply-return','brine_return_temp',18::numeric, 28::numeric, 'warn'),
  ('supply-return','ice_surface_temp', 16::numeric, 26::numeric, 'warn'),
  ('alarms','gas_detection_ppm',       NULL::numeric, 25::numeric,'critical')
)
insert into public.refrigeration_thresholds
  (facility_id, field_id, equipment_id, min_value, max_value, severity)
select f.facility_id, f.id, f.equipment_id, t.tmin, t.tmax, t.severity
from tmpl t
join public.refrigeration_sections s on s.slug = t.section_slug
join public.refrigeration_fields f on f.section_id = s.id and f.key = t.key and f.is_active
where not exists (
  select 1 from public.refrigeration_thresholds th
  where th.field_id = f.id
    and th.equipment_id is not distinct from f.equipment_id
    and th.is_active
);

commit;
