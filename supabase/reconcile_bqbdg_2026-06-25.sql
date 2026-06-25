-- =============================================================================
-- reconcile_bqbdg_2026-06-25.sql   (ONE-TIME, run manually against project
--                                   bqbdgwlhbhabsibjgwmk "Rink Reports 5-6")
--
-- STATUS: ✅ APPLIED 2026-06-25 (via Supabase MCP, per-migration in version
--   order, each verified; ledger then rebuilt). Post-state verified: the live
--   ledger now matches the on-disk files exactly (001..159, local == remote),
--   air_quality_thresholds dropped, compliance engine + dropdown options +
--   daily business_date all present. Retained as an audit record + runbook for
--   the OTHER instance ("Rink Reports by Max Facility", iusj…) if it is ever
--   reconciled. Do NOT re-run against bqbdg.
--
-- WHAT THIS DOES
--   Brings the live "Rink Reports 5-6" database up to `main` and rewrites its
--   migration ledger to match the on-disk files exactly (001..159).
--
-- WHY
--   This DB is the dev instance of the confident-allen lineage. It is cleanly
--   applied through 145, plus three migrations renumbered by the prefix dedupe
--   (155 refrigeration_readings_per_shift, 157 ice_operations_enabled_types,
--   158 scheduling_expiry are ALREADY physically applied). It never received
--   main's air-quality / scheduling feature migrations, so the following ELEVEN
--   are physically MISSING and are applied below, in version order:
--       146 air_quality_compliance_profiles
--       147 facility_air_quality_config
--       148 scheduling_publish_lock_and_cert_override
--       149 scheduling_edit_published_shift
--       150 scheduling_cancel_notifies
--       151 backfill_scheduling_config
--       152 air_quality_mn_evacuation_thresholds
--       153 air_quality_retire_thresholds        (DROPs public.air_quality_thresholds)
--       154 communication_email_sending_claim
--       156 daily_report_business_date
--       159 facility_dropdown_options
--   The pre-existing ledger rows 146-149 are mis-named "ghosts" (they recorded
--   the confident-allen numbering); the final step deletes the whole ledger and
--   re-inserts the correct 001..159 mapping.
--
-- SAFETY
--   * Entirely wrapped in ONE transaction — all-or-nothing. Any failure rolls
--     back and leaves the database exactly as it is now.
--   * PRECONDITION: take a backup / note a PITR timestamp before running.
--   * Run exactly once. Re-running after success will fail (objects already
--     exist) and roll back harmlessly.
-- =============================================================================

begin;

-- =============================================================================
-- >>> APPLY 00000000000146_air_quality_compliance_profiles.sql
-- =============================================================================
-- =============================================================================
-- 00000000000146_air_quality_compliance_profiles.sql
-- Jurisdiction-aware compliance ENGINE: global reference profiles.
--
-- These are GLOBAL reference rows (no facility_id) that define each
-- jurisdiction's ice-arena air-quality rules: which metrics are tracked, the
-- escalating threshold tiers per metric, the measurement method (single sample
-- vs. 1-hour time-weighted average), the sampling-frequency requirements, and
-- the escalation/notification obligations. Facilities pick one profile via
-- facility_air_quality_config (migration 147); the reading form + evaluation
-- engine derive their behavior from the chosen profile at runtime.
--
-- RLS: readable by any authenticated user (facilities need to render the rules);
-- writable only by super_admin (these are curated regulatory reference data).
--
-- Tier model (jsonb `tiers`): per metric key, an object of escalating tiers.
-- Each tier is an object with an optional `max` (single/averaged ceiling — a
-- value strictly greater than `max` hits the tier) and an optional
-- `consecutive` ({count, over}) for the MA "N consecutive samples over X" rule.
-- Tier precedence high→low: evacuation > notification > corrective > within.
-- Absent tiers (e.g. MN has no notification tier) are simply omitted.
--
-- IMPORTANT — sourcing of numbers: values below come from the module spec
-- appendix (MN Rule 4620, MA 105 CMR 675, WI DHS P-00067, USIRA guidance).
-- The Minnesota EVACUATION values were flagged unverified in the spec
-- (~83 ppm CO per one mirror vs. 125 ppm per USIRA) and are intentionally left
-- UNSET (no evacuation tier for MN) until confirmed against the MN DOH rule.
-- Do not invent them.
-- =============================================================================

