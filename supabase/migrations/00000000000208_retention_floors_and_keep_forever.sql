-- =============================================================================
-- 00000000000208_retention_floors_and_keep_forever.sql
--
-- Closes the retention data-loss defect (prompt-library Defect 1) and resolves
-- the keep_days=0 contradiction.
--
-- THE DEFECT
-- ----------
-- Per-module retention floors (365 days for accident/incident reports, 90 for
-- refrigeration/air quality) existed ONLY in the browser, as a `minDays` prop
-- in src/app/admin/retention/types.ts consumed by the row component. The server
-- action upsertRetentionSetting() enforced a flat `keep_days >= 30` for EVERY
-- module. A crafted POST therefore wrote keep_days = 30 for accident_reports.
--
-- That is not merely a slow leak via the nightly cron: purge_module_data()
-- (migration 132) deliberately ignores auto_purge, so the admin "Purge now"
-- button deletes immediately against whatever keep_days holds. The full attack
-- was: POST keep_days=30 -> click purge -> accident records older than 30 days
-- gone, with no auto_purge and no waiting for the 03:17 cron.
--
-- Fix: move the floor to the database boundary, where every write path meets it
-- rather than trusting a single caller. This follows the same reasoning as the
-- publish-lock work (migrations 148/164/181) — a rule enforced only in the app
-- layer is not enforced.
--
-- THE keep_days=0 CONTRADICTION
-- -----------------------------
-- Migration 18 declared `check (keep_days >= 30)` while the comment on the very
-- same table said "keep_days=0 means keep forever (disabled)", and the server
-- action accepted 0. Saving the UI's "Forever (no purge)" preset therefore
-- always failed on a constraint violation. This migration permits 0.
--
-- Permitting 0 is DANGEROUS on its own, which is why the invariant below exists:
-- every retention-driven purge function computes
--   now() - (keep_days || ' days')::interval
-- with no zero-guard (verified across migrations 24, 138 and 186). With
-- keep_days = 0 that cutoff is exactly now(), so a "keep forever" row would
-- delete EVERY record in the module on the next cron run — the precise opposite
-- of what the setting means.
--
-- Rather than copy eight function bodies into this migration to add a guard —
-- which would risk silently reverting the newer definitions in migration 186
-- (daily_reports, which also purges assignment-routing rows) and migration 138
-- (ice_depth) — this migration enforces an INVARIANT instead:
--
--     keep_days = 0  IMPLIES  auto_purge = false
--
-- Every retention-driven purge function already filters `auto_purge = true`
-- (verified: migrations 24, 138, 186). So a keep-forever row is never selected
-- by any of them, including any written in future that follow the convention.
-- The manual path is independently safe: purge_module_data() already raises
-- "Retention for this module is set to keep records forever" on keep_days = 0.
--
-- The invariant is a COERCION, not a rejection: "keep forever" and "auto-purge"
-- are contradictory instructions, and silently keeping data is the safe
-- resolution. Rejecting would make the UI's Forever preset fail whenever the
-- auto-purge checkbox happened to be ticked.
--
-- EXISTING ROWS
-- -------------
-- Rows already below their module's floor are raised UP to the floor, never
-- lowered. Raising keep_days only ever retains more data, so it cannot destroy
-- anything; leaving them alone would let the defect persist for exactly the
-- facilities it already affected.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-module retention floors, in the database.
--
-- A table rather than a hardcoded CASE because CLAUDE.md requires configurable
-- values to live in the database. Seeded from the minDays values that were
-- previously browser-only in src/app/admin/retention/types.ts.
--
-- audit_logs is deliberately absent: it is NOT retention-configurable. Both
-- purge_old_audit_logs() (migration 24) and purge_module_data() (migration 132)
-- pin it to a fixed 7-year compliance window and never read retention_settings.
-- ---------------------------------------------------------------------------

create table if not exists public.retention_module_floors (
  module_key text primary key,
  min_days   integer not null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint retention_module_floors_min_days_sane check (min_days >= 30)
);

comment on table public.retention_module_floors is
  'Regulatory/business minimum retention per module, enforced by '
  'retention_settings_enforce_floor(). A facility may keep records LONGER than '
  'the floor, or forever (keep_days = 0), but never less. Previously these '
  'values lived only in the browser as a minDays prop, which is the defect this '
  'table closes. audit_logs is intentionally absent — it is fixed at 7 years by '
  'purge_old_audit_logs() and is not retention_settings-configurable.';

comment on column public.retention_module_floors.min_days is
  'Smallest permitted non-zero keep_days for this module. keep_days = 0 (keep '
  'forever) is always permitted — it is stricter than any floor.';

