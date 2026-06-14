-- =============================================================================
-- 00000000000141_facility_spaces_shared_admin.sql
-- Make facility_spaces a shared, cross-module list. It now feeds the
-- space/location pickers in Incident Reports, Accident Reports, and Air Quality
-- and is managed from a dedicated /admin/spaces surface.
--
-- 1. Broaden write access: in addition to facility admins (and the incident
--    module admin added in migration 105), allow admins of the other consuming
--    modules (accident_reports, air_quality) to manage the shared list.
-- 2. Extend the default seed to the de-duped union of the historical incident
--    space defaults and the accident "location" dropdown defaults (plus a
--    generic "Other").
--
-- SELECT policy is unchanged (any same-facility user can read). Cross-facility
-- isolation is preserved: writes still require facility_id = current_facility_id().
-- =============================================================================

drop policy if exists facility_spaces_insert on public.facility_spaces;
create policy facility_spaces_insert on public.facility_spaces
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('incident_reports')
        or public.has_module_admin_access('accident_reports')
        or public.has_module_admin_access('air_quality')
      )
    )
  );

drop policy if exists facility_spaces_update on public.facility_spaces;
create policy facility_spaces_update on public.facility_spaces
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('incident_reports')
        or public.has_module_admin_access('accident_reports')
        or public.has_module_admin_access('air_quality')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('incident_reports')
        or public.has_module_admin_access('accident_reports')
        or public.has_module_admin_access('air_quality')
      )
    )
  );

drop policy if exists facility_spaces_delete on public.facility_spaces;
create policy facility_spaces_delete on public.facility_spaces
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('incident_reports')
        or public.has_module_admin_access('accident_reports')
        or public.has_module_admin_access('air_quality')
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Default seed: de-duped union of incident + accident location starter sets.
-- Idempotent via on conflict (facility_id, slug).
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
    (p_facility_id, 'Main Rink',   'main_rink',   1,  true),
    (p_facility_id, 'Lobby',       'lobby',       2,  true),
    (p_facility_id, 'Locker Room', 'locker_room', 3,  true),
    (p_facility_id, 'Pro Shop',    'pro_shop',    4,  true),
    (p_facility_id, 'Parking Lot', 'parking_lot', 5,  true),
    (p_facility_id, 'Ice Surface', 'ice_surface', 6,  true),
    (p_facility_id, 'Bench',       'bench',       7,  true),
    (p_facility_id, 'Concession',  'concession',  8,  true),
    (p_facility_id, 'Boardroom',   'boardroom',   9,  true),
    (p_facility_id, 'Other',       'other',       10, true)
  on conflict (facility_id, slug) do nothing;
end;
$$;

comment on function public.seed_default_facility_spaces(uuid) is
  'Seeds a generic starter set of facility spaces (shared across incident/accident/air-quality). Idempotent via on conflict do nothing on (facility_id, slug).';

revoke execute on function public.seed_default_facility_spaces(uuid) from public;
grant  execute on function public.seed_default_facility_spaces(uuid) to service_role;
