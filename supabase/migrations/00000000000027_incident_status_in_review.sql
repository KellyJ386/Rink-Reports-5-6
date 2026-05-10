-- =============================================================================
-- 00000000000027_incident_status_in_review.sql
-- Rename the 'reviewed' status value to 'in_review' to match the application
-- layer. The original migration used 'reviewed'; the app code was later updated
-- to 'in_review' but the DB CHECK constraint was not updated at the same time.
-- =============================================================================

-- Temporarily drop the CHECK constraint so we can safely update existing rows.
alter table public.incident_reports
  drop constraint if exists incident_reports_status_check;

-- Migrate any rows that were stored with the old value.
update public.incident_reports
  set status = 'in_review'
  where status = 'reviewed';

-- Re-add the constraint with the corrected set of allowed values.
alter table public.incident_reports
  add constraint incident_reports_status_check
  check (status in ('submitted', 'in_review', 'resolved', 'archived'));