create table if not exists public.air_quality_compliance_profiles (
  id               uuid primary key default gen_random_uuid(),
  jurisdiction     text not null unique,
  display_name     text not null,
  method           text not null default 'single'
                     check (method in ('single', 'twa_1hr')),
  is_binding       boolean not null default false,
  metrics          jsonb not null default '[]'::jsonb,
  tiers            jsonb not null default '{}'::jsonb,
  sampling_rules   jsonb not null default '{}'::jsonb,
  escalation_rules jsonb not null default '{}'::jsonb,
  guidance_note    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

comment on table public.air_quality_compliance_profiles is
  'Global jurisdiction reference profiles for the Air Quality compliance engine. metrics/tiers/sampling_rules/escalation_rules are jsonb; method = single sample vs 1-hr TWA; is_binding distinguishes regulation (MN/MA) from guidance (WI/USIRA). Readable by all authenticated users; super_admin writes only.';
comment on column public.air_quality_compliance_profiles.tiers is
  'Per-metric escalating tiers: { <metric>: { corrective?: {max?, consecutive?}, notification?: {...}, evacuation?: {...} } }. A value strictly greater than a tier max hits that tier; precedence evacuation > notification > corrective.';

create index if not exists idx_air_quality_compliance_profiles_jurisdiction
  on public.air_quality_compliance_profiles (jurisdiction);

drop trigger if exists trg_air_quality_compliance_profiles_updated_at
  on public.air_quality_compliance_profiles;
create trigger trg_air_quality_compliance_profiles_updated_at
  before update on public.air_quality_compliance_profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.air_quality_compliance_profiles enable row level security;

drop policy if exists air_quality_compliance_profiles_select
  on public.air_quality_compliance_profiles;
create policy air_quality_compliance_profiles_select
  on public.air_quality_compliance_profiles
  for select to authenticated
  using (true);

drop policy if exists air_quality_compliance_profiles_insert
  on public.air_quality_compliance_profiles;
create policy air_quality_compliance_profiles_insert
  on public.air_quality_compliance_profiles
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists air_quality_compliance_profiles_update
  on public.air_quality_compliance_profiles;
create policy air_quality_compliance_profiles_update
  on public.air_quality_compliance_profiles
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists air_quality_compliance_profiles_delete
  on public.air_quality_compliance_profiles;
create policy air_quality_compliance_profiles_delete
  on public.air_quality_compliance_profiles
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- Seed the four reference profiles. Idempotent (on conflict on jurisdiction
-- refreshes the curated data).
-- CO is ppm/0 decimals; NO2 is ppm/1 decimal (WI specifies NO2 in 0.1 ppm
-- increments). All tiers are upper ceilings (higher reading = worse).
-- -----------------------------------------------------------------------------
insert into public.air_quality_compliance_profiles
  (jurisdiction, display_name, method, is_binding, metrics, tiers,
   sampling_rules, escalation_rules, guidance_note)
values
  -- Minnesota — Rule 4620 (binding). Two-tier, single sample. Evacuation UNSET.
  ('MN', 'Minnesota (Rule 4620)', 'single', true,
   '[{"key":"co","label":"Carbon Monoxide","unit":"ppm","decimals":0},
     {"key":"no2","label":"Nitrogen Dioxide","unit":"ppm","decimals":1}]'::jsonb,
   '{"co":{"corrective":{"max":20}},
     "no2":{"corrective":{"max":0.3}}}'::jsonb,
   '{"post_resurfacing_per_week":2,"post_edging_per_week":1,"weekend_required":true}'::jsonb,
   '{"report_to_commissioner_days":5,"record_retention_years":3,"annual_certification":true}'::jsonb,
   'Minnesota Rule 4620 is binding. Corrective action at CO > 20 ppm or NO2 > 0.3 ppm. Evacuation thresholds are not yet configured pending verification against the MN DOH rule.'),

  -- Massachusetts — 105 CMR 675 (binding). Three-tier + notification, single.
  ('MA', 'Massachusetts (105 CMR 675)', 'single', true,
   '[{"key":"co","label":"Carbon Monoxide","unit":"ppm","decimals":0},
     {"key":"no2","label":"Nitrogen Dioxide","unit":"ppm","decimals":1}]'::jsonb,
   '{"co":{"corrective":{"max":30},
           "notification":{"max":60,"consecutive":{"count":6,"over":30}},
           "evacuation":{"max":125}},
     "no2":{"corrective":{"max":0.5},
            "notification":{"max":1.0,"consecutive":{"count":6,"over":0.5}},
            "evacuation":{"max":2.0}}}'::jsonb,
   '{"min_per_week":3,"min_weekday":2,"min_weekend":1,"post_resurfacing_minutes":20}'::jsonb,
   '{"fire_dept_within_hours":1,"board_of_health_within_hours":24,"bureau_within_hours":24}'::jsonb,
   'Massachusetts 105 CMR 675 is binding. Notification level requires notifying the fire department within 1 hour and the board of health and the Bureau within 24 hours.'),

  -- Wisconsin — DHS P-00067 (guidance). 1-hr TWA method.
  ('WI', 'Wisconsin (DHS P-00067)', 'twa_1hr', false,
   '[{"key":"co","label":"Carbon Monoxide","unit":"ppm","decimals":0},
     {"key":"no2","label":"Nitrogen Dioxide","unit":"ppm","decimals":1}]'::jsonb,
   '{"co":{"corrective":{"max":25},"evacuation":{"max":125}},
     "no2":{"corrective":{"max":0.3},"evacuation":{"max":2.0}}}'::jsonb,
   '{"min_per_week":2,"weekend_required":true,"next_busiest_weekday":true,
     "twa":{"samples":13,"interval_min":5,"duration_min":60}}'::jsonb,
   '{}'::jsonb,
   'Wisconsin DHS P-00067 is guidance, not binding. Uses a 1-hour time-weighted average: 13 readings every 5 minutes over an hour, summed and divided by 13.'),

  -- USIRA / Default (non-binding best practice; mirrors Minnesota sampling).
  ('USIRA', 'USIRA / Default (recommended)', 'single', false,
   '[{"key":"co","label":"Carbon Monoxide","unit":"ppm","decimals":0},
     {"key":"no2","label":"Nitrogen Dioxide","unit":"ppm","decimals":1}]'::jsonb,
   '{"co":{"corrective":{"max":20},"evacuation":{"max":125}},
     "no2":{"corrective":{"max":0.3},"evacuation":{"max":2.0}}}'::jsonb,
   '{"post_resurfacing_per_week":2,"post_edging_per_week":1,"weekend_required":true}'::jsonb,
   '{"record_retention_years":3}'::jsonb,
   'Your state does not currently have binding ice-arena air quality regulations. RinkReports applies US Ice Rink Association recommended guidelines.')
on conflict (jurisdiction) do update set
  display_name     = excluded.display_name,
  method           = excluded.method,
  is_binding       = excluded.is_binding,
  metrics          = excluded.metrics,
  tiers            = excluded.tiers,
  sampling_rules   = excluded.sampling_rules,
  escalation_rules = excluded.escalation_rules,
  guidance_note    = excluded.guidance_note;


-- =============================================================================
-- >>> APPLY 00000000000147_facility_air_quality_config.sql
-- =============================================================================
-- =============================================================================
-- 00000000000147_facility_air_quality_config.sql
-- Per-facility config for the Air Quality compliance engine.
--
-- One row per facility selecting which global compliance profile applies
-- (migration 146) plus facility-level tuning:
--   - active_metrics      : which metric keys are collected (subset of profile)
--   - threshold_overrides : per-metric/per-tier STRICTER-ONLY ceilings. A
--                           facility may tighten a regulatory ceiling but never
--                           loosen it below the profile floor — enforced in the
--                           admin action (app layer) and documented here.
--   - frequency_config    : overrides/augments the profile sampling_rules
--   - escalation_config   : facility escalation contacts/actions per tier
--   - submit_roles/view_roles : optional role gates (empty = fall back to the
--                           module permission helpers).
--
-- facility_id is server-injected (RLS pins it to current_facility_id()). RLS
-- read = same-facility module access; write = facility admin / air_quality
-- module admin / super_admin. Auto-seeded (USIRA default) on facility create,
-- with a backfill for existing facilities.
-- =============================================================================

