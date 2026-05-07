-- =============================================================================
-- 00000000000014_ice_depth_schema.sql
-- Ice Depth module: 6 tables + RLS + seed-defaults helper.
--
-- Premium module. Per facility, admins design up to 8 active "layouts"
-- (vertical rink diagrams). Each layout holds up to N points (max 60) that
-- the admin places visually. Staff submit a session by clicking each point
-- and entering a depth value. Staff may start anywhere; the UI walks the
-- sequence (point_number + sort_order). Incomplete submissions are allowed
-- (no per-point requirement); there is no partial save and staff cannot
-- edit after submit.
--
-- Severity computation (server-side at submit; persisted on each
-- ice_depth_measurements row):
--   severity = 'low'  if depth_value <= settings.low_threshold
--            = 'high' if depth_value >  settings.high_threshold
--            = 'ok'   otherwise
-- The thresholds and measurement_unit at submit time are snapshotted onto
-- the session so historical sessions remain interpretable even if admin
-- later changes the unit or thresholds.
--
-- Alerts: when settings.alerts_enabled = true the server inserts ONE
-- communication_alerts row per session that has the relevant severity
-- present, where:
--   alert fires if (settings.alert_on = 'low'  and has_low_reading)
--                or (settings.alert_on = 'high' and has_high_reading)
--                or (settings.alert_on = 'any'  and (has_low_reading or has_high_reading))
-- Alert severity = settings.default_alert_severity. source_module='ice_depth'.
-- One alert per session, not per measurement.
--
-- Caps (DB-enforced via triggers):
--   * Max 8 ACTIVE ice_depth_layouts per facility.
--   * Max 60 ACTIVE ice_depth_points per layout.
-- Toggling is_active = false is always allowed.
--
-- Deferred (NOT in this migration): PDF/Excel exports, email recipients,
-- BT caliper devices, 3-year retention purge.
--
-- Tables:
--   ice_depth_settings          (one row per facility)
--   ice_depth_layouts           (max 8 active per facility -- trigger)
--   ice_depth_points            (max 60 active per layout -- trigger)
--   ice_depth_sessions          (one row per staff submission; immutable)
--   ice_depth_measurements      (one row per recorded depth point)
--   ice_depth_followup_notes    (append-only)
--
-- Module key for permission helpers: 'ice_depth'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ice_depth_settings (one row per facility)
-- -----------------------------------------------------------------------------
create table if not exists public.ice_depth_settings (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  measurement_unit         text not null default 'inches'
                             check (measurement_unit in ('inches','mm')),
  low_threshold            numeric not null default 0.99,
  high_threshold           numeric not null default 1.75,
  low_color                text not null default '#ef4444',
  ok_color                 text not null default '#22c55e',
  high_color               text not null default '#eab308',
  alerts_enabled           boolean not null default false,
  alert_on                 text not null default 'low'
                             check (alert_on in ('low','high','any')),
  default_alert_severity   text not null default 'high'
                             check (default_alert_severity in ('warn','high','critical')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  constraint ice_depth_settings_facility_uniq unique (facility_id)
);

comment on table public.ice_depth_settings is
  'Ice Depth: per-facility module config. Thresholds are stored in the configured measurement_unit (inches or mm). Default thresholds: low <= 0.99, high > 1.75 (inches). Colors are CSS hex. When alerts_enabled=true the app inserts one communication_alerts row per session whose readings match alert_on (''low'' | ''high'' | ''any'') with severity = default_alert_severity.';
comment on column public.ice_depth_settings.low_threshold is
  'Inclusive low threshold; depth_value <= low_threshold => severity ''low''. Stored in measurement_unit.';
comment on column public.ice_depth_settings.high_threshold is
  'Exclusive high threshold; depth_value > high_threshold => severity ''high''. Stored in measurement_unit.';
comment on column public.ice_depth_settings.alert_on is
  'Which severity triggers a communication_alerts insert: ''low'', ''high'', or ''any''. Only consulted when alerts_enabled = true.';

drop trigger if exists trg_ice_depth_settings_updated_at on public.ice_depth_settings;
create trigger trg_ice_depth_settings_updated_at
  before update on public.ice_depth_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. ice_depth_layouts
-- Up to 8 ACTIVE layouts per facility (DB-enforced).
-- -----------------------------------------------------------------------------
create table if not exists public.ice_depth_layouts (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null references public.facilities(id) on delete restrict,
  name                    text not null,
  slug                    text not null,
  description             text,
  sort_order              int  not null default 0,
  is_active               boolean not null default true,
  diagram_aspect_ratio    numeric not null default 0.425,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz,
  constraint ice_depth_layouts_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.ice_depth_layouts is
  'Ice Depth: per-facility custom rink-diagram layouts. Hard cap of 8 active per facility (DB-enforced). diagram_aspect_ratio is width / height of the rendered diagram; default 0.425 approximates an 85x200 NHL rink shown vertically.';
comment on column public.ice_depth_layouts.diagram_aspect_ratio is
  'width / height of the rendered diagram. Used by the UI to size the canvas. Default 0.425 = 85/200 (vertical NHL rink).';

create index if not exists idx_ice_depth_layouts_facility_active_sort
  on public.ice_depth_layouts (facility_id, is_active, sort_order);

drop trigger if exists trg_ice_depth_layouts_updated_at on public.ice_depth_layouts;
create trigger trg_ice_depth_layouts_updated_at
  before update on public.ice_depth_layouts
  for each row execute function public.set_updated_at();

-- Enforce: at most 8 active layouts per facility.
create or replace function public.enforce_ice_depth_layouts_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if new.is_active is true then
    select count(*) into v_count
      from public.ice_depth_layouts
     where facility_id = new.facility_id
       and is_active = true
       and (tg_op = 'INSERT' or id <> new.id);
    if v_count >= 8 then
      raise exception 'Facility % already has 8 active ice_depth_layouts (max).', new.facility_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_ice_depth_layouts_cap() is
  'Trigger: raises if a facility would exceed 8 active ice_depth_layouts. Skipped when is_active is being toggled off.';

drop trigger if exists trg_ice_depth_layouts_cap on public.ice_depth_layouts;
create trigger trg_ice_depth_layouts_cap
  before insert or update of is_active, facility_id on public.ice_depth_layouts
  for each row execute function public.enforce_ice_depth_layouts_cap();

-- -----------------------------------------------------------------------------
-- 3. ice_depth_points
-- Up to 60 ACTIVE points per layout (DB-enforced).
-- point_number is sequential and unique per layout (admin assigns;
-- UI auto-numbers when placing). x/y are fractional positions in [0,1].
-- -----------------------------------------------------------------------------
create table if not exists public.ice_depth_points (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  layout_id     uuid not null references public.ice_depth_layouts(id) on delete cascade,
  point_number  int  not null,
  label         text,
  x_position    numeric not null check (x_position >= 0 and x_position <= 1),
  y_position    numeric not null check (y_position >= 0 and y_position <= 1),
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint ice_depth_points_layout_number_uniq unique (layout_id, point_number)
);

comment on table public.ice_depth_points is
  'Ice Depth: numbered measurement points placed on a layout diagram. Hard cap of 60 active points per layout (DB-enforced). x_position / y_position are fractional [0,1] coordinates relative to the diagram. point_number is sequential and unique within a layout (admin/UI assigns at place time; admin may reorder via sort_order without renumbering).';
comment on column public.ice_depth_points.point_number is
  'Sequential identifier within a layout. UI auto-assigns next available integer when admin places a new point. Uniqueness enforced via (layout_id, point_number). Note: deleting a point leaves a gap -- the UI must either renumber subsequent points or accept gaps. point_number is the staff-visible label on the diagram.';
comment on column public.ice_depth_points.sort_order is
  'Drives the order in which staff are walked through points by the UI (Enter advances to next sort_order). Defaults to 0; UI typically initializes to point_number.';

create index if not exists idx_ice_depth_points_layout_sort
  on public.ice_depth_points (layout_id, sort_order);

create index if not exists idx_ice_depth_points_layout_active
  on public.ice_depth_points (layout_id, is_active);

drop trigger if exists trg_ice_depth_points_updated_at on public.ice_depth_points;
create trigger trg_ice_depth_points_updated_at
  before update on public.ice_depth_points
  for each row execute function public.set_updated_at();

-- Enforce: at most 60 active points per layout.
create or replace function public.enforce_ice_depth_points_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if new.is_active is true then
    select count(*) into v_count
      from public.ice_depth_points
     where layout_id = new.layout_id
       and is_active = true
       and (tg_op = 'INSERT' or id <> new.id);
    if v_count >= 60 then
      raise exception 'Layout % already has 60 active ice_depth_points (max).', new.layout_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_ice_depth_points_cap() is
  'Trigger: raises if a layout would exceed 60 active ice_depth_points. Skipped when is_active is being toggled off.';

drop trigger if exists trg_ice_depth_points_cap on public.ice_depth_points;
create trigger trg_ice_depth_points_cap
  before insert or update of is_active, layout_id on public.ice_depth_points
  for each row execute function public.enforce_ice_depth_points_cap();

-- -----------------------------------------------------------------------------
-- 4. ice_depth_sessions
-- One row per staff submission. Immutable (super_admin-only UPDATE/DELETE).
-- Snapshots of the unit and thresholds preserve interpretability across
-- later admin changes. has_low_reading / has_high_reading / counts are
-- denormalized for fast filtering and history views.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_depth_sessions (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  layout_id                   uuid not null references public.ice_depth_layouts(id) on delete restrict,
  employee_id                 uuid references public.employees(id) on delete set null,
  notes                       text,
  submitted_at                timestamptz not null default now(),
  measurement_unit_snapshot   text not null
                                check (measurement_unit_snapshot in ('inches','mm')),
  low_threshold_snapshot      numeric not null,
  high_threshold_snapshot     numeric not null,
  has_low_reading             boolean not null default false,
  has_high_reading            boolean not null default false,
  low_count                   int not null default 0,
  high_count                  int not null default 0,
  total_measurements          int not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz
);

comment on table public.ice_depth_sessions is
  'Ice Depth: one row per staff submission against a layout. Snapshots measurement_unit / low_threshold / high_threshold from ice_depth_settings at submit time so historical sessions stay interpretable across later admin changes. Original is immutable; only super_admin may UPDATE/DELETE.';
comment on column public.ice_depth_sessions.measurement_unit_snapshot is
  'Snapshot of ice_depth_settings.measurement_unit at submit time. depth_value rows belong to this unit.';
comment on column public.ice_depth_sessions.has_low_reading is
  'Denormalized: true if any child ice_depth_measurements row has severity=''low''. Server sets at submit. Drives alert decision and fast filtering.';
comment on column public.ice_depth_sessions.has_high_reading is
  'Denormalized: true if any child ice_depth_measurements row has severity=''high''.';
comment on column public.ice_depth_sessions.total_measurements is
  'Count of recorded child measurements. May be less than the layout''s active point count -- incomplete submissions are allowed.';

create index if not exists idx_ice_depth_sessions_facility_submitted
  on public.ice_depth_sessions (facility_id, submitted_at desc);

create index if not exists idx_ice_depth_sessions_layout_submitted
  on public.ice_depth_sessions (layout_id, submitted_at desc);

create index if not exists idx_ice_depth_sessions_employee
  on public.ice_depth_sessions (employee_id);

create index if not exists idx_ice_depth_sessions_has_low
  on public.ice_depth_sessions (facility_id, submitted_at desc)
  where has_low_reading = true;

drop trigger if exists trg_ice_depth_sessions_updated_at on public.ice_depth_sessions;
create trigger trg_ice_depth_sessions_updated_at
  before update on public.ice_depth_sessions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. ice_depth_measurements
-- One row per recorded depth value. Snapshots point identity so deletes
-- of a parent point do not lose history.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_depth_measurements (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null references public.facilities(id) on delete restrict,
  session_id              uuid not null references public.ice_depth_sessions(id) on delete cascade,
  point_id                uuid references public.ice_depth_points(id) on delete set null,
  point_number_snapshot   int  not null,
  label_snapshot          text,
  x_snapshot              numeric not null,
  y_snapshot              numeric not null,
  depth_value             numeric not null,
  severity                text not null check (severity in ('low','ok','high')),
  created_at              timestamptz not null default now()
);

comment on table public.ice_depth_measurements is
  'Ice Depth: per-point depth reading captured during a session. Snapshots point identity (number, label, x/y) so historical heat-maps and trend-by-point queries remain valid even if the parent point is later moved or deleted. severity is computed server-side at submit using the session''s threshold snapshots: ''low'' if depth_value <= low_threshold_snapshot, ''high'' if depth_value > high_threshold_snapshot, else ''ok''.';
comment on column public.ice_depth_measurements.depth_value is
  'Depth in the session''s measurement_unit_snapshot (inches or mm).';
comment on column public.ice_depth_measurements.severity is
  'Server-computed at submit time from depth_value vs the session threshold snapshots. Persisted (not derived in queries) so admin threshold changes do not retroactively reclassify history.';

create index if not exists idx_ice_depth_measurements_session
  on public.ice_depth_measurements (session_id);

create index if not exists idx_ice_depth_measurements_point
  on public.ice_depth_measurements (point_id);

create index if not exists idx_ice_depth_measurements_severity
  on public.ice_depth_measurements (severity);

-- -----------------------------------------------------------------------------
-- 6. ice_depth_followup_notes (append-only at the DB)
-- Managers/admins may add follow-up notes; they cannot edit the original
-- session. Only INSERT policy is gated on has_module_admin_access.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_depth_followup_notes (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  session_id      uuid not null references public.ice_depth_sessions(id) on delete cascade,
  employee_id     uuid references public.employees(id) on delete set null,
  body            text not null,
  is_admin_note   boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.ice_depth_followup_notes is
  'Ice Depth: append-only follow-up notes (admin/manager only). Original session stays immutable. No UPDATE/DELETE policies.';

create index if not exists idx_ice_depth_followup_notes_session_created
  on public.ice_depth_followup_notes (session_id, created_at);

-- =============================================================================
-- Seed defaults helper
-- Inserts a default settings row only. Per spec, no default layouts/points
-- are seeded -- admin builds those manually.
-- =============================================================================
create or replace function public.seed_default_ice_depth_settings(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.ice_depth_settings
    (facility_id, measurement_unit, low_threshold, high_threshold,
     low_color, ok_color, high_color,
     alerts_enabled, alert_on, default_alert_severity)
  values
    (p_facility_id, 'inches', 0.99, 1.75,
     '#ef4444', '#22c55e', '#eab308',
     false, 'low', 'high')
  on conflict (facility_id) do nothing;
end;
$$;

comment on function public.seed_default_ice_depth_settings(uuid) is
  'Seeds the default ice_depth_settings row for a facility (inches, 0.99/1.75 thresholds, red/green/yellow, alerts off). Idempotent. Does NOT seed layouts or points -- admin builds those manually per spec.';

revoke execute on function public.seed_default_ice_depth_settings(uuid) from public;
grant  execute on function public.seed_default_ice_depth_settings(uuid) to service_role;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.ice_depth_settings         enable row level security;
alter table public.ice_depth_layouts          enable row level security;
alter table public.ice_depth_points           enable row level security;
alter table public.ice_depth_sessions         enable row level security;
alter table public.ice_depth_measurements     enable row level security;
alter table public.ice_depth_followup_notes   enable row level security;

-- -----------------------------------------------------------------------------
-- Config tables (settings, layouts, points):
--   SELECT: super_admin OR same-facility + module access
--   INSERT/UPDATE/DELETE: super_admin OR same-facility + module admin access
-- -----------------------------------------------------------------------------

-- ice_depth_settings ----------------------------------------------------------
drop policy if exists ice_depth_settings_select on public.ice_depth_settings;
create policy ice_depth_settings_select on public.ice_depth_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists ice_depth_settings_insert on public.ice_depth_settings;
create policy ice_depth_settings_insert on public.ice_depth_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists ice_depth_settings_update on public.ice_depth_settings;
create policy ice_depth_settings_update on public.ice_depth_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists ice_depth_settings_delete on public.ice_depth_settings;
create policy ice_depth_settings_delete on public.ice_depth_settings
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

-- ice_depth_layouts -----------------------------------------------------------
drop policy if exists ice_depth_layouts_select on public.ice_depth_layouts;
create policy ice_depth_layouts_select on public.ice_depth_layouts
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists ice_depth_layouts_insert on public.ice_depth_layouts;
create policy ice_depth_layouts_insert on public.ice_depth_layouts
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists ice_depth_layouts_update on public.ice_depth_layouts;
create policy ice_depth_layouts_update on public.ice_depth_layouts
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists ice_depth_layouts_delete on public.ice_depth_layouts;
create policy ice_depth_layouts_delete on public.ice_depth_layouts
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

-- ice_depth_points ------------------------------------------------------------
drop policy if exists ice_depth_points_select on public.ice_depth_points;
create policy ice_depth_points_select on public.ice_depth_points
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists ice_depth_points_insert on public.ice_depth_points;
create policy ice_depth_points_insert on public.ice_depth_points
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists ice_depth_points_update on public.ice_depth_points;
create policy ice_depth_points_update on public.ice_depth_points
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists ice_depth_points_delete on public.ice_depth_points;
create policy ice_depth_points_delete on public.ice_depth_points
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

-- -----------------------------------------------------------------------------
-- ice_depth_sessions
--   SELECT: super_admin OR same-facility + module access
--   INSERT: super_admin OR same-facility + module access AND submitter = self
--   UPDATE/DELETE: super_admin only -- original immutable. Module admins
--                  cannot edit (they append followup notes).
-- -----------------------------------------------------------------------------
drop policy if exists ice_depth_sessions_select on public.ice_depth_sessions;
create policy ice_depth_sessions_select on public.ice_depth_sessions
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists ice_depth_sessions_insert on public.ice_depth_sessions;
create policy ice_depth_sessions_insert on public.ice_depth_sessions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
      and employee_id = public.current_employee_id()
    )
  );

drop policy if exists ice_depth_sessions_update on public.ice_depth_sessions;
create policy ice_depth_sessions_update on public.ice_depth_sessions
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists ice_depth_sessions_delete on public.ice_depth_sessions;
create policy ice_depth_sessions_delete on public.ice_depth_sessions
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- ice_depth_measurements
--   SELECT: super_admin OR same-facility + module access
--   INSERT: super_admin OR same-facility + module access (parent session
--           INSERT policy is the real submitter gate)
--   UPDATE/DELETE: super_admin only.
-- -----------------------------------------------------------------------------
drop policy if exists ice_depth_measurements_select on public.ice_depth_measurements;
create policy ice_depth_measurements_select on public.ice_depth_measurements
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists ice_depth_measurements_insert on public.ice_depth_measurements;
create policy ice_depth_measurements_insert on public.ice_depth_measurements
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists ice_depth_measurements_update on public.ice_depth_measurements;
create policy ice_depth_measurements_update on public.ice_depth_measurements
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists ice_depth_measurements_delete on public.ice_depth_measurements;
create policy ice_depth_measurements_delete on public.ice_depth_measurements
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- ice_depth_followup_notes (append-only)
--   SELECT: super_admin OR same-facility + module access
--   INSERT: super_admin OR same-facility + module admin access
--   UPDATE/DELETE: no policies -> denied
-- -----------------------------------------------------------------------------
drop policy if exists ice_depth_followup_notes_select on public.ice_depth_followup_notes;
create policy ice_depth_followup_notes_select on public.ice_depth_followup_notes
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists ice_depth_followup_notes_insert on public.ice_depth_followup_notes;
create policy ice_depth_followup_notes_insert on public.ice_depth_followup_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

-- (No update / delete policies -- append-only.)
