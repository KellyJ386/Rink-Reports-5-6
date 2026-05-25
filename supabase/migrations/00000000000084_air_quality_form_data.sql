-- =============================================================================
-- 00000000000084_air_quality_form_data.sql
-- Adds an optional JSONB payload to air_quality_reports holding the extended
-- regulatory monitoring-log sections (tester/equipment info, Section 1 general
-- info & equipment status, Section 2 routine + post-edging measurements, and
-- Section 4 recommendations). All fields are optional and supplementary to the
-- existing normalized readings; the column inherits the existing
-- air_quality_reports RLS policies (no new policies needed).
-- =============================================================================

alter table public.air_quality_reports
  add column if not exists form_data jsonb;

comment on column public.air_quality_reports.form_data is
  'Optional extended monitoring-log payload (tester/equipment details, Section 1 general info, Section 2 routine/post-edging measurements, Section 4 recommendations). All fields optional; supplementary to air_quality_readings. Written by the staff submit action.';
