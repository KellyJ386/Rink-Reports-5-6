-- =============================================================================
-- 00000000000269_export_settings_defaults.sql
--
-- export_settings (migration 19) has had zero rows since it was created —
-- confirmed against production before this migration. build-export.ts already
-- tolerates that (defaultSettings() fallback), but Phase 6's branded PDF
-- header/footer wants a REAL row to back the branding fields (logo_url,
-- header_text, footer_text) an admin can actually edit, not an in-memory
-- fallback that silently resets on every read. This seeds one, and wires
-- future facilities to get one automatically, following the same
-- facilities-insert-trigger pattern as seed_default_door_types /
-- seed_default_dasher_boards_config / etc.
-- =============================================================================

begin;

create or replace function public.seed_default_export_settings(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.export_settings (facility_id)
  values (p_facility_id)
  on conflict (facility_id) do nothing;
end;
$$;

comment on function public.seed_default_export_settings(uuid) is
  'Seeds one export_settings row (all defaults) for a facility if it does not '
  'already have one. Idempotent via on conflict on the facility_id unique '
  'constraint (migration 19). Called from the facilities insert trigger for new '
  'facilities, and once here as a backfill for existing ones.';

revoke execute on function public.seed_default_export_settings(uuid) from public, anon, authenticated;
grant  execute on function public.seed_default_export_settings(uuid) to service_role;

create or replace function public.tg_seed_export_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_export_settings(new.id);
  return new;
end;
$$;

drop trigger if exists facilities_seed_export_settings on public.facilities;
create trigger facilities_seed_export_settings
  after insert on public.facilities
  for each row execute function public.tg_seed_export_settings();

-- Backfill every existing facility.
do $$
declare
  f record;
  v_seeded int := 0;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_export_settings(f.id);
    v_seeded := v_seeded + 1;
  end loop;
  raise notice 'migration 269: seed_default_export_settings invoked for % facility(ies)', v_seeded;
end $$;

commit;
