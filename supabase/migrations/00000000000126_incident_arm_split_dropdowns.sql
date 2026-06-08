-- =============================================================================
-- 00000000000126_incident_arm_split_dropdowns.sql
-- Body diagram item 6: make upper arm and lower arm independently selectable.
--
-- The SVG diagram used a single `arms` region covering both the upper arm and
-- the forearm, so clicking either toggled both. The diagram now renders
-- separate `upper_arms` / `lower_arms` regions (mirroring upper_legs /
-- lower_legs). The form only persists a body-part selection when a matching
-- active `accident_dropdowns` row exists, so seed the two new keys for every
-- facility and deactivate the legacy `arms` row. Historical rows that reference
-- `arms` still resolve via the FK (the detail/edit views load all dropdowns,
-- active or not), and the diagram renders the legacy whole-arm region only when
-- such a selection is present.
--
-- ROLLBACK:
--   update public.accident_dropdowns set is_active = true
--     where category = 'body_part' and key = 'arms';
--   update public.accident_dropdowns set is_active = false
--     where category = 'body_part' and key in ('upper_arms','lower_arms');
-- =============================================================================

-- 1. Seed the new keys for every existing facility.
insert into public.accident_dropdowns
  (facility_id, category, key, display_name, sort_order, is_active)
select f.id, 'body_part', v.key, v.display_name, v.sort_order, true
  from public.facilities f
  cross join (values
    ('upper_arms', 'Upper Arms', 18),
    ('lower_arms', 'Lower Arms', 19)
  ) as v(key, display_name, sort_order)
  on conflict (facility_id, category, key) do nothing;

-- 2. Deactivate the legacy whole-arm row so new submissions use the split.
update public.accident_dropdowns
   set is_active = false
 where category = 'body_part'
   and key = 'arms'
   and is_active = true;

-- 3. Update the seed function so new facilities get the split (arms retained
--    inactive for backwards compatibility, like head_neck).
create or replace function public.seed_default_accident_dropdowns(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- body_part -- order roughly bottom-up; head_neck and arms retained as
  -- inactive for backwards compatibility. upper_arms / lower_arms are the
  -- canonical arm zones going forward.
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'body_part', 'feet',        'Feet',        1,  true),
    (p_facility_id, 'body_part', 'ankles',      'Ankles',      2,  true),
    (p_facility_id, 'body_part', 'lower_legs',  'Lower Legs',  3,  true),
    (p_facility_id, 'body_part', 'knees',       'Knees',       4,  true),
    (p_facility_id, 'body_part', 'upper_legs',  'Upper Legs',  5,  true),
    (p_facility_id, 'body_part', 'hips',        'Hips',        6,  true),
    (p_facility_id, 'body_part', 'torso',       'Torso',       7,  true),
    (p_facility_id, 'body_part', 'arms',        'Arms',        8,  false),
    (p_facility_id, 'body_part', 'elbows',      'Elbows',      9,  true),
    (p_facility_id, 'body_part', 'hands',       'Hands',       10, true),
    (p_facility_id, 'body_part', 'fingers',     'Fingers',     11, true),
    (p_facility_id, 'body_part', 'head_neck',   'Head/Neck',   12, false),
    (p_facility_id, 'body_part', 'head',        'Head',        13, true),
    (p_facility_id, 'body_part', 'face_jaw',    'Face / Jaw',  14, true),
    (p_facility_id, 'body_part', 'neck',        'Neck',        15, true),
    (p_facility_id, 'body_part', 'shoulders',   'Shoulders',   16, true),
    (p_facility_id, 'body_part', 'wrists',      'Wrists',      17, true),
    (p_facility_id, 'body_part', 'upper_arms',  'Upper Arms',  18, true),
    (p_facility_id, 'body_part', 'lower_arms',  'Lower Arms',  19, true)
  on conflict (facility_id, category, key) do nothing;

  -- severity (4) with colors
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, color, sort_order, is_active)
  values
    (p_facility_id, 'severity', 'low',      'Low',      '#16a34a', 1, true),
    (p_facility_id, 'severity', 'medium',   'Medium',   '#f59e0b', 2, true),
    (p_facility_id, 'severity', 'high',     'High',     '#ef4444', 3, true),
    (p_facility_id, 'severity', 'critical', 'Critical', '#7f1d1d', 4, true)
  on conflict (facility_id, category, key) do nothing;

  -- medical_attention (5); triggers_alert metadata on the three escalated keys
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active, metadata)
  values
    (p_facility_id, 'medical_attention', 'none',            'None',                  1, true, '{}'::jsonb),
    (p_facility_id, 'medical_attention', 'first_aid',       'First Aid',             2, true, '{}'::jsonb),
    (p_facility_id, 'medical_attention', 'medical_office',  'Medical Office Visit',  3, true, '{"triggers_alert": true}'::jsonb),
    (p_facility_id, 'medical_attention', 'er',              'Emergency Room',        4, true, '{"triggers_alert": true}'::jsonb),
    (p_facility_id, 'medical_attention', 'hospitalization', 'Hospitalization',       5, true, '{"triggers_alert": true}'::jsonb)
  on conflict (facility_id, category, key) do nothing;

  -- injury_type (10)
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'injury_type', 'cut',         'Cut',         1,  true),
    (p_facility_id, 'injury_type', 'bruise',      'Bruise',      2,  true),
    (p_facility_id, 'injury_type', 'sprain',      'Sprain',      3,  true),
    (p_facility_id, 'injury_type', 'strain',      'Strain',      4,  true),
    (p_facility_id, 'injury_type', 'fracture',    'Fracture',    5,  true),
    (p_facility_id, 'injury_type', 'concussion',  'Concussion',  6,  true),
    (p_facility_id, 'injury_type', 'burn',        'Burn',        7,  true),
    (p_facility_id, 'injury_type', 'puncture',    'Puncture',    8,  true),
    (p_facility_id, 'injury_type', 'dislocation', 'Dislocation', 9,  true),
    (p_facility_id, 'injury_type', 'other',       'Other',       10, true)
  on conflict (facility_id, category, key) do nothing;

  -- location (8)
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'location', 'ice_surface', 'Ice Surface', 1, true),
    (p_facility_id, 'location', 'bench',       'Bench',       2, true),
    (p_facility_id, 'location', 'locker_room', 'Locker Room', 3, true),
    (p_facility_id, 'location', 'lobby',       'Lobby',       4, true),
    (p_facility_id, 'location', 'concession',  'Concession',  5, true),
    (p_facility_id, 'location', 'parking_lot', 'Parking Lot', 6, true),
    (p_facility_id, 'location', 'boardroom',   'Boardroom',   7, true),
    (p_facility_id, 'location', 'other',       'Other',       8, true)
  on conflict (facility_id, category, key) do nothing;

  -- activity (8)
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'activity', 'skating',      'Skating',      1, true),
    (p_facility_id, 'activity', 'coaching',     'Coaching',     2, true),
    (p_facility_id, 'activity', 'instructing',  'Instructing',  3, true),
    (p_facility_id, 'activity', 'cleaning',     'Cleaning',     4, true),
    (p_facility_id, 'activity', 'maintenance',  'Maintenance',  5, true),
    (p_facility_id, 'activity', 'event_setup',  'Event Setup',  6, true),
    (p_facility_id, 'activity', 'walking',      'Walking',      7, true),
    (p_facility_id, 'activity', 'other',        'Other',        8, true)
  on conflict (facility_id, category, key) do nothing;
end;
$$;
