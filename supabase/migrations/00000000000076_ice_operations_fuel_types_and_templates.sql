-- =============================================================================
-- 00000000000075_ice_operations_fuel_types_and_templates.sql
-- Ice Operations: add admin-configurable fuel types for resurfacers and
-- dynamic circle-check templates (up to four per facility, one per fuel type).
--
-- Extends the existing ice_operations_* family. Backwards compatible with the
-- legacy ice_operations_circle_check_items checklist (used as a fallback when
-- an equipment row has no fuel_type_id assigned, or no template exists for its
-- fuel type).
--
-- Tables added:
--   ice_operations_fuel_types
--   ice_operations_circle_check_templates
--   ice_operations_circle_check_template_items
--
-- Columns added:
--   ice_operations_equipment.fuel_type_id  -> ice_operations_fuel_types(id)
--
-- RLS mirrors the existing config-table pattern (see migration 13).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ice_operations_fuel_types
-- Admin-definable per-facility fuel types (e.g. Electric, Gas, Propane).
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_fuel_types (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint ice_operations_fuel_types_facility_slug_uniq
    unique (facility_id, slug)
);

comment on table public.ice_operations_fuel_types is
  'Ice Operations: per-facility ice-resurfacer fuel types (e.g. Electric, Gas). Admin-controlled. Each row may anchor at most one circle-check template (ice_operations_circle_check_templates).';

create index if not exists idx_ice_operations_fuel_types_facility_active_sort
  on public.ice_operations_fuel_types (facility_id, is_active, sort_order);

drop trigger if exists trg_ice_operations_fuel_types_updated_at on public.ice_operations_fuel_types;
create trigger trg_ice_operations_fuel_types_updated_at
  before update on public.ice_operations_fuel_types
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. ice_operations_equipment.fuel_type_id
-- Links equipment to a fuel type. Nullable for backwards compatibility.
-- -----------------------------------------------------------------------------
alter table public.ice_operations_equipment
  add column if not exists fuel_type_id uuid
    references public.ice_operations_fuel_types(id) on delete set null;

create index if not exists idx_ice_operations_equipment_fuel_type
  on public.ice_operations_equipment (fuel_type_id);

-- -----------------------------------------------------------------------------
-- 3. ice_operations_circle_check_templates
-- One template per fuel type per facility. The application caps the total
-- template count at 4 per facility (enforced in admin actions).
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_circle_check_templates (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  fuel_type_id  uuid not null references public.ice_operations_fuel_types(id)
                  on delete cascade,
  name          text not null,
  description   text,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint ice_operations_circle_check_templates_facility_fuel_uniq
    unique (facility_id, fuel_type_id)
);

comment on table public.ice_operations_circle_check_templates is
  'Ice Operations: circle-check templates keyed by fuel type. At most one template per (facility, fuel_type). Application caps total templates at 4 per facility.';

create index if not exists idx_ice_operations_circle_check_templates_facility_active_sort
  on public.ice_operations_circle_check_templates (facility_id, is_active, sort_order);

drop trigger if exists trg_ice_operations_circle_check_templates_updated_at on public.ice_operations_circle_check_templates;
create trigger trg_ice_operations_circle_check_templates_updated_at
  before update on public.ice_operations_circle_check_templates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. ice_operations_circle_check_template_items
-- Custom checklist fields owned by a template.
-- -----------------------------------------------------------------------------
create table if not exists public.ice_operations_circle_check_template_items (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  template_id  uuid not null references public.ice_operations_circle_check_templates(id)
                 on delete cascade,
  label        text not null,
  description  text,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.ice_operations_circle_check_template_items is
  'Ice Operations: per-template checklist fields. Filled in by the operator during a circle check. Results land in ice_operations_circle_check_results with checklist_item_id=null and label_snapshot preserved.';

create index if not exists idx_ice_operations_circle_check_template_items_template_active_sort
  on public.ice_operations_circle_check_template_items (template_id, is_active, sort_order);

drop trigger if exists trg_ice_operations_circle_check_template_items_updated_at on public.ice_operations_circle_check_template_items;
create trigger trg_ice_operations_circle_check_template_items_updated_at
  before update on public.ice_operations_circle_check_template_items
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security
-- Mirrors the config-table pattern from migration 13.
-- =============================================================================
alter table public.ice_operations_fuel_types                        enable row level security;
alter table public.ice_operations_circle_check_templates            enable row level security;
alter table public.ice_operations_circle_check_template_items       enable row level security;

-- ice_operations_fuel_types --------------------------------------------------
drop policy if exists ice_operations_fuel_types_select on public.ice_operations_fuel_types;
create policy ice_operations_fuel_types_select on public.ice_operations_fuel_types
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_fuel_types_insert on public.ice_operations_fuel_types;
create policy ice_operations_fuel_types_insert on public.ice_operations_fuel_types
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_fuel_types_update on public.ice_operations_fuel_types;
create policy ice_operations_fuel_types_update on public.ice_operations_fuel_types
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_fuel_types_delete on public.ice_operations_fuel_types;
create policy ice_operations_fuel_types_delete on public.ice_operations_fuel_types
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

-- ice_operations_circle_check_templates --------------------------------------
drop policy if exists ice_operations_circle_check_templates_select on public.ice_operations_circle_check_templates;
create policy ice_operations_circle_check_templates_select on public.ice_operations_circle_check_templates
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_templates_insert on public.ice_operations_circle_check_templates;
create policy ice_operations_circle_check_templates_insert on public.ice_operations_circle_check_templates
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_templates_update on public.ice_operations_circle_check_templates;
create policy ice_operations_circle_check_templates_update on public.ice_operations_circle_check_templates
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_templates_delete on public.ice_operations_circle_check_templates;
create policy ice_operations_circle_check_templates_delete on public.ice_operations_circle_check_templates
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

-- ice_operations_circle_check_template_items ---------------------------------
drop policy if exists ice_operations_circle_check_template_items_select on public.ice_operations_circle_check_template_items;
create policy ice_operations_circle_check_template_items_select on public.ice_operations_circle_check_template_items
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_template_items_insert on public.ice_operations_circle_check_template_items;
create policy ice_operations_circle_check_template_items_insert on public.ice_operations_circle_check_template_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_template_items_update on public.ice_operations_circle_check_template_items;
create policy ice_operations_circle_check_template_items_update on public.ice_operations_circle_check_template_items
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );

drop policy if exists ice_operations_circle_check_template_items_delete on public.ice_operations_circle_check_template_items;
create policy ice_operations_circle_check_template_items_delete on public.ice_operations_circle_check_template_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_operations')
    )
  );
