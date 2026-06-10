-- =============================================================================
-- 00000000000134_purge_outbox_and_sync_queue.sql
--
-- D3 (360 review): notification_outbox and offline_sync_queue grow unbounded —
-- terminal rows (sent/cancelled/failed outbox rows; synced/failed queue rows)
-- were never purged. The cron route purged synced queue rows inline, but that
-- left failed rows forever and covered the outbox not at all.
--
-- Both tables hold system/delivery state rather than per-facility user data,
-- so retention is fixed-interval (like the audit log's fixed policy) instead
-- of retention_settings-driven:
--
--   purge_old_notification_outbox()
--     - sent / cancelled rows older than 90 days
--     - failed rows older than 180 days (kept longer for delivery triage)
--     - pending rows are NEVER purged (the drain owns them)
--
--   purge_old_offline_sync_queue()
--     - synced rows older than 90 days (replaces the cron route's inline
--       delete; same 90-day policy)
--     - failed rows older than 180 days (admins have had two release cycles
--       to triage via /reports/offline-queue)
--     - pending rows are NEVER purged (they may still replay)
--
-- Conventions follow migration 24: SECURITY DEFINER, pinned search_path,
-- integer count return, EXECUTE revoked from public/anon/authenticated and
-- granted to service_role only (invoked by /api/cron/run-retention-purge).
-- supabase/tests/rls_isolation.sql §2l asserts the execute gate.
-- =============================================================================

create or replace function public.purge_old_notification_outbox()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total   integer := 0;
  v_deleted integer;
begin
  delete from public.notification_outbox
   where status in ('sent', 'cancelled')
     and coalesce(sent_at, updated_at, created_at) < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.notification_outbox
   where status = 'failed'
     and coalesce(updated_at, created_at) < now() - interval '180 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  return v_total;
end;
$$;

revoke execute on function public.purge_old_notification_outbox() from public;
revoke execute on function public.purge_old_notification_outbox() from anon;
revoke execute on function public.purge_old_notification_outbox() from authenticated;
grant  execute on function public.purge_old_notification_outbox() to service_role;

comment on function public.purge_old_notification_outbox() is
  'Retention purge for terminal notification_outbox rows: sent/cancelled '
  '> 90 days, failed > 180 days. Pending rows are never touched. '
  'service_role only; invoked by /api/cron/run-retention-purge.';

create or replace function public.purge_old_offline_sync_queue()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total   integer := 0;
  v_deleted integer;
begin
  delete from public.offline_sync_queue
   where sync_status = 'synced'
     and coalesce(synced_at, created_at) < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.offline_sync_queue
   where sync_status = 'failed'
     and created_at < now() - interval '180 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  return v_total;
end;
$$;

revoke execute on function public.purge_old_offline_sync_queue() from public;
revoke execute on function public.purge_old_offline_sync_queue() from anon;
revoke execute on function public.purge_old_offline_sync_queue() from authenticated;
grant  execute on function public.purge_old_offline_sync_queue() to service_role;

comment on function public.purge_old_offline_sync_queue() is
  'Retention purge for terminal offline_sync_queue rows: synced > 90 days, '
  'failed > 180 days. Pending rows are never touched (they may still replay). '
  'service_role only; invoked by /api/cron/run-retention-purge.';
