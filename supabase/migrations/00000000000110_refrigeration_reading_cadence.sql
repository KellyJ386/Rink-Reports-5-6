-- =============================================================================
-- 00000000000110_refrigeration_reading_cadence.sql
-- Refrigeration item 3: reading cadence on refrigeration_reports.
--
-- Adds reading_at (when the round was actually taken, distinct from
-- submitted_at/created_at) plus nullable shift / round_no for future cadence
-- reporting. Backfills reading_at for existing rows and indexes
-- (facility_id, reading_at desc) for time-window queries.
--
-- ROLLBACK:
--   drop index if exists public.idx_refrigeration_reports_facility_reading;
--   alter table public.refrigeration_reports
--     drop column if exists round_no,
--     drop column if exists shift,
--     drop column if exists reading_at;
-- =============================================================================
begin;

alter table public.refrigeration_reports
  add column if not exists reading_at timestamptz not null default now(),
  add column if not exists shift      text,
  add column if not exists round_no   smallint;

comment on column public.refrigeration_reports.reading_at is
  'When the reading round was physically taken. Distinct from submitted_at (when the report was saved) and created_at (row insert). Defaults to now() when the client does not supply it.';
comment on column public.refrigeration_reports.shift is
  'Optional shift label for cadence reporting (e.g. AM/PM/Overnight). Free-form, nullable.';
comment on column public.refrigeration_reports.round_no is
  'Optional sequential round number within a shift/day for cadence reporting. Nullable.';

-- Backfill existing rows to a sensible reading time.
update public.refrigeration_reports
   set reading_at = coalesce(submitted_at, created_at)
 where reading_at is not null;

create index if not exists idx_refrigeration_reports_facility_reading
  on public.refrigeration_reports (facility_id, reading_at desc);

commit;
