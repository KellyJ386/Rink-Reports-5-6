-- =============================================================================
-- 00000000000257_dasher_boards_segment_labels.sql
--
-- Dasher Boards: fully custom segment labeling, zones, aliases, new segment
-- types, and label-snapshot history.
--
-- No two rinks label their glass the same way and no industry standard exists,
-- so the module gains a facility-authored DISPLAY layer over the permanent
-- identity labels — the same product decision as glass numbering (migration
-- 233), generalized to every perimeter asset:
--
--   * custom_label — what THIS facility calls the segment ("Zam Gate Left",
--     "N-3"). Display-only: `label` (B12/G12/D3) remains permanent identity,
--     issue history follows the asset id forever, and renaming never breaks or
--     reattributes history. Unique per rink, case-insensitively.
--   * aliases — alternate names for search ("the Zam gate glass").
--   * zones — an admin-configurable per-rink grouping list (seeded with the
--     standard seven: ends / sides / benches / penalty boxes), referenced by
--     assets through a composite FK so a zone can never come from another rink.
--   * new asset types: corner_radius and post_gap join board_panel /
--     glass_panel / door as positioned perimeter segments.
--   * board panels may now carry the physical spec (material/dimensions) —
--     the glass_* spec columns are generalized to "the segment's panel spec",
--     and the material domain gains 'hdpe' and 'other'.
--   * out_of_service — an explicit operator-set status, distinct from the
--     severity rollup derived from open issues and from is_active retirement.
--
-- History correctness invariants (DB-enforced, not app-enforced):
--   * dasher_boards_issues.label_snapshot / dasher_boards_asset_checks
--     .label_snapshot record the display label AT LOG TIME (BEFORE INSERT
--     trigger, server-derived — any client-supplied value is overwritten), so
--     historical reports read correctly after renames. Frozen on update by the
--     existing column guards.
--   * custom_label changes and out_of_service flips ALWAYS write a
--     dasher_boards_asset_events row (AFTER UPDATE trigger) — no silent
--     relabel, no silent status write.
--
-- SECURITY DEFINER functions introduced here (flagged per module spec):
--   * public.seed_default_dasher_boards_zones(uuid) + its rink trigger —
--     mirrors seed_default_dasher_boards_config (migration 194); internal-only
--     execute (service_role).
--   * public.dasher_boards_assets_log_display_events() — trigger-only audit
--     insert. The asset_events INSERT policy is admin-only, but out_of_service
--     is deliberately writable by the edit tier (a status change is the
--     "supervisor+" concern); the automatic audit row must therefore bypass
--     that policy. It inserts ONLY the derived event for the row transition it
--     observed — callers cannot pass it arbitrary data. Execute revoked from
--     public.
--
-- Permission tiers are unchanged (migration 192 mapping): view = read,
-- submit = staff logging, edit = status changes (now including
-- out_of_service), admin = structure/labels/zones. The assets column guard is
-- restated below to freeze custom_label/aliases/zone_id for the edit tier
-- while admitting out_of_service — a newly added column is edit-writable
-- unless the guard names it (the migration 233 lesson).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. dasher_boards_zones — admin-configurable per-rink grouping list
-- -----------------------------------------------------------------------------

-- Same-facility pinning target (the migration-207 ice_depth_rinks pattern):
-- child tables pin (rink_id, facility_id) against this so a row whose
-- facility_id passes the RLS check can never smuggle in ANOTHER tenant's
-- rink_id — without it, a facility-A module admin could insert a zone (or
-- retarget an asset) onto facility B's rink and squat B's per-rink uniqueness
-- domains (zone names, labels, sequence positions).
alter table public.dasher_boards_rinks
  drop constraint if exists dasher_boards_rinks_id_facility_uniq;
alter table public.dasher_boards_rinks
  add constraint dasher_boards_rinks_id_facility_uniq unique (id, facility_id);

