-- =============================================================================
-- 00000000000037_retention_last_purged_at.sql
--
-- Adds last_purged_at to retention_settings so the Admin UI can display
-- when each module's data was last purged, and record manual purge runs.
-- =============================================================================

alter table public.retention_settings
  add column if not exists last_purged_at timestamptz,
  add column if not exists last_purge_count integer;

comment on column public.retention_settings.last_purged_at is
  'Timestamp of the most recent purge run for this module.';
comment on column public.retention_settings.last_purge_count is
  'Number of records deleted during the most recent purge run.';
