-- =============================================================================
-- 00000000000144_facility_modules.sql
-- Per-facility module enable/disable switch (audit finding C4).
--
-- Until now every facility saw all modules in the staff nav; access was gated
-- only at the page/permission level, and there was no way for an admin to turn
-- a whole module off for their facility. This adds a small feature-flag table
-- that the nav reads at runtime.
--
-- Scope: this is a NAV/feature toggle, NOT an authorization boundary —
-- per-user access stays governed by user_permissions + the has_module_access
-- helpers. A disabled module is hidden from the staff nav; direct access is
-- still independently gated by RLS/permissions.
--
-- 1. facility_modules(facility_id, module_key, enabled) — one row per module
--    per facility, unique on (facility_id, module_key).
-- 2. RLS: any same-facility authenticated user may read; only facility admins
--    (or super admins) may write. Cross-facility isolation preserved.
-- 3. seed_default_facility_modules(p_facility_id): enables every canonical
--    module. Idempotent (on conflict do nothing). Internal-only execute
--    (revoked from public, granted to service_role), mirroring migration 135.
-- 4. AFTER INSERT trigger on facilities seeds it for every new facility.
-- 5. Backfill: enable all modules for every existing facility.
-- =============================================================================

create table if not exists public.facility_modules (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, module_key)
);

create index if not exists facility_modules_facility_id_idx
  on public.facility_modules (facility_id);

-- Keep updated_at fresh (set_updated_at is the project-wide trigger fn).
drop trigger if exists facility_modules_set_updated_at on public.facility_modules;
create trigger facility_modules_set_updated_at
  before update on public.facility_modules
  for each row execute function public.set_updated_at();

alter table public.facility_modules enable row level security;

-- Read: any authenticated user in the same facility (super admins see all).
drop policy if exists facility_modules_select on public.facility_modules;
create policy facility_modules_select on public.facility_modules
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- Write: facility admins (or super admins) only.
drop policy if exists facility_modules_insert on public.facility_modules;
create policy facility_modules_insert on public.facility_modules
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.is_facility_admin(facility_id))
  );

drop policy if exists facility_modules_update on public.facility_modules;
create policy facility_modules_update on public.facility_modules
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.is_facility_admin(facility_id))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.is_facility_admin(facility_id))
  );

drop policy if exists facility_modules_delete on public.facility_modules;
create policy facility_modules_delete on public.facility_modules
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id() and public.is_facility_admin(facility_id))
  );

-- -----------------------------------------------------------------------------
-- Seeder: enable every canonical module for a facility. Idempotent.
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_facility_modules(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.facility_modules (facility_id, module_key, enabled)
  select p_facility_id, k, true
  from (values
    ('daily_reports'),
    ('ice_depth'),
    ('ice_operations'),
    ('refrigeration'),
    ('air_quality'),
    ('incident_reports'),
    ('accident_reports'),
    ('scheduling'),
    ('communications'),
    ('facility_paperwork')
  ) as m(k)
  on conflict (facility_id, module_key) do nothing;
end;
$$;

comment on function public.seed_default_facility_modules(uuid) is
  'Seeds facility_modules with every canonical module enabled. Idempotent via on conflict do nothing on (facility_id, module_key).';

revoke execute on function public.seed_default_facility_modules(uuid) from public;
grant  execute on function public.seed_default_facility_modules(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Auto-seed on facility creation (trigger, so every insert path is covered).
-- -----------------------------------------------------------------------------
create or replace function public.tg_seed_facility_modules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_facility_modules(new.id);
  return new;
end;
$$;

revoke execute on function public.tg_seed_facility_modules() from public;

drop trigger if exists facilities_seed_modules on public.facilities;
create trigger facilities_seed_modules
  after insert on public.facilities
  for each row execute function public.tg_seed_facility_modules();

-- -----------------------------------------------------------------------------
-- Backfill: enable all modules for every existing facility.
-- -----------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_facility_modules(f.id);
  end loop;
end;
$$;
