-- =============================================================================
-- 00000000000008_incident_reports_schema.sql
-- Incident Reports module: 4 tables + RLS + seed-defaults helper.
--
-- Independent simple form module. Facility-wide (no areas/tabs).
-- No photo uploads. PDF generation deferred (no incident_pdfs table).
-- Original submitted reports cannot be overwritten in normal flow — admins may
-- transition status; managers/admins may append follow-up notes (append-only).
--
-- Tables:
--   incident_types               (admin-customizable categories)
--   incident_severity_levels     (admin-customizable severities)
--   incident_reports             (the submission)
--     -> incident_followup_notes (append-only)
--
-- Retention is admin-configurable (recommended 5 years) and intentionally NOT
-- enforced via a purge function here — defer to the retention admin module.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. incident_types
-- -----------------------------------------------------------------------------
create table if not exists public.incident_types (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  color        text,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint incident_types_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.incident_types is
  'Incident Reports: per-facility customizable incident categories.';

create index if not exists idx_incident_types_facility
  on public.incident_types (facility_id);
create index if not exists idx_incident_types_facility_active
  on public.incident_types (facility_id, is_active);

drop trigger if exists trg_incident_types_updated_at on public.incident_types;
create trigger trg_incident_types_updated_at
  before update on public.incident_types
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. incident_severity_levels
-- -----------------------------------------------------------------------------
create table if not exists public.incident_severity_levels (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  key           text not null,
  display_name  text not null,
  color         text,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint incident_severity_levels_facility_key_uniq unique (facility_id, key)
);

comment on table public.incident_severity_levels is
  'Incident Reports: per-facility customizable severity levels (e.g. low/medium/high/critical).';

create index if not exists idx_incident_severity_levels_facility
  on public.incident_severity_levels (facility_id);
create index if not exists idx_incident_severity_levels_facility_active
  on public.incident_severity_levels (facility_id, is_active);

drop trigger if exists trg_incident_severity_levels_updated_at on public.incident_severity_levels;
create trigger trg_incident_severity_levels_updated_at
  before update on public.incident_severity_levels
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. incident_reports
-- -----------------------------------------------------------------------------
create table if not exists public.incident_reports (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities(id) on delete restrict,
  employee_id        uuid references public.employees(id) on delete set null,
  incident_type_id   uuid references public.incident_types(id) on delete set null,
  severity_level_id  uuid references public.incident_severity_levels(id) on delete set null,
  location           text,
  occurred_at        timestamptz not null default now(),
  reporter_name      text not null,
  reporter_phone     text not null,
  description        text not null,
  status             text not null default 'submitted'
                       check (status in ('submitted','reviewed','resolved','archived')),
  submitted_at       timestamptz not null default now(),
  reviewed_at        timestamptz,
  resolved_at        timestamptz,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

comment on table public.incident_reports is
  'Incident Reports: per-facility incident submissions. Original content not overwritten in normal flow; admins transition status. Reporter contact (name + phone) is required by spec.';

create index if not exists idx_incident_reports_facility_submitted
  on public.incident_reports (facility_id, submitted_at desc);
create index if not exists idx_incident_reports_employee
  on public.incident_reports (employee_id);
create index if not exists idx_incident_reports_incident_type
  on public.incident_reports (incident_type_id);
create index if not exists idx_incident_reports_severity_level
  on public.incident_reports (severity_level_id);
create index if not exists idx_incident_reports_status
  on public.incident_reports (status);
create index if not exists idx_incident_reports_location
  on public.incident_reports (location text_pattern_ops);

drop trigger if exists trg_incident_reports_updated_at on public.incident_reports;
create trigger trg_incident_reports_updated_at
  before update on public.incident_reports
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. incident_followup_notes (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.incident_followup_notes (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  incident_id   uuid not null references public.incident_reports(id) on delete cascade,
  employee_id   uuid references public.employees(id) on delete set null,
  body          text not null,
  created_at    timestamptz not null default now()
);

comment on table public.incident_followup_notes is
  'Incident Reports: append-only follow-up notes by managers/admins. No update/delete policies — permanent history.';

create index if not exists idx_incident_followup_notes_incident_created
  on public.incident_followup_notes (incident_id, created_at);
create index if not exists idx_incident_followup_notes_facility
  on public.incident_followup_notes (facility_id);

-- =============================================================================
-- Seed defaults helper
-- Idempotent; intended to be invoked by app/admin code at facility creation
-- or on first activation of the Incident Reports module for a facility.
-- =============================================================================
create or replace function public.seed_default_incident_types_and_severities(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Severities (lower sort_order = more critical, displayed first)
  insert into public.incident_severity_levels (facility_id, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'critical', 'Critical', 1, true),
    (p_facility_id, 'high',     'High',     2, true),
    (p_facility_id, 'medium',   'Medium',   3, true),
    (p_facility_id, 'low',      'Low',      4, true)
  on conflict (facility_id, key) do nothing;

  -- Incident types
  insert into public.incident_types (facility_id, name, slug, sort_order, is_active)
  values
    (p_facility_id, 'Theft',          'theft',          1, true),
    (p_facility_id, 'Vandalism',      'vandalism',      2, true),
    (p_facility_id, 'Safety Concern', 'safety_concern', 3, true),
    (p_facility_id, 'Other',          'other',          4, true)
  on conflict (facility_id, slug) do nothing;
end;
$$;

comment on function public.seed_default_incident_types_and_severities(uuid) is
  'Seeds 4 default incident severity levels and 4 default incident types for a facility. Idempotent via on conflict do nothing on the unique keys.';

revoke execute on function public.seed_default_incident_types_and_severities(uuid) from public;
grant  execute on function public.seed_default_incident_types_and_severities(uuid) to service_role;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.incident_types            enable row level security;
alter table public.incident_severity_levels  enable row level security;
alter table public.incident_reports          enable row level security;
alter table public.incident_followup_notes   enable row level security;

-- -----------------------------------------------------------------------------
-- incident_types
--   SELECT: super admin OR same-facility + module access
--   INSERT/UPDATE/DELETE: super admin OR same-facility + module admin access
-- -----------------------------------------------------------------------------
drop policy if exists incident_types_select on public.incident_types;
create policy incident_types_select on public.incident_types
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('incident_reports')
    )
  );

drop policy if exists incident_types_insert on public.incident_types;
create policy incident_types_insert on public.incident_types
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

drop policy if exists incident_types_update on public.incident_types;
create policy incident_types_update on public.incident_types
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

drop policy if exists incident_types_delete on public.incident_types;
create policy incident_types_delete on public.incident_types
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- incident_severity_levels (same shape as incident_types)
-- -----------------------------------------------------------------------------
drop policy if exists incident_severity_levels_select on public.incident_severity_levels;
create policy incident_severity_levels_select on public.incident_severity_levels
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('incident_reports')
    )
  );

