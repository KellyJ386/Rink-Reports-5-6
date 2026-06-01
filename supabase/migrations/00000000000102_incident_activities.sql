-- =============================================================================
-- 00000000000102_incident_activities.sql
-- Incident Activities: per-facility, admin-customizable "Activity at the time"
-- options for the Incident Report. Incident-owned (decoupled from the Accident
-- module's accident_dropdowns) so the Incident admin manages its own list.
--
-- The form's "Other" option is handled in the UI and stored as free text on
-- incident_reports.activity_other -- it is NOT a row here.
-- =============================================================================

create table if not exists public.incident_activities (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  key          text not null,
  display_name text not null,
  color        text,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint incident_activities_facility_key_uniq unique (facility_id, key)
);

comment on table public.incident_activities is
  'Incident Reports: per-facility customizable "activity at the time" options.';

create index if not exists idx_incident_activities_facility
  on public.incident_activities (facility_id);
create index if not exists idx_incident_activities_facility_active_sort
  on public.incident_activities (facility_id, is_active, sort_order);

drop trigger if exists trg_incident_activities_updated_at on public.incident_activities;
create trigger trg_incident_activities_updated_at
  before update on public.incident_activities
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Seed defaults helper (idempotent).
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_incident_activities(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.incident_activities (facility_id, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'public_skating',  'Public Skating',  1, true),
    (p_facility_id, 'hockey',          'Hockey',          2, true),
    (p_facility_id, 'figure_skating',  'Figure Skating',  3, true),
    (p_facility_id, 'learn_to_skate',  'Learn to Skate',  4, true),
    (p_facility_id, 'maintenance',     'Maintenance',     5, true)
  on conflict (facility_id, key) do nothing;
end;
$$;

comment on function public.seed_default_incident_activities(uuid) is
  'Seeds a generic starter set of incident activities. Idempotent via on conflict do nothing on (facility_id, key).';

revoke execute on function public.seed_default_incident_activities(uuid) from public;
grant  execute on function public.seed_default_incident_activities(uuid) to service_role;

-- =============================================================================
-- Row Level Security (mirror incident_types)
--   SELECT: super admin OR same-facility + module access.
--   INSERT/UPDATE/DELETE: super admin OR same-facility + module admin access.
-- =============================================================================
alter table public.incident_activities enable row level security;

drop policy if exists incident_activities_select on public.incident_activities;
create policy incident_activities_select on public.incident_activities
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('incident_reports')
    )
  );

drop policy if exists incident_activities_insert on public.incident_activities;
create policy incident_activities_insert on public.incident_activities
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

drop policy if exists incident_activities_update on public.incident_activities;
create policy incident_activities_update on public.incident_activities
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

drop policy if exists incident_activities_delete on public.incident_activities;
create policy incident_activities_delete on public.incident_activities
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );
