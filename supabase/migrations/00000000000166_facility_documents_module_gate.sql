-- =============================================================================
-- 00000000000166_facility_documents_module_gate.sql
--
-- Add a per-module permission gate to facility_documents SELECT (audit D-02).
--
-- !!! ACCESS-CHANGING MIGRATION — READ BEFORE APPLYING !!!
-- The old facility_documents_select policy (migration 85) gated on facility
-- only, so ANY active staff member at a facility could list and obtain signed
-- download URLs for ALL of that facility's documents, regardless of module
-- permissions. This migration tightens SELECT to ALSO require
-- has_module_access('facility_documents'), mirroring how every other module's
-- report table gates SELECT (refrigeration / incident_reports:
--   is_super_admin() OR (facility_id = current_facility_id()
--                        AND has_module_access('<module>'))).
--
-- CONSEQUENCE: existing staff who previously relied on the facility-only gate
-- will LOSE read access to facility documents until they are granted a
-- `facility_documents` row in public.user_permissions
-- (module_name = 'facility_documents', action = 'view', enabled = true).
-- Provision/backfill those grants (via the permissions matrix or a data
-- migration) for anyone who should retain access.
--
-- Super-admin bypass is preserved. The admin write policies
-- (facility_documents_insert / _update / _delete, gated on is_super_admin() /
-- is_facility_admin()) are UNCHANGED.
--
-- Policy predicate only — no table shape change, so src/types/database.ts does
-- NOT need regeneration.
-- =============================================================================

begin;

drop policy if exists facility_documents_select on public.facility_documents;
create policy facility_documents_select on public.facility_documents
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('facility_documents')
    )
  );

commit;
