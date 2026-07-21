-- =============================================================================
-- 00000000000199_rink_diagram_overlays.sql
--
-- Ice Depth: facility-level reference overlays for the rink diagram.
--
--   A. Door markers — Zamboni/access doors etc. placed on the shared USA-Hockey
--      diagram. Door TYPES are an admin-configurable lookup (facility_door_types),
--      never a code enum; markers (facility_door_markers) reference a type and
--      store normalized 0..1 coordinates in the SAME position space as
--      ice_depth_points (x_position/y_position against the 380×740 viewBox).
--   B. Center-ice logo watermark — per-facility uploaded logo rendered at a
--      configurable position/scale/rotation/opacity BELOW all report data.
--      Config lives in facility_rink_diagram_config (one row per facility);
--      the image bytes live in the private 'rink-logos' storage bucket under
--      '<facility_id>/<file>' (first path segment IS the facility id).
--
-- Both are facility configuration (set once, rendered read-only on every
-- ice-depth report); neither is per-report data, so nothing here references
-- sessions or measurements and rendering is independent of report state.
--
-- Access model (module key 'ice_depth', same gates as the other ice-depth
-- config tables in migration 14):
--   SELECT: super_admin OR same-facility + has_module_access('ice_depth')
--   INSERT/UPDATE/DELETE: super_admin OR same-facility +
--     has_module_admin_access('ice_depth')
-- Storage: authenticated reads scoped to the caller's facility path; writes
-- restricted to service-role (logo uploads go through a module-admin-gated
-- server action using the service-role client), mirroring facility-documents
-- (migration 85).
--
-- Seed on facility provisioning: Zamboni Door / Access Door / Player Gate /
-- Penalty Box Gate via an AFTER INSERT trigger on facilities (migration 144
-- pattern), plus a backfill for existing facilities. Seed only — the rows
-- remain fully editable in Admin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. facility_door_types (admin-configurable lookup; never a code enum)
-- -----------------------------------------------------------------------------
create table if not exists public.facility_door_types (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete cascade,
  name         text not null,
  color        text
                 check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_by   uuid references public.employees(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint facility_door_types_facility_name_uniq unique (facility_id, name),
  -- Composite target for the same-facility FK on facility_door_markers.
  constraint facility_door_types_id_facility_uniq unique (id, facility_id)
);

comment on table public.facility_door_types is
  'Ice Depth diagram overlays: admin-configurable door-type lookup (e.g. Zamboni Door, Access Door). Facility-scoped; seeded on facility provisioning but fully editable in Admin. color is an optional CSS hex; NULL renders the brand navy default.';
comment on column public.facility_door_types.color is
  'Optional 6-digit CSS hex for markers of this type. NULL = UI default (brand navy #002244).';

create index if not exists idx_facility_door_types_facility_active_sort
  on public.facility_door_types (facility_id, is_active, sort_order);

drop trigger if exists trg_facility_door_types_updated_at on public.facility_door_types;
create trigger trg_facility_door_types_updated_at
  before update on public.facility_door_types
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. facility_door_markers
-- position_x / position_y are fractional [0,1] coordinates in the SAME space
-- as ice_depth_points.x_position/y_position (0..1 against the 380×740 rink
-- viewBox) so markers align with depth points without a second coordinate
-- system.
-- -----------------------------------------------------------------------------
create table if not exists public.facility_door_markers (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete cascade,
  door_type_id  uuid not null,
  label         text,
  position_x    numeric not null check (position_x >= 0 and position_x <= 1),
  position_y    numeric not null check (position_y >= 0 and position_y <= 1),
  created_by    uuid references public.employees(id) on delete set null,
  updated_by    uuid references public.employees(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  -- Composite FK pins the marker's type to the SAME facility, so a marker can
  -- never reference another tenant's door type (cross-tenant FK class of bug,
  -- cf. migration 189).
  constraint facility_door_markers_type_same_facility_fkey
    foreign key (door_type_id, facility_id)
    references public.facility_door_types (id, facility_id)
    on delete restrict
);

comment on table public.facility_door_markers is
  'Ice Depth diagram overlays: door/gate markers placed on the rink diagram. position_x/position_y are fractional [0,1] in the same coordinate space as ice_depth_points (380×740 viewBox). Facility-level reference geography — rendered read-only on every report, independent of report state. door_type_id is pinned to the same facility via a composite FK.';
comment on column public.facility_door_markers.label is
  'Optional free-text label (e.g. "West Zamboni") shown with the door-type name in tooltips/legend.';

create index if not exists idx_facility_door_markers_facility
  on public.facility_door_markers (facility_id);

create index if not exists idx_facility_door_markers_type
  on public.facility_door_markers (door_type_id);

drop trigger if exists trg_facility_door_markers_updated_at on public.facility_door_markers;
create trigger trg_facility_door_markers_updated_at
  before update on public.facility_door_markers
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. facility_rink_diagram_config (one row per facility)
-- Logo watermark layout. logo_scale is a fraction of the diagram WIDTH;
-- logo_opacity is deliberately watermark-level by default so the logo never
-- competes with depth data (z-order puts it below everything at render).
-- -----------------------------------------------------------------------------
create table if not exists public.facility_rink_diagram_config (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities(id) on delete cascade,
  logo_storage_path  text,
  logo_position_x    numeric not null default 0.5
                       check (logo_position_x >= 0 and logo_position_x <= 1),
  logo_position_y    numeric not null default 0.5
                       check (logo_position_y >= 0 and logo_position_y <= 1),
  logo_scale         numeric not null default 0.25
                       check (logo_scale > 0 and logo_scale <= 1),
  logo_rotation      numeric not null default 0
                       check (logo_rotation >= -360 and logo_rotation <= 360),
  logo_opacity       numeric not null default 0.15
                       check (logo_opacity >= 0 and logo_opacity <= 1),
  logo_visible       boolean not null default true,
  updated_by         uuid references public.employees(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  constraint facility_rink_diagram_config_facility_uniq unique (facility_id)
);

comment on table public.facility_rink_diagram_config is
  'Ice Depth diagram overlays: per-facility center-ice logo watermark config (one row per facility). logo_storage_path points into the private rink-logos bucket (''<facility_id>/<file>''). logo_position_x/y are fractional [0,1] in the shared diagram coordinate space; logo_scale is a fraction of diagram width; logo_opacity defaults to watermark level (0.15). Rendered BELOW door markers and depth points so it never obscures data.';

drop trigger if exists trg_facility_rink_diagram_config_updated_at on public.facility_rink_diagram_config;
create trigger trg_facility_rink_diagram_config_updated_at
  before update on public.facility_rink_diagram_config
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security — identical gates to the other ice_depth config tables:
-- staff-and-up (any enabled ice_depth grant) may read; only module admins may
-- write. The write gate lives HERE (and in the server actions), not in the UI.
-- =============================================================================
alter table public.facility_door_types         enable row level security;
alter table public.facility_door_markers       enable row level security;
alter table public.facility_rink_diagram_config enable row level security;

-- facility_door_types ---------------------------------------------------------
drop policy if exists facility_door_types_select on public.facility_door_types;
create policy facility_door_types_select on public.facility_door_types
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists facility_door_types_insert on public.facility_door_types;
create policy facility_door_types_insert on public.facility_door_types
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists facility_door_types_update on public.facility_door_types;
create policy facility_door_types_update on public.facility_door_types
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

drop policy if exists facility_door_types_delete on public.facility_door_types;
create policy facility_door_types_delete on public.facility_door_types
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

-- facility_door_markers -------------------------------------------------------
drop policy if exists facility_door_markers_select on public.facility_door_markers;
create policy facility_door_markers_select on public.facility_door_markers
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists facility_door_markers_insert on public.facility_door_markers;
create policy facility_door_markers_insert on public.facility_door_markers
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists facility_door_markers_update on public.facility_door_markers;
create policy facility_door_markers_update on public.facility_door_markers
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

drop policy if exists facility_door_markers_delete on public.facility_door_markers;
create policy facility_door_markers_delete on public.facility_door_markers
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

-- facility_rink_diagram_config ------------------------------------------------
drop policy if exists facility_rink_diagram_config_select on public.facility_rink_diagram_config;
create policy facility_rink_diagram_config_select on public.facility_rink_diagram_config
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists facility_rink_diagram_config_insert on public.facility_rink_diagram_config;
create policy facility_rink_diagram_config_insert on public.facility_rink_diagram_config
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists facility_rink_diagram_config_update on public.facility_rink_diagram_config;
create policy facility_rink_diagram_config_update on public.facility_rink_diagram_config
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

drop policy if exists facility_rink_diagram_config_delete on public.facility_rink_diagram_config;
create policy facility_rink_diagram_config_delete on public.facility_rink_diagram_config
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

-- =============================================================================
-- Seed defaults: four standard door types per facility. Idempotent via the
-- (facility_id, name) unique constraint. Seed only — admins may rename,
-- recolor, reorder, deactivate, or delete them afterwards.
-- =============================================================================
create or replace function public.seed_default_door_types(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.facility_door_types (facility_id, name, sort_order)
  select p_facility_id, s.name, s.sort_order
  from (values
    ('Zamboni Door',     0),
    ('Access Door',      1),
    ('Player Gate',      2),
    ('Penalty Box Gate', 3)
  ) as s(name, sort_order)
  on conflict (facility_id, name) do nothing;
end;
$$;

comment on function public.seed_default_door_types(uuid) is
  'Seeds the four standard rink door types (Zamboni Door, Access Door, Player Gate, Penalty Box Gate) for a facility. Idempotent. Seed only — rows stay editable in Admin. Internal-only execute, mirroring seed_default_dasher_boards_config.';

revoke execute on function public.seed_default_door_types(uuid) from public;
grant  execute on function public.seed_default_door_types(uuid) to service_role;

-- Auto-seed for new facilities (path-independent, migration 144 pattern).
create or replace function public.tg_seed_door_types()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_door_types(new.id);
  return new;
end;
$$;

revoke execute on function public.tg_seed_door_types() from public;

drop trigger if exists facilities_seed_door_types on public.facilities;
create trigger facilities_seed_door_types
  after insert on public.facilities
  for each row execute function public.tg_seed_door_types();

-- Backfill every existing facility.
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_door_types(f.id);
  end loop;
end;
$$;

-- =============================================================================
-- Storage: private 'rink-logos' bucket.
--
-- The EXECUTE guard mirrors migrations 48/85: the `public` column on
-- storage.buckets is missing on the older storage schema bundled with the CI
-- supabase/postgres image, so the INSERT text must only be parsed when its
-- branch actually runs. Either branch yields the same private bucket.
-- =============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage'
       and table_name   = 'buckets'
       and column_name  = 'public'
  ) then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('rink-logos', 'rink-logos', false)
      on conflict (id) do nothing
    $sql$;
  else
    execute $sql$
      insert into storage.buckets (id, name)
      values ('rink-logos', 'rink-logos')
      on conflict (id) do nothing
    $sql$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- storage.objects RLS for this bucket only.
--
-- Path layout: '<facility_uuid>/<file_name>'. The first segment IS the
-- facility id, so (storage.foldername(name))[1] scopes reads to the caller's
-- facility — a session can never read (or sign a URL for) another facility's
-- logo object.
--
-- Writes are restricted to service-role: the logo upload/replace/remove server
-- actions verify the module-scoped ice_depth admin grant first and then use
-- the service-role client, so ordinary authenticated callers (staff included)
-- have NO write path — enforced here, not by hiding the edit UI.
-- -----------------------------------------------------------------------------
drop policy if exists rink_logos_select on storage.objects;
create policy rink_logos_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'rink-logos'
    and (
      public.is_super_admin()
      or (storage.foldername(name))[1]::uuid = public.current_facility_id()
    )
  );

drop policy if exists rink_logos_insert on storage.objects;
create policy rink_logos_insert
  on storage.objects
  for insert to authenticated
  with check (false);

drop policy if exists rink_logos_update on storage.objects;
create policy rink_logos_update
  on storage.objects
  for update to authenticated
  using (false);

drop policy if exists rink_logos_delete on storage.objects;
create policy rink_logos_delete
  on storage.objects
  for delete to authenticated
  using (bucket_id = 'rink-logos' and public.is_super_admin());
