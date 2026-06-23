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
