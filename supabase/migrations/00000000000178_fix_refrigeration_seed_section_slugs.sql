-- =============================================================================
-- 00000000000178_fix_refrigeration_seed_section_slugs.sql
--
-- The SQL seed function from migration 11 used underscore slugs
-- ('supply_return', 'machine_hours') while everything since — the admin
-- console's inline seeder, and the field/threshold seeds in migrations
-- 109/113/125 — uses the hyphenated slugs ('supply-return', 'machine-hours').
-- The function is service_role-only and never invoked by a trigger, so no
-- live rows carry the underscore slugs today, but the drift breaks the
-- cross-seeder idempotency both sides rely on: a facility seeded by the SQL
-- function and then via the admin "Seed defaults" card would end up with
-- duplicate Supply / Return and Machine Hours sections (the
-- (facility_id, slug) conflict target never matches). Align the function to
-- the canonical hyphenated slugs, and defensively rename any underscore rows
-- that a service-role call may have created.
-- =============================================================================

-- Defensive data fixup: rename underscore-slug rows where the canonical
-- hyphenated row does not already exist for that facility. (If both exist the
-- underscore row is left alone — merging report history is not this
-- migration's job — but the seeders stop multiplying either way.)
update public.refrigeration_sections s
set slug = replace(s.slug, '_', '-')
where s.slug in ('supply_return', 'machine_hours')
  and not exists (
    select 1
    from public.refrigeration_sections dup
    where dup.facility_id = s.facility_id
      and dup.slug = replace(s.slug, '_', '-')
  );

create or replace function public.seed_default_refrigeration_sections(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.refrigeration_sections
    (facility_id, slug, name, sort_order, is_active)
  values
    (p_facility_id, 'compressors',    'Compressors',     1, true),
    (p_facility_id, 'pumps',          'Pumps',           2, true),
    (p_facility_id, 'condensers',     'Condensers',      3, true),
    (p_facility_id, 'supply-return',  'Supply / Return', 4, true),
    (p_facility_id, 'machine-hours',  'Machine Hours',   5, true),
    (p_facility_id, 'alarms',         'Alarms',          6, true)
  on conflict (facility_id, slug) do nothing;

  insert into public.refrigeration_settings
    (facility_id, out_of_range_alerts_enabled, default_alert_severity)
  values
    (p_facility_id, false, 'warn')
  on conflict (facility_id) do nothing;
end;
$$;

comment on function public.seed_default_refrigeration_sections(uuid) is
  'Seeds canonical refrigeration_sections (compressors, pumps, condensers, supply-return, machine-hours, alarms) and a default refrigeration_settings row for a facility. Idempotent, and slug-compatible with the admin console''s inline seeder.';
