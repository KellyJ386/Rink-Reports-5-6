-- =============================================================================
-- 00000000000018_retention_settings.sql
-- Per-facility, per-module data retention configuration.
-- =============================================================================

create table if not exists public.retention_settings (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  module_key  text not null,
  keep_days   integer not null default 365,
  auto_purge  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint retention_settings_facility_module_uniq unique (facility_id, module_key),
  constraint retention_settings_keep_days_min check (keep_days >= 30)
);

comment on table public.retention_settings is
  'Per-facility, per-module retention rules. keep_days=0 means keep forever (disabled).';

create index if not exists idx_retention_settings_facility_id
  on public.retention_settings (facility_id);

drop trigger if exists trg_retention_settings_updated_at on public.retention_settings;
create trigger trg_retention_settings_updated_at
  before update on public.retention_settings
  for each row execute function public.set_updated_at();

alter table public.retention_settings enable row level security;

drop policy if exists retention_settings_select on public.retention_settings;
create policy retention_settings_select on public.retention_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists retention_settings_insert on public.retention_settings;
create policy retention_settings_insert on public.retention_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists retention_settings_update on public.retention_settings;
create policy retention_settings_update on public.retention_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists retention_settings_delete on public.retention_settings;
create policy retention_settings_delete on public.retention_settings
  for delete to authenticated
  using (public.is_super_admin());
