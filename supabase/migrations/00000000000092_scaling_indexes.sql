-- =============================================================================
-- 00000000000091_scaling_indexes.sql
--
-- Two indexes that close verified planner gaps at scale. Both tables grow with
-- tenant activity and are filtered by facility_id under RLS, but neither had an
-- index that the planner could use for its hot access pattern.
--
-- 1. communication_recipients is a fan-out table (one message -> N recipient
--    rows). Its RLS SELECT policy filters on facility_id = current_facility_id()
--    (00000000000009_communications_schema.sql ~line 584). Existing indexes are
--    (employee_id, read_at), (message_id), and a partial email-ready index
--    constrained to email_status='pending' (00000000000062) -- none of which
--    serves a per-tenant facility_id scan. Result: a sequential scan per tenant.
--
-- 2. audit_logs is the fastest-growing table (triggers on ~20 tables write to
--    it). The admin audit view filters by facility AND orders by created_at desc.
--    Existing indexes are single-column only: (facility_id), (actor_user_id),
--    (entity_type, entity_id), (created_at desc) (00000000000002 ~lines 310-317).
--    A compound (facility_id, created_at desc) lets the planner satisfy both the
--    filter and the ordering from one index seek, avoiding a sort step.
-- =============================================================================

create index if not exists idx_communication_recipients_facility
  on public.communication_recipients (facility_id);

create index if not exists idx_audit_logs_facility_created
  on public.audit_logs (facility_id, created_at desc);
