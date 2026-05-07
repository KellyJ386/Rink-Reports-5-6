-- =============================================================================
-- 00000000000010_accident_reports_schema.sql
-- Accident Reports module: 6 tables + RLS + seed-defaults helper.
--
-- Separate from Incident Reports. No photo uploads. No areas/tabs. Interactive
-- SVG body diagram (front + back) -- body part selections live in
-- accident_body_part_selections.
--
-- Required on submission: injured person name, contact, description.
-- Admin-controlled dropdowns (single combined table accident_dropdowns covering
--   injury_type, body_part, location, activity, medical_attention, severity).
-- Workers' Comp toggle + admin-customizable instructions text per facility.
-- Original report editable for 24h only (DB enforces; outside window only
--   admins may edit). Every change timestamped via accident_change_log
--   (append-only) -- the app code is responsible for inserting log rows.
-- Medical attention "required" triggers Communications alerts -- the staff UI
--   inserts into communication_alerts with source_module = 'accident_reports'.
-- History visible to Admin/GM/Manager via has_module_admin_access.
-- No statuses. Retention: 5 years (admin retention module owns the purge).
--
-- Tables:
--   accident_dropdowns
--   accident_reports
--   accident_body_part_selections
--   accident_followup_notes              (append-only)
--   accident_change_log                  (append-only)
--   accident_workers_comp_settings       (one active row per facility)
--
-- Module key for permission helpers: 'accident_reports'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. accident_dropdowns
-- -----------------------------------------------------------------------------
create table if not exists public.accident_dropdowns (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  category      text not null
                  check (category in (
                    'injury_type','body_part','location','activity',
                    'medical_attention','severity'
                  )),
  key           text not null,
  display_name  text not null,
  color         text,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint accident_dropdowns_facility_category_key_uniq
    unique (facility_id, category, key)
);

comment on table public.accident_dropdowns is
  'Accident Reports: per-facility admin-customizable dropdown values, partitioned by category. metadata extension point e.g. {"triggers_alert": true} on medical_attention rows.';

create index if not exists idx_accident_dropdowns_facility_category_active_sort
  on public.accident_dropdowns (facility_id, category, is_active, sort_order);

drop trigger if exists trg_accident_dropdowns_updated_at on public.accident_dropdowns;
create trigger trg_accident_dropdowns_updated_at
  before update on public.accident_dropdowns
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. accident_reports
-- -----------------------------------------------------------------------------
create table if not exists public.accident_reports (
  id                              uuid primary key default gen_random_uuid(),
  facility_id                     uuid not null references public.facilities(id) on delete restrict,
  employee_id                     uuid references public.employees(id) on delete set null,
  injured_person_name             text not null,
  injured_person_contact          text not null,
  description                     text not null,
  occurred_at                     timestamptz not null default now(),
  location_dropdown_id            uuid references public.accident_dropdowns(id) on delete set null,
  activity_dropdown_id            uuid references public.accident_dropdowns(id) on delete set null,
  severity_dropdown_id            uuid references public.accident_dropdowns(id) on delete set null,
  medical_attention_dropdown_id   uuid references public.accident_dropdowns(id) on delete set null,
  primary_injury_type_dropdown_id uuid references public.accident_dropdowns(id) on delete set null,
  workers_comp                    boolean not null default false,
  workers_comp_acknowledged_at    timestamptz,
  submitted_at                    timestamptz not null default now(),
  edit_window_ends_at             timestamptz not null default (now() + interval '24 hours'),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz
);

comment on table public.accident_reports is
  'Accident Reports: per-facility accident submissions. Editable by submitter while now() <= edit_window_ends_at (24h default). Outside the window only admins may update; all changes should be logged in accident_change_log by the app.';
comment on column public.accident_reports.edit_window_ends_at is
  'Convenience timestamp -- RLS update policy compares now() to this value to gate submitter edits.';

create index if not exists idx_accident_reports_facility_submitted
  on public.accident_reports (facility_id, submitted_at desc);
create index if not exists idx_accident_reports_employee
  on public.accident_reports (employee_id);
create index if not exists idx_accident_reports_severity
  on public.accident_reports (severity_dropdown_id);
create index if not exists idx_accident_reports_medical_attention
  on public.accident_reports (medical_attention_dropdown_id);

