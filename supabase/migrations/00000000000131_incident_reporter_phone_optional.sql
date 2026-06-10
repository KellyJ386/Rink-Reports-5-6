-- =============================================================================
-- 00000000000131_incident_reporter_phone_optional.sql
--
-- BACKFILL of production history version 20260603012740 (applied 2026-06-03).
-- This change was live on prod but absent from the repo, leaving the repo's
-- base incident schema (incident_reports.reporter_phone NOT NULL) drifted from
-- production (nullable). Reproduced verbatim from the prod history table.
--
-- Ordering note: chronologically this predates the 123-127 work, but it is
-- numbered here (after the backfilled grid migrations) to avoid renumbering
-- already-deployed migration files. It has no ordering dependency on 123-130 —
-- it only relaxes a NOT NULL on a column created back in migration 8. See
-- docs/production-reconciliation-2026-06.md.
-- =============================================================================

alter table public.incident_reports
  alter column reporter_phone drop not null;

comment on column public.incident_reports.reporter_phone is
  'Legacy/optional. No longer collected by the redesigned form (reporter is the logged-in user). Retained nullable for historical rows.';
