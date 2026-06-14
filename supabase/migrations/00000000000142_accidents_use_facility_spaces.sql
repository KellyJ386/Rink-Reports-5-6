-- =============================================================================
-- 00000000000142_accidents_use_facility_spaces.sql
-- Accident Reports adopt the shared facility_spaces list for "where it happened".
--
-- Previously the location options were an accident_dropdowns category
-- ('location') and accident_reports.location_dropdown_id referenced
-- accident_dropdowns(id). Now they come from the shared facility_spaces list.
--
-- The column keeps its legacy name (location_dropdown_id) to avoid a wide
-- rename; only its FK target changes. There are no accident_reports rows to
-- migrate. The 'location' accident_dropdowns rows are removed and dropped from
-- the seeder (facility_spaces is the single source now).
-- =============================================================================

-- 1) Retarget the FK from accident_dropdowns -> facility_spaces.
alter table public.accident_reports
  drop constraint if exists accident_reports_location_dropdown_id_fkey;
alter table public.accident_reports
  add constraint accident_reports_location_dropdown_id_fkey
  foreign key (location_dropdown_id)
  references public.facility_spaces(id) on delete set null;

comment on column public.accident_reports.location_dropdown_id is
  'Facility space where the accident occurred. References facility_spaces(id) (shared list) as of migration 142; retains its legacy column name.';

-- 2) Drop the now-unused 'location' accident dropdown rows.
delete from public.accident_dropdowns where category = 'location';

-- 3) Recreate the seeder without the 'location' block (other categories
-- unchanged). Mirrors the definition as of migration 126.
create or replace function public.seed_default_accident_dropdowns(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
$function$;
