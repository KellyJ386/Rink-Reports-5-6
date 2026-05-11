-- =============================================================================
-- 00000000000036_export_settings_columns.sql
--
-- Adds date_format and module_column_visibility to export_settings.
-- date_format controls how dates appear on PDFs/CSVs.
-- module_column_visibility is a jsonb map of module_key → array of visible columns.
-- =============================================================================

alter table public.export_settings
  add column if not exists date_format text not null default 'MM/DD/YYYY'
    check (date_format in ('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD')),
  add column if not exists csv_delimiter text not null default 'comma'
    check (csv_delimiter in ('comma', 'tab', 'semicolon')),
  add column if not exists module_column_visibility jsonb not null default '{}'::jsonb;

comment on column public.export_settings.date_format is
  'Date format used on PDF exports and CSVs (e.g. MM/DD/YYYY).';
comment on column public.export_settings.csv_delimiter is
  'Field delimiter for CSV exports: comma, tab, or semicolon.';
comment on column public.export_settings.module_column_visibility is
  'Per-module map of visible columns for exports. '
  'Key = module_key, value = array of column identifiers to include.';
