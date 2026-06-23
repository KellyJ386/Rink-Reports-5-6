-- =============================================================================
-- 00000000000149_backfill_scheduling_config.sql
--
-- New facilities auto-seed scheduling config (schedule_settings + baseline
-- compliance rules) via the create_facility_with_roles() path (migration 120).
-- Facilities that existed BEFORE that trigger never got seeded, so their
-- scheduling rules engine runs with NULL settings. One-time backfill: seed any
-- facility that still lacks a schedule_settings row.
--
-- seed_default_scheduling_config() (migration 117) is idempotent, so this is
-- safe to re-run and a no-op once every facility is seeded.
-- =============================================================================

do $$
declare
  v_facility record;
begin
  for v_facility in
    select f.id
      from public.facilities f
     where not exists (
       select 1 from public.schedule_settings s where s.facility_id = f.id
     )
  loop
    perform public.seed_default_scheduling_config(v_facility.id);
  end loop;
end$$;
