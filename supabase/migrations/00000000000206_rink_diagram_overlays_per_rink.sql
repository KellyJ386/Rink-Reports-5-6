-- =============================================================================
-- 00000000000206_rink_diagram_overlays_per_rink.sql
--
-- Ice Depth diagram overlays (migration 199) were scoped to the whole
-- FACILITY: one shared set of door markers and one logo config across every
-- physical sheet of ice. A facility with more than one rink (ice_depth_rinks
-- — e.g. "Main Rink" + "Oval Rink") needs door placements per PHYSICAL rink,
-- since the real Zamboni/access doors sit at different board positions on
-- each sheet. This migration re-scopes:
--
--   facility_door_markers        -> now belongs to one rink (rink_id)
--   facility_rink_diagram_config -> now one row per RINK, not per facility
--
-- facility_door_types stays facility-level on purpose: it is a shared naming
-- / color vocabulary ("Zamboni Door", "Access Door", ...) an admin defines
-- once, not a physical placement — every rink in the facility picks from the
-- same list.
--
-- Backfill: existing rows (there is no per-report data riding on this yet —
-- Ice Depth reports render overlays live from current config, never a
-- snapshot) move to the facility's default rink (is_default = true), falling
-- back to the first active rink by sort_order — same resolution order the
-- staff module already uses to auto-open a rink (migration 83's "auto-open
-- default"). A facility with markers/config but zero rinks (should not exist
-- — layouts require a rink) has those rows deleted rather than left dangling,
-- since there is nothing sensible to attach them to.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Composite unique target for the new cross-table FKs, mirroring
-- facility_door_types_id_facility_uniq (migration 199) — pins a marker's or
-- config's rink to the SAME facility, so neither can ever reference another
-- tenant's rink.
-- -----------------------------------------------------------------------------
alter table public.ice_depth_rinks
  add constraint ice_depth_rinks_id_facility_uniq unique (id, facility_id);

-- -----------------------------------------------------------------------------
-- 1. facility_door_markers.rink_id
-- -----------------------------------------------------------------------------
alter table public.facility_door_markers
  add column if not exists rink_id uuid;

-- Backfill: default-or-first-active rink per facility.
with target_rink as (
  select distinct on (facility_id)
    facility_id, id as rink_id
  from public.ice_depth_rinks
  order by facility_id, is_default desc, sort_order asc, name asc
)
update public.facility_door_markers m
   set rink_id = t.rink_id
  from target_rink t
 where m.facility_id = t.facility_id
   and m.rink_id is null;

-- No sensible rink to attach to (facility has markers but zero rinks) —
-- delete rather than leave an orphan that the NOT NULL below would reject.
delete from public.facility_door_markers
 where rink_id is null;

alter table public.facility_door_markers
  alter column rink_id set not null;

alter table public.facility_door_markers
  add constraint facility_door_markers_rink_same_facility_fkey
    foreign key (rink_id, facility_id)
    references public.ice_depth_rinks (id, facility_id)
    on delete cascade;

create index if not exists idx_facility_door_markers_rink
  on public.facility_door_markers (rink_id);

comment on column public.facility_door_markers.rink_id is
  'Which physical sheet of ice (ice_depth_rinks) this door marker belongs to. Pinned to the same facility as facility_id via a composite FK. Doors are placed per rink — each sheet of ice has its own physical door layout.';

-- -----------------------------------------------------------------------------
-- 2. facility_rink_diagram_config: one row per RINK, not per facility.
-- -----------------------------------------------------------------------------
alter table public.facility_rink_diagram_config
  add column if not exists rink_id uuid;

with target_rink as (
  select distinct on (facility_id)
    facility_id, id as rink_id
  from public.ice_depth_rinks
  order by facility_id, is_default desc, sort_order asc, name asc
)
update public.facility_rink_diagram_config c
   set rink_id = t.rink_id
  from target_rink t
 where c.facility_id = t.facility_id
   and c.rink_id is null;

delete from public.facility_rink_diagram_config
 where rink_id is null;

alter table public.facility_rink_diagram_config
  alter column rink_id set not null;

alter table public.facility_rink_diagram_config
  add constraint facility_rink_diagram_config_rink_same_facility_fkey
    foreign key (rink_id, facility_id)
    references public.ice_depth_rinks (id, facility_id)
    on delete cascade;

-- One logo config per RINK now (was per facility) — drop the old uniqueness,
-- add the new one. A facility with N rinks may now have up to N logo configs.
alter table public.facility_rink_diagram_config
  drop constraint facility_rink_diagram_config_facility_uniq;

alter table public.facility_rink_diagram_config
  add constraint facility_rink_diagram_config_rink_uniq unique (rink_id);

comment on table public.facility_rink_diagram_config is
  'Ice Depth diagram overlays: per-RINK (physical sheet of ice) center-ice logo watermark config — one row per ice_depth_rinks row, not per facility (migration 206). logo_storage_path points into the private rink-logos bucket (''<facility_id>/<file>''). logo_position_x/y are fractional [0,1] in the shared diagram coordinate space; logo_scale is a fraction of diagram width; logo_opacity defaults to watermark level (0.15). Rendered BELOW door markers and depth points so it never obscures data.';
comment on column public.facility_rink_diagram_config.rink_id is
  'Which physical sheet of ice (ice_depth_rinks) this logo config belongs to. Pinned to the same facility as facility_id via a composite FK. One row per rink (unique).';

-- RLS is unchanged: both tables still gate SELECT on
-- has_module_access('ice_depth') and writes on has_module_admin_access
-- ('ice_depth'), scoped by facility_id (migration 199) — rink_id narrows
-- WHICH rink's rows a query targets, but not who may read/write them.
