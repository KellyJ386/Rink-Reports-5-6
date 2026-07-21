-- =============================================================================
-- 00000000000191_dasher_boards_schema.sql
-- Dasher Boards (module #11): spatial perimeter condition tracking.
--
-- A rink's perimeter is modeled as an ordered ring of typed assets — board
-- panels, glass panels, and doors — generated from facility-entered setup data
-- (nothing hardcoded). Staff tap problem assets to report issues (severity
-- a/b/c); open issues persist on the asset across days until resolved, so the
-- diagram is the live condition map. Daily inspection is exception-based: a
-- signed walk record attests that untapped assets are OK. Admin-configurable
-- cadenced checklist items (weekly/monthly/yearly; daily deliberately unseeded)
-- ride inside the walk flow and feed the same issue pipeline.
--
-- Product invariants encoded here:
--   * Labels are permanent identity; sequence_position is drawing order.
--     Inserting an asset NEVER renumbers existing assets; retired labels are
--     never reused (dasher_boards_retired_labels + triggers in migration 192).
--   * Doors are full-height assets and carry their own glass spec; the glass
--     row at a door's position is deactivated while the door exists.
--   * Glass-to-board mapping is 1:1 (glass rows carry parent_board_id and
--     inherit position); independent glass spans are out of scope.
--   * A completed inspection is immutable (policies + guard trigger, 192).
--
-- Scoping: facility -> dasher_boards_rinks -> assets/inspections/checklist.
-- Module-scoped rink table per house convention (mirrors ice_depth_rinks /
-- ice_operations_rinks; deliberate — no shared global rinks table exists).
-- RLS + guard triggers live in 00000000000192_dasher_boards_rls.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. dasher_boards_rinks — the perimeter's owner (a physical sheet of ice)
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_rinks (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null references public.facilities(id) on delete restrict,
  name                    text not null,
  slug                    text not null,
  rink_template           text not null default 'nhl_200x85'
                            check (rink_template in ('nhl_200x85', 'olympic_200x100', 'custom')),
  custom_length_ft        numeric,
  custom_width_ft         numeric,
  perimeter_anchor_label  text,
  perimeter_direction     text not null default 'clockwise'
                            check (perimeter_direction in ('clockwise', 'counterclockwise')),
  inspection_weekday      int not null default 1
                            check (inspection_weekday between 0 and 6),
  sort_order              int not null default 0,
  is_active               boolean not null default true,
  is_default              boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz,
  constraint dasher_boards_rinks_facility_slug_uniq unique (facility_id, slug),
  constraint dasher_boards_rinks_custom_dims check (
    (rink_template = 'custom' and custom_length_ft > 0 and custom_width_ft > 0)
    or (rink_template <> 'custom' and custom_length_ft is null and custom_width_ft is null)
  )
);

comment on table public.dasher_boards_rinks is
  'Dasher Boards: physical sheets of ice within a facility, each owning one ordered perimeter of assets. perimeter_anchor_label names where sequence position 1 starts (e.g. "Zamboni gate"); perimeter_direction is the drawing order around the boundary. inspection_weekday (0=Sun..6=Sat) is the day weekly checklist items come due.';
comment on column public.dasher_boards_rinks.inspection_weekday is
  '0=Sunday .. 6=Saturday (JS Date.getDay convention). Weekly checklist items come due on this weekday. Default Monday.';

create index if not exists idx_dasher_boards_rinks_facility_active_sort
  on public.dasher_boards_rinks (facility_id, is_active, sort_order);

create unique index if not exists idx_dasher_boards_rinks_one_default_per_facility
  on public.dasher_boards_rinks (facility_id)
  where is_default;

drop trigger if exists trg_dasher_boards_rinks_updated_at on public.dasher_boards_rinks;
create trigger trg_dasher_boards_rinks_updated_at
  before update on public.dasher_boards_rinks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. dasher_boards_asset_subtypes — admin-managed (doors only in v1)
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_asset_subtypes (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  asset_type   text not null check (asset_type in ('board_panel', 'glass_panel', 'door')),
  label        text not null,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint dasher_boards_asset_subtypes_uniq unique (facility_id, asset_type, label)
);

comment on table public.dasher_boards_asset_subtypes is
  'Dasher Boards: admin-managed asset subtypes (e.g. door subtypes: Bench, Scoreboard, Public Skate, Zamboni). Keyed by asset_type so the same table can serve other types later; v1 only assigns subtypes to doors.';

drop trigger if exists trg_dasher_boards_asset_subtypes_updated_at on public.dasher_boards_asset_subtypes;
create trigger trg_dasher_boards_asset_subtypes_updated_at
  before update on public.dasher_boards_asset_subtypes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. dasher_boards_checklist_items — admin-managed cadenced items (per rink)
--    (created before dasher_boards_issues, which references it)
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  rink_id      uuid not null references public.dasher_boards_rinks(id) on delete restrict,
  label        text not null,
  cadence      text not null check (cadence in ('daily', 'weekly', 'monthly', 'yearly')),
  due_month    int check (due_month between 1 and 12),
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint dasher_boards_checklist_items_rink_label_uniq unique (rink_id, label),
  constraint dasher_boards_checklist_items_due_month_iff_yearly check (
    (cadence = 'yearly' and due_month is not null)
    or (cadence <> 'yearly' and due_month is null)
  )
);

