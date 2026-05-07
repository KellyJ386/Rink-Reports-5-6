-- =============================================================================
-- 00000000000013_ice_operations_schema.sql
-- Ice Operations module: 7 tables + RLS + seed-defaults helper.
--
-- Fixed-structure module: the four operation_type values
--   ('ice_make','circle_check','edging','blade_change')
-- are hard-coded into the submissions check constraint and cannot be deleted
-- by admins. Admins do control the rinks dropdown, the equipment dropdown,
-- the per-facility circle-check checklist (up to 50 items, enforced in app),
-- and the temperature unit / alert severity defaults.
--
-- Submission flow (UI / server contract -- the DB does not enforce these):
--   * occurred_at + employee_id are auto-captured at submit time.
--   * payload jsonb shape varies per operation_type:
--       ice_make:       { water_temp_c, ice_temp_c, time_in, time_out,
--                         water_used_gal, surface_pass_count, ... }
--       edging:         { hours_run, ... }
--       blade_change:   { blade_serial, hours_at_change,
--                         replaced_by_employee_id, ... }
--       circle_check:   {}    -- per-item results live in
--                              ice_operations_circle_check_results
--   * rink_id is required for ice_make and circle_check (UI-enforced).
--   * equipment_id relevance varies (zamboni for ice_make / circle_check,
--     edger for edging, blade_set for blade_change). Nullable in DB.
--   * Staff may submit forms with missing optional fields; the only hard
--     content rule is that any failed circle-check item MUST include
--     failed_notes (UI-enforced).
--   * For circle_check submissions with any passed=false rows the server
--     sets has_failed_check=true, failed_count=N, AND inserts ONE
--     communication_alerts row (source_module='ice_operations',
--     severity = ice_operations_settings.default_alert_severity,
--     body lists each failed label + note). One alert per submission, not
--     per failed item.
--
-- Original submission rows are immutable -- only super_admin may
-- UPDATE/DELETE. Module admins/managers may append timestamped follow-up
-- notes via ice_operations_followup_notes (append-only at the DB layer; no
-- UPDATE/DELETE policies).
--
-- End-of-day PDF and 2-year retention purge are deferred (handled later).
--
-- Tables:
--   ice_operations_settings              (one row per facility)
--   ice_operations_rinks
--   ice_operations_equipment
--   ice_operations_submissions
--   ice_operations_circle_check_items
--   ice_operations_circle_check_results
--   ice_operations_followup_notes        (append-only)
--
-- Module key for permission helpers: 'ice_operations'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ice_operations_settings (one row per facility)
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_settings (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  temperature_unit         text not null default 'F'
                             check (temperature_unit in ('F','C')),
  alerts_enabled           boolean not null default true,
  default_alert_severity   text not null default 'high'
                             check (default_alert_severity in ('warn','high','critical')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  constraint ice_operations_settings_facility_uniq unique (facility_id)
);

comment on table public.ice_operations_settings is
  'Ice Operations: per-facility module config. temperature_unit applies to ice_make payload (F/C). When alerts_enabled = true the app inserts one communication_alerts row per circle_check submission that has any failed item, using default_alert_severity.';

drop trigger if exists trg_ice_operations_settings_updated_at on public.ice_operations_settings;
create trigger trg_ice_operations_settings_updated_at
  before update on public.ice_operations_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. ice_operations_rinks
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_rinks (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint ice_operations_rinks_facility_slug_uniq
    unique (facility_id, slug)
);

comment on table public.ice_operations_rinks is
  'Ice Operations: per-facility rinks (e.g. Rink A, Rink B). Admin controlled. Required selection on ice_make and circle_check submissions (UI-enforced).';

create index if not exists idx_ice_operations_rinks_facility_active_sort
  on public.ice_operations_rinks (facility_id, is_active, sort_order);

drop trigger if exists trg_ice_operations_rinks_updated_at on public.ice_operations_rinks;
create trigger trg_ice_operations_rinks_updated_at
  before update on public.ice_operations_rinks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. ice_operations_equipment
-- equipment_type partitions the dropdown so the form can show only the
-- relevant subset per operation_type (e.g. zambonis for ice_make /
-- circle_check, edgers for edging, blade_sets for blade_change).
-- hours_count is an admin-maintained cumulative counter; the latest value
-- is what staff sees on the form.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_equipment (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  equipment_type  text not null
                    check (equipment_type in ('zamboni','edger','blade_set','other')),
  name            text not null,
  slug            text not null,
  model           text,
  serial_number   text,
  hours_count     numeric,
  sort_order      int  not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  constraint ice_operations_equipment_facility_slug_uniq
    unique (facility_id, slug)
);

comment on table public.ice_operations_equipment is
  'Ice Operations: equipment dropdown. equipment_type drives which submissions can pick this row (zamboni=>ice_make/circle_check, edger=>edging, blade_set=>blade_change, other=>any). hours_count is admin-maintained cumulative hours; staff-side forms display the latest value.';
comment on column public.ice_operations_equipment.hours_count is
  'Admin-maintained cumulative hours counter. Not auto-updated from submissions; admins update manually after maintenance events.';

create index if not exists idx_ice_operations_equipment_facility_type_active
  on public.ice_operations_equipment (facility_id, equipment_type, is_active);

drop trigger if exists trg_ice_operations_equipment_updated_at on public.ice_operations_equipment;
create trigger trg_ice_operations_equipment_updated_at
  before update on public.ice_operations_equipment
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. ice_operations_submissions
-- One row per submitted operation. payload jsonb carries the type-specific
-- fields (see file header for shape). has_failed_check / failed_count are
-- denormalized for fast history filtering on circle_check failures.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_submissions (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities(id) on delete restrict,
  employee_id        uuid references public.employees(id) on delete set null,
  operation_type     text not null
                       check (operation_type in ('ice_make','circle_check','edging','blade_change')),
  rink_id            uuid references public.ice_operations_rinks(id) on delete set null,
  equipment_id       uuid references public.ice_operations_equipment(id) on delete set null,
  occurred_at        timestamptz not null default now(),
  payload            jsonb not null default '{}'::jsonb,
  notes              text,
  has_failed_check   boolean not null default false,
  failed_count       int not null default 0,
  submitted_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

comment on table public.ice_operations_submissions is
  'Ice Operations: one row per submitted operation. operation_type is fixed to the four canonical values. payload jsonb shape varies per operation_type (ice_make: water/ice temps, time_in/out, water_used_gal, surface_pass_count; edging: hours_run; blade_change: blade_serial, hours_at_change, replaced_by_employee_id; circle_check: empty -- results live in ice_operations_circle_check_results). Original is immutable; only super_admin may UPDATE/DELETE.';
comment on column public.ice_operations_submissions.has_failed_check is
  'Denormalized: true if any associated ice_operations_circle_check_results row has passed = false. Server sets at submit time. Always false for non-circle_check operations.';
comment on column public.ice_operations_submissions.failed_count is
  'Denormalized count of failed circle-check items. Drives the alert body. Always 0 for non-circle_check operations.';
comment on column public.ice_operations_submissions.rink_id is
  'Required by app for operation_type in (ice_make, circle_check); optional for edging / blade_change. DB does not enforce.';
comment on column public.ice_operations_submissions.equipment_id is
  'Relevance varies by operation_type: zamboni for ice_make/circle_check, edger for edging, blade_set for blade_change. Nullable in DB.';

create index if not exists idx_ice_operations_submissions_facility_submitted
  on public.ice_operations_submissions (facility_id, submitted_at desc);

create index if not exists idx_ice_operations_submissions_operation_type
  on public.ice_operations_submissions (operation_type);

create index if not exists idx_ice_operations_submissions_employee
  on public.ice_operations_submissions (employee_id);

create index if not exists idx_ice_operations_submissions_rink
  on public.ice_operations_submissions (rink_id);

create index if not exists idx_ice_operations_submissions_equipment
  on public.ice_operations_submissions (equipment_id);

create index if not exists idx_ice_operations_submissions_failed_check
  on public.ice_operations_submissions (facility_id, submitted_at desc)
  where has_failed_check = true;

drop trigger if exists trg_ice_operations_submissions_updated_at on public.ice_operations_submissions;
create trigger trg_ice_operations_submissions_updated_at
  before update on public.ice_operations_submissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. ice_operations_circle_check_items (admin config)
-- Up to 50 active items per facility (UI-enforced; DB does not block).
-- applies_to_equipment_type: null = applies to all equipment_types.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_circle_check_items (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  label                       text not null,
  description                 text,
  applies_to_equipment_type   text
                                check (applies_to_equipment_type in ('zamboni','edger','blade_set','other')),
  sort_order                  int  not null default 0,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz
);

comment on table public.ice_operations_circle_check_items is
  'Ice Operations: per-facility circle-check checklist (up to 50 active rows; enforced in app). applies_to_equipment_type filters which items show for the selected equipment; null = applies to all equipment types.';

create index if not exists idx_ice_operations_circle_check_items_facility_active_sort
  on public.ice_operations_circle_check_items (facility_id, is_active, sort_order);

drop trigger if exists trg_ice_operations_circle_check_items_updated_at on public.ice_operations_circle_check_items;
create trigger trg_ice_operations_circle_check_items_updated_at
  before update on public.ice_operations_circle_check_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. ice_operations_circle_check_results
-- One row per checklist item per circle_check submission. label_snapshot
-- preserves history if the underlying checklist item is later edited or
-- deleted. failed_notes is required (UI-enforced) when passed = false.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_circle_check_results (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references public.facilities(id) on delete restrict,
  submission_id       uuid not null references public.ice_operations_submissions(id) on delete cascade,
  checklist_item_id   uuid references public.ice_operations_circle_check_items(id) on delete set null,
  label_snapshot      text not null,
  passed              boolean not null,
  failed_notes        text,
  created_at          timestamptz not null default now()
);

comment on table public.ice_operations_circle_check_results is
  'Ice Operations: per-checklist-item result for a circle_check submission. label_snapshot is captured at submit time so deleting a checklist item does not lose historical context. failed_notes is required (UI-enforced) when passed=false.';

create unique index if not exists uniq_ice_operations_circle_check_results_submission_item
  on public.ice_operations_circle_check_results (submission_id, checklist_item_id)
  where checklist_item_id is not null;

create index if not exists idx_ice_operations_circle_check_results_submission
  on public.ice_operations_circle_check_results (submission_id);

create index if not exists idx_ice_operations_circle_check_results_failed
  on public.ice_operations_circle_check_results (submission_id)
  where passed = false;

-- -----------------------------------------------------------------------------
-- 7. ice_operations_followup_notes (append-only at the DB)
-- Managers/admins may add follow-up context but cannot edit the original
-- submission. is_admin_note defaults to true; the only INSERT policy is
-- gated on has_module_admin_access('ice_operations'), so the column is
-- effectively always true. Kept for clarity / forward compatibility.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_followup_notes (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  submission_id   uuid not null references public.ice_operations_submissions(id) on delete cascade,
  employee_id     uuid references public.employees(id) on delete set null,
  body            text not null,
  is_admin_note   boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.ice_operations_followup_notes is
  'Ice Operations: append-only follow-up notes (admin/manager only). Original submission stays immutable. No UPDATE/DELETE policies.';

create index if not exists idx_ice_operations_followup_notes_submission_created
  on public.ice_operations_followup_notes (submission_id, created_at);

-- =============================================================================
-- Seed defaults helper
-- Idempotent. Inserts a default settings row and a starter set of canonical
-- circle-check items (illustrative). No rinks or equipment seeded -- admin
-- adds those.
-- =============================================================================
create or replace function public.seed_default_ice_operations_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  -- 1) Default settings (one row per facility).
  insert into public.ice_operations_settings
    (facility_id, temperature_unit, alerts_enabled, default_alert_severity)
  values
    (p_facility_id, 'F', true, 'high')
  on conflict (facility_id) do nothing;

  -- 2) Starter circle-check items. Idempotent on (facility_id, label) via
  -- WHERE NOT EXISTS so callers can re-run safely without duplicating rows.
  for r in
    select * from (values
      ('Check oil level',          'zamboni', 0),
      ('Check tire pressure',      'zamboni', 1),
      ('Check blade sharpness',    'zamboni', 2),
      ('Inspect for fluid leaks',  'zamboni', 3),
      ('Check edger blade',        'edger',   4)
    ) as v(label, eq_type, sort_order)
  loop
    insert into public.ice_operations_circle_check_items
      (facility_id, label, applies_to_equipment_type, sort_order, is_active)
    select p_facility_id, r.label, r.eq_type, r.sort_order, true
    where not exists (
      select 1 from public.ice_operations_circle_check_items
      where facility_id = p_facility_id and label = r.label
    );
  end loop;
end;
$$;

comment on function public.seed_default_ice_operations_config(uuid) is
  'Seeds the default ice_operations_settings row and a starter set of circle-check items for a facility. Idempotent. Does not seed rinks or equipment -- admin adds those.';

revoke execute on function public.seed_default_ice_operations_config(uuid) from public;
grant  execute on function public.seed_default_ice_operations_config(uuid) to service_role;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.ice_operations_settings              enable row level security;
alter table public.ice_operations_rinks                 enable row level security;
alter table public.ice_operations_equipment             enable row level security;
alter table public.ice_operations_submissions           enable row level security;
alter table public.ice_operations_circle_check_items    enable row level security;
alter table public.ice_operations_circle_check_results  enable row level security;
alter table public.ice_operations_followup_notes        enable row level security;

-- -----------------------------------------------------------------------------
-- Config tables share the same shape:
--   SELECT: super_admin OR same-facility + module access
--   INSERT/UPDATE/DELETE: super_admin OR same-facility + module admin access
-- -----------------------------------------------------------------------------

-- ice_operations_settings -----------------------------------------------------
drop policy if exists ice_operations_settings_select on public.ice_operations_settings;
create policy ice_operations_settings_select on public.ice_operations_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_settings_insert on public.ice_operations_settings;
create policy ice_operations_settings_insert on public.ice_operations_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_settings_update on public.ice_operations_settings;
create policy ice_operations_settings_update on public.ice_operations_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_settings_delete on public.ice_operations_settings;
create policy ice_operations_settings_delete on public.ice_operations_settings
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

-- ice_operations_rinks --------------------------------------------------------
drop policy if exists ice_operations_rinks_select on public.ice_operations_rinks;
create policy ice_operations_rinks_select on public.ice_operations_rinks
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_rinks_insert on public.ice_operations_rinks;
create policy ice_operations_rinks_insert on public.ice_operations_rinks
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_rinks_update on public.ice_operations_rinks;
create policy ice_operations_rinks_update on public.ice_operations_rinks
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_rinks_delete on public.ice_operations_rinks;
create policy ice_operations_rinks_delete on public.ice_operations_rinks
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

-- ice_operations_equipment ----------------------------------------------------
drop policy if exists ice_operations_equipment_select on public.ice_operations_equipment;
create policy ice_operations_equipment_select on public.ice_operations_equipment
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_equipment_insert on public.ice_operations_equipment;
create policy ice_operations_equipment_insert on public.ice_operations_equipment
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_equipment_update on public.ice_operations_equipment;
create policy ice_operations_equipment_update on public.ice_operations_equipment
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_equipment_delete on public.ice_operations_equipment;
create policy ice_operations_equipment_delete on public.ice_operations_equipment
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

-- ice_operations_circle_check_items ------------------------------------------
drop policy if exists ice_operations_circle_check_items_select on public.ice_operations_circle_check_items;
create policy ice_operations_circle_check_items_select on public.ice_operations_circle_check_items
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_items_insert on public.ice_operations_circle_check_items;
create policy ice_operations_circle_check_items_insert on public.ice_operations_circle_check_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_items_update on public.ice_operations_circle_check_items;
create policy ice_operations_circle_check_items_update on public.ice_operations_circle_check_items
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_items_delete on public.ice_operations_circle_check_items;
create policy ice_operations_circle_check_items_delete on public.ice_operations_circle_check_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

-- -----------------------------------------------------------------------------
-- ice_operations_submissions
--   SELECT: super_admin OR same-facility + module access
--   INSERT: super_admin OR same-facility + module access AND submitter = self
--   UPDATE/DELETE: super_admin only -- original is immutable; even module
--                  admins cannot edit (they append followup notes).
-- -----------------------------------------------------------------------------
drop policy if exists ice_operations_submissions_select on public.ice_operations_submissions;
create policy ice_operations_submissions_select on public.ice_operations_submissions
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_submissions_insert on public.ice_operations_submissions;
create policy ice_operations_submissions_insert on public.ice_operations_submissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
      and employee_id = public.current_employee_id()
    )
  );

drop policy if exists ice_operations_submissions_update on public.ice_operations_submissions;
create policy ice_operations_submissions_update on public.ice_operations_submissions
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists ice_operations_submissions_delete on public.ice_operations_submissions;
create policy ice_operations_submissions_delete on public.ice_operations_submissions
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- ice_operations_circle_check_results
--   SELECT/INSERT: same-facility + module access (parent submission INSERT
--                  policy is the real gate for who may submit).
--   UPDATE/DELETE: super_admin only -- captured results are immutable.
-- -----------------------------------------------------------------------------
drop policy if exists ice_operations_circle_check_results_select on public.ice_operations_circle_check_results;
create policy ice_operations_circle_check_results_select on public.ice_operations_circle_check_results
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_results_insert on public.ice_operations_circle_check_results;
create policy ice_operations_circle_check_results_insert on public.ice_operations_circle_check_results
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_results_update on public.ice_operations_circle_check_results;
create policy ice_operations_circle_check_results_update on public.ice_operations_circle_check_results
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists ice_operations_circle_check_results_delete on public.ice_operations_circle_check_results;
create policy ice_operations_circle_check_results_delete on public.ice_operations_circle_check_results
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- ice_operations_followup_notes (append-only)
--   SELECT: super_admin OR same-facility + module access
--   INSERT: super_admin OR same-facility + module admin access
--   UPDATE/DELETE: no policies -> denied
-- -----------------------------------------------------------------------------
drop policy if exists ice_operations_followup_notes_select on public.ice_operations_followup_notes;
create policy ice_operations_followup_notes_select on public.ice_operations_followup_notes
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_followup_notes_insert on public.ice_operations_followup_notes;
create policy ice_operations_followup_notes_insert on public.ice_operations_followup_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

-- (No update / delete policies -- append-only.)
