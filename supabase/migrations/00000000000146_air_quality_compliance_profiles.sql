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