comment on table public.dasher_boards_checklist_items is
  'Dasher Boards: admin-managed cadenced inspection checklist items. Due items surface when a walk starts; walk completion requires all due items answered. Flagged items create issues in the same pipeline as spatial issues (no diagram dot). The daily cadence ships unseeded by design — the spatial exception model carries daily.';

create index if not exists idx_dasher_boards_checklist_items_rink_active_sort
  on public.dasher_boards_checklist_items (rink_id, is_active, sort_order);

drop trigger if exists trg_dasher_boards_checklist_items_updated_at on public.dasher_boards_checklist_items;
create trigger trg_dasher_boards_checklist_items_updated_at
  before update on public.dasher_boards_checklist_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. dasher_boards_assets — the perimeter: board panels, glass panels, doors
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_assets (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities(id) on delete restrict,
  rink_id            uuid not null references public.dasher_boards_rinks(id) on delete restrict,
  asset_type         text not null check (asset_type in ('board_panel', 'glass_panel', 'door')),
  subtype_id         uuid references public.dasher_boards_asset_subtypes(id) on delete set null,
  label              text not null,
  sequence_position  int,
  parent_board_id    uuid references public.dasher_boards_assets(id) on delete cascade,
  is_active          boolean not null default true,
  -- Glass replacement spec (glass_panel and door rows only; doors carry their
  -- own glass spec because a door is a full-height asset).
  glass_width_in     numeric check (glass_width_in > 0),
  glass_height_in    numeric check (glass_height_in > 0),
  glass_thickness_in numeric check (glass_thickness_in > 0),
  glass_material     text check (glass_material in ('tempered', 'acrylic', 'polycarbonate')),
  spec_notes         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  constraint dasher_boards_assets_rink_label_uniq unique (rink_id, label),
  -- Subtypes are door-only in v1.
  constraint dasher_boards_assets_subtype_door_only check (
    subtype_id is null or asset_type = 'door'
  ),
  -- Positioned types (board_panel, door) carry sequence_position and no parent;
  -- glass rows carry parent_board_id and inherit their parent's position.
  constraint dasher_boards_assets_position_shape check (
    (asset_type in ('board_panel', 'door') and sequence_position is not null and parent_board_id is null)
    or (asset_type = 'glass_panel' and parent_board_id is not null and sequence_position is null)
  ),
  -- Board panels never carry a glass spec.
  constraint dasher_boards_assets_board_no_glass_spec check (
    asset_type <> 'board_panel'
    or (glass_width_in is null and glass_height_in is null and glass_thickness_in is null
        and glass_material is null and spec_notes is null)
  )
);

comment on table public.dasher_boards_assets is
  'Dasher Boards: every physical asset around the perimeter. label (B12/G12/D3) is permanent identity — issue history follows it forever; sequence_position is drawing order and may shift on insert/remove, but existing assets are NEVER relabeled. Glass rows map 1:1 to a parent board position and can be deactivated (no shielding, or a door occupies the position). Retired labels are recorded in dasher_boards_retired_labels and never reused (enforced by trigger, migration 192).';