create table if not exists public.facility_air_quality_config (
  id                    uuid primary key default gen_random_uuid(),
  facility_id           uuid not null references public.facilities(id) on delete cascade,
  compliance_profile_id uuid references public.air_quality_compliance_profiles(id) on delete restrict,
  active_metrics        jsonb not null default '["co","no2"]'::jsonb,
  threshold_overrides   jsonb not null default '{}'::jsonb,
  frequency_config      jsonb not null default '{}'::jsonb,
  escalation_config     jsonb not null default '{}'::jsonb,
  submit_roles          text[] not null default '{}',
  view_roles            text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  constraint facility_air_quality_config_facility_uniq unique (facility_id)
);

comment on table public.facility_air_quality_config is
  'Per-facility Air Quality compliance config: which global compliance profile applies plus active_metrics, stricter-only threshold_overrides, frequency_config, escalation_config, and optional submit/view role gates. One row per facility.';
comment on column public.facility_air_quality_config.threshold_overrides is
  'Per-metric/per-tier ceilings that TIGHTEN the profile (never loosen). Shape mirrors profile tiers: { <metric>: { corrective?: {max}, notification?: {max}, evacuation?: {max} } }. Stricter-only is enforced in the admin server action.';

create index if not exists idx_facility_air_quality_config_facility
  on public.facility_air_quality_config (facility_id);
create index if not exists idx_facility_air_quality_config_profile
  on public.facility_air_quality_config (compliance_profile_id);

drop trigger if exists trg_facility_air_quality_config_updated_at
  on public.facility_air_quality_config;
create trigger trg_facility_air_quality_config_updated_at
  before update on public.facility_air_quality_config
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.facility_air_quality_config enable row level security;

drop policy if exists facility_air_quality_config_select
  on public.facility_air_quality_config;
create policy facility_air_quality_config_select
  on public.facility_air_quality_config
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists facility_air_quality_config_insert
  on public.facility_air_quality_config;
create policy facility_air_quality_config_insert
  on public.facility_air_quality_config
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('air_quality')
      )
    )
  );

drop policy if exists facility_air_quality_config_update
  on public.facility_air_quality_config;
create policy facility_air_quality_config_update
  on public.facility_air_quality_config
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('air_quality')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('air_quality')
      )
    )
  );

drop policy if exists facility_air_quality_config_delete
  on public.facility_air_quality_config;
create policy facility_air_quality_config_delete
  on public.facility_air_quality_config
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('air_quality')
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Seeder: create the config row defaulting to the USIRA profile. Idempotent.
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_facility_air_quality_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id
  from public.air_quality_compliance_profiles
  where jurisdiction = 'USIRA';

  insert into public.facility_air_quality_config (facility_id, compliance_profile_id)
  values (p_facility_id, v_profile_id)
  on conflict (facility_id) do nothing;
end;
$$;

comment on function public.seed_default_facility_air_quality_config(uuid) is
  'Seeds a facility_air_quality_config row defaulting to the USIRA profile. Idempotent via on conflict do nothing on (facility_id).';