create table if not exists public.dasher_boards_zones (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  rink_id      uuid not null references public.dasher_boards_rinks(id) on delete restrict,
  name         text not null,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint dasher_boards_zones_rink_name_uniq unique (rink_id, name),
  -- Target for the assets composite FK: pins a zone reference to its own rink.
  constraint dasher_boards_zones_id_rink_uniq unique (id, rink_id),
  constraint dasher_boards_zones_name_shape check (
    name = btrim(name) and char_length(name) between 1 and 60
  )
);

comment on table public.dasher_boards_zones is
  'Dasher Boards: admin-configurable perimeter zones per rink (North End, Home Bench, …), seeded with a standard set on rink creation. Assets reference a zone of their own rink via a composite FK. Display/grouping only — position order remains sequence_position.';

-- A zone's rink must belong to the zone's own facility (tenant pinning — the
-- RLS policies validate facility_id against the caller, this closes rink_id).
alter table public.dasher_boards_zones
  drop constraint if exists dasher_boards_zones_rink_same_facility_fkey;
alter table public.dasher_boards_zones
  add constraint dasher_boards_zones_rink_same_facility_fkey
    foreign key (rink_id, facility_id)
    references public.dasher_boards_rinks (id, facility_id);

create index if not exists idx_dasher_boards_zones_rink_active_sort
  on public.dasher_boards_zones (rink_id, is_active, sort_order);

drop trigger if exists trg_dasher_boards_zones_updated_at on public.dasher_boards_zones;
create trigger trg_dasher_boards_zones_updated_at
  before update on public.dasher_boards_zones
  for each row execute function public.set_updated_at();

-- RLS: config-table pattern (read = module view, write = module admin).
alter table public.dasher_boards_zones enable row level security;

drop policy if exists dasher_boards_zones_select on public.dasher_boards_zones;
create policy dasher_boards_zones_select on public.dasher_boards_zones
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_zones_insert on public.dasher_boards_zones;
create policy dasher_boards_zones_insert on public.dasher_boards_zones
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_zones_update on public.dasher_boards_zones;
create policy dasher_boards_zones_update on public.dasher_boards_zones
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_zones_delete on public.dasher_boards_zones;
create policy dasher_boards_zones_delete on public.dasher_boards_zones
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