drop trigger if exists trg_accident_reports_updated_at on public.accident_reports;
create trigger trg_accident_reports_updated_at
  before update on public.accident_reports
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. accident_body_part_selections
-- -----------------------------------------------------------------------------
create table if not exists public.accident_body_part_selections (
  id                     uuid primary key default gen_random_uuid(),
  facility_id            uuid not null references public.facilities(id) on delete restrict,
  accident_id            uuid not null references public.accident_reports(id) on delete cascade,
  body_part_dropdown_id  uuid not null references public.accident_dropdowns(id) on delete restrict,
  side                   text not null default 'none'
                           check (side in ('front','back','both','none')),
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz,
  constraint accident_body_part_selections_uniq
    unique (accident_id, body_part_dropdown_id, side)
);

comment on table public.accident_body_part_selections is
  'Accident Reports: body parts selected on the SVG diagram (front/back/both/none) per accident. body_part_dropdown_id uses ON DELETE RESTRICT so admins cannot delete a body part referenced by historical reports.';

create index if not exists idx_accident_body_part_selections_accident
  on public.accident_body_part_selections (accident_id);

drop trigger if exists trg_accident_body_part_selections_updated_at on public.accident_body_part_selections;
create trigger trg_accident_body_part_selections_updated_at
  before update on public.accident_body_part_selections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. accident_followup_notes (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.accident_followup_notes (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  accident_id  uuid not null references public.accident_reports(id) on delete cascade,
  employee_id  uuid references public.employees(id) on delete set null,
  body         text not null,
  created_at   timestamptz not null default now()
);

comment on table public.accident_followup_notes is
  'Accident Reports: append-only follow-up notes (used after the 24h edit window closes). No update/delete policies -- permanent history.';

create index if not exists idx_accident_followup_notes_accident_created
  on public.accident_followup_notes (accident_id, created_at);

-- -----------------------------------------------------------------------------
-- 5. accident_change_log (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.accident_change_log (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  accident_id   uuid not null references public.accident_reports(id) on delete cascade,
  employee_id   uuid references public.employees(id) on delete set null,
  action        text not null,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.accident_change_log is
  'Accident Reports: append-only audit log. action e.g. create, update, add_body_part, remove_body_part. Visible to admins only. No update/delete policies.';

create index if not exists idx_accident_change_log_accident_created
  on public.accident_change_log (accident_id, created_at);

-- -----------------------------------------------------------------------------
-- 6. accident_workers_comp_settings
-- One ACTIVE row per facility -- enforced via partial unique index. History
-- rows (is_active = false) are allowed for future use.
-- -----------------------------------------------------------------------------
create table if not exists public.accident_workers_comp_settings (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  instructions  text not null default '',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

comment on table public.accident_workers_comp_settings is
  'Accident Reports: admin-customizable Workers'' Comp instructions text shown when the workers_comp toggle is on. Exactly one is_active=true row per facility (partial unique index).';

create unique index if not exists uniq_accident_workers_comp_settings_facility_active
  on public.accident_workers_comp_settings (facility_id)
  where is_active = true;

drop trigger if exists trg_accident_workers_comp_settings_updated_at on public.accident_workers_comp_settings;
create trigger trg_accident_workers_comp_settings_updated_at
  before update on public.accident_workers_comp_settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Seed defaults helper
-- Idempotent. Inserts canonical dropdown values for a facility.
-- =============================================================================
create or replace function public.seed_default_accident_dropdowns(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- body_part (12) -- order roughly bottom-up
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
    (p_facility_id, 'body_part', 'head_neck',   'Head/Neck',   12, true)
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

comment on function public.seed_default_accident_dropdowns(uuid) is
  'Seeds canonical accident_dropdowns values for a facility across all 6 categories. Idempotent via on conflict (facility_id, category, key) do nothing.';

revoke execute on function public.seed_default_accident_dropdowns(uuid) from public;
grant  execute on function public.seed_default_accident_dropdowns(uuid) to service_role;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.accident_dropdowns              enable row level security;
alter table public.accident_reports                enable row level security;
alter table public.accident_body_part_selections   enable row level security;
alter table public.accident_followup_notes         enable row level security;
alter table public.accident_change_log             enable row level security;
alter table public.accident_workers_comp_settings  enable row level security;

-- -----------------------------------------------------------------------------
-- accident_dropdowns
--   SELECT: super_admin OR same-facility + module access
--   INSERT/UPDATE/DELETE: super_admin OR same-facility + module admin access
-- -----------------------------------------------------------------------------
drop policy if exists accident_dropdowns_select on public.accident_dropdowns;
create policy accident_dropdowns_select on public.accident_dropdowns
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('accident_reports')
    )
  );

drop policy if exists accident_dropdowns_insert on public.accident_dropdowns;
create policy accident_dropdowns_insert on public.accident_dropdowns
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  );

drop policy if exists accident_dropdowns_update on public.accident_dropdowns;
create policy accident_dropdowns_update on public.accident_dropdowns
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  );

drop policy if exists accident_dropdowns_delete on public.accident_dropdowns;
create policy accident_dropdowns_delete on public.accident_dropdowns
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- accident_workers_comp_settings (same shape as accident_dropdowns)
-- -----------------------------------------------------------------------------
drop policy if exists accident_workers_comp_settings_select on public.accident_workers_comp_settings;
create policy accident_workers_comp_settings_select on public.accident_workers_comp_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('accident_reports')
    )
  );

