-- Phase 1: role-default storage + protect manual exceptions on user_permissions.
-- Source of truth for permission SEEDING (not resolution). Resolution stays on user_permissions.

-- 1) Editable per-role permission matrix, facility-isolated. Keyed to the user_action enum.
create table if not exists public.role_permission_defaults (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete cascade,
  module_name text not null,
  action      public.user_action not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (facility_id, role_id, module_name, action)
);

comment on table public.role_permission_defaults is
  'Editable per-role default permission matrix. apply_role_permission_defaults() seeds public.user_permissions from this. Replaces deprecated role_module_permission_defaults (migration 77).';

create index if not exists role_permission_defaults_role_idx
  on public.role_permission_defaults (facility_id, role_id);

-- keep updated_at fresh
create or replace function public.touch_role_permission_defaults()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_role_permission_defaults on public.role_permission_defaults;
create trigger trg_touch_role_permission_defaults
  before update on public.role_permission_defaults
  for each row execute function public.touch_role_permission_defaults();

-- RLS mirrors public.roles (the closest admin-config analog): facility-isolated read,
-- super_admin OR facility admin/gm manage.
alter table public.role_permission_defaults enable row level security;

drop policy if exists role_permission_defaults_select on public.role_permission_defaults;
create policy role_permission_defaults_select on public.role_permission_defaults
  for select using (is_super_admin() or facility_id = current_facility_id());

drop policy if exists role_permission_defaults_insert on public.role_permission_defaults;
create policy role_permission_defaults_insert on public.role_permission_defaults
  for insert with check (
    is_super_admin()
    or (facility_id = current_facility_id()
        and current_user_role() = any (array['admin','gm','super_admin']))
  );

drop policy if exists role_permission_defaults_update on public.role_permission_defaults;
create policy role_permission_defaults_update on public.role_permission_defaults
  for update using (
    is_super_admin()
    or (facility_id = current_facility_id()
        and current_user_role() = any (array['admin','gm','super_admin']))
  ) with check (
    is_super_admin()
    or (facility_id = current_facility_id()
        and current_user_role() = any (array['admin','gm','super_admin']))
  );

drop policy if exists role_permission_defaults_delete on public.role_permission_defaults;
create policy role_permission_defaults_delete on public.role_permission_defaults
  for delete using (
    is_super_admin()
    or (facility_id = current_facility_id()
        and current_user_role() = any (array['admin','gm','super_admin']))
  );

-- lock down grants like other public tables (RLS still applies)
revoke all on public.role_permission_defaults from anon;
grant select, insert, update, delete on public.role_permission_defaults to authenticated;

-- 2) Protect manual exceptions from re-seeding.
alter table public.user_permissions
  add column if not exists source text not null default 'role_default';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_permissions_source_check'
  ) then
    alter table public.user_permissions
      add constraint user_permissions_source_check
      check (source in ('role_default','manual_override'));
  end if;
end$$;

comment on column public.user_permissions.source is
  'role_default = written by apply_role_permission_defaults() and safe to re-seed; manual_override = hand-set by an admin and never clobbered by role re-seeding.';

-- Backfill the pre-existing rows as manual_override: they were hand-curated via the
-- admin grid (the only write path before this change), include a user with no role
-- linkage (cannot be reconciled to a role default), and must not be disturbed by
-- the Phase 4 backfill. New employees created after this get clean role_default rows.
update public.user_permissions set source = 'manual_override' where source = 'role_default';
