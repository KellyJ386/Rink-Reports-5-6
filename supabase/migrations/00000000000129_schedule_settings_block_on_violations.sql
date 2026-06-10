-- =============================================================================
-- 00000000000129_schedule_settings_block_on_violations.sql
-- Scheduling grid Phase 4: make the smart-layer warnings enforceable.
--
-- The drag-to-create grid surfaces advisory warnings (weekly-hours cap, overlap,
-- required-cert gaps, time-off, overtime) computed by
-- scheduling_assignment_violations() + the per-employee employees.max_weekly_hours
-- cap. Those are advisory BY DEFAULT. This flag lets a facility opt into hard
-- enforcement: when true, the grid's create/update server actions refuse a write
-- that would raise any of those warnings.
--
-- Lives in schedule_settings alongside the other compliance toggles
-- (require_job_area_qualification, notify_on_overtime, ...) and is surfaced in
-- the scheduling settings form. Additive / non-destructive; safe to re-run.
-- =============================================================================

alter table public.schedule_settings
  add column if not exists block_on_violations boolean not null default false;

comment on column public.schedule_settings.block_on_violations is
  'Scheduling grid: when true, assignment warnings (weekly-hours cap, overlap, required-cert gaps, time-off, overtime) become hard blocks in the grid create/update actions. Default false = advisory only.';

-- VERIFICATION (run manually after apply):
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema='public' and table_name='schedule_settings'
--   and column_name='block_on_violations';
-- -- expect: block_on_violations | boolean | NO | false
