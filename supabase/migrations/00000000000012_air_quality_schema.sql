-- =============================================================================
-- 00000000000012_air_quality_schema.sql
-- Air Quality module: 9 tables + RLS + seed-defaults helper.
--
-- Independent simple form module. Core readings are CO and CO2; admin can
-- configure additional reading types (humidity, temperature, etc.).
-- Admin controls locations, equipment, reading types, thresholds, compliance
-- rules (jurisdiction-aware), testing frequency, and module-level settings.
-- Different facilities may have different compliance rules.
--
-- Staff cannot submit incomplete reports -- every active+required reading
-- type per location must have a value (UI-enforced; the DB does not block).
-- Exceedances trigger a companion communication_alerts row (source_module =
-- 'air_quality'). The submitting server code is responsible for evaluating
-- each reading against the matching active threshold (location-specific
-- preferred over location-null), setting air_quality_readings.is_exceedance /
-- severity_at_submit / threshold_id / compliance snapshots, AND rolling those
-- up onto the parent air_quality_reports row (has_exceedance,
-- max_severity = max severity across all readings using ordering
-- 'warn' < 'high' < 'critical').
--
-- PDFs and auto-email are deferred -- no pdf or email_recipients tables.
-- Original reports immutable -- only super_admin may UPDATE/DELETE reports
-- and readings. Managers/admins append timestamped follow-up notes
-- (append-only at the DB layer; no UPDATE/DELETE policies).
-- Retention purge deferred (handled later by admin retention module).
--
-- Tables:
--   air_quality_locations
--   air_quality_equipment
--   air_quality_reading_types
--   air_quality_thresholds
--   air_quality_compliance_rules
--   air_quality_reports
--   air_quality_readings
--   air_quality_followup_notes        (append-only)
--   air_quality_settings              (one row per facility)
--
-- Module key for permission helpers: 'air_quality'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. air_quality_locations
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_locations (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint air_quality_locations_facility_slug_uniq
    unique (facility_id, slug)
);

comment on table public.air_quality_locations is
  'Air Quality: per-facility locations where readings are collected (e.g. Rink A, Rink B, Lobby). Admin controlled.';

create index if not exists idx_air_quality_locations_facility_active_sort
  on public.air_quality_locations (facility_id, is_active, sort_order);

drop trigger if exists trg_air_quality_locations_updated_at on public.air_quality_locations;
create trigger trg_air_quality_locations_updated_at
  before update on public.air_quality_locations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. air_quality_equipment
-- location_id nullable -- null = facility-wide equipment (e.g. handheld).
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_equipment (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  location_id     uuid references public.air_quality_locations(id) on delete cascade,
  name            text not null,
  slug            text not null,
  model           text,
  serial_number   text,
  sort_order      int  not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  constraint air_quality_equipment_facility_slug_uniq
    unique (facility_id, slug)
);

comment on table public.air_quality_equipment is
  'Air Quality: equipment instances (monitors). location_id null = facility-wide / handheld. Admin controlled.';

create index if not exists idx_air_quality_equipment_facility_location_active
  on public.air_quality_equipment (facility_id, location_id, is_active);

drop trigger if exists trg_air_quality_equipment_updated_at on public.air_quality_equipment;
create trigger trg_air_quality_equipment_updated_at
  before update on public.air_quality_equipment
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. air_quality_reading_types
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_reading_types (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  key           text not null,
  label         text not null,
  unit          text not null,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  is_required   boolean not null default true,
  decimals      int  not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint air_quality_reading_types_facility_key_uniq
    unique (facility_id, key)
);

comment on table public.air_quality_reading_types is
  'Air Quality: per-facility reading types collected per submission (co, co2, temperature, humidity, etc.). Admin controlled.';
comment on column public.air_quality_reading_types.is_required is
  'Hint to the submit form -- when true the UI must require a value for every active location.';
comment on column public.air_quality_reading_types.decimals is
  'Display precision hint (e.g. 1 = "12.3"). Storage is numeric -- this only affects rendering.';

create index if not exists idx_air_quality_reading_types_facility_active_sort
  on public.air_quality_reading_types (facility_id, is_active, sort_order);

