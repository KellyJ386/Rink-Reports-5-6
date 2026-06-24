-- =============================================================================
-- 00000000000155_facility_dropdown_options.sql
--
-- Generic, per-facility "configurable dropdown options" table. Generalizes the
-- accident_dropdowns pattern (migration 10) into a single table keyed by a
-- `domain` whitelist, so any genuinely-customizable picker list can be made
-- admin-editable without a new table + migration each time.
--
-- First domain: 'facility_timezone' -- the IANA time zones offered in the
-- Facility settings timezone picker. Previously a hardcoded TS constant
-- (TIMEZONE_OPTIONS in src/app/admin/facility/types.ts); now per-facility and
-- editable at /admin/lists. The TS constant is retained only as the seed
-- source + a fallback when a facility has no rows yet.
--
-- The `domain` CHECK is deliberately narrow. Only lists whose new values
-- actually FUNCTION belong here. Code-bound enums (refrigeration field types,
-- export formats, comms source modules, alert_on, timing, units, and the
-- theme-token severity scales) are intentionally NOT domains -- adding options
-- for them would be inert or break logic. See CLAUDE.md / the feature plan.
--
-- Module key for permission helpers: none. Writes are gated on facility admin
-- (is_facility_admin) rather than a report-module permission, because these
-- lists are facility configuration, not a reporting module.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table if not exists public.facility_dropdown_options (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete cascade,
  domain        text not null
                  check (domain in ('facility_timezone')),
  key           text not null,
  display_name  text not null,
  color         text,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint facility_dropdown_options_facility_domain_key_uniq
    unique (facility_id, domain, key)
);

comment on table public.facility_dropdown_options is
  'Generic per-facility admin-customizable picker lists, partitioned by `domain` (CHECK-whitelisted). Generalizes accident_dropdowns. Only lists whose new values actually function are valid domains; code-bound enums are excluded by design.';

create index if not exists idx_facility_dropdown_options_facility_domain_active_sort
  on public.facility_dropdown_options (facility_id, domain, is_active, sort_order);

drop trigger if exists trg_facility_dropdown_options_updated_at on public.facility_dropdown_options;
create trigger trg_facility_dropdown_options_updated_at
  before update on public.facility_dropdown_options
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Seed defaults helper
-- Idempotent. Inserts the canonical option set for each domain for a facility.
-- =============================================================================
create or replace function public.seed_default_facility_dropdown_options(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- facility_timezone: mirrors TIMEZONE_OPTIONS. key = IANA identifier (stored
  -- verbatim in facilities.timezone), display_name = friendly label.
  insert into public.facility_dropdown_options
    (facility_id, domain, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'facility_timezone', 'America/New_York',    'Eastern — New York',          1,  true),
    (p_facility_id, 'facility_timezone', 'America/Detroit',     'Eastern — Detroit',           2,  true),
    (p_facility_id, 'facility_timezone', 'America/Chicago',     'Central — Chicago',           3,  true),
    (p_facility_id, 'facility_timezone', 'America/Denver',      'Mountain — Denver',           4,  true),
    (p_facility_id, 'facility_timezone', 'America/Phoenix',     'Mountain (no DST) — Phoenix', 5,  true),
    (p_facility_id, 'facility_timezone', 'America/Los_Angeles', 'Pacific — Los Angeles',       6,  true),
    (p_facility_id, 'facility_timezone', 'America/Anchorage',   'Alaska — Anchorage',          7,  true),
    (p_facility_id, 'facility_timezone', 'Pacific/Honolulu',    'Hawaii — Honolulu',           8,  true),
    (p_facility_id, 'facility_timezone', 'America/Toronto',     'Eastern — Toronto',           9,  true),
    (p_facility_id, 'facility_timezone', 'America/Vancouver',   'Pacific — Vancouver',         10, true),
    (p_facility_id, 'facility_timezone', 'UTC',                 'UTC',                         11, true)
  on conflict (facility_id, domain, key) do nothing;
end;
$$;

comment on function public.seed_default_facility_dropdown_options(uuid) is
  'Seeds canonical facility_dropdown_options for a facility across all domains. Idempotent via on conflict (facility_id, domain, key) do nothing.';

revoke execute on function public.seed_default_facility_dropdown_options(uuid) from public, anon;
grant  execute on function public.seed_default_facility_dropdown_options(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Auto-seed on facility creation. Self-contained AFTER INSERT trigger (covers
-- every insert path, not just create_facility_with_roles). Idempotent.
-- -----------------------------------------------------------------------------
create or replace function public.trg_seed_facility_dropdown_options()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_facility_dropdown_options(new.id);
  return new;
end;
$$;

drop trigger if exists trg_facilities_seed_dropdown_options on public.facilities;
create trigger trg_facilities_seed_dropdown_options
  after insert on public.facilities
  for each row execute function public.trg_seed_facility_dropdown_options();

-- -----------------------------------------------------------------------------
-- Backfill: every existing facility gets the canonical set now.
-- -----------------------------------------------------------------------------
do $$
declare
  v_row record;
begin
  for v_row in select id from public.facilities loop
    perform public.seed_default_facility_dropdown_options(v_row.id);
  end loop;
end$$;

-- =============================================================================
-- Row Level Security
--   SELECT: super_admin OR same-facility (any authenticated member -- the
--           Facility settings form + staff need to read the picker list).
--   INSERT/UPDATE/DELETE: super_admin OR facility admin (is_facility_admin).
-- =============================================================================
alter table public.facility_dropdown_options enable row level security;

drop policy if exists facility_dropdown_options_select on public.facility_dropdown_options;
create policy facility_dropdown_options_select on public.facility_dropdown_options
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_dropdown_options_insert on public.facility_dropdown_options;
create policy facility_dropdown_options_insert on public.facility_dropdown_options
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.is_facility_admin(facility_id)
    )
  );

drop policy if exists facility_dropdown_options_update on public.facility_dropdown_options;
create policy facility_dropdown_options_update on public.facility_dropdown_options
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.is_facility_admin(facility_id)
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.is_facility_admin(facility_id)
    )
  );

drop policy if exists facility_dropdown_options_delete on public.facility_dropdown_options;
create policy facility_dropdown_options_delete on public.facility_dropdown_options
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.is_facility_admin(facility_id)
    )
  );