-- -----------------------------------------------------------------------------
-- 2. Zone seeding: standard seven per rink, auto-run on rink creation
--    (mirrors seed_default_dasher_boards_config, migration 194).
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_dasher_boards_zones(p_rink_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
begin
  select r.facility_id into v_facility_id
    from public.dasher_boards_rinks r
   where r.id = p_rink_id;

  if v_facility_id is null then
    return;
  end if;

  insert into public.dasher_boards_zones (facility_id, rink_id, name, sort_order)
  select v_facility_id, p_rink_id, z.name, z.sort_order
  from (values
    ('North End', 0),
    ('South End', 1),
    ('East Side', 2),
    ('West Side', 3),
    ('Home Bench', 4),
    ('Visitor Bench', 5),
    ('Penalty Boxes', 6)
  ) as z(name, sort_order)
  on conflict (rink_id, name) do nothing;
end;
$$;

comment on function public.seed_default_dasher_boards_zones(uuid) is
  'Seeds the standard seven perimeter zones for a Dasher Boards rink. Idempotent (on conflict do nothing). Internal-only execute, mirroring seed_default_dasher_boards_config.';

revoke execute on function public.seed_default_dasher_boards_zones(uuid) from public;
grant  execute on function public.seed_default_dasher_boards_zones(uuid) to service_role;

create or replace function public.tg_seed_dasher_boards_zones()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_dasher_boards_zones(new.id);
  return new;
end;
$$;

revoke execute on function public.tg_seed_dasher_boards_zones() from public;

drop trigger if exists dasher_boards_rinks_seed_zones on public.dasher_boards_rinks;
create trigger dasher_boards_rinks_seed_zones
  after insert on public.dasher_boards_rinks
  for each row execute function public.tg_seed_dasher_boards_zones();

-- Backfill every existing rink.
do $$
declare
  r record;
begin
  for r in select id from public.dasher_boards_rinks loop
    perform public.seed_default_dasher_boards_zones(r.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Assets: custom_label / aliases / zone_id / out_of_service
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_assets
  add column if not exists custom_label   text,
  add column if not exists aliases        text[] not null default '{}'::text[],
  add column if not exists zone_id        uuid,
  add column if not exists out_of_service boolean not null default false;

comment on column public.dasher_boards_assets.custom_label is
  'The facility''s own name for this segment ("Zam Gate Left", "N-3"). DISPLAY ONLY — `label` remains permanent identity and is what issue history follows; renaming writes a `relabeled` asset event and never touches history. NULL = display the permanent label (or the glass numbering scheme, which custom_label overrides when set). Unique per rink, case-insensitively.';
comment on column public.dasher_boards_assets.aliases is
  'Alternate search names for the segment ("the Zam gate glass"). Search-only; never displayed as the primary label.';
comment on column public.dasher_boards_assets.zone_id is
  'Optional perimeter zone (dasher_boards_zones) for grouping in the builder and reports. Composite FK pins it to a zone of the asset''s own rink.';
comment on column public.dasher_boards_assets.out_of_service is
  'Explicit operator-set status: the segment is present but out of service (e.g. glass removed pending replacement). Distinct from is_active (retired from the perimeter) and from the open-issue severity rollup. Every flip writes an asset event (trigger-enforced) — no silent status write.';

alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_custom_label_shape;
alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_custom_label_shape check (
    custom_label is null
    or (custom_label = btrim(custom_label) and char_length(custom_label) between 1 and 40)
  );

alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_aliases_shape;
alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_aliases_shape check (
    cardinality(aliases) <= 12
    and array_position(aliases, null) is null
    and array_position(aliases, '') is null
  );

-- Labels must be unambiguous within a rink (case-insensitive).
create unique index if not exists idx_dasher_boards_assets_custom_label_uniq
  on public.dasher_boards_assets (rink_id, lower(custom_label))
  where custom_label is not null;

-- A zone must belong to the asset's own rink (and therefore its facility).
-- ON DELETE SET NULL (zone_id) clears only the zone reference (PG15+ syntax).
alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_zone_same_rink;
alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_zone_same_rink
    foreign key (zone_id, rink_id)
    references public.dasher_boards_zones (id, rink_id)
    on delete set null (zone_id);

create index if not exists idx_dasher_boards_assets_zone
  on public.dasher_boards_assets (zone_id)
  where zone_id is not null;

-- An asset's rink must belong to the asset's own facility (tenant pinning,
-- closing the pre-existing gap the zone FK above would otherwise inherit: a
-- module admin's UPDATE passes RLS on facility_id alone, so without this a
-- facility-A asset could be retargeted onto facility B's rink and squat B's
-- label/position uniqueness domains).
alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_rink_same_facility_fkey;
alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_rink_same_facility_fkey
    foreign key (rink_id, facility_id)
    references public.dasher_boards_rinks (id, facility_id);

-- -----------------------------------------------------------------------------
-- 4. New segment types + generalized panel spec.
--    Widening an enumerated CHECK means DROP + ADD with the WHOLE list restated
--    (the migration 158/234 sharp edge); rls_isolation.sql inserts every
--    permitted value so a lost one fails CI.
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_asset_type_check;
alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_asset_type_check
    check (asset_type in ('board_panel', 'glass_panel', 'door', 'corner_radius', 'post_gap'));

alter table public.dasher_boards_asset_subtypes
  drop constraint if exists dasher_boards_asset_subtypes_asset_type_check;
alter table public.dasher_boards_asset_subtypes
  add constraint dasher_boards_asset_subtypes_asset_type_check
    check (asset_type in ('board_panel', 'glass_panel', 'door', 'corner_radius', 'post_gap'));

alter table public.dasher_boards_issue_categories
  drop constraint if exists dasher_boards_issue_categories_asset_type_check;
alter table public.dasher_boards_issue_categories
  add constraint dasher_boards_issue_categories_asset_type_check
    check (asset_type in ('board_panel', 'glass_panel', 'door', 'corner_radius', 'post_gap'));

-- corner_radius and post_gap are positioned segments like boards and doors;
-- glass rows still ride a parent position. The retired-asset relaxation
-- (migration 196) carries over: an inactive positioned asset may float.
alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_position_shape;
alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_position_shape check (
    (
      asset_type in ('board_panel', 'door', 'corner_radius', 'post_gap')
      and parent_board_id is null
      and (sequence_position is not null or is_active = false)
    )
    or (
      asset_type = 'glass_panel'
      and parent_board_id is not null
      and sequence_position is null
    )
  );

comment on constraint dasher_boards_assets_position_shape
  on public.dasher_boards_assets is
  'Active boards/doors/corner segments/post gaps are positioned; retired (is_active=false) ones float with a null position so the sequence gap can close without renumbering labels. Glass rows always ride their parent position.';

-- Boards (and the new types) may now carry the physical panel spec: the
-- glass_* columns generalize to "this segment's panel spec". Material domain
-- gains hdpe (board facing) and other.
alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_board_no_glass_spec;

alter table public.dasher_boards_assets
  drop constraint if exists dasher_boards_assets_glass_material_check;
alter table public.dasher_boards_assets
  add constraint dasher_boards_assets_glass_material_check
    check (glass_material in ('tempered', 'acrylic', 'polycarbonate', 'hdpe', 'other'));

comment on column public.dasher_boards_assets.glass_material is
  'Segment material. Historically glass-only (tempered/acrylic/polycarbonate); since migration 257 any segment may carry its panel spec, adding hdpe (board facing) and other. Column names keep the glass_ prefix for compatibility.';

-- -----------------------------------------------------------------------------
-- 5. Asset events: out-of-service transitions join the lifecycle audit domain.
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_asset_events
  drop constraint if exists dasher_boards_asset_events_event_type_check;
alter table public.dasher_boards_asset_events
  add constraint dasher_boards_asset_events_event_type_check
    check (event_type in (
      'created', 'converted_to_door', 'converted_to_board', 'relabeled',
      'deactivated', 'reactivated', 'glass_toggled', 'spec_updated',
      'renumbered', 'marked_out_of_service', 'returned_to_service'
    ));

-- Automatic audit rows for display-layer/status transitions. SECURITY DEFINER
-- (documented in the header): the events INSERT policy is admin-only, but
-- out_of_service is edit-tier writable; the audit row must not depend on the
-- caller's grant. Inserts only the derived event for the observed transition.
create or replace function public.dasher_boards_assets_log_display_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.custom_label is distinct from old.custom_label then
    insert into public.dasher_boards_asset_events
      (facility_id, asset_id, event_type, detail, employee_id)
    values (
      new.facility_id, new.id, 'relabeled',
      jsonb_build_object(
        'label_kind', 'custom_label',
        'old', old.custom_label,
        'new', new.custom_label
      ),
      public.current_employee_id()
    );
  end if;

  if new.out_of_service is distinct from old.out_of_service then
    insert into public.dasher_boards_asset_events
      (facility_id, asset_id, event_type, detail, employee_id)
    values (
      new.facility_id, new.id,
      case when new.out_of_service then 'marked_out_of_service'
           else 'returned_to_service' end,
      jsonb_build_object('out_of_service', new.out_of_service),
      public.current_employee_id()
    );
  end if;

  return new;
end;
$$;

comment on function public.dasher_boards_assets_log_display_events() is
  'AFTER UPDATE trigger on dasher_boards_assets: writes the mandatory asset event for every custom_label change (relabeled, detail.label_kind=custom_label) and every out_of_service flip (marked_out_of_service / returned_to_service). SECURITY DEFINER so the audit row does not depend on the caller''s asset_events INSERT grant (admin-only) — an edit-tier status change must still be audited. Trigger-only; execute revoked from public.';

revoke execute on function public.dasher_boards_assets_log_display_events() from public;

drop trigger if exists trg_dasher_boards_assets_log_display_events on public.dasher_boards_assets;
create trigger trg_dasher_boards_assets_log_display_events
  after update on public.dasher_boards_assets
  for each row
  when (old.custom_label is distinct from new.custom_label
        or old.out_of_service is distinct from new.out_of_service)
  execute function public.dasher_boards_assets_log_display_events();

-- -----------------------------------------------------------------------------
-- 6. Label snapshots: history reads the label AT LOG TIME.
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_issues
  add column if not exists label_snapshot text;
alter table public.dasher_boards_asset_checks
  add column if not exists label_snapshot text;

comment on column public.dasher_boards_issues.label_snapshot is
  'The asset''s display label (custom_label, else the permanent label) at the moment the issue was logged. Server-derived by trigger — client-supplied values are overwritten. NULL for checklist-target issues. Frozen on update by the issues column guard, so history reads correctly after renames.';
comment on column public.dasher_boards_asset_checks.label_snapshot is
  'The asset''s display label (custom_label, else the permanent label) at the moment the check was recorded. Server-derived by trigger — client-supplied values are overwritten. Frozen on update by the asset-checks guard.';

create or replace function public.dasher_boards_issues_snapshot_label()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.asset_id is not null then
    select coalesce(a.custom_label, a.label) into new.label_snapshot
      from public.dasher_boards_assets a
     where a.id = new.asset_id;
  else
    new.label_snapshot := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dasher_boards_issues_snapshot_label on public.dasher_boards_issues;
create trigger trg_dasher_boards_issues_snapshot_label
  before insert on public.dasher_boards_issues
  for each row execute function public.dasher_boards_issues_snapshot_label();

create or replace function public.dasher_boards_asset_checks_snapshot_label()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select coalesce(a.custom_label, a.label) into new.label_snapshot
    from public.dasher_boards_assets a
   where a.id = new.asset_id;
  return new;
end;
$$;

drop trigger if exists trg_dasher_boards_asset_checks_snapshot_label on public.dasher_boards_asset_checks;
create trigger trg_dasher_boards_asset_checks_snapshot_label
  before insert on public.dasher_boards_asset_checks
  for each row execute function public.dasher_boards_asset_checks_snapshot_label();

-- Backfill history with the permanent label (custom labels do not exist before
-- this migration, so it IS the label every historical record was logged
-- under). The guards (resolved-issue / completed-walk immutability) and
-- updated_at maintenance are disabled around the backfill so historical rows
-- keep their timestamps and locks.
alter table public.dasher_boards_issues disable trigger trg_dasher_boards_issues_guard;
alter table public.dasher_boards_issues disable trigger trg_dasher_boards_issues_updated_at;

update public.dasher_boards_issues i
   set label_snapshot = a.label
  from public.dasher_boards_assets a
 where i.asset_id = a.id
   and i.label_snapshot is null;

alter table public.dasher_boards_issues enable trigger trg_dasher_boards_issues_guard;
alter table public.dasher_boards_issues enable trigger trg_dasher_boards_issues_updated_at;

alter table public.dasher_boards_asset_checks disable trigger trg_dasher_boards_asset_checks_guard;
alter table public.dasher_boards_asset_checks disable trigger trg_dasher_boards_asset_checks_updated_at;

update public.dasher_boards_asset_checks c
   set label_snapshot = a.label
  from public.dasher_boards_assets a
 where c.asset_id = a.id
   and c.label_snapshot is null;

alter table public.dasher_boards_asset_checks enable trigger trg_dasher_boards_asset_checks_guard;
alter table public.dasher_boards_asset_checks enable trigger trg_dasher_boards_asset_checks_updated_at;

-- -----------------------------------------------------------------------------
-- 7. Issues column guard (restating migration 204's version + label_snapshot
--    in the frozen identity/linkage set).
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_issues_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_admin bool;
  v_is_edit  bool;
begin
  if public.dasher_boards_guard_exempt() then
    return new;
  end if;

  -- Resolved issues are immutable (carry-forward record).
  if old.resolved_at is not null then
    raise exception 'dasher_boards: resolved issues are immutable';
  end if;

  -- Identity / linkage columns are frozen for all non-exempt callers.
  if new.id                is distinct from old.id
     or new.facility_id       is distinct from old.facility_id
     or new.rink_id           is distinct from old.rink_id
     or new.asset_id          is distinct from old.asset_id
     or new.checklist_item_id is distinct from old.checklist_item_id
     or new.reported_by       is distinct from old.reported_by
     or new.inspection_id     is distinct from old.inspection_id
     or new.label_snapshot    is distinct from old.label_snapshot
     or new.created_at        is distinct from old.created_at
  then
    raise exception 'dasher_boards: issue identity/linkage columns are immutable';
  end if;

  v_is_admin := public.has_module_admin_access('dasher_boards');
  v_is_edit  := public.has_module_edit_access('dasher_boards');

  if v_is_admin then
    return new;
  end if;

  if v_is_edit then
    -- Supervisors (edit grant): ack / resolve / action_taken / supervisor
    -- reassignment only. Report content stays the reporter's.
    if new.description is distinct from old.description
       or new.category_id is distinct from old.category_id
       or new.severity    is distinct from old.severity
    then
      raise exception 'dasher_boards: edit grant may only change ack/resolution fields';
    end if;
    return new;
  end if;

  -- Submit tier (staff). RLS has already restricted the reachable rows.
  -- Path 1: resolving a non-A issue (mark fixed) — resolution fields only.
  if new.resolved_at is distinct from old.resolved_at
     or new.resolved_by is distinct from old.resolved_by
  then
    if old.severity = 'a' then
      raise exception 'dasher_boards: severity-A issues require a supervisor to resolve';
    end if;
    if new.description      is distinct from old.description
       or new.category_id      is distinct from old.category_id
       or new.severity         is distinct from old.severity
       or new.action_taken     is distinct from old.action_taken
       or new.supervisor_id    is distinct from old.supervisor_id
       or new.supervisor_ack_at is distinct from old.supervisor_ack_at
    then
      raise exception 'dasher_boards: resolving may change only the resolution fields';
    end if;
    return new;
  end if;

  -- Path 2: the reporter editing their own unresolved report (desc/category).
  if old.reported_by is distinct from public.current_employee_id() then
    raise exception 'dasher_boards: you may only edit issues you reported';
  end if;
  if new.severity          is distinct from old.severity
     or new.action_taken      is distinct from old.action_taken
     or new.supervisor_id     is distinct from old.supervisor_id
     or new.supervisor_ack_at is distinct from old.supervisor_ack_at
     or new.resolved_by       is distinct from old.resolved_by
     or new.resolved_at       is distinct from old.resolved_at
  then
    raise exception 'dasher_boards: reporters may only edit description/category on their own unresolved issues';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Asset-checks guard (restating migration 205's version + label_snapshot
--    in the frozen linkage set).
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_asset_checks_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inspection_id uuid;
  v_completed_at  timestamptz;
begin
  if public.dasher_boards_guard_exempt() then
    return coalesce(new, old);
  end if;

  v_inspection_id := case when tg_op = 'INSERT' then new.inspection_id else old.inspection_id end;

  select i.completed_at into v_completed_at
    from public.dasher_boards_inspections i
   where i.id = v_inspection_id;

  if v_completed_at is not null then
    raise exception 'dasher_boards: asset checks are immutable once the inspection is completed';
  end if;

  if tg_op = 'UPDATE' then
    if new.inspection_id is distinct from old.inspection_id
       or new.asset_id       is distinct from old.asset_id
       or new.facility_id    is distinct from old.facility_id
       or new.label_snapshot is distinct from old.label_snapshot
    then
      raise exception 'dasher_boards: asset-check linkage columns are immutable';
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Assets column guard (restating migration 233's version): freeze the new
--    display-layer columns for the edit tier, admit out_of_service (a status
--    change is exactly the edit tier's concern; the AFTER trigger above writes
--    the mandatory audit row).
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_assets_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.dasher_boards_guard_exempt() then
    return new;
  end if;

  -- Admins retain full write. This admin-first branch matters because the
  -- helpers have no hierarchy — an admin does NOT satisfy has_module_edit_access,
  -- so without it an admin would be caught by the edit-only freeze below.
  if public.has_module_admin_access('dasher_boards') then
    return new;
  end if;

  if public.has_module_edit_access('dasher_boards') then
    -- Edit tier (managers): the five spec columns + out_of_service only.
    -- `updated_at` is left free (the set_updated_at trigger maintains it).
    if new.id                is distinct from old.id
       or new.facility_id       is distinct from old.facility_id
       or new.rink_id           is distinct from old.rink_id
       or new.asset_type        is distinct from old.asset_type
       or new.subtype_id        is distinct from old.subtype_id
       or new.label             is distinct from old.label
       or new.custom_label      is distinct from old.custom_label
       or new.aliases           is distinct from old.aliases
       or new.zone_id           is distinct from old.zone_id
       or new.display_number    is distinct from old.display_number
       or new.sequence_position is distinct from old.sequence_position
       or new.parent_board_id   is distinct from old.parent_board_id
       or new.is_active         is distinct from old.is_active
       or new.created_at        is distinct from old.created_at
    then
      raise exception 'dasher_boards: edit grant may only change the panel spec and out-of-service status';
    end if;
    return new;
  end if;

  -- Neither exempt, admin, nor edit: the RLS row gate should already have
  -- blocked this, so a reachable raise here means a policy/guard drift.
  raise exception 'dasher_boards: not authorized to modify assets';
end;
$$;

comment on function public.dasher_boards_assets_guard() is
  'BEFORE UPDATE column guard on dasher_boards_assets: exempt roles and module admins may change any column; edit-tier (managers) may change ONLY the panel spec (glass_width_in/glass_height_in/glass_thickness_in/glass_material/spec_notes) and out_of_service; all else — label, custom_label, aliases, zone_id, display_number, structure — is rejected. Pairs with the admin-OR-edit UPDATE policy so edit-tier cannot rewrite structural/identity columns via a direct request.';

-- -----------------------------------------------------------------------------
-- 10. Seed additions (restating migration 204's seed function): the two door
--     subtypes the standard gate taxonomy was missing, and quick-pick issue
--     categories for the new segment types. Backfilled for existing facilities.
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_dasher_boards_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Door subtypes (the standard gate taxonomy: player/bench, scoreboard,
  -- spectator/public, machine/zamboni, penalty, emergency).
  insert into public.dasher_boards_asset_subtypes (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'door', s.label, s.sort_order
  from (values
    ('Bench', 0),
    ('Scoreboard', 1),
    ('Public Skate', 2),
    ('Zamboni', 3),
    ('Penalty', 4),
    ('Emergency', 5)
  ) as s(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: board panels (repair + cleaning).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'board_panel', c.label, c.sort_order
  from (values
    ('Facing damage', 0),
    ('Protruding/missing fastener', 1),
    ('Panel joint misalignment', 2),
    ('Kickplate damage', 3),
    ('Caprail damage', 4),
    ('Resurfacer impact', 5),
    ('Needs cleaning', 7),
    ('Debris/buildup', 8),
    ('Other', 9)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: glass panels (repair + cleaning).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'glass_panel', c.label, c.sort_order
  from (values
    ('Crack', 0),
    ('Chip/sharp edge', 1),
    ('Not seated/rattle', 2),
    ('Crazing at clamp', 3),
    ('Gasket damaged/missing', 4),
    ('Needs cleaning', 6),
    ('Film/residue', 7),
    ('Other', 8)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: doors (repair + cleaning).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'door', c.label, c.sort_order
  from (values
    ('Latch not holding', 0),
    ('Hinge/sag', 1),
    ('Not flush with board line', 2),
    ('Threshold damage', 3),
    ('Door glass damage', 4),
    ('Hardware protruding ice-side', 5),
    ('Needs cleaning', 7),
    ('Other', 8)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: corner radius segments (migration 257).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'corner_radius', c.label, c.sort_order
  from (values
    ('Facing damage', 0),
    ('Protruding/missing fastener', 1),
    ('Radius joint misalignment', 2),
    ('Needs cleaning', 3),
    ('Other', 4)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: post gaps (migration 257).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'post_gap', c.label, c.sort_order
  from (values
    ('Padding/trim damage', 0),
    ('Gap obstruction', 1),
    ('Other', 2)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;
end;
$$;

-- Backfill the new subtypes/categories for every existing facility. The seed
-- is idempotent (on conflict do nothing), so this only adds the missing rows.
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_dasher_boards_config(f.id);
  end loop;
end;
$$;

commit;