revoke execute on function public.seed_default_facility_air_quality_config(uuid) from public;
grant  execute on function public.seed_default_facility_air_quality_config(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Auto-seed on facility creation.
-- -----------------------------------------------------------------------------
create or replace function public.tg_seed_facility_air_quality_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_facility_air_quality_config(new.id);
  return new;
end;
$$;

revoke execute on function public.tg_seed_facility_air_quality_config() from public;

drop trigger if exists facilities_seed_air_quality_config on public.facilities;
create trigger facilities_seed_air_quality_config
  after insert on public.facilities
  for each row execute function public.tg_seed_facility_air_quality_config();

-- -----------------------------------------------------------------------------
-- Backfill existing facilities.
-- -----------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_facility_air_quality_config(f.id);
  end loop;
end;
$$;


-- =============================================================================
-- >>> APPLY 00000000000148_scheduling_publish_lock_and_cert_override.sql
-- =============================================================================
-- =============================================================================
-- 00000000000148_scheduling_publish_lock_and_cert_override.sql
--
-- Two launch-required Employee-Scheduling guarantees.
--
-- 1. PUBLISH-LOCK (regression-sensitive). A prior audit flagged a publish-lock
--    bypass: once a schedule is published it must be frozen, yet any scheduling
--    admin — or a crafted PostgREST write — could still directly UPDATE/DELETE a
--    `published` schedule_shifts row (the schedule_shifts_update/delete RLS
--    policies gate only on facility + module-admin, never on status). This adds
--    a DB-boundary trigger that REJECTS any mutation of an already-published
--    shift performed by an end-user PostgREST role ('authenticated'/'anon').
--
--    The governed, re-validated flows that legitimately touch published shifts
--    run as SECURITY DEFINER functions owned by the table owner, so they run as
--    'postgres' and are allowed automatically (no edits to them required):
--       scheduling_apply_swap, scheduling_claim_open_shift,
--       scheduling_decide_open_claim, scheduling_approve_publish_request,
--       and the two new admin RPCs below.
--    Publishing a draft (old.status='draft') is unaffected; only an
--    already-published OLD row is locked. INSERTs are unaffected (a brand-new
--    row is created through the normal admin paths, then published via the
--    two-person publish-request RPC).
--
-- 2. CERT-OVERRIDE AUDIT. Missing/expired required certifications hard-block an
--    assignment — scheduling_assignment_violations() already emits
--    'cert_missing:<name>' and treats an expired cert as missing. A
--    facility_manager+ (scheduling admin) may deliberately override the block,
--    but every override is recorded. public.schedule_assignment_overrides is
--    the immutable audit log; public.scheduling_log_cert_override() is its only
--    writer (manager-gated, facility-scoped, SECURITY DEFINER).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Publish-lock trigger.
-- -----------------------------------------------------------------------------
create or replace function public.schedule_shifts_publish_lock()
returns trigger
language plpgsql
as $$
begin
  -- Governed contexts may mutate a published shift:
  --   * SECURITY DEFINER scheduling RPCs run as the table owner ('postgres');
  --   * trusted backend roles (service_role / supabase_admin);
  --   * an explicit transaction-local bypass flag set by a future governed
  --     writer (select set_config('rr.publish_lock_bypass','on',true)).
  -- A direct write from an end-user role — i.e. the grid/edit server actions or
  -- a crafted request — is rejected once the shift is published.
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception
        'Schedule is published and locked: a published shift cannot be deleted directly. Cancel it through the scheduling tools or republish.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE: only a row that is ALREADY published is locked. Publishing a draft
  -- (old.status='draft' -> 'published') is how the publish RPC works, so it is
  -- allowed.
  if old.status = 'published' then
    raise exception
      'Schedule is published and locked: edits to a published shift require an explicit republish by a facility manager.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.schedule_shifts_publish_lock() is
  'Publish-lock backstop: rejects direct UPDATE/DELETE of an already-published schedule_shifts row from an end-user PostgREST role. Governed SECURITY DEFINER RPCs (run as the table owner) and trusted backend roles are allowed, so swap/claim/publish/cancel/open-fill keep working. Closes the publish-lock bypass.';

drop trigger if exists trg_schedule_shifts_publish_lock on public.schedule_shifts;
create trigger trg_schedule_shifts_publish_lock
  before update or delete on public.schedule_shifts
  for each row execute function public.schedule_shifts_publish_lock();

-- -----------------------------------------------------------------------------
-- 2a. Admin cancel a shift. Runs as definer so the publish-lock trigger allows
--     cancelling a PUBLISHED shift (a governed status transition, not an edit).
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_admin_cancel_shift(p_shift_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid := public.current_facility_id();
  v_shift       public.schedule_shifts%rowtype;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_cancel_shift: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_shift from public.schedule_shifts where id = p_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Shift not found.');
  end if;
  if not public.is_super_admin() and v_shift.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_cancel_shift: shift belongs to another facility'
      using errcode = '42501';
  end if;
  if v_shift.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;

  update public.schedule_shifts set status = 'cancelled' where id = p_shift_id;
  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.scheduling_admin_cancel_shift(uuid) is
  'Admin cancel of a shift (draft or published). SECURITY DEFINER so a published shift can be cancelled through this governed path while the publish-lock trigger still rejects direct edits. Facility-scoped + scheduling-admin gated.';

revoke execute on function public.scheduling_admin_cancel_shift(uuid) from public, anon;
grant  execute on function public.scheduling_admin_cancel_shift(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2b. Admin assign an employee to an open (published, unassigned) shift.
--     Replaces the direct schedule_shifts UPDATE in admin-core-actions, which
--     the publish-lock now rejects. Re-validates the assignment as a hard block.
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_admin_assign_open_shift(
  p_open_shift_id uuid,
  p_employee_id   uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_open        public.schedule_open_shifts%rowtype;
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
  v_updated     int;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_assign_open_shift: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_open from public.schedule_open_shifts where id = p_open_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Open shift not found.');
  end if;
  if not public.is_super_admin() and v_open.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_assign_open_shift: listing belongs to another facility'
      using errcode = '42501';
  end if;
  if v_open.claim_status not in ('open', 'claimed') then
    return jsonb_build_object('ok', false, 'error', 'Open shift is no longer available.');
  end if;

  select * into v_shift from public.schedule_shifts where id = v_open.shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Parent shift not found.');
  end if;

  if not exists (
    select 1 from public.employees e
     where e.id = p_employee_id and e.facility_id = v_open.facility_id
  ) then
    return jsonb_build_object('ok', false, 'error',
      'That employee isn''t part of your facility.');
  end if;

  -- Hard block: re-validate (cert / overtime / time-off / overlap / ...).
  v_codes := public.scheduling_assignment_violations(
    v_open.facility_id, p_employee_id,
    v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
    v_shift.job_area_id, v_shift.id);
  if array_length(v_codes, 1) is not null then
    return jsonb_build_object('ok', false, 'error', 'not_assignable',
      'violations', to_jsonb(v_codes));
  end if;

  update public.schedule_shifts
     set employee_id = p_employee_id
   where id = v_open.shift_id and employee_id is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error',
      'That shift was already assigned to someone else.');
  end if;

  update public.schedule_open_shifts
     set claim_status            = 'filled',
         claimed_by_employee_id  = p_employee_id,
         claimed_at              = now(),
         approved_by_employee_id = v_employee_id,
         approved_at             = now()
   where id = p_open_shift_id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.scheduling_admin_assign_open_shift(uuid, uuid) is
  'Admin direct-assign of an open (published, unassigned) shift to an employee. SECURITY DEFINER (so it works under the publish-lock), facility-scoped, scheduling-admin gated, and hard-block re-validated via scheduling_assignment_violations. Returns jsonb {ok, error?, violations?}.';

revoke execute on function public.scheduling_admin_assign_open_shift(uuid, uuid) from public, anon;
grant  execute on function public.scheduling_admin_assign_open_shift(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Cert-override audit log + its sole writer.
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_assignment_overrides (
  id                        uuid primary key default gen_random_uuid(),
  facility_id               uuid not null references public.facilities(id)          on delete cascade,
  shift_id                  uuid references public.schedule_shifts(id)              on delete set null,
  employee_id               uuid not null references public.employees(id)           on delete cascade,
  job_area_id               uuid references public.employee_job_areas(id)           on delete set null,
  override_type             text not null default 'cert_missing'
                              check (override_type in ('cert_missing')),
  violation_codes           text[] not null default '{}',
  missing_certs             text[] not null default '{}',
  reason                    text check (reason is null or length(reason) <= 1000),
  overridden_by_employee_id uuid references public.employees(id)                    on delete set null,
  overridden_by_user_id     uuid default auth.uid(),
  created_at                timestamptz not null default now()
);

comment on table public.schedule_assignment_overrides is
  'Audit log of cert-gate overrides: a facility_manager+ deliberately assigned an employee to a job area despite a missing/expired required certification. Immutable; written only by scheduling_log_cert_override().';

create index if not exists idx_schedule_assignment_overrides_facility
  on public.schedule_assignment_overrides (facility_id, created_at desc);
create index if not exists idx_schedule_assignment_overrides_employee
  on public.schedule_assignment_overrides (employee_id);

alter table public.schedule_assignment_overrides enable row level security;

-- Read: super admin OR scheduling admin in the row's facility. There is NO
-- write policy: end-user roles cannot INSERT/UPDATE/DELETE audit rows. The
-- SECURITY DEFINER writer below bypasses RLS, keeping the log append-only.
drop policy if exists schedule_assignment_overrides_select on public.schedule_assignment_overrides;
create policy schedule_assignment_overrides_select on public.schedule_assignment_overrides
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

create or replace function public.scheduling_log_cert_override(
  p_employee_id     uuid,
  p_job_area_id     uuid,
  p_violation_codes text[],
  p_shift_id        uuid default null,
  p_reason          text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid := public.current_facility_id();
  v_emp_fac     uuid;
  v_missing     text[];
  v_id          uuid;
begin
  -- Override authority: facility_manager or above only.
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_log_cert_override: facility manager (scheduling admin) required'
      using errcode = '42501';
  end if;
  if p_employee_id is null or p_job_area_id is null then
    raise exception 'scheduling_log_cert_override: employee and job area are required'
      using errcode = '22023';
  end if;

  -- Facility scoping: the employee must belong to the caller's facility.
  select facility_id into v_emp_fac from public.employees where id = p_employee_id;
  if v_emp_fac is null then
    raise exception 'scheduling_log_cert_override: employee not found' using errcode = '22023';
  end if;
  if not public.is_super_admin() and v_emp_fac is distinct from v_facility_id then
    raise exception 'scheduling_log_cert_override: employee belongs to another facility'
      using errcode = '42501';
  end if;

  -- Pull the cert names out of the cert_missing:* codes for a tidy column.
  select coalesce(array_agg(substring(c from 'cert_missing:(.*)')), '{}')
    into v_missing
    from unnest(coalesce(p_violation_codes, '{}')) as c
   where c like 'cert_missing:%';

  insert into public.schedule_assignment_overrides
    (facility_id, shift_id, employee_id, job_area_id, override_type,
     violation_codes, missing_certs, reason, overridden_by_employee_id)
  values
    (v_emp_fac, p_shift_id, p_employee_id, p_job_area_id, 'cert_missing',
     coalesce(p_violation_codes, '{}'),
     v_missing,
     nullif(btrim(coalesce(p_reason, '')), ''),
     public.current_employee_id())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.scheduling_log_cert_override(uuid, uuid, text[], uuid, text) is
  'Records (and authorizes) a cert-gate override. Manager-gated (is_super_admin OR has_module_admin_access(scheduling)) and facility-scoped; the only writer of schedule_assignment_overrides. Returns the new audit row id.';

revoke execute on function public.scheduling_log_cert_override(uuid, uuid, text[], uuid, text) from public, anon;
grant  execute on function public.scheduling_log_cert_override(uuid, uuid, text[], uuid, text) to authenticated, service_role;


-- =============================================================================
-- >>> APPLY 00000000000149_scheduling_edit_published_shift.sql
-- =============================================================================
-- =============================================================================
-- 00000000000149_scheduling_edit_published_shift.sql
--
-- Governed "republish" edit for a PUBLISHED shift. Migration 148 froze
-- published shifts at the DB boundary (direct UPDATE/DELETE from an end-user
-- role is rejected). That left cancel as the only governed change; this adds
-- the explicit, audited edit path the spec calls for ("edits require an
-- explicit republish by a facility_manager+, enforced server-side").
--
-- scheduling_admin_edit_published_shift():
--   * scheduling-admin gated + facility-scoped, SECURITY DEFINER (so it can
--     write through the publish-lock),
--   * only touches a shift whose status is 'published',
--   * hard-blocks on a missing/expired required cert unless p_override_cert is
--     passed, in which case it records the override via the same audited writer
--     (scheduling_log_cert_override) — so even a crafted direct RPC call is
--     gated + logged the same way the grid is,
--   * applies the full new field set, re-stamps the publish metadata, and
--     notifies the affected employee(s) that their published shift changed,
--   * the double-booking exclusion constraint (migration 140) remains the
--     backstop for overlaps.
-- =============================================================================

create or replace function public.scheduling_admin_edit_published_shift(
  p_shift_id      uuid,
  p_employee_id   uuid,
  p_job_area_id   uuid,
  p_starts_at     timestamptz,
  p_ends_at       timestamptz,
  p_break_minutes int,
  p_role_label    text,
  p_notes         text,
  p_override_cert boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
  v_cert        text[];
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_edit_published_shift: scheduling admin required'
      using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'error', 'End must be after start.');
  end if;

  select * into v_shift from public.schedule_shifts where id = p_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Shift not found.');
  end if;
  if not public.is_super_admin() and v_shift.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_edit_published_shift: shift belongs to another facility'
      using errcode = '42501';
  end if;
  if v_shift.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'not_published');
  end if;

  -- Referenced employee / job area must belong to the shift's facility (the FKs
  -- don't enforce this).
  if p_employee_id is not null and not exists (
    select 1 from public.employees e
     where e.id = p_employee_id and e.facility_id = v_shift.facility_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'That employee isn''t part of your facility.');
  end if;
  if p_job_area_id is not null and not exists (
    select 1 from public.employee_job_areas j
     where j.id = p_job_area_id and j.facility_id = v_shift.facility_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'That job area isn''t part of your facility.');
  end if;

  -- Re-validate the candidate assignment, excluding this shift from its own
  -- weekly-hours / overlap / min-rest math.
  v_codes := public.scheduling_assignment_violations(
    v_shift.facility_id, p_employee_id,
    p_starts_at, p_ends_at, coalesce(p_break_minutes, 0),
    p_job_area_id, p_shift_id);

  -- Cert gaps hard-block unless a manager explicitly overrides (and we log it).
  select coalesce(array_agg(c), '{}') into v_cert
    from unnest(v_codes) as c where c like 'cert_missing:%';
  if array_length(v_cert, 1) is not null then
    if not p_override_cert then
      return jsonb_build_object('ok', false, 'error', 'cert_blocked',
        'violations', to_jsonb(v_cert));
    end if;
    perform public.scheduling_log_cert_override(
      p_employee_id, p_job_area_id, v_cert, p_shift_id, p_override_reason);
  end if;

  update public.schedule_shifts
     set employee_id              = p_employee_id,
         job_area_id              = p_job_area_id,
         starts_at                = p_starts_at,
         ends_at                  = p_ends_at,
         break_minutes            = coalesce(p_break_minutes, 0),
         role_label               = p_role_label,
         notes                    = p_notes,
         published_at             = now(),
         published_by_employee_id = v_employee_id
   where id = p_shift_id;

  -- Notify the affected employee(s) their published shift changed.
  insert into public.schedule_notifications
    (facility_id, employee_id, notification_type, shift_id, payload)
  select v_shift.facility_id, emp, 'shift_changed', p_shift_id,
         jsonb_build_object('message', 'A published shift of yours was updated by a manager.')
    from (
      select distinct emp from unnest(array[v_shift.employee_id, p_employee_id]) as emp
       where emp is not null
    ) recipients;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.scheduling_admin_edit_published_shift(uuid, uuid, uuid, timestamptz, timestamptz, int, text, text, boolean, text) is
  'Governed republish-edit of a PUBLISHED shift. Scheduling-admin gated + facility-scoped, SECURITY DEFINER (writes through the publish-lock). Hard-blocks a missing/expired required cert unless p_override_cert (then logged via scheduling_log_cert_override). Applies the full field set, re-stamps publish metadata, notifies affected employees. Returns jsonb {ok, error?, violations?}.';

revoke execute on function public.scheduling_admin_edit_published_shift(uuid, uuid, uuid, timestamptz, timestamptz, int, text, text, boolean, text) from public, anon;
grant  execute on function public.scheduling_admin_edit_published_shift(uuid, uuid, uuid, timestamptz, timestamptz, int, text, text, boolean, text) to authenticated, service_role;


-- =============================================================================
-- >>> APPLY 00000000000150_scheduling_cancel_notifies.sql
-- =============================================================================
-- =============================================================================
-- 00000000000150_scheduling_cancel_notifies.sql
--
-- scheduling_admin_cancel_shift (migration 148) cancelled silently — unlike the
-- edit/claim/decide flows, the affected employee was never told. Re-create it
-- (same signature) so a cancel notifies the assigned employee, matching
-- scheduling_admin_edit_published_shift (migration 149). Uses notification_type
-- 'shift_changed' (an allowed value in the migration-15 check; 'shift_cancelled'
-- is not, so we don't touch the constraint).
-- =============================================================================

create or replace function public.scheduling_admin_cancel_shift(p_shift_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid := public.current_facility_id();
  v_shift       public.schedule_shifts%rowtype;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_cancel_shift: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_shift from public.schedule_shifts where id = p_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Shift not found.');
  end if;
  if not public.is_super_admin() and v_shift.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_cancel_shift: shift belongs to another facility'
      using errcode = '42501';
  end if;
  if v_shift.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;

  update public.schedule_shifts set status = 'cancelled' where id = p_shift_id;

  -- Tell the affected employee (if the shift was assigned).
  if v_shift.employee_id is not null then
    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, payload)
    values
      (v_shift.facility_id, v_shift.employee_id, 'shift_changed', p_shift_id,
       jsonb_build_object('message', 'A shift of yours was cancelled by a manager.'));
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.scheduling_admin_cancel_shift(uuid) is
  'Admin cancel of a shift (draft or published). SECURITY DEFINER so a published shift can be cancelled through this governed path while the publish-lock trigger still rejects direct edits. Facility-scoped + scheduling-admin gated. Notifies the assigned employee (shift_changed) when the cancelled shift had one.';

revoke execute on function public.scheduling_admin_cancel_shift(uuid) from public, anon;
grant  execute on function public.scheduling_admin_cancel_shift(uuid) to authenticated, service_role;


-- =============================================================================
-- >>> APPLY 00000000000151_backfill_scheduling_config.sql
-- =============================================================================
-- =============================================================================
-- 00000000000151_backfill_scheduling_config.sql
--
-- New facilities auto-seed scheduling config (schedule_settings + baseline
-- compliance rules) via the create_facility_with_roles() path (migration 120).
-- Facilities that existed BEFORE that trigger never got seeded, so their
-- scheduling rules engine runs with NULL settings. One-time backfill: seed any
-- facility that still lacks a schedule_settings row.
--
-- seed_default_scheduling_config() (migration 117) is idempotent, so this is
-- safe to re-run and a no-op once every facility is seeded.
-- =============================================================================

do $$
declare
  v_facility record;
begin
  for v_facility in
    select f.id
      from public.facilities f
     where not exists (
       select 1 from public.schedule_settings s where s.facility_id = f.id
     )
  loop
    perform public.seed_default_scheduling_config(v_facility.id);
  end loop;
end$$;


-- =============================================================================
-- >>> APPLY 00000000000152_air_quality_mn_evacuation_thresholds.sql
-- =============================================================================
-- =============================================================================
-- 00000000000152_air_quality_mn_evacuation_thresholds.sql
-- Set the Minnesota profile's evacuation tiers, which migration 146 left unset.
--
-- The module spec flagged the MN evacuation values as unverified (~83 ppm CO
-- per one mirror vs. 125 ppm per USIRA), so they were intentionally omitted.
-- Per the maintainer's go-ahead we now seed a DOCUMENTED PLACEHOLDER that
-- mirrors the USIRA / WI / MA evacuation pair (CO > 125 ppm, NO2 > 2.0 ppm).
--
-- ⚠ PLACEHOLDER — verify against the Minnesota DOH Rule 4620 before relying on
-- these for a customer. If the binding value is the stricter ~83 ppm CO, update
-- this profile. Facilities may already tighten via stricter-only overrides.
--
-- Merges the evacuation tier into the existing co/no2 tier objects (keeping the
-- corrective tiers). Idempotent.
-- =============================================================================

update public.air_quality_compliance_profiles
set tiers = tiers || jsonb_build_object(
  'co',  coalesce(tiers->'co',  '{}'::jsonb) || '{"evacuation":{"max":125}}'::jsonb,
  'no2', coalesce(tiers->'no2', '{}'::jsonb) || '{"evacuation":{"max":2.0}}'::jsonb
)
where jurisdiction = 'MN';


-- =============================================================================
-- >>> APPLY 00000000000153_air_quality_retire_thresholds.sql
-- =============================================================================
-- =============================================================================
-- 00000000000153_air_quality_retire_thresholds.sql
-- Retire the legacy per-facility air_quality_thresholds table.
--
-- The jurisdiction-aware compliance engine (global air_quality_compliance_
-- profiles + per-facility facility_air_quality_config, migrations 146/147) is
-- now the single source of truth for evaluation. The submit pipeline stamps
-- each reading's is_exceedance / severity_at_submit / compliance_max_at_submit
-- from the facility's effective (override-tightened) tiers, so the old
-- warn/alert/compliance band table and its per-reading FK are dead.
--
-- 1. Drop air_quality_readings.threshold_id (FK into the table being removed).
--    The other readings snapshot columns are retained and still populated.
-- 2. Drop air_quality_thresholds (its RLS policies, indexes, partial-unique
--    indexes, and updated_at trigger drop with it via CASCADE).
-- =============================================================================

alter table public.air_quality_readings
  drop column if exists threshold_id;

drop table if exists public.air_quality_thresholds cascade;


-- =============================================================================
-- >>> APPLY 00000000000154_communication_email_sending_claim.sql
-- =============================================================================
-- Add an in-flight email delivery state so the communications cron can claim
-- recipient rows before calling the external email provider. This closes the
-- race where overlapping cron invocations could both send the same pending row
-- and only discover the conflict when updating state after the side effect.
--
-- A claimed row uses:
--   email_status = 'sending'
--   email_claim_token = random worker-local UUID
--   email_next_attempt_at = claim expiry timestamp
--
-- If a worker dies mid-send, a later cron run may reclaim the row after the
-- expiry and retry it. The claim token prevents an expired worker from
-- settling a row after another worker has reclaimed it. Successful/failed
-- sends clear the claim token and clear or reset email_next_attempt_at.

alter table public.communication_recipients
  add column if not exists email_claim_token uuid;

alter table public.communication_recipients
  drop constraint if exists communication_recipients_email_status_check;

alter table public.communication_recipients
  add constraint communication_recipients_email_status_check
  check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

comment on column public.communication_recipients.email_status is
  'External email delivery state. pending = ready or waiting for retry; sending = claimed by a cron worker until email_next_attempt_at; sent/failed/skipped are terminal.';

comment on column public.communication_recipients.email_claim_token is
  'Random UUID written by the cron worker when claiming a row for email delivery. Settlement updates must match this token so stale workers cannot overwrite newer claims.';

drop index if exists public.idx_communication_recipients_email_ready;

create index if not exists idx_communication_recipients_email_ready
  on public.communication_recipients (email_status, email_next_attempt_at nulls first, created_at asc)
  where email_status in ('pending', 'sending');


-- =============================================================================
-- >>> APPLY 00000000000156_daily_report_business_date.sql
-- =============================================================================
-- Daily Reports: identify a submission by its facility-local "business date" so
-- a re-submission of the same area+template on the same day updates the existing
-- report (a correction) instead of creating a duplicate. A new local day always
-- creates a fresh report; past days are therefore effectively locked because the
-- form only ever targets today's date.
--
-- business_date is computed server-side at submit time from the facility's
-- timezone. The partial unique index enforces one submission per
-- (facility, area, template, day); the app upserts against it.

alter table public.daily_report_submissions
  add column if not exists business_date date;

-- Backfill existing rows from submitted_at in the facility's local timezone.
update public.daily_report_submissions s
set business_date = (s.submitted_at at time zone coalesce(f.timezone, 'UTC'))::date
from public.facilities f
where f.id = s.facility_id
  and s.business_date is null;

create unique index if not exists daily_report_submissions_unique_per_day
  on public.daily_report_submissions (facility_id, area_id, template_id, business_date)
  where business_date is not null;

comment on column public.daily_report_submissions.business_date is
  'Facility-local date of the submission (set server-side at submit time). Unique per (facility, area, template) so same-day re-submission updates the existing report rather than duplicating it.';


-- =============================================================================
-- >>> APPLY 00000000000159_facility_dropdown_options.sql
-- =============================================================================
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


-- =============================================================================
-- >>> REBUILD LEDGER to match on-disk files (001..159)
-- =============================================================================
delete from supabase_migrations.schema_migrations;

insert into supabase_migrations.schema_migrations (version, name) values
  ('00000000000001','extensions'),
  ('00000000000002','backbone_schema'),
  ('00000000000003','helper_functions'),
  ('00000000000004','backbone_rls'),
  ('00000000000005','seed_system_roles'),
  ('00000000000006','security_hardening'),
  ('00000000000007','daily_reports_schema'),
  ('00000000000008','incident_reports_schema'),
  ('00000000000009','communications_schema'),
  ('00000000000010','accident_reports_schema'),
  ('00000000000011','refrigeration_schema'),
  ('00000000000012','air_quality_schema'),
  ('00000000000013','ice_operations_schema'),
  ('00000000000014','ice_depth_schema'),
  ('00000000000015','scheduling_schema'),
  ('00000000000016','users_self_insert'),
  ('00000000000017','get_employee_counts_by_facility'),
  ('00000000000018','retention_settings'),
  ('00000000000019','export_settings'),
  ('00000000000020','shift_reminder_notification_type'),
  ('00000000000021','schedule_swap_requests_rls'),
  ('00000000000022','settings_cascade_delete'),
  ('00000000000023','performance_indexes'),
  ('00000000000024','retention_aware_purge_functions'),
  ('00000000000025','helper_function_null_guards'),
  ('00000000000026','revoke_anon_function_execute'),
  ('00000000000027','incident_status_in_review'),
  ('00000000000028','facility_contact_fields'),
  ('00000000000029','module_permission_helper'),
  ('00000000000030','submission_rls_module_permissions'),
  ('00000000000031','offline_sync_queue'),
  ('00000000000032','refrigeration_change_log'),
  ('00000000000033','air_quality_change_log'),
  ('00000000000034','ice_operations_change_log'),
  ('00000000000035','ice_depth_change_log'),
  ('00000000000036','export_settings_columns'),
  ('00000000000037','retention_last_purged_at'),
  ('00000000000038','permission_level_enum'),
  ('00000000000039','backfill_and_sync_trigger'),
  ('00000000000040','schedule_publish_requests'),
  ('00000000000041','audit_triggers'),
  ('00000000000042','employee_custom_fields'),
  ('00000000000043','dept_facility_permission_defaults'),
  ('00000000000044','roles_active_and_description'),
  ('00000000000045','notification_timing_and_outbox'),
  ('00000000000046','audit_triggers_expansion'),
  ('00000000000047','notification_outbox_drain'),
  ('00000000000048','pdf_attachments'),
  ('00000000000049','security_hardening'),
  ('00000000000050','deferred_security_followups'),
  ('00000000000051','accident_witnesses_and_age'),
  ('00000000000052','facility_city_state_email'),
  ('00000000000053','create_employee_complete'),
  ('00000000000054','module_area_permissions_rls_tighten'),
  ('00000000000055','consolidate_canonical_roles'),
  ('00000000000056','employee_invites'),
  ('00000000000057','employee_certifications'),
  ('00000000000058','drop_gm_from_admin_role_lists'),
  ('00000000000059','communication_groups_staff_can_message'),
  ('00000000000060','communication_recipient_delivery_state'),
  ('00000000000061','fix_phantom_table_names'),
  ('00000000000062','email_send_retry'),
  ('00000000000063','routing_requires_ack'),
  ('00000000000064','refrigeration_field_is_required'),
  ('00000000000065','employee_hidden_modules'),
  ('00000000000066','revoke_anon_security_definer_followups'),
  ('00000000000067','ice_depth_layout_logo'),
  ('00000000000068','group_member_facility_match'),
  ('00000000000069','create_facility_with_roles'),
  ('00000000000070','employee_custom_fields'),
  ('00000000000071','rls_use_effective_permission'),
  ('00000000000072','drop_custom_employee_fields'),
  ('00000000000073','simplify_permission_resolution'),
  ('00000000000074','accident_wrists_body_part'),
  ('00000000000075','ice_resurfacer_equipment_type'),
  ('00000000000076','ice_operations_fuel_types_and_templates'),
  ('00000000000077','user_permissions_replace'),
  ('00000000000078','user_permissions_rls_recursion_fix'),
  ('00000000000079','role_permission_defaults_and_source'),
  ('00000000000080','seed_role_permission_defaults_tennity'),
  ('00000000000081','apply_role_permission_defaults_fn'),
  ('00000000000082','role_permission_defaults_auto_seed'),
  ('00000000000083','ice_depth_rinks'),
  ('00000000000084','air_quality_form_data'),
  ('00000000000085','facility_documents'),
  ('00000000000086','dispatch_authz_gate_restore'),
  ('00000000000087','retire_gm_supervisor_roles'),
  ('00000000000088','information_requests'),
  ('00000000000089','circle_check_response_type'),
  ('00000000000090','daily_area_submit_enforcement'),
  ('00000000000091','unify_permission_helpers'),
  ('00000000000092','scaling_indexes'),
  ('00000000000093','accident_body_part_laterality'),
  ('00000000000094','rate_limit'),
  ('00000000000095','audit_identity_permissions'),
  ('00000000000096','facility_scaling_indexes'),
  ('00000000000097','security_hardening_v3'),
  ('00000000000098','consolidate_rls_policies'),
  ('00000000000099','drop_dead_legacy_permission_tables'),
  ('00000000000100','user_account_management'),
  ('00000000000101','facility_spaces'),
  ('00000000000102','incident_activities'),
  ('00000000000103','incident_reports_redesign_columns'),
  ('00000000000104','incident_report_children'),
  ('00000000000105','facility_spaces_incident_admin_write'),
  ('00000000000106','seed_daily_report_checklists'),
  ('00000000000107','employee_job_areas'),
  ('00000000000108','create_employee_complete_job_areas'),
  ('00000000000109','seed_refrigeration_fields_thresholds'),
  ('00000000000110','refrigeration_reading_cadence'),
  ('00000000000111','refrigeration_followup_note_links'),
  ('00000000000112','refrigeration_integrity_and_trend_indexes'),
  ('00000000000113','refrigeration_computed_field_type'),
  ('00000000000114','refrigeration_rls_permission_fixes'),
  ('00000000000115','schedule_shift_job_area'),
  ('00000000000116','job_area_cert_requirements'),
  ('00000000000117','schedule_settings_remediation'),
  ('00000000000118','scheduling_assignment_violations'),
  ('00000000000119','scheduling_rls_and_grants_remediation'),
  ('00000000000120','auto_seed_scheduling_on_facility_create'),
  ('00000000000121','drop_employee_departments'),
  ('00000000000122','revoke_anon_seed_and_trigger_execute'),
  ('00000000000123','module_access_any_enabled_action'),
  ('00000000000124','refrigeration_select_options_normalize'),
  ('00000000000125','refrigeration_machine_hours_per_compressor'),
  ('00000000000126','incident_arm_split_dropdowns'),
  ('00000000000127','schedule_availability_job_area'),
  ('00000000000128','scheduling_grid_schema_additions'),
  ('00000000000129','schedule_settings_block_on_violations'),
  ('00000000000130','schedule_template_shifts_nullable_department'),
  ('00000000000131','incident_reporter_phone_optional'),
  ('00000000000132','purge_module_data'),
  ('00000000000133','scheduling_admin_facility_scope_fix'),
  ('00000000000134','purge_outbox_and_sync_queue'),
  ('00000000000135','auto_seed_daily_checklists_on_facility_create'),
  ('00000000000136','scheduling_swap_publish_rpcs_and_rls'),
  ('00000000000137','scheduling_facility_tz_engine_and_open_claims'),
  ('00000000000138','ice_depth_integrity_and_purge'),
  ('00000000000139','daily_report_rename_operational_to_daily'),
  ('00000000000140','schedule_shifts_no_double_booking'),
  ('00000000000141','facility_spaces_shared_admin'),
  ('00000000000142','accidents_use_facility_spaces'),
  ('00000000000143','air_quality_use_facility_spaces'),
  ('00000000000144','facility_modules'),
  ('00000000000145','incident_emergency_fields'),
  ('00000000000146','air_quality_compliance_profiles'),
  ('00000000000147','facility_air_quality_config'),
  ('00000000000148','scheduling_publish_lock_and_cert_override'),
  ('00000000000149','scheduling_edit_published_shift'),
  ('00000000000150','scheduling_cancel_notifies'),
  ('00000000000151','backfill_scheduling_config'),
  ('00000000000152','air_quality_mn_evacuation_thresholds'),
  ('00000000000153','air_quality_retire_thresholds'),
  ('00000000000154','communication_email_sending_claim'),
  ('00000000000155','refrigeration_readings_per_shift'),
  ('00000000000156','daily_report_business_date'),
  ('00000000000157','ice_operations_enabled_types'),
  ('00000000000158','scheduling_expiry'),
  ('00000000000159','facility_dropdown_options');

-- Post-conditions (informational): after commit, `supabase migration list`
-- should show local == remote, and these should all be present:
--   air_quality_compliance_profiles, facility_air_quality_config,
--   facility_dropdown_options (tables), daily_reports.business_date (column),
--   and air_quality_thresholds should be GONE.

commit;
