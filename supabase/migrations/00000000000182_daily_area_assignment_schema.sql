-- =============================================================================
-- 00000000000182_daily_area_assignment_schema.sql
-- Daily Reports: area assignment & routing — Phase 1 (schema only).
--
-- Adds five tables for per-day area assignment routing (design:
-- docs/daily-area-assignment-discovery.md, gate-approved):
--   1. report_area_assignments          — who is responsible for an area on a
--                                         facility-local business date. Multiple
--                                         active rows per (area, date) = multiple
--                                         assignees. Supersede-don't-delete.
--   2. area_default_owners              — standing default owners per area
--                                         (admin-configured fallback when no
--                                         manual/schedule assignment exists).
--   3. daily_area_job_area_map          — bridge between daily_report_areas and
--                                         the scheduling job-area catalog
--                                         (employee_job_areas). Net-new: the two
--                                         taxonomies are deliberately unlinked
--                                         (see migration 107 header).
--   4. daily_area_assignment_snapshots  — immutable per-(facility, business_date,
--                                         area) record of who was assigned and
--                                         whether the area was completed, frozen
--                                         at day close. Day-keyed because daily
--                                         reports have no report/lock entity
--                                         (migrations 156/161: append-only
--                                         submissions grouped by business_date).
--   5. daily_report_settings            — per-facility feature flag
--                                         (assignment_routing_enabled, default
--                                         OFF) + pre-lock warning threshold.
--
-- RLS: enabled on all five tables with NO policies (default-deny). Policies
-- land in Phase 2 as one reviewed unit together with the
-- daily_report_submissions visibility changes and the rls_isolation.sql
-- assertions. Until then nothing can read or write these tables through
-- PostgREST, and a missing daily_report_settings row (or a disabled flag)
-- means routing is off — current open-report behavior is unchanged.
--
-- People are referenced by employees(id), matching every other daily-report
-- table and module_area_permissions. Snapshot assignee/completion details are
-- jsonb so they survive the 14-day submission purge and employee deactivation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. report_area_assignments
-- -----------------------------------------------------------------------------
create table if not exists public.report_area_assignments (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  report_date   date not null,
  area_id       uuid not null references public.daily_report_areas(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  source        text not null check (source in ('manual', 'schedule', 'default')),
  assigned_by   uuid references public.employees(id) on delete set null,
  created_at    timestamptz not null default now(),
  superseded_at timestamptz
);

comment on table public.report_area_assignments is
  'Daily Reports routing: who is responsible for an area on a facility-local business date. '
  'Multiple active (superseded_at IS NULL) rows per (area, date) = multiple assignees; any one '
  'assignee completing the area satisfies it for all. Reassignment supersedes rows (never deletes) '
  'so history survives into the day-close snapshot. source records how the row was produced: '
  'manual override > schedule-derived (published shifts only) > standing default.';
comment on column public.report_area_assignments.report_date is
  'Facility-local business date this assignment applies to (same day model as '
  'daily_report_submissions.business_date). For schedule-derived rows, an overnight shift '
  'assigns the business date it STARTS on.';
comment on column public.report_area_assignments.superseded_at is
  'NULL = active. Set (never deleted) when the assignment is replaced or removed, so the '
  'assignment history for the day remains auditable.';

-- One ACTIVE assignment per (facility, date, area, employee); superseded
-- history rows are unconstrained.
create unique index if not exists report_area_assignments_active_uniq
  on public.report_area_assignments (facility_id, report_date, area_id, employee_id)
  where superseded_at is null;

create index if not exists idx_report_area_assignments_facility_date
  on public.report_area_assignments (facility_id, report_date);
create index if not exists idx_report_area_assignments_employee_date
  on public.report_area_assignments (employee_id, report_date);
create index if not exists idx_report_area_assignments_area
  on public.report_area_assignments (area_id);

-- -----------------------------------------------------------------------------
-- 2. area_default_owners
-- -----------------------------------------------------------------------------
create table if not exists public.area_default_owners (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  area_id     uuid not null references public.daily_report_areas(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint area_default_owners_uniq unique (area_id, employee_id)
);

comment on table public.area_default_owners is
  'Daily Reports routing: standing default owner(s) per area (admin-configured). Used by the '
  'resolution engine when a business date has no manual assignment and no published '
  'schedule-derived assignment. Multiple rows per area = multiple default assignees.';

create index if not exists idx_area_default_owners_facility
  on public.area_default_owners (facility_id);
create index if not exists idx_area_default_owners_employee
  on public.area_default_owners (employee_id);

-- -----------------------------------------------------------------------------
-- 3. daily_area_job_area_map
-- -----------------------------------------------------------------------------
create table if not exists public.daily_area_job_area_map (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  area_id     uuid not null references public.daily_report_areas(id) on delete cascade,
  job_area_id uuid not null references public.employee_job_areas(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint daily_area_job_area_map_uniq unique (area_id, job_area_id)
);

comment on table public.daily_area_job_area_map is
  'Daily Reports routing: maps a daily report area to one or more scheduling job areas '
  '(employee_job_areas). The resolution engine reads PUBLISHED schedule_shifts whose '
  'job_area_id is mapped here to derive the day''s assignees. The two catalogs are otherwise '
  'deliberately unlinked (migration 107); this bridge is additive and read-only against '
  'scheduling.';

create index if not exists idx_daily_area_job_area_map_facility
  on public.daily_area_job_area_map (facility_id);
create index if not exists idx_daily_area_job_area_map_job_area
  on public.daily_area_job_area_map (job_area_id);

-- -----------------------------------------------------------------------------
-- 4. daily_area_assignment_snapshots
-- -----------------------------------------------------------------------------
create table if not exists public.daily_area_assignment_snapshots (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  business_date date not null,
  area_id       uuid not null references public.daily_report_areas(id) on delete cascade,
  assignees     jsonb not null,
  completed     boolean not null,
  completed_by  jsonb,
  snapshot_at   timestamptz not null default now(),
  constraint daily_area_assignment_snapshots_uniq
    unique (facility_id, business_date, area_id)
);

comment on table public.daily_area_assignment_snapshots is
  'Daily Reports routing: immutable record, frozen at day close, of who was assigned to an area '
  'for a business date and whether any assignee completed it. Written only by the day-close '
  'SECURITY DEFINER path (Phase 5); no PostgREST role may write it. Areas that were open '
  '(unassigned) that day get no row and render as today. assignees / completed_by are jsonb '
  'snapshots ([{employee_id, name, source}] / [{employee_id, name, submission_id, submitted_at}]) '
  'so the record outlives the 14-day submission purge and later employee changes.';

create index if not exists idx_daily_area_assignment_snapshots_facility_date
  on public.daily_area_assignment_snapshots (facility_id, business_date);

-- -----------------------------------------------------------------------------
-- 5. daily_report_settings
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_settings (
  facility_id                uuid primary key references public.facilities(id) on delete cascade,
  assignment_routing_enabled boolean not null default false,
  prelock_warning_minutes    int not null default 60
    check (prelock_warning_minutes between 5 and 720),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz
);

comment on table public.daily_report_settings is
  'Per-facility Daily Reports settings. assignment_routing_enabled is the feature flag for '
  'area assignment & routing: OFF (or no row) = every area is open to all permitted staff, '
  'exactly the pre-feature behavior. prelock_warning_minutes is how long before facility-local '
  'day close the supervisor pre-lock warning view flags incomplete assigned areas.';

drop trigger if exists trg_daily_report_settings_updated_at on public.daily_report_settings;
create trigger trg_daily_report_settings_updated_at
  before update on public.daily_report_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security: enable, deny-all. Policies are Phase 2 (one reviewed
-- unit, together with the daily_report_submissions visibility changes and the
-- rls_isolation.sql adversarial assertions).
-- -----------------------------------------------------------------------------
alter table public.report_area_assignments        enable row level security;
alter table public.area_default_owners            enable row level security;
alter table public.daily_area_job_area_map        enable row level security;
alter table public.daily_area_assignment_snapshots enable row level security;
alter table public.daily_report_settings          enable row level security;