drop policy if exists incident_severity_levels_insert on public.incident_severity_levels;
create policy incident_severity_levels_insert on public.incident_severity_levels
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

drop policy if exists incident_severity_levels_update on public.incident_severity_levels;
create policy incident_severity_levels_update on public.incident_severity_levels
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

drop policy if exists incident_severity_levels_delete on public.incident_severity_levels;
create policy incident_severity_levels_delete on public.incident_severity_levels
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- incident_reports
--   SELECT: super admin OR (same-facility AND (module admin OR (module access AND own row)))
--   INSERT: super admin OR (same-facility + module access + employee_id = current_employee_id)
--   UPDATE: admin only — DB allows admin updates (status transitions / extreme corrections);
--           the app enforces "original cannot be overwritten" in normal flow.
--   DELETE: super admin only.
-- -----------------------------------------------------------------------------
drop policy if exists incident_reports_select on public.incident_reports;
create policy incident_reports_select on public.incident_reports
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('incident_reports')
        or (
          public.has_module_access('incident_reports')
          and employee_id = public.current_employee_id()
        )
      )
    )
  );

drop policy if exists incident_reports_insert on public.incident_reports;
create policy incident_reports_insert on public.incident_reports
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('incident_reports')
      and employee_id = public.current_employee_id()
    )
  );

drop policy if exists incident_reports_update on public.incident_reports;
create policy incident_reports_update on public.incident_reports
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

drop policy if exists incident_reports_delete on public.incident_reports;
create policy incident_reports_delete on public.incident_reports
  for delete to authenticated
  using (
    public.is_super_admin()
  );

-- -----------------------------------------------------------------------------
-- incident_followup_notes (append-only — no UPDATE/DELETE policies)
--   SELECT: super admin OR (same-facility AND (module admin OR (module access AND parent is own)))
--   INSERT: super admin OR (same-facility AND module admin access)
--   UPDATE/DELETE: no policies → denied by default (RLS on, append-only)
-- -----------------------------------------------------------------------------
drop policy if exists incident_followup_notes_select on public.incident_followup_notes;
create policy incident_followup_notes_select on public.incident_followup_notes
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('incident_reports')
        or (
          public.has_module_access('incident_reports')
          and exists (
            select 1
            from public.incident_reports r
            where r.id = incident_id
              and r.employee_id = public.current_employee_id()
          )
        )
      )
    )
  );

drop policy if exists incident_followup_notes_insert on public.incident_followup_notes;
create policy incident_followup_notes_insert on public.incident_followup_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

-- (No update / delete policies — append-only.)