insert into public.retention_module_floors (module_key, min_days, note) values
  ('accident_reports', 365, 'Accident and workers'' comp records. Check local regulatory requirements; OSHA recordkeeping expects longer.'),
  ('incident_reports', 365, 'Staff and patron incident records.'),
  ('refrigeration',     90, 'Refrigeration system check reports.'),
  ('air_quality',       90, 'Air quality reading history. Jurisdictional log-retention rules may require longer.'),
  ('scheduling',        90, 'Past shifts, swaps, and time-off requests.'),
  ('daily_reports',     30, 'Checklist submission history.'),
  ('ice_depth',         30, 'Ice depth measurement sessions.'),
  ('ice_operations',    30, 'Resurfacer, edging, and blade change logs.'),
  ('communications',    30, 'Messages and alerts.')
on conflict (module_key) do nothing;

drop trigger if exists trg_retention_module_floors_updated_at on public.retention_module_floors;
create trigger trg_retention_module_floors_updated_at
  before update on public.retention_module_floors
  for each row execute function public.set_updated_at();

alter table public.retention_module_floors enable row level security;

-- Readable by any authenticated user (the admin UI renders the floor as a hint);
-- writable by super_admin only. A facility admin must not be able to lower the
-- floor that constrains them — that would reintroduce the defect one level up.
drop policy if exists retention_module_floors_select on public.retention_module_floors;
create policy retention_module_floors_select on public.retention_module_floors
  for select to authenticated
  using (true);

drop policy if exists retention_module_floors_write on public.retention_module_floors;
create policy retention_module_floors_write on public.retention_module_floors
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 2. Raise any existing rows that sit below their module's floor.
--
-- Runs before the trigger is installed so the corrective UPDATE itself is not
-- rejected. Only ever increases keep_days.
-- ---------------------------------------------------------------------------

do $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    select s.id, s.facility_id, s.module_key, s.keep_days, f.min_days
      from public.retention_settings s
      join public.retention_module_floors f on f.module_key = s.module_key
     where s.keep_days > 0
       and s.keep_days < f.min_days
  loop
    update public.retention_settings
       set keep_days = v_row.min_days
     where id = v_row.id;
    v_count := v_count + 1;
    raise notice
      'retention floor: raised %/% from % to % days',
      v_row.facility_id, v_row.module_key, v_row.keep_days, v_row.min_days;
  end loop;

  if v_count = 0 then
    raise notice 'retention floor: no existing rows were below their module floor.';
  else
    raise notice 'retention floor: raised % row(s) to their module floor.', v_count;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Permit keep_days = 0 ("keep forever").
--
-- Safe only in combination with the invariant enforced in section 4 — do not
-- reorder these, and do not relax this constraint in isolation.
-- ---------------------------------------------------------------------------

alter table public.retention_settings
  drop constraint if exists retention_settings_keep_days_min;

alter table public.retention_settings
  add constraint retention_settings_keep_days_min
  check (keep_days = 0 or keep_days >= 30);

comment on table public.retention_settings is
  'Per-facility, per-module retention rules. keep_days = 0 means keep forever, '
  'which forces auto_purge = false (see retention_settings_enforce_floor). '
  'Non-zero values are floored per module by retention_module_floors.';

-- ---------------------------------------------------------------------------
-- 4. Enforce the floor and the keep-forever invariant at the DB boundary.
-- ---------------------------------------------------------------------------

create or replace function public.retention_settings_enforce_floor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_min_days integer;
begin
  -- keep_days = 0 is "keep forever": stricter than any floor, so it always
  -- passes the floor check. But it MUST NOT be combined with auto_purge, or the
  -- nightly cron would compute a cutoff of now() - '0 days' = now() and delete
  -- the entire module. Every retention-driven purge function filters
  -- `auto_purge = true`, so clearing the flag here is what makes keep-forever
  -- safe across all of them — existing and future — without editing any.
  if new.keep_days = 0 then
    new.auto_purge := false;
    return new;
  end if;

  select min_days into v_min_days
    from public.retention_module_floors
   where module_key = new.module_key;

  -- A module with no floor row is unconstrained beyond the table CHECK. This is
  -- deliberate: it lets a new module ship before its floor is decided, rather
  -- than failing closed on an unrelated deploy.
  if v_min_days is not null and new.keep_days < v_min_days then
    raise exception
      'Retention for % cannot be shorter than % days (regulatory minimum). Requested % days.',
      new.module_key, v_min_days, new.keep_days
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.retention_settings_enforce_floor() is
  'BEFORE INSERT/UPDATE guard on retention_settings. Enforces the per-module '
  'floor from retention_module_floors, and coerces auto_purge to false whenever '
  'keep_days = 0 so a keep-forever row can never be selected by a purge loop. '
  'Enforced for every role including service_role — the floor is a compliance '
  'minimum, not a permission check. Adjusting a floor requires super_admin '
  'rights on retention_module_floors.';

drop trigger if exists trg_retention_settings_enforce_floor on public.retention_settings;
create trigger trg_retention_settings_enforce_floor
  before insert or update on public.retention_settings
  for each row execute function public.retention_settings_enforce_floor();
