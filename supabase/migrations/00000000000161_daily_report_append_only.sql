-- Daily Reports: make submissions append-only, mirroring the other submission
-- tables (refrigeration_reports, air_quality_reports, ice_depth_sessions,
-- ice_operations_submissions). Each submit -- including a same-day correction --
-- now creates a NEW row.
--
-- Migration 156 added a partial unique index on
-- (facility_id, area_id, template_id, business_date) and the app upserted
-- against it: a same-day re-submit took an UPDATE + DELETE-children path. But the
-- UPDATE/DELETE RLS on daily_report_submissions / _items / _notes is admin-only
-- (migration 7), while INSERT is staff-level. So a staff same-day correction
-- matched zero rows, Supabase returned no error for the zero-row write, and the
-- "correction" was silently lost. Switching to append-only routes every submit
-- through the staff-allowed INSERT path and removes that bug class entirely.
--
-- We DROP the unique index. business_date is KEPT: it remains a useful
-- facility-local grouping key (set server-side on INSERT) and the migration-156
-- backfill stays valid -- it is simply no longer unique.
--
-- RLS is unchanged: INSERT stays staff-level; UPDATE/DELETE stay admin-only and
-- simply go unused by the staff path. Cross-day immutability still holds because
-- the form only ever targets today's date, so an INSERT only ever writes today.

drop index if exists public.daily_report_submissions_unique_per_day;

comment on column public.daily_report_submissions.business_date is
  'Facility-local date of the submission (set server-side at submit time). A grouping key for a day''s submissions; NOT unique -- daily reports are append-only, so a same-day correction is a new row.';
