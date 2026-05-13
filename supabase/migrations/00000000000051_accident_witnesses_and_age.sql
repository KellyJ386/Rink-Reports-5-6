-- =============================================================================
-- 00000000000051_accident_witnesses_and_age.sql
-- Accident Reports: add injured_person_age, witnesses (1..5), and finer-grained
-- body_part dropdown rows (head, neck, face_jaw, shoulders) plus a small set
-- of legacy-row updates so the existing head_neck key is hidden from new
-- submissions but still resolvable on historical reports.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. accident_reports.injured_person_age (nullable; new form enforces required)
-- -----------------------------------------------------------------------------
alter table public.accident_reports
  add column if not exists injured_person_age smallint
    check (injured_person_age is null or (injured_person_age between 0 and 120));

comment on column public.accident_reports.injured_person_age is
  'Age (years) of the injured person at the time of submission. Nullable for '
  'historical rows; the submission form requires it on new reports.';

-- -----------------------------------------------------------------------------
-- 2. accident_witnesses (0..5 per accident; ordered by sort_order)
-- -----------------------------------------------------------------------------
create table if not exists public.accident_witnesses (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  accident_id   uuid not null references public.accident_reports(id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  contact       text,
  statement     text,
  sort_order    int  not null default 0 check (sort_order >= 0 and sort_order <= 4),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint accident_witnesses_uniq_per_accident
    unique (accident_id, sort_order)
);

comment on table public.accident_witnesses is
  'Accident Reports: up to 5 witnesses per accident. Captured by the submitter; '
  'editable while the parent report is within its 24h edit window.';

create index if not exists idx_accident_witnesses_accident
  on public.accident_witnesses (accident_id);

drop trigger if exists trg_accident_witnesses_updated_at on public.accident_witnesses;
create trigger trg_accident_witnesses_updated_at
  before update on public.accident_witnesses
  for each row execute function public.set_updated_at();

-- Cap to 5 witnesses per accident via a BEFORE INSERT trigger. (The unique
-- index on (accident_id, sort_order) with the 0..4 check already prevents
-- more than 5, but this provides a clear error message.)
create or replace function public.enforce_accident_witnesses_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count int;
begin
  select count(*) into current_count
    from public.accident_witnesses
    where accident_id = NEW.accident_id;
  if current_count >= 5 then
    raise exception 'Accident reports can have at most 5 witnesses';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_accident_witnesses_cap on public.accident_witnesses;
create trigger trg_accident_witnesses_cap
  before insert on public.accident_witnesses
  for each row execute function public.enforce_accident_witnesses_cap();

-- -----------------------------------------------------------------------------
-- 3. RLS for accident_witnesses (mirror accident_body_part_selections)
-- -----------------------------------------------------------------------------
alter table public.accident_witnesses enable row level security;

drop policy if exists accident_witnesses_select on public.accident_witnesses;
create policy accident_witnesses_select on public.accident_witnesses
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('accident_reports')
        or exists (
          select 1
          from public.accident_reports r
          where r.id = accident_id
            and r.employee_id = public.current_employee_id()
        )
      )
    )
  );

drop policy if exists accident_witnesses_insert on public.accident_witnesses;
create policy accident_witnesses_insert on public.accident_witnesses
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.accident_reports r
        where r.id = accident_id
          and (
            public.has_module_admin_access('accident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  );

drop policy if exists accident_witnesses_update on public.accident_witnesses;
create policy accident_witnesses_update on public.accident_witnesses
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.accident_reports r
        where r.id = accident_id
          and (
            public.has_module_admin_access('accident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.accident_reports r
        where r.id = accident_id
          and (
            public.has_module_admin_access('accident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  );

drop policy if exists accident_witnesses_delete on public.accident_witnesses;
create policy accident_witnesses_delete on public.accident_witnesses
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.accident_reports r
        where r.id = accident_id
          and (
            public.has_module_admin_access('accident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Seed new body_part rows for every facility, and deactivate head_neck so
--    new submissions get the finer split. Existing historical rows that
--    reference head_neck still resolve via the FK.
-- -----------------------------------------------------------------------------
insert into public.accident_dropdowns
  (facility_id, category, key, display_name, sort_order, is_active)
select f.id, 'body_part', v.key, v.display_name, v.sort_order, true
  from public.facilities f
  cross join (values
    ('head',       'Head',       13),
    ('face_jaw',   'Face / Jaw', 14),
    ('neck',       'Neck',       15),
    ('shoulders',  'Shoulders',  16)
  ) as v(key, display_name, sort_order)
  on conflict (facility_id, category, key) do nothing;

update public.accident_dropdowns
  set is_active = false
  where category = 'body_part'
    and key = 'head_neck'
    and is_active = true;

-- -----------------------------------------------------------------------------
-- 5. Update the seed function so newly-created facilities get the new keys
--    and skip the legacy head_neck row.
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_accident_dropdowns(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- body_part -- order roughly bottom-up; head_neck retained as inactive for
  -- backwards compatibility, head / face_jaw / neck / shoulders are the
  -- canonical zones going forward.
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
    (p_facility_id, 'body_part', 'arms',        'Arms',        8,  true),
    (p_facility_id, 'body_part', 'elbows',      'Elbows',      9,  true),
    (p_facility_id, 'body_part', 'hands',       'Hands',       10, true),
    (p_facility_id, 'body_part', 'fingers',     'Fingers',     11, true),
    (p_facility_id, 'body_part', 'head_neck',   'Head/Neck',   12, false),
    (p_facility_id, 'body_part', 'head',        'Head',        13, true),
    (p_facility_id, 'body_part', 'face_jaw',    'Face / Jaw',  14, true),
    (p_facility_id, 'body_part', 'neck',        'Neck',        15, true),
    (p_facility_id, 'body_part', 'shoulders',   'Shoulders',   16, true)
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

revoke execute on function public.seed_default_accident_dropdowns(uuid) from public;
grant  execute on function public.seed_default_accident_dropdowns(uuid) to service_role;
