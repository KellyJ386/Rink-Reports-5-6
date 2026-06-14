-- =============================================================================
-- 00000000000143_air_quality_use_facility_spaces.sql
-- Air Quality adopts the shared facility_spaces list and retires its own
-- air_quality_locations table.
--
-- air_quality_locations had the same shape as facility_spaces but was a
-- module-private list that also parented per-location equipment + thresholds and
-- was the target of air_quality_reports.location_id. We re-point all three FKs
-- to facility_spaces and drop the old table. There are no air_quality_locations
-- / equipment / location-scoped threshold / report rows to migrate.
--
-- Column names (location_id) are unchanged to minimize churn; only their FK
-- target moves. On-delete semantics are preserved (equipment/thresholds CASCADE,
-- reports RESTRICT).
-- =============================================================================

-- 1) Re-point the three FKs from air_quality_locations -> facility_spaces.
alter table public.air_quality_equipment
  drop constraint if exists air_quality_equipment_location_id_fkey;
alter table public.air_quality_equipment
  add constraint air_quality_equipment_location_id_fkey
  foreign key (location_id) references public.facility_spaces(id) on delete cascade;

alter table public.air_quality_thresholds
  drop constraint if exists air_quality_thresholds_location_id_fkey;
alter table public.air_quality_thresholds
  add constraint air_quality_thresholds_location_id_fkey
  foreign key (location_id) references public.facility_spaces(id) on delete cascade;

alter table public.air_quality_reports
  drop constraint if exists air_quality_reports_location_id_fkey;
alter table public.air_quality_reports
  add constraint air_quality_reports_location_id_fkey
  foreign key (location_id) references public.facility_spaces(id) on delete restrict;

comment on column public.air_quality_reports.location_id is
  'Facility space the readings were taken in. References facility_spaces(id) (shared list) as of migration 143.';

-- 2) Drop the now-unused module-private table (its RLS policies, indexes, and
-- updated_at trigger drop with it). The shared list lives in facility_spaces.
drop table if exists public.air_quality_locations;