comment on column public.dasher_boards_assets.glass_thickness_in is
  'Decimal inches (e.g. 0.625 for 5/8"). Displayed as the nearest common fraction in the UI.';

create unique index if not exists idx_dasher_boards_assets_rink_position_uniq
  on public.dasher_boards_assets (rink_id, sequence_position)
  where sequence_position is not null;

-- 1:1 glass-to-board: at most one glass row per parent board position.
create unique index if not exists idx_dasher_boards_assets_one_glass_per_board
  on public.dasher_boards_assets (parent_board_id)
  where asset_type = 'glass_panel';

create index if not exists idx_dasher_boards_assets_rink_type
  on public.dasher_boards_assets (rink_id, asset_type, is_active);

drop trigger if exists trg_dasher_boards_assets_updated_at on public.dasher_boards_assets;
create trigger trg_dasher_boards_assets_updated_at
  before update on public.dasher_boards_assets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. dasher_boards_retired_labels — labels that may never be reused on a rink
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_retired_labels (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  rink_id      uuid not null references public.dasher_boards_rinks(id) on delete restrict,
  label        text not null,
  asset_id     uuid references public.dasher_boards_assets(id) on delete set null,
  retired_at   timestamptz not null default now(),
  constraint dasher_boards_retired_labels_uniq unique (rink_id, label)
);

comment on table public.dasher_boards_retired_labels is
  'Dasher Boards: append-only record of labels retired by conversion/relabel (e.g. B12 becomes D5 -> B12 is retired). A trigger on dasher_boards_assets auto-records the old label on every label change and rejects any insert/relabel that would resurrect a retired label.';

create index if not exists idx_dasher_boards_retired_labels_rink
  on public.dasher_boards_retired_labels (rink_id);

