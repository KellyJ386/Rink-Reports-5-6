-- =============================================================================
-- 00000000000112_refrigeration_integrity_and_trend_indexes.sql
-- Refrigeration item 5: integrity guards + trend/read indexes.
--
-- NOTE ON UNIQUENESS GUARDS (item 5): ambiguous-threshold and duplicate-active-key
-- protection is ALREADY enforced by partial unique indexes created in migration
-- 00000000000011_refrigeration_schema.sql:
--   * refrigeration_thresholds:
--       uniq_refrigeration_thresholds_field_active_no_equipment  (field_id) WHERE equipment_id IS NULL AND is_active
--       uniq_refrigeration_thresholds_field_equipment_active     (field_id, equipment_id) WHERE equipment_id IS NOT NULL AND is_active
--     => two ACTIVE thresholds can never resolve ambiguously for one field/equipment.
--   * refrigeration_fields:
--       uniq_refrigeration_fields_section_key_no_equipment   (section_id, key) WHERE equipment_id IS NULL
--       uniq_refrigeration_fields_section_equipment_key      (section_id, equipment_id, key) WHERE equipment_id IS NOT NULL
--     => duplicate keys within a section/equipment are already rejected (section_id
--        implies facility_id, so a facility_id column would be redundant).
-- We therefore add NO redundant unique indexes here. The pre-check below verifies
-- the invariant holds, and we add only the genuinely-missing trend index.
--
-- ROLLBACK:
--   drop index if exists public.idx_refrigeration_report_values_field_created;
-- =============================================================================
begin;

-- Pre-check: surface any pre-existing duplicates rather than silently assuming
-- the invariant. Expected to find zero; raises (aborting the migration) if not.
do $$
declare
  v_dupe_thresholds int;
  v_dupe_fields int;
begin
  select count(*) into v_dupe_thresholds
  from (
    select field_id, coalesce(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid) eq
    from public.refrigeration_thresholds
    where is_active
    group by 1, 2
    having count(*) > 1
  ) d;

  select count(*) into v_dupe_fields
  from (
    select section_id, coalesce(equipment_id, '00000000-0000-0000-0000-000000000000'::uuid) eq, key
    from public.refrigeration_fields
    where is_active
    group by 1, 2, 3
    having count(*) > 1
  ) d;

  if v_dupe_thresholds > 0 or v_dupe_fields > 0 then
    raise exception
      'Refrigeration integrity pre-check failed: % duplicate active threshold group(s), % duplicate active field key group(s). Resolve before applying.',
      v_dupe_thresholds, v_dupe_fields;
  end if;
end$$;

-- Trend/read performance at the 1,000-facility target: per-field history scans.
-- (report_id is already covered by idx_refrigeration_report_values_report.)
create index if not exists idx_refrigeration_report_values_field_created
  on public.refrigeration_report_values (field_id, created_at);

commit;
