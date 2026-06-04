-- =============================================================================
-- 00000000000111_refrigeration_followup_note_links.sql
-- Refrigeration item 4: tie a corrective-action note to the specific reading.
--
-- Adds report_value_id (the out-of-range reading the note addresses; CASCADE so
-- a note dies with its value) and field_id (the config field, for trend/grouping
-- across reports). Both nullable so existing report-level notes remain valid.
--
-- ROLLBACK:
--   drop index if exists public.idx_refrigeration_followup_notes_report_value;
--   alter table public.refrigeration_followup_notes
--     drop column if exists field_id,
--     drop column if exists report_value_id;
-- =============================================================================
begin;

alter table public.refrigeration_followup_notes
  add column if not exists report_value_id uuid
    references public.refrigeration_report_values(id) on delete cascade,
  add column if not exists field_id uuid
    references public.refrigeration_fields(id);

comment on column public.refrigeration_followup_notes.report_value_id is
  'The specific out-of-range report value this corrective-action note addresses. NULL for report-level notes. CASCADE: the note is removed if its value row is.';
comment on column public.refrigeration_followup_notes.field_id is
  'The config field the note is about, for cross-report trend/grouping. Nullable; not CASCADE so history survives field deletion.';

create index if not exists idx_refrigeration_followup_notes_report_value
  on public.refrigeration_followup_notes (report_value_id);

commit;
