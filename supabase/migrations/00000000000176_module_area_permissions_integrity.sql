-- =============================================================================
-- 00000000000176_module_area_permissions_integrity.sql
--
-- module_area_permissions.area_id is a soft reference by design ("callers must
-- validate" — the target table varies by module_key), but nothing enforced it
-- and deleting an area left its grants behind. In production, 15 of 26 rows
-- were orphaned grants pointing at daily_report_areas deleted ~2026-05-31
-- (purged live on 2026-07-06; snapshot preserved in the Rec-Reports repo,
-- admin-fixes/orphaned-module-area-permissions.snapshot.json).
--
-- This migration makes the predicted failure mode impossible going forward:
--   1. idempotent re-purge (no-op on prod; cleans any rebuilt environment),
--   2. BEFORE INSERT/UPDATE validation that the area exists in the same
--      facility (daily_reports is the only module using per-area grants
--      today — extend the CASE as other modules adopt areas),
--   3. AFTER DELETE cleanup on daily_report_areas, the cascade an FK cannot
--      provide for a polymorphic reference.
-- =============================================================================

begin;

-- 1. Idempotent purge of any orphaned daily_reports grants.
delete from public.module_area_permissions map
where map.module_key = 'daily_reports'
  and not exists (
    select 1 from public.daily_report_areas a where a.id = map.area_id
  );

-- 2. Validate the soft reference on write.
create or replace function public.validate_module_area_permission()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.module_key = 'daily_reports' then
    if not exists (
      select 1 from public.daily_report_areas a
      where a.id = new.area_id and a.facility_id = new.facility_id
    ) then
      raise exception
        'module_area_permissions: area % does not exist in facility % for module daily_reports',
        new.area_id, new.facility_id;
    end if;
  end if;
  return new;
end;
$$;

-- Trigger function, not an RPC: strip the default PUBLIC EXECUTE grant so it
-- is not reachable via /rest/v1/rpc/ (house pattern from migration 97).
revoke execute on function public.validate_module_area_permission() from public, anon, authenticated;

drop trigger if exists trg_validate_module_area_permission on public.module_area_permissions;
create trigger trg_validate_module_area_permission
  before insert or update of area_id, module_key, facility_id
  on public.module_area_permissions
  for each row execute function public.validate_module_area_permission();

-- 3. Clean up grants when a daily-report area is deleted.
create or replace function public.cleanup_daily_report_area_permissions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.module_area_permissions
  where module_key = 'daily_reports' and area_id = old.id;
  return old;
end;
$$;

revoke execute on function public.cleanup_daily_report_area_permissions() from public, anon, authenticated;

drop trigger if exists trg_cleanup_daily_report_area_permissions on public.daily_report_areas;
create trigger trg_cleanup_daily_report_area_permissions
  after delete on public.daily_report_areas
  for each row execute function public.cleanup_daily_report_area_permissions();

comment on function public.validate_module_area_permission() is
  'BEFORE INSERT/UPDATE guard on module_area_permissions: the polymorphic area_id must reference an existing area in the same facility for the given module_key (daily_reports today). Added after 15 orphaned grants were found in production (2026-07-06 admin-area review).';

comment on function public.cleanup_daily_report_area_permissions() is
  'AFTER DELETE on daily_report_areas: removes per-area permission grants for the deleted area — the ON DELETE CASCADE a polymorphic soft reference cannot express. SECURITY DEFINER so an area delete by a module admin also clears grants regardless of the caller''s module_area_permissions write scope.';

commit;
