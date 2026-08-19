-- =============================================================================
-- 00000000000241_audit_logs_partition_rls.sql
--
-- Close a cross-tenant read hole left by the partitioning pilot (222).
--
-- WHAT WENT WRONG: 222 enabled RLS on the partitioned *parent* only, on the
-- assumption (also stated in docs/phase5-partitioning-plan.md and in the
-- rls_isolation.sql comment) that parent RLS "applies to every partition".
-- That is only true for queries that NAME the parent. Row security is a
-- per-relation flag: a query that names a partition directly — and PostgREST
-- exposes partitions as ordinary tables, so `GET /rest/v1/audit_logs_y2026`
-- does exactly that — is governed by the partition's own RLS state, which was
-- never enabled. Combined with the stock default privileges (SELECT granted
-- to anon/authenticated on every new table), any authenticated user could
-- read every facility's audit trail through a partition.
--
-- THE FIX, two independent fences per partition:
--   1. enable row level security — with no policies, direct access is
--      default-deny. Access THROUGH the parent is unaffected (the policies
--      of the relation named in the query are the ones applied), so app
--      inserts/selects on public.audit_logs behave exactly as before.
--   2. revoke anon/authenticated privileges — belt and braces, and it makes
--      the failure mode an explicit permission error instead of silent
--      empty results. service_role keeps its grant (it has BYPASSRLS and the
--      cron/retention paths run as the function owner anyway).
--
-- Also revokes the parent-table grant to anon from 222 — the only anon table
-- grant in the schema. It was fail-closed only by accident (anon cannot
-- execute the helper functions the policies call); anon has no business on
-- audit_logs at all.
--
-- The loop walks pg_inherits rather than hardcoding names so it covers all
-- 14 partitions (y2023–y2035 + default) and any partition added before this
-- migration runs. Any FUTURE partition-creation path must repeat both steps
-- (enable RLS + revoke) — rls_isolation.sql now meta-asserts that every
-- table in public has RLS enabled, so forgetting fails CI, not production.
-- =============================================================================

do $$
declare
  part regclass;
begin
  for part in
    select inhrelid::regclass
      from pg_inherits
     where inhparent = 'public.audit_logs'::regclass
     order by inhrelid::regclass::text
  loop
    execute format('alter table %s enable row level security', part);
    execute format('revoke all on %s from anon, authenticated', part);
  end loop;
end $$;

revoke all on public.audit_logs from anon;
