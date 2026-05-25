-- =============================================================================
-- 00000000000083_ice_depth_rinks.sql
-- Ice Depth: physical "rinks" (sheets of ice) within a facility.
--
-- Until now an ice_depth_layout WAS the unit a staff member picked. Facilities
-- with more than one sheet of ice need a layer above the diagram: the rink. A
-- rink is a physical sheet; a layout/diagram is a measurement-point template
-- used on a rink. The staff submission UI now cascades rink -> diagram.
--
--   ice_depth_rinks            (per facility; one may be flagged is_default)
--   ice_depth_layouts.rink_id  (which rink a diagram belongs to)
--   ice_depth_layouts.is_default (default diagram WITHIN its rink)
--
-- "Auto-open default" resolution (app side, with fallback):
--   default rink   = the rink flagged is_default, else first active by sort.
--   default diagram = within that rink, the layout flagged is_default, else
--                     first active by sort.
--
-- Backfill: every facility that already has layouts gets a seeded "Main Rink"
-- (default), all its existing layouts are assigned to it, and one diagram per
-- rink is flagged the default.
--
-- RLS mirrors ice_depth_layouts: SELECT for same-facility module access,
-- write for same-facility module admin access (or super_admin).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ice_depth_rinks
-- -----------------------------------------------------------------------------
create table if not exists public.ice_depth_rinks (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint ice_depth_rinks_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.ice_depth_rinks is
  'Ice Depth: physical sheets of ice within a facility. Staff pick a rink, then a diagram (ice_depth_layouts.rink_id) on that rink. At most one rink per facility may be is_default (partial unique index).';
comment on column public.ice_depth_rinks.is_default is
  'At most one per facility (partial unique index). The staff module auto-opens this rink''s default diagram; falls back to the first active rink when unset.';

create index if not exists idx_ice_depth_rinks_facility_active_sort
  on public.ice_depth_rinks (facility_id, is_active, sort_order);

-- At most one default rink per facility.
create unique index if not exists idx_ice_depth_rinks_one_default_per_facility
  on public.ice_depth_rinks (facility_id)
  where is_default;

drop trigger if exists trg_ice_depth_rinks_updated_at on public.ice_depth_rinks;
create trigger trg_ice_depth_rinks_updated_at
  before update on public.ice_depth_rinks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. ice_depth_layouts: belong to a rink; one may be the rink's default diagram
-- -----------------------------------------------------------------------------
alter table public.ice_depth_layouts
  add column if not exists rink_id uuid references public.ice_depth_rinks(id) on delete restrict;

alter table public.ice_depth_layouts
  add column if not exists is_default boolean not null default false;

comment on column public.ice_depth_layouts.rink_id is
  'The rink (sheet of ice) this diagram belongs to. Null only transiently before assignment; the app requires a rink at create time.';
comment on column public.ice_depth_layouts.is_default is
  'At most one per rink (partial unique index). The default diagram opened when staff select this rink; falls back to the first active diagram when unset.';

create index if not exists idx_ice_depth_layouts_rink
  on public.ice_depth_layouts (rink_id);

-- At most one default diagram per rink.
create unique index if not exists idx_ice_depth_layouts_one_default_per_rink
  on public.ice_depth_layouts (rink_id)
  where is_default;

-- -----------------------------------------------------------------------------
-- 3. Backfill existing data
-- -----------------------------------------------------------------------------

-- Seed a default "Main Rink" for every facility that already has layouts.
insert into public.ice_depth_rinks (facility_id, name, slug, sort_order, is_active, is_default)
select distinct l.facility_id, 'Main Rink', 'main-rink', 0, true, true
from public.ice_depth_layouts l
on conflict (facility_id, slug) do nothing;

-- Assign existing layouts to their facility's seeded default rink.
update public.ice_depth_layouts l
set rink_id = r.id
from public.ice_depth_rinks r
where r.facility_id = l.facility_id
  and r.slug = 'main-rink'
  and l.rink_id is null;

-- Flag one default diagram per rink (prefer active, then lowest sort_order, then name).
update public.ice_depth_layouts l
set is_default = true
where l.id in (
  select distinct on (rink_id) id
  from public.ice_depth_layouts
  where rink_id is not null
  order by rink_id, is_active desc, sort_order asc, name asc
);

-- =============================================================================
-- Row Level Security (mirrors ice_depth_layouts)
-- =============================================================================
alter table public.ice_depth_rinks enable row level security;

drop policy if exists ice_depth_rinks_select on public.ice_depth_rinks;
create policy ice_depth_rinks_select on public.ice_depth_rinks
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth')
    )
  );

drop policy if exists ice_depth_rinks_insert on public.ice_depth_rinks;
create policy ice_depth_rinks_insert on public.ice_depth_rinks
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );

drop policy if exists ice_depth_rinks_update on public.ice_depth_rinks;
create policy ice_depth_rinks_update on public.ice_depth_rinks
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

drop policy if exists ice_depth_rinks_delete on public.ice_depth_rinks;
create policy ice_depth_rinks_delete on public.ice_depth_rinks
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('ice_depth')
    )
  );
