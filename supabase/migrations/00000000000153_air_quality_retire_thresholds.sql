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