drop trigger if exists trg_air_quality_reading_types_updated_at on public.air_quality_reading_types;
create trigger trg_air_quality_reading_types_updated_at
  before update on public.air_quality_reading_types
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. air_quality_thresholds
-- location_id null = applies to all locations under this reading type.
-- Postgres unique constraints don't treat NULL as equal, so two partial
-- unique indexes guarantee one active threshold per (reading_type) and one
-- active threshold per (reading_type, location). The application's
-- threshold-match logic should prefer the location-specific row over the
-- reading-type-wide (location-null) row.
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_thresholds (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid not null references public.facilities(id) on delete restrict,
  reading_type_id   uuid not null references public.air_quality_reading_types(id) on delete cascade,
  location_id       uuid references public.air_quality_locations(id) on delete cascade,
  warn_min          numeric,
  warn_max          numeric,
  alert_min         numeric,
  alert_max         numeric,
  compliance_min    numeric,
  compliance_max    numeric,
  severity          text not null default 'high'
                      check (severity in ('warn','high','critical')),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

comment on table public.air_quality_thresholds is
  'Air Quality: per-reading-type thresholds. warn_*/alert_* drive UI badges and exceedance flags; compliance_*/severity drive communication_alerts payload. location_id null = applies to all locations; location-specific rows take precedence at match time.';
comment on column public.air_quality_thresholds.warn_min is
  'Lower bound of the warning band. For CO/CO2 typically null (only the upper bound matters).';
comment on column public.air_quality_thresholds.warn_max is
  'Upper bound of the warning band -- readings >= this trigger a "warn" UI badge but do not necessarily fire an alert.';
comment on column public.air_quality_thresholds.alert_min is
  'Lower bound of the alert band -- readings <= this fire an exceedance at this row''s severity.';
comment on column public.air_quality_thresholds.alert_max is
  'Upper bound of the alert band -- readings >= this fire an exceedance at this row''s severity.';
comment on column public.air_quality_thresholds.compliance_min is
  'Regulatory lower bound (informational badge, snapshotted onto each reading).';
comment on column public.air_quality_thresholds.compliance_max is
  'Regulatory upper bound (informational badge, snapshotted onto each reading).';

create unique index if not exists uniq_air_quality_thresholds_reading_type_active_no_location
  on public.air_quality_thresholds (reading_type_id)
  where location_id is null and is_active = true;

create unique index if not exists uniq_air_quality_thresholds_reading_type_location_active
  on public.air_quality_thresholds (reading_type_id, location_id)
  where location_id is not null and is_active = true;

create index if not exists idx_air_quality_thresholds_facility
  on public.air_quality_thresholds (facility_id);

create index if not exists idx_air_quality_thresholds_reading_type
  on public.air_quality_thresholds (reading_type_id);

drop trigger if exists trg_air_quality_thresholds_updated_at on public.air_quality_thresholds;
create trigger trg_air_quality_thresholds_updated_at
  before update on public.air_quality_thresholds
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. air_quality_compliance_rules
-- Free-form jurisdiction text so facilities can define their own buckets.
-- The active/effective rule for a facility is selected by matching
-- air_quality_settings.default_jurisdiction.
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_compliance_rules (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  jurisdiction    text not null,
  rule_name       text not null,
  rule_body       text not null,
  effective_from  date,
  effective_to    date,
  is_active       boolean not null default true,
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

comment on table public.air_quality_compliance_rules is
  'Air Quality: jurisdiction-aware compliance text shown to staff/admins. rule_body is markdown-ish but rendered as plain text by the UI.';
comment on column public.air_quality_compliance_rules.jurisdiction is
  'Free-form jurisdiction key (e.g. ''us_federal'', ''on_canada'', ''eu''). Matched against air_quality_settings.default_jurisdiction.';

create index if not exists idx_air_quality_compliance_rules_facility_active
  on public.air_quality_compliance_rules (facility_id, is_active);

drop trigger if exists trg_air_quality_compliance_rules_updated_at on public.air_quality_compliance_rules;
create trigger trg_air_quality_compliance_rules_updated_at
  before update on public.air_quality_compliance_rules
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. air_quality_reports
-- has_exceedance + max_severity are denormalized for fast history filtering.
-- The submitting server code MUST set both atomically with the readings rows.
-- max_severity is null when has_exceedance = false.
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_reports (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  employee_id     uuid references public.employees(id) on delete set null,
  location_id     uuid not null references public.air_quality_locations(id) on delete restrict,
  equipment_id    uuid references public.air_quality_equipment(id) on delete set null,
  notes           text,
  submitted_at    timestamptz not null default now(),
  has_exceedance  boolean not null default false,
  max_severity    text check (max_severity in ('warn','high','critical')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

comment on table public.air_quality_reports is
  'Air Quality: a single submission for one location. Original is immutable -- only super_admin may UPDATE/DELETE. Staff append context via air_quality_followup_notes (admins/managers only).';
comment on column public.air_quality_reports.has_exceedance is
  'Denormalized: true if any associated air_quality_readings row has is_exceedance = true. Server sets at submit time.';
comment on column public.air_quality_reports.max_severity is
  'Denormalized: max severity across all readings on this report using ordering warn < high < critical. Null when has_exceedance = false. Server sets at submit time.';

create index if not exists idx_air_quality_reports_facility_submitted
  on public.air_quality_reports (facility_id, submitted_at desc);

create index if not exists idx_air_quality_reports_employee
  on public.air_quality_reports (employee_id);

create index if not exists idx_air_quality_reports_location
  on public.air_quality_reports (location_id);

create index if not exists idx_air_quality_reports_exceedance
  on public.air_quality_reports (facility_id, submitted_at desc)
  where has_exceedance = true;

drop trigger if exists trg_air_quality_reports_updated_at on public.air_quality_reports;
create trigger trg_air_quality_reports_updated_at
  before update on public.air_quality_reports
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. air_quality_readings
-- Snapshots preserve key/label/unit + compliance_min/max in case the reading
-- type or threshold is later edited or deleted.
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_readings (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  report_id                   uuid not null references public.air_quality_reports(id) on delete cascade,
  reading_type_id             uuid references public.air_quality_reading_types(id) on delete set null,
  key_snapshot                text not null,
  label_snapshot              text not null,
  unit_snapshot               text not null,
  value_numeric               numeric not null,
  threshold_id                uuid references public.air_quality_thresholds(id) on delete set null,
  is_exceedance               boolean not null default false,
  severity_at_submit          text check (severity_at_submit in ('warn','high','critical')),
  compliance_min_at_submit    numeric,
  compliance_max_at_submit    numeric,
  created_at                  timestamptz not null default now()
);

comment on table public.air_quality_readings is
  'Air Quality: per-reading-type captured values for a report. Snapshot columns preserve key/label/unit and the matched compliance bounds in case admin later edits or deletes the source rows. is_exceedance / severity_at_submit / threshold_id are populated by the app at submit time using the location-aware threshold-match rule.';
comment on column public.air_quality_readings.severity_at_submit is
  'Severity copied from the matching threshold row when is_exceedance = true; null otherwise. Drives the corresponding communication_alerts severity.';

create index if not exists idx_air_quality_readings_report
  on public.air_quality_readings (report_id);

create index if not exists idx_air_quality_readings_reading_type
  on public.air_quality_readings (reading_type_id);

create index if not exists idx_air_quality_readings_exceedance
  on public.air_quality_readings (report_id)
  where is_exceedance = true;

-- -----------------------------------------------------------------------------
-- 8. air_quality_followup_notes (append-only at the DB)
-- Spec: managers/admins only; staff cannot add follow-up notes. is_admin_note
-- defaults to true and the only INSERT policy is gated on
-- has_module_admin_access('air_quality'), so the column is essentially
-- always true. Kept as a column for forward compatibility / clarity.
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_followup_notes (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  report_id      uuid not null references public.air_quality_reports(id) on delete cascade,
  employee_id    uuid references public.employees(id) on delete set null,
  body           text not null,
  is_admin_note  boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table public.air_quality_followup_notes is
  'Air Quality: append-only follow-up notes (admin/manager only). No update/delete policies.';

create index if not exists idx_air_quality_followup_notes_report_created
  on public.air_quality_followup_notes (report_id, created_at);

-- -----------------------------------------------------------------------------
-- 9. air_quality_settings (one row per facility)
-- alerts_enabled defaults true (exceedances are safety-critical).
-- default_alert_severity is the fallback severity when a matched threshold
-- has no severity column populated -- normally severity comes from the
-- threshold itself.
-- -----------------------------------------------------------------------------
create table if not exists public.air_quality_settings (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  testing_frequency        text,
  default_jurisdiction     text,
  alerts_enabled           boolean not null default true,
  default_alert_severity   text not null default 'high'
                             check (default_alert_severity in ('warn','high','critical')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  constraint air_quality_settings_facility_uniq unique (facility_id)
);

comment on table public.air_quality_settings is
  'Air Quality: per-facility module config. When alerts_enabled = true the app evaluates thresholds at submit time and inserts communication_alerts (source_module = ''air_quality'') for exceedances. default_jurisdiction selects which air_quality_compliance_rules rows to render to staff.';

drop trigger if exists trg_air_quality_settings_updated_at on public.air_quality_settings;
create trigger trg_air_quality_settings_updated_at
  before update on public.air_quality_settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Seed defaults helper
-- Idempotent. Inserts canonical CO/CO2 reading types, default thresholds
-- (location-null) using illustrative US OSHA/EPA-ish values, and a default
-- settings row. Designed to be safe to call multiple times.
-- =============================================================================
create or replace function public.seed_default_air_quality_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_co_id   uuid;
  v_co2_id  uuid;
begin
  -- 1) Reading types ---------------------------------------------------------
  insert into public.air_quality_reading_types
    (facility_id, key, label, unit, sort_order, is_active, is_required, decimals)
  values
    (p_facility_id, 'co',  'Carbon Monoxide', 'ppm', 0, true, true, 1),
    (p_facility_id, 'co2', 'Carbon Dioxide',  'ppm', 1, true, true, 0)
  on conflict (facility_id, key) do nothing;

  select id into v_co_id
  from public.air_quality_reading_types
  where facility_id = p_facility_id and key = 'co';

  select id into v_co2_id
  from public.air_quality_reading_types
  where facility_id = p_facility_id and key = 'co2';

  -- 2) Default settings ------------------------------------------------------
  insert into public.air_quality_settings
    (facility_id, testing_frequency, default_jurisdiction,
     alerts_enabled, default_alert_severity)
  values
    (p_facility_id, null, 'us_federal', true, 'high')
  on conflict (facility_id) do nothing;

  -- 3) Default thresholds (location-null = facility-wide defaults) -----------
  -- CO: alert at 25 ppm, compliance ceiling 50 ppm, severity 'high'.
  if v_co_id is not null
     and not exists (
       select 1 from public.air_quality_thresholds
       where reading_type_id = v_co_id
         and location_id is null
         and is_active = true
     )
  then
    insert into public.air_quality_thresholds
      (facility_id, reading_type_id, location_id,
       warn_min, warn_max, alert_min, alert_max,
       compliance_min, compliance_max, severity, is_active)
    values
      (p_facility_id, v_co_id, null,
       null, null, null, 25,
       null, 50, 'high', true);
  end if;

  -- CO2: alert at 1000 ppm, compliance ceiling 5000 ppm, severity 'warn'.
  if v_co2_id is not null
     and not exists (
       select 1 from public.air_quality_thresholds
       where reading_type_id = v_co2_id
         and location_id is null
         and is_active = true
     )
  then
    insert into public.air_quality_thresholds
      (facility_id, reading_type_id, location_id,
       warn_min, warn_max, alert_min, alert_max,
       compliance_min, compliance_max, severity, is_active)
    values
      (p_facility_id, v_co2_id, null,
       null, null, null, 1000,
       null, 5000, 'warn', true);
  end if;
end;
$$;

comment on function public.seed_default_air_quality_config(uuid) is
  'Seeds canonical air_quality reading types (co, co2), a default air_quality_settings row, and default location-null thresholds for CO and CO2. Idempotent.';

revoke execute on function public.seed_default_air_quality_config(uuid) from public;
grant  execute on function public.seed_default_air_quality_config(uuid) to service_role;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.air_quality_locations         enable row level security;
alter table public.air_quality_equipment         enable row level security;
alter table public.air_quality_reading_types     enable row level security;
alter table public.air_quality_thresholds        enable row level security;
alter table public.air_quality_compliance_rules  enable row level security;
alter table public.air_quality_reports           enable row level security;
alter table public.air_quality_readings          enable row level security;
alter table public.air_quality_followup_notes    enable row level security;
alter table public.air_quality_settings          enable row level security;

-- -----------------------------------------------------------------------------
-- Config tables share the same shape:
--   SELECT: super_admin OR same-facility + module access
--   INSERT/UPDATE/DELETE: super_admin OR same-facility + module admin access
-- -----------------------------------------------------------------------------

-- air_quality_locations -------------------------------------------------------
drop policy if exists air_quality_locations_select on public.air_quality_locations;
create policy air_quality_locations_select on public.air_quality_locations
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_locations_insert on public.air_quality_locations;
create policy air_quality_locations_insert on public.air_quality_locations
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_locations_update on public.air_quality_locations;
create policy air_quality_locations_update on public.air_quality_locations
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_locations_delete on public.air_quality_locations;
create policy air_quality_locations_delete on public.air_quality_locations
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

-- air_quality_equipment -------------------------------------------------------
drop policy if exists air_quality_equipment_select on public.air_quality_equipment;
create policy air_quality_equipment_select on public.air_quality_equipment
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_equipment_insert on public.air_quality_equipment;
create policy air_quality_equipment_insert on public.air_quality_equipment
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_equipment_update on public.air_quality_equipment;
create policy air_quality_equipment_update on public.air_quality_equipment
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_equipment_delete on public.air_quality_equipment;
create policy air_quality_equipment_delete on public.air_quality_equipment
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

-- air_quality_reading_types ---------------------------------------------------
drop policy if exists air_quality_reading_types_select on public.air_quality_reading_types;
create policy air_quality_reading_types_select on public.air_quality_reading_types
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_reading_types_insert on public.air_quality_reading_types;
create policy air_quality_reading_types_insert on public.air_quality_reading_types
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_reading_types_update on public.air_quality_reading_types;
create policy air_quality_reading_types_update on public.air_quality_reading_types
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_reading_types_delete on public.air_quality_reading_types;
create policy air_quality_reading_types_delete on public.air_quality_reading_types
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

-- air_quality_thresholds ------------------------------------------------------
drop policy if exists air_quality_thresholds_select on public.air_quality_thresholds;
create policy air_quality_thresholds_select on public.air_quality_thresholds
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_thresholds_insert on public.air_quality_thresholds;
create policy air_quality_thresholds_insert on public.air_quality_thresholds
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_thresholds_update on public.air_quality_thresholds;
create policy air_quality_thresholds_update on public.air_quality_thresholds
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_thresholds_delete on public.air_quality_thresholds;
create policy air_quality_thresholds_delete on public.air_quality_thresholds
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

-- air_quality_compliance_rules -----------------------------------------------
drop policy if exists air_quality_compliance_rules_select on public.air_quality_compliance_rules;
create policy air_quality_compliance_rules_select on public.air_quality_compliance_rules
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_compliance_rules_insert on public.air_quality_compliance_rules;
create policy air_quality_compliance_rules_insert on public.air_quality_compliance_rules
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_compliance_rules_update on public.air_quality_compliance_rules;
create policy air_quality_compliance_rules_update on public.air_quality_compliance_rules
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_compliance_rules_delete on public.air_quality_compliance_rules;
create policy air_quality_compliance_rules_delete on public.air_quality_compliance_rules
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

-- air_quality_settings --------------------------------------------------------
drop policy if exists air_quality_settings_select on public.air_quality_settings;
create policy air_quality_settings_select on public.air_quality_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_settings_insert on public.air_quality_settings;
create policy air_quality_settings_insert on public.air_quality_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_settings_update on public.air_quality_settings;
create policy air_quality_settings_update on public.air_quality_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

drop policy if exists air_quality_settings_delete on public.air_quality_settings;
create policy air_quality_settings_delete on public.air_quality_settings
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

-- -----------------------------------------------------------------------------
-- air_quality_reports
--   SELECT: super_admin OR same-facility + module access (lenient; UI hides
--           history from staff).
--   INSERT: super_admin OR same-facility + module access AND submitter = self
--   UPDATE/DELETE: super_admin only -- original report is immutable. Even
--                  module admins cannot edit (they append followup notes).
-- -----------------------------------------------------------------------------
drop policy if exists air_quality_reports_select on public.air_quality_reports;
create policy air_quality_reports_select on public.air_quality_reports
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_reports_insert on public.air_quality_reports;
create policy air_quality_reports_insert on public.air_quality_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
      and employee_id = public.current_employee_id()
    )
  );

drop policy if exists air_quality_reports_update on public.air_quality_reports;
create policy air_quality_reports_update on public.air_quality_reports
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists air_quality_reports_delete on public.air_quality_reports;
create policy air_quality_reports_delete on public.air_quality_reports
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- air_quality_readings
--   SELECT/INSERT: same-facility + module access (parent report INSERT policy
--                  is the real gate for who can submit).
--   UPDATE/DELETE: super_admin only -- captured values are immutable.
-- -----------------------------------------------------------------------------
drop policy if exists air_quality_readings_select on public.air_quality_readings;
create policy air_quality_readings_select on public.air_quality_readings
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_readings_insert on public.air_quality_readings;
create policy air_quality_readings_insert on public.air_quality_readings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_readings_update on public.air_quality_readings;
create policy air_quality_readings_update on public.air_quality_readings
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists air_quality_readings_delete on public.air_quality_readings;
create policy air_quality_readings_delete on public.air_quality_readings
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- air_quality_followup_notes (append-only)
--   SELECT: super_admin OR same-facility + module access
--   INSERT: super_admin OR same-facility + module admin access
--   UPDATE/DELETE: no policies -> denied
-- -----------------------------------------------------------------------------
drop policy if exists air_quality_followup_notes_select on public.air_quality_followup_notes;
create policy air_quality_followup_notes_select on public.air_quality_followup_notes
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists air_quality_followup_notes_insert on public.air_quality_followup_notes;
create policy air_quality_followup_notes_insert on public.air_quality_followup_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('air_quality')
    )
  );

-- (No update / delete policies -- append-only.)
