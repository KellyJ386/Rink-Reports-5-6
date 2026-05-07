-- =============================================================================
-- 00000000000011_refrigeration_schema.sql
-- Refrigeration module: 8 tables + RLS + seed-defaults helper.
--
-- Independent simple form module. Admins control sections + equipment + fields.
-- Sections are togglable. Numeric/text/boolean/select fields supported.
-- Out-of-range monitoring is opt-in per facility (refrigeration_settings.
--   out_of_range_alerts_enabled). When enabled, the staff/server code that
--   inserts a refrigeration_report_value is responsible for evaluating active
--   thresholds and setting is_out_of_range / threshold_id, then inserting a
--   companion communication_alerts row with source_module = 'refrigeration'.
-- Severity passes through from the matching threshold; communication_alerts
--   accepts ('info','warn','high','critical') -- thresholds here only allow
--   ('warn','high','critical') (info doesn't make sense for an OOR reading).
--
-- No PDFs, no email, no photos (deferred per spec).
-- Original report values are immutable -- only super_admin can UPDATE/DELETE.
-- Follow-up notes are append-only at the DB layer (admin "edits" = new note).
-- Retention purge deferred (handled later by admin retention module).
--
-- Tables:
--   refrigeration_sections
--   refrigeration_equipment
--   refrigeration_fields
--   refrigeration_thresholds
--   refrigeration_reports
--   refrigeration_report_values
--   refrigeration_followup_notes      (append-only)
--   refrigeration_settings            (one row per facility)
--
-- Module key for permission helpers: 'refrigeration'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. refrigeration_sections
-- -----------------------------------------------------------------------------
create table if not exists public.refrigeration_sections (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint refrigeration_sections_facility_slug_uniq
    unique (facility_id, slug)
);

comment on table public.refrigeration_sections is
  'Refrigeration: per-facility togglable sections (Compressors, Pumps, etc.). Admin controlled.';

create index if not exists idx_refrigeration_sections_facility_active_sort
  on public.refrigeration_sections (facility_id, is_active, sort_order);

drop trigger if exists trg_refrigeration_sections_updated_at on public.refrigeration_sections;
create trigger trg_refrigeration_sections_updated_at
  before update on public.refrigeration_sections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. refrigeration_equipment
-- -----------------------------------------------------------------------------
create table if not exists public.refrigeration_equipment (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  section_id   uuid not null references public.refrigeration_sections(id) on delete cascade,
  name         text not null,
  slug         text not null,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint refrigeration_equipment_section_slug_uniq
    unique (section_id, slug)
);

comment on table public.refrigeration_equipment is
  'Refrigeration: equipment instances within a section (e.g. Compressor #1, Compressor #2). Admin controlled.';

create index if not exists idx_refrigeration_equipment_facility_section_active
  on public.refrigeration_equipment (facility_id, section_id, is_active);

drop trigger if exists trg_refrigeration_equipment_updated_at on public.refrigeration_equipment;
create trigger trg_refrigeration_equipment_updated_at
  before update on public.refrigeration_equipment
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. refrigeration_fields
-- equipment_id nullable -- when null the field is section-level (e.g. a
-- section-wide alarm). Postgres unique constraints don't treat NULL as equal,
-- so we enforce uniqueness with two partial indexes instead.
-- -----------------------------------------------------------------------------
create table if not exists public.refrigeration_fields (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  section_id    uuid not null references public.refrigeration_sections(id) on delete cascade,
  equipment_id  uuid references public.refrigeration_equipment(id) on delete cascade,
  key           text not null,
  label         text not null,
  field_type    text not null
                  check (field_type in ('numeric','text','boolean','select')),
  unit          text,
  options       jsonb not null default '[]'::jsonb,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

comment on table public.refrigeration_fields is
  'Refrigeration: fields collected per section/equipment. equipment_id null = section-level field.';
comment on column public.refrigeration_fields.options is
  'Used only when field_type = ''select''. Array of {key, label}.';
comment on column public.refrigeration_fields.unit is
  'Display unit for numeric fields (e.g. ''psi'', ''F'', ''hours''). Null for non-numeric.';

create unique index if not exists uniq_refrigeration_fields_section_key_no_equipment
  on public.refrigeration_fields (section_id, key)
  where equipment_id is null;

create unique index if not exists uniq_refrigeration_fields_section_equipment_key
  on public.refrigeration_fields (section_id, equipment_id, key)
  where equipment_id is not null;

create index if not exists idx_refrigeration_fields_facility_section
  on public.refrigeration_fields (facility_id, section_id);

create index if not exists idx_refrigeration_fields_equipment
  on public.refrigeration_fields (equipment_id);

drop trigger if exists trg_refrigeration_fields_updated_at on public.refrigeration_fields;
create trigger trg_refrigeration_fields_updated_at
  before update on public.refrigeration_fields
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. refrigeration_thresholds
-- equipment_id null = applies to all equipment under the field.
-- Partial unique indexes guarantee one active threshold per (field) and one
-- active threshold per (field, equipment). The application's threshold-match
-- logic should prefer the equipment-specific row over the field-wide row.
-- -----------------------------------------------------------------------------
create table if not exists public.refrigeration_thresholds (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  field_id      uuid not null references public.refrigeration_fields(id) on delete cascade,
  equipment_id  uuid references public.refrigeration_equipment(id) on delete cascade,
  min_value     numeric,
  max_value     numeric,
  severity      text not null default 'warn'
                  check (severity in ('warn','high','critical')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint refrigeration_thresholds_min_or_max_present
    check (min_value is not null or max_value is not null)
);

comment on table public.refrigeration_thresholds is
  'Refrigeration: numeric out-of-range thresholds. equipment_id null = field-wide. severity passes through to communication_alerts when an OOR reading is captured.';

create unique index if not exists uniq_refrigeration_thresholds_field_active_no_equipment
  on public.refrigeration_thresholds (field_id)
  where equipment_id is null and is_active = true;

create unique index if not exists uniq_refrigeration_thresholds_field_equipment_active
  on public.refrigeration_thresholds (field_id, equipment_id)
  where equipment_id is not null and is_active = true;

create index if not exists idx_refrigeration_thresholds_facility
  on public.refrigeration_thresholds (facility_id);

drop trigger if exists trg_refrigeration_thresholds_updated_at on public.refrigeration_thresholds;
create trigger trg_refrigeration_thresholds_updated_at
  before update on public.refrigeration_thresholds
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. refrigeration_reports
-- -----------------------------------------------------------------------------
create table if not exists public.refrigeration_reports (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  employee_id   uuid references public.employees(id) on delete set null,
  notes         text,
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

comment on table public.refrigeration_reports is
  'Refrigeration: a single submission. Original values are immutable -- only super_admin may UPDATE/DELETE. Staff may submit incomplete reports.';
comment on column public.refrigeration_reports.notes is
  'Optional free-form staff notes captured at submit time. Distinct from refrigeration_followup_notes (admin append-only).';

create index if not exists idx_refrigeration_reports_facility_submitted
  on public.refrigeration_reports (facility_id, submitted_at desc);

create index if not exists idx_refrigeration_reports_employee
  on public.refrigeration_reports (employee_id);

drop trigger if exists trg_refrigeration_reports_updated_at on public.refrigeration_reports;
create trigger trg_refrigeration_reports_updated_at
  before update on public.refrigeration_reports
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. refrigeration_report_values
-- One row per field captured. Values are immutable post-insert (only
-- super_admin may UPDATE/DELETE). Snapshot columns preserve history if config
-- rows are later renamed or deleted.
-- -----------------------------------------------------------------------------
create table if not exists public.refrigeration_report_values (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  report_id                uuid not null references public.refrigeration_reports(id) on delete cascade,
  field_id                 uuid references public.refrigeration_fields(id) on delete set null,
  equipment_id             uuid references public.refrigeration_equipment(id) on delete set null,
  label_snapshot           text not null,
  equipment_name_snapshot  text,
  field_type_snapshot      text not null,
  unit_snapshot            text,
  value_text               text,
  value_numeric            numeric,
  value_boolean            boolean,
  is_out_of_range          boolean not null default false,
  threshold_id             uuid references public.refrigeration_thresholds(id) on delete set null,
  created_at               timestamptz not null default now()
);

comment on table public.refrigeration_report_values is
  'Refrigeration: per-field captured values for a report. Snapshot columns preserve label/type/unit/equipment_name in case admin later renames or deletes the source field/equipment. is_out_of_range/threshold_id are populated by the app when the matching threshold flagged the reading.';
comment on column public.refrigeration_report_values.equipment_name_snapshot is
  'Equipment name at submit time. If the field was section-level, app may write the section name here instead.';

create index if not exists idx_refrigeration_report_values_report
  on public.refrigeration_report_values (report_id);

create index if not exists idx_refrigeration_report_values_field
  on public.refrigeration_report_values (field_id);

create index if not exists idx_refrigeration_report_values_oor
  on public.refrigeration_report_values (report_id)
  where is_out_of_range = true;

-- -----------------------------------------------------------------------------
-- 7. refrigeration_followup_notes (append-only at the DB)
-- Spec: managers/admins only; staff cannot add follow-up notes. is_admin_note
-- defaults to true and the only INSERT policy is gated on
-- has_module_admin_access('refrigeration'), so the column is essentially
-- always true. Kept as a column for forward compatibility / clarity.
-- -----------------------------------------------------------------------------
create table if not exists public.refrigeration_followup_notes (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  report_id      uuid not null references public.refrigeration_reports(id) on delete cascade,
  employee_id    uuid references public.employees(id) on delete set null,
  body           text not null,
  is_admin_note  boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table public.refrigeration_followup_notes is
  'Refrigeration: append-only follow-up notes (admin/manager only). No update/delete policies.';

create index if not exists idx_refrigeration_followup_notes_report_created
  on public.refrigeration_followup_notes (report_id, created_at);

-- -----------------------------------------------------------------------------
-- 8. refrigeration_settings (one row per facility)
-- -----------------------------------------------------------------------------
create table if not exists public.refrigeration_settings (
  id                              uuid primary key default gen_random_uuid(),
  facility_id                     uuid not null references public.facilities(id) on delete restrict,
  out_of_range_alerts_enabled     boolean not null default false,
  default_alert_severity          text not null default 'warn'
                                    check (default_alert_severity in ('warn','high','critical')),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz,
  constraint refrigeration_settings_facility_uniq unique (facility_id)
);

comment on table public.refrigeration_settings is
  'Refrigeration: per-facility module config. When out_of_range_alerts_enabled = true the app evaluates thresholds and inserts communication_alerts (source_module = ''refrigeration'') for OOR readings.';

drop trigger if exists trg_refrigeration_settings_updated_at on public.refrigeration_settings;
create trigger trg_refrigeration_settings_updated_at
  before update on public.refrigeration_settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Seed defaults helper
-- Idempotent. Inserts canonical section structure + a default settings row.
-- =============================================================================
create or replace function public.seed_default_refrigeration_sections(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.refrigeration_sections
    (facility_id, slug, name, sort_order, is_active)
  values
    (p_facility_id, 'compressors',    'Compressors',     1, true),
    (p_facility_id, 'pumps',          'Pumps',           2, true),
    (p_facility_id, 'condensers',     'Condensers',      3, true),
    (p_facility_id, 'supply_return',  'Supply / Return', 4, true),
    (p_facility_id, 'machine_hours',  'Machine Hours',   5, true),
    (p_facility_id, 'alarms',         'Alarms',          6, true)
  on conflict (facility_id, slug) do nothing;

  insert into public.refrigeration_settings
    (facility_id, out_of_range_alerts_enabled, default_alert_severity)
  values
    (p_facility_id, false, 'warn')
  on conflict (facility_id) do nothing;
end;
$$;

comment on function public.seed_default_refrigeration_sections(uuid) is
  'Seeds canonical refrigeration_sections (compressors, pumps, condensers, supply_return, machine_hours, alarms) and a default refrigeration_settings row for a facility. Idempotent.';

revoke execute on function public.seed_default_refrigeration_sections(uuid) from public;
grant  execute on function public.seed_default_refrigeration_sections(uuid) to service_role;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.refrigeration_sections        enable row level security;
alter table public.refrigeration_equipment       enable row level security;
alter table public.refrigeration_fields          enable row level security;
alter table public.refrigeration_thresholds      enable row level security;
alter table public.refrigeration_reports         enable row level security;
alter table public.refrigeration_report_values   enable row level security;
alter table public.refrigeration_followup_notes  enable row level security;
alter table public.refrigeration_settings        enable row level security;

-- -----------------------------------------------------------------------------
-- Config tables share the same shape:
--   SELECT: super_admin OR same-facility + module access
--   INSERT/UPDATE/DELETE: super_admin OR same-facility + module admin access
-- -----------------------------------------------------------------------------

-- refrigeration_sections ------------------------------------------------------
drop policy if exists refrigeration_sections_select on public.refrigeration_sections;
create policy refrigeration_sections_select on public.refrigeration_sections
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_sections_insert on public.refrigeration_sections;
create policy refrigeration_sections_insert on public.refrigeration_sections
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_sections_update on public.refrigeration_sections;
create policy refrigeration_sections_update on public.refrigeration_sections
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_sections_delete on public.refrigeration_sections;
create policy refrigeration_sections_delete on public.refrigeration_sections
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

-- refrigeration_equipment -----------------------------------------------------
drop policy if exists refrigeration_equipment_select on public.refrigeration_equipment;
create policy refrigeration_equipment_select on public.refrigeration_equipment
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_equipment_insert on public.refrigeration_equipment;
create policy refrigeration_equipment_insert on public.refrigeration_equipment
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_equipment_update on public.refrigeration_equipment;
create policy refrigeration_equipment_update on public.refrigeration_equipment
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_equipment_delete on public.refrigeration_equipment;
create policy refrigeration_equipment_delete on public.refrigeration_equipment
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

-- refrigeration_fields --------------------------------------------------------
drop policy if exists refrigeration_fields_select on public.refrigeration_fields;
create policy refrigeration_fields_select on public.refrigeration_fields
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_fields_insert on public.refrigeration_fields;
create policy refrigeration_fields_insert on public.refrigeration_fields
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_fields_update on public.refrigeration_fields;
create policy refrigeration_fields_update on public.refrigeration_fields
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_fields_delete on public.refrigeration_fields;
create policy refrigeration_fields_delete on public.refrigeration_fields
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

-- refrigeration_thresholds ----------------------------------------------------
drop policy if exists refrigeration_thresholds_select on public.refrigeration_thresholds;
create policy refrigeration_thresholds_select on public.refrigeration_thresholds
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_thresholds_insert on public.refrigeration_thresholds;
create policy refrigeration_thresholds_insert on public.refrigeration_thresholds
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_thresholds_update on public.refrigeration_thresholds;
create policy refrigeration_thresholds_update on public.refrigeration_thresholds
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_thresholds_delete on public.refrigeration_thresholds;
create policy refrigeration_thresholds_delete on public.refrigeration_thresholds
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

-- refrigeration_settings ------------------------------------------------------
drop policy if exists refrigeration_settings_select on public.refrigeration_settings;
create policy refrigeration_settings_select on public.refrigeration_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_settings_insert on public.refrigeration_settings;
create policy refrigeration_settings_insert on public.refrigeration_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_settings_update on public.refrigeration_settings;
create policy refrigeration_settings_update on public.refrigeration_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

drop policy if exists refrigeration_settings_delete on public.refrigeration_settings;
create policy refrigeration_settings_delete on public.refrigeration_settings
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

-- -----------------------------------------------------------------------------
-- refrigeration_reports
--   SELECT: super_admin OR same-facility + module access (lenient; UI hides
--           history from staff).
--   INSERT: super_admin OR same-facility + module access AND submitter = self
--   UPDATE/DELETE: super_admin only -- original report is immutable.
-- -----------------------------------------------------------------------------
drop policy if exists refrigeration_reports_select on public.refrigeration_reports;
create policy refrigeration_reports_select on public.refrigeration_reports
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_reports_insert on public.refrigeration_reports;
create policy refrigeration_reports_insert on public.refrigeration_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
      and employee_id = public.current_employee_id()
    )
  );

drop policy if exists refrigeration_reports_update on public.refrigeration_reports;
create policy refrigeration_reports_update on public.refrigeration_reports
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists refrigeration_reports_delete on public.refrigeration_reports;
create policy refrigeration_reports_delete on public.refrigeration_reports
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- refrigeration_report_values
--   SELECT/INSERT: same-facility + module access (parent report INSERT policy
--                  is the real gate for who can submit).
--   UPDATE/DELETE: super_admin only -- captured values are immutable.
-- -----------------------------------------------------------------------------
drop policy if exists refrigeration_report_values_select on public.refrigeration_report_values;
create policy refrigeration_report_values_select on public.refrigeration_report_values
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_report_values_insert on public.refrigeration_report_values;
create policy refrigeration_report_values_insert on public.refrigeration_report_values
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_report_values_update on public.refrigeration_report_values;
create policy refrigeration_report_values_update on public.refrigeration_report_values
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists refrigeration_report_values_delete on public.refrigeration_report_values;
create policy refrigeration_report_values_delete on public.refrigeration_report_values
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- refrigeration_followup_notes (append-only)
--   SELECT: super_admin OR same-facility + module access
--   INSERT: super_admin OR same-facility + module admin access
--   UPDATE/DELETE: no policies -> denied
-- -----------------------------------------------------------------------------
drop policy if exists refrigeration_followup_notes_select on public.refrigeration_followup_notes;
create policy refrigeration_followup_notes_select on public.refrigeration_followup_notes
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('refrigeration')
    )
  );

drop policy if exists refrigeration_followup_notes_insert on public.refrigeration_followup_notes;
create policy refrigeration_followup_notes_insert on public.refrigeration_followup_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('refrigeration')
    )
  );

-- (No update / delete policies -- append-only.)
