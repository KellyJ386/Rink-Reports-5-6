-- =============================================================================
-- 00000000000179_drop_ice_operation_change_log.sql
--
-- Drop the never-used ice_operation_change_log table.
--
-- Migration 34 created it as an append-only correction log for ice-operations
-- reports (report_id, changed_by, reason, before/after jsonb), with RLS
-- policies and indexes; migration 61 re-bound its report_id FK to the real
-- submissions table. No application code has ever inserted into or read from
-- it — the corrections model that actually shipped keeps submissions immutable
-- (UPDATE/DELETE are super_admin-only) and lets admins append
-- ice_operations_followup_notes instead.
--
-- The table has never held data, so this drop loses nothing. Policies and
-- indexes are dropped with the table. IF EXISTS keeps the file idempotent and
-- tolerant of environments where migration 34's phantom-table branch created
-- nothing.
-- =============================================================================

drop table if exists public.ice_operation_change_log;
