-- =============================================================================
-- 00000000000129_schedule_settings_block_on_violations.sql
--
-- BACKFILL of production history version 20260609184411 (applied 2026-06-09 by
-- a parallel work stream). Reproduced verbatim from the prod history table so
-- the repo matches prod; idempotent (add column if not exists). See
-- docs/production-reconciliation-2026-06.md.
-- =============================================================================

alter table public.schedule_settings
  add column if not exists block_on_violations boolean not null default false;

comment on column public.schedule_settings.block_on_violations is
  'Scheduling grid: when true, assignment warnings (weekly-hours cap, overlap, required-cert gaps, time-off, overtime) become hard blocks in the grid create/update actions. Default false = advisory only.';