drop policy if exists accident_workers_comp_settings_insert on public.accident_workers_comp_settings;
create policy accident_workers_comp_settings_insert on public.accident_workers_comp_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  );

drop policy if exists accident_workers_comp_settings_update on public.accident_workers_comp_settings;
create policy accident_workers_comp_settings_update on public.accident_workers_comp_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  );

drop policy if exists accident_workers_comp_settings_delete on public.accident_workers_comp_settings;
create policy accident_workers_comp_settings_delete on public.accident_workers_comp_settings
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- accident_reports
--   SELECT: super_admin OR (same-facility AND (module admin OR (module access AND own row)))
--   INSERT: super_admin OR (same-facility AND module access AND employee_id = current_employee_id)
--   UPDATE: super_admin OR module admin OR (own row AND now() <= edit_window_ends_at)
--   DELETE: super_admin only
-- -----------------------------------------------------------------------------
drop policy if exists accident_reports_select on public.accident_reports;
create policy accident_reports_select on public.accident_reports
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('accident_reports')
        or (
          public.has_module_access('accident_reports')
          and employee_id = public.current_employee_id()
        )
      )
    )
  );

drop policy if exists accident_reports_insert on public.accident_reports;
create policy accident_reports_insert on public.accident_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('accident_reports')
      and employee_id = public.current_employee_id()
    )
  );

drop policy if exists accident_reports_update on public.accident_reports;
create policy accident_reports_update on public.accident_reports
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('accident_reports')
        or (
          employee_id = public.current_employee_id()
          and now() <= edit_window_ends_at
        )
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('accident_reports')
        or (
          employee_id = public.current_employee_id()
          and now() <= edit_window_ends_at
        )
      )
    )
  );

drop policy if exists accident_reports_delete on public.accident_reports;
create policy accident_reports_delete on public.accident_reports
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- accident_body_part_selections
--   SELECT: parent rule (admin OR own parent)
--   INSERT/UPDATE/DELETE: admin OR submitter within edit window
-- -----------------------------------------------------------------------------
drop policy if exists accident_body_part_selections_select on public.accident_body_part_selections;
create policy accident_body_part_selections_select on public.accident_body_part_selections
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

drop policy if exists accident_body_part_selections_insert on public.accident_body_part_selections;
create policy accident_body_part_selections_insert on public.accident_body_part_selections
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

drop policy if exists accident_body_part_selections_update on public.accident_body_part_selections;
create policy accident_body_part_selections_update on public.accident_body_part_selections
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

drop policy if exists accident_body_part_selections_delete on public.accident_body_part_selections;
create policy accident_body_part_selections_delete on public.accident_body_part_selections
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
-- accident_followup_notes (append-only)
--   SELECT: parent rule (admin OR own parent)
--   INSERT: super_admin OR (same-facility AND module admin)
--   UPDATE/DELETE: no policies -> denied (append-only)
-- -----------------------------------------------------------------------------
drop policy if exists accident_followup_notes_select on public.accident_followup_notes;
create policy accident_followup_notes_select on public.accident_followup_notes
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

drop policy if exists accident_followup_notes_insert on public.accident_followup_notes;
create policy accident_followup_notes_insert on public.accident_followup_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  );

-- (No update / delete policies -- append-only.)

-- -----------------------------------------------------------------------------
-- accident_change_log (append-only)
--   SELECT: super_admin OR module admin
--   INSERT: any authenticated user in same facility (server code is the writer;
--           write authority is gated upstream by accident_reports update policy)
--   UPDATE/DELETE: no policies -> denied
-- -----------------------------------------------------------------------------
drop policy if exists accident_change_log_select on public.accident_change_log;
create policy accident_change_log_select on public.accident_change_log
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('accident_reports')
    )
  );

drop policy if exists accident_change_log_insert on public.accident_change_log;
create policy accident_change_log_insert on public.accident_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- (No update / delete policies -- append-only.)