-- -----------------------------------------------------------------------------
-- 6. dasher_boards_asset_events — append-only audit trail for asset lifecycle
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_asset_events (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  asset_id     uuid not null references public.dasher_boards_assets(id) on delete cascade,
  event_type   text not null check (event_type in (
                 'created', 'converted_to_door', 'converted_to_board', 'relabeled',
                 'deactivated', 'reactivated', 'glass_toggled', 'spec_updated'
               )),
  detail       jsonb,
  employee_id  uuid references public.employees(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.dasher_boards_asset_events is
  'Dasher Boards: append-only audit trail for asset lifecycle changes (conversions, relabels, glass toggles, spec edits). No UPDATE/DELETE policies — append-only like ice_depth_followup_notes.';

create index if not exists idx_dasher_boards_asset_events_asset_created
  on public.dasher_boards_asset_events (asset_id, created_at);

-- -----------------------------------------------------------------------------
-- 7. dasher_boards_issue_categories — admin-managed quick-pick per asset type
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_issue_categories (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  asset_type   text not null check (asset_type in ('board_panel', 'glass_panel', 'door')),
  label        text not null,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint dasher_boards_issue_categories_uniq unique (facility_id, asset_type, label)
);

comment on table public.dasher_boards_issue_categories is
  'Dasher Boards: admin-managed issue category quick-picks, per asset type (seeded per facility by seed_default_dasher_boards_config).';

drop trigger if exists trg_dasher_boards_issue_categories_updated_at on public.dasher_boards_issue_categories;
create trigger trg_dasher_boards_issue_categories_updated_at
  before update on public.dasher_boards_issue_categories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 8. dasher_boards_inspections — the signed walk record
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_inspections (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  rink_id       uuid not null references public.dasher_boards_rinks(id) on delete restrict,
  inspector_id  uuid references public.employees(id) on delete set null,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

comment on table public.dasher_boards_inspections is
  'Dasher Boards: one row per perimeter walk. A completed inspection (completed_at set) with zero linked issues means "walked, all clear" — untapped assets are implicitly OK, attested by this record. Once completed_at is set the row is IMMUTABLE — enforced by RLS policy AND a guard trigger (migration 192), not just app code.';

create index if not exists idx_dasher_boards_inspections_rink_completed
  on public.dasher_boards_inspections (rink_id, completed_at desc);

create index if not exists idx_dasher_boards_inspections_facility
  on public.dasher_boards_inspections (facility_id);

-- At most one open walk per inspector per rink.
create unique index if not exists idx_dasher_boards_inspections_one_open_per_inspector
  on public.dasher_boards_inspections (rink_id, inspector_id)
  where completed_at is null;

drop trigger if exists trg_dasher_boards_inspections_updated_at on public.dasher_boards_inspections;
create trigger trg_dasher_boards_inspections_updated_at
  before update on public.dasher_boards_inspections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 9. dasher_boards_issues — spatial (asset) OR checklist-flag issues
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_issues (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities(id) on delete restrict,
  rink_id            uuid not null references public.dasher_boards_rinks(id) on delete restrict,
  asset_id           uuid references public.dasher_boards_assets(id) on delete restrict,
  checklist_item_id  uuid references public.dasher_boards_checklist_items(id) on delete restrict,
  category_id        uuid references public.dasher_boards_issue_categories(id) on delete set null,
  description        text not null,
  severity           text not null check (severity in ('a', 'b', 'c')),
  action_taken       text,
  reported_by        uuid references public.employees(id) on delete set null,
  inspection_id      uuid references public.dasher_boards_inspections(id) on delete set null,
  supervisor_id      uuid references public.employees(id) on delete set null,
  supervisor_ack_at  timestamptz,
  resolved_by        uuid references public.employees(id) on delete set null,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  -- Exactly one target: a perimeter asset (spatial) or a checklist item.
  constraint dasher_boards_issues_one_target check (
    num_nonnulls(asset_id, checklist_item_id) = 1
  ),
  -- Categories apply to spatial issues only.
  constraint dasher_boards_issues_category_spatial_only check (
    asset_id is not null or category_id is null
  ),
  -- Severity A always names a supervisor (ack requirement; also app-enforced).
  constraint dasher_boards_issues_a_requires_supervisor check (
    severity <> 'a' or supervisor_id is not null
  )
);

comment on table public.dasher_boards_issues is
  'Dasher Boards: condition issues. Spatial issues target an asset (with category); checklist-flag issues target a cadenced item (no category, no diagram dot). Open issues (resolved_at null) color the diagram and carry forward across days. Severity a requires a supervisor and supervisor acknowledgment before the walk that logged it can complete. Resolved issues are immutable; ack/resolution fields are writable only by edit-level grants (guard trigger, migration 192).';

create index if not exists idx_dasher_boards_issues_asset_open
  on public.dasher_boards_issues (asset_id)
  where resolved_at is null;

create index if not exists idx_dasher_boards_issues_rink_open
  on public.dasher_boards_issues (rink_id, severity)
  where resolved_at is null;

create index if not exists idx_dasher_boards_issues_inspection
  on public.dasher_boards_issues (inspection_id);

create index if not exists idx_dasher_boards_issues_checklist_item
  on public.dasher_boards_issues (checklist_item_id);

create index if not exists idx_dasher_boards_issues_facility_created
  on public.dasher_boards_issues (facility_id, created_at desc);

drop trigger if exists trg_dasher_boards_issues_updated_at on public.dasher_boards_issues;
create trigger trg_dasher_boards_issues_updated_at
  before update on public.dasher_boards_issues
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 10. dasher_boards_checklist_responses — pass/flag per due item per walk
-- -----------------------------------------------------------------------------
create table if not exists public.dasher_boards_checklist_responses (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  inspection_id  uuid not null references public.dasher_boards_inspections(id) on delete cascade,
  item_id        uuid not null references public.dasher_boards_checklist_items(id) on delete restrict,
  status         text not null check (status in ('pass', 'flag')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  constraint dasher_boards_checklist_responses_uniq unique (inspection_id, item_id)
);

comment on table public.dasher_boards_checklist_responses is
  'Dasher Boards: one pass/flag answer per due checklist item per walk. Immutable once the parent inspection is completed — same policy treatment as the inspection row itself (guard trigger, migration 192).';

create index if not exists idx_dasher_boards_checklist_responses_item
  on public.dasher_boards_checklist_responses (item_id);

drop trigger if exists trg_dasher_boards_checklist_responses_updated_at on public.dasher_boards_checklist_responses;
create trigger trg_dasher_boards_checklist_responses_updated_at
  before update on public.dasher_boards_checklist_responses
  for each row execute function public.set_updated_at();
