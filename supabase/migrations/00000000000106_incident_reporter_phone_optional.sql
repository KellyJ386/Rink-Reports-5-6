-- =============================================================================
-- 00000000000106_incident_reporter_phone_optional.sql
-- The redesigned incident form drops the Reporter box: the reporter's name is
-- derived from the logged-in user, and the reporter phone is no longer
-- collected. Make reporter_phone nullable so new reports can omit it. The
-- column is retained (nullable) so existing reports keep their phone value.
-- =============================================================================

alter table public.incident_reports
  alter column reporter_phone drop not null;

comment on column public.incident_reports.reporter_phone is
  'Legacy/optional. No longer collected by the redesigned form (reporter is the logged-in user). Retained nullable for historical rows.';
