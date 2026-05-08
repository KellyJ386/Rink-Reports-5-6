-- =============================================================================
-- 00000000000019_export_settings.sql
-- Per-facility PDF / export configuration.
-- =============================================================================

create table if not exists public.export_settings (
  id                    uuid primary key default gen_random_uuid(),
  facility_id           uuid not null unique references public.facilities(id) on delete restrict,
  logo_url              text,
  header_text           text,
  footer_text           text,
  paper_size            text not null default 'letter',
  include_facility_name boolean not null default true,
  include_date          boolean not null default true,
  include_submitted_by  boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  constraint export_settings_paper_size_check
    check (paper_size in ('letter','a4'))
);

comment on table public.export_settings is
  'Per-facility PDF/export branding and layout preferences.';

drop trigger if exists trg_export_settings_updated_at on public.export_settings;
create trigger trg_export_settings_updated_at
  before update on public.export_settings
  for each row execute function public.set_updated_at();

alter table public.export_settings enable row level security;

drop policy if exists export_settings_select on public.export_settings;
create policy export_settings_select on public.export_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists export_settings_insert on public.export_settings;
create policy export_settings_insert on public.export_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin','gm','super_admin')
    )
  );

drop policy if exists export_settings_update on public.export_settings;
create policy export_settings_update on public.export_settings
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

drop policy if exists export_settings_delete on public.export_settings;
create policy export_settings_delete on public.export_settings
  for delete to authenticated
  using (public.is_super_admin());
