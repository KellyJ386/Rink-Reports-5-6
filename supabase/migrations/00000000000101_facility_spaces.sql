-- =============================================================================
-- 00000000000101_facility_spaces.sql
-- Facility Spaces: shared, facility-wide list of physical areas/spaces.
--
-- Introduced for the Incident Report redesign (multi-select "Facility Space"),
-- but intentionally facility-level (not incident-scoped) so other modules
-- (e.g. accidents location) can adopt it later. Managed under the Facility
-- admin area; surfaced as a tab in the Incident Reports admin.
--
-- The form's "Other" option is NOT a row here -- it is handled in the UI and
-- stored as free text on the consuming report (e.g. incident_reports.location_other).
-- =============================================================================

create table if not exists public.facility_spaces (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint facility_spaces_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.facility_spaces is
  'Shared per-facility list of physical spaces/areas. Read by submission forms (incident reports, etc.); managed by facility admins.';

create index if not exists idx_facility_spaces_facility
  on public.facility_spaces (facility_id);
create index if not exists idx_facility_spaces_facility_active_sort
  on public.facility_spaces (facility_id, is_active, sort_order);

drop trigger if exists trg_facility_spaces_updated_at on public.facility_spaces;
create trigger trg_facility_spaces_updated_at
  before update on public.facility_spaces
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Seed defaults helper (idempotent). Invoked by app/admin at facility creation
-- or first activation. Generic starter set -- facilities customize from here.
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_facility_spaces(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.facility_spaces (facility_id, name, slug, sort_order, is_active)
  values
    (p_facility_id, 'Main Rink',   'main_rink',   1, true),
    (p_facility_id, 'Lobby',       'lobby',       2, true),
    (p_facility_id, 'Locker Room', 'locker_room', 3, true),
    (p_facility_id, 'Pro Shop',    'pro_shop',    4, true),
    (p_facility_id, 'Parking Lot', 'parking_lot', 5, true)
  on conflict (facility_id, slug) do nothing;
end;
$$;

comment on function public.seed_default_facility_spaces(uuid) is
  'Seeds a generic starter set of facility spaces. Idempotent via on conflict do nothing on (facility_id, slug).';

revoke execute on function public.seed_default_facility_spaces(uuid) from public;
grant  execute on function public.seed_default_facility_spaces(uuid) to service_role;

-- =============================================================================
-- Row Level Security
--   SELECT: super admin OR any same-facility authenticated user (shared list).
--   INSERT/UPDATE/DELETE: super admin OR facility admin.
-- =============================================================================
alter table public.facility_spaces enable row level security;

drop policy if exists facility_spaces_select on public.facility_spaces;
create policy facility_spaces_select on public.facility_spaces
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_spaces_insert on public.facility_spaces;
create policy facility_spaces_insert on public.facility_spaces
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.is_facility_admin(facility_id)
    )
  );

drop policy if exists facility_spaces_update on public.facility_spaces;
create policy facility_spaces_update on public.facility_spaces
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.is_facility_admin(facility_id)
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.is_facility_admin(facility_id)
    )
  );

drop policy if exists facility_spaces_delete on public.facility_spaces;
create policy facility_spaces_delete on public.facility_spaces
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.is_facility_admin(facility_id)
    )
  );
