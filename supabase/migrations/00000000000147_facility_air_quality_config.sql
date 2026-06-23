-- =============================================================================
-- 00000000000147_facility_air_quality_config.sql
-- Per-facility config for the Air Quality compliance engine.
--
-- One row per facility selecting which global compliance profile applies
-- (migration 146) plus facility-level tuning:
--   - active_metrics      : which metric keys are collected (subset of profile)
--   - threshold_overrides : per-metric/per-tier STRICTER-ONLY ceilings. A
--                           facility may tighten a regulatory ceiling but never
--                           loosen it below the profile floor — enforced in the
--                           admin action (app layer) and documented here.
--   - frequency_config    : overrides/augments the profile sampling_rules
--   - escalation_config   : facility escalation contacts/actions per tier
--   - submit_roles/view_roles : optional role gates (empty = fall back to the
--                           module permission helpers).
--
-- facility_id is server-injected (RLS pins it to current_facility_id()). RLS
-- read = same-facility module access; write = facility admin / air_quality
-- module admin / super_admin. Auto-seeded (USIRA default) on facility create,
-- with a backfill for existing facilities.
-- =============================================================================

create table if not exists public.facility_air_quality_config (
  id                    uuid primary key default gen_random_uuid(),
  facility_id           uuid not null references public.facilities(id) on delete cascade,
  compliance_profile_id uuid references public.air_quality_compliance_profiles(id) on delete restrict,
  active_metrics        jsonb not null default '["co","no2"]'::jsonb,
  threshold_overrides   jsonb not null default '{}'::jsonb,
  frequency_config      jsonb not null default '{}'::jsonb,
  escalation_config     jsonb not null default '{}'::jsonb,
  submit_roles          text[] not null default '{}',
  view_roles            text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  constraint facility_air_quality_config_facility_uniq unique (facility_id)
);

comment on table public.facility_air_quality_config is
  'Per-facility Air Quality compliance config: which global compliance profile applies plus active_metrics, stricter-only threshold_overrides, frequency_config, escalation_config, and optional submit/view role gates. One row per facility.';
comment on column public.facility_air_quality_config.threshold_overrides is
  'Per-metric/per-tier ceilings that TIGHTEN the profile (never loosen). Shape mirrors profile tiers: { <metric>: { corrective?: {max}, notification?: {max}, evacuation?: {max} } }. Stricter-only is enforced in the admin server action.';

create index if not exists idx_facility_air_quality_config_facility
  on public.facility_air_quality_config (facility_id);
create index if not exists idx_facility_air_quality_config_profile
  on public.facility_air_quality_config (compliance_profile_id);

drop trigger if exists trg_facility_air_quality_config_updated_at
  on public.facility_air_quality_config;
create trigger trg_facility_air_quality_config_updated_at
  before update on public.facility_air_quality_config
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.facility_air_quality_config enable row level security;

drop policy if exists facility_air_quality_config_select
  on public.facility_air_quality_config;
create policy facility_air_quality_config_select
  on public.facility_air_quality_config
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('air_quality')
    )
  );

drop policy if exists facility_air_quality_config_insert
  on public.facility_air_quality_config;
create policy facility_air_quality_config_insert
  on public.facility_air_quality_config
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('air_quality')
      )
    )
  );

drop policy if exists facility_air_quality_config_update
  on public.facility_air_quality_config;
create policy facility_air_quality_config_update
  on public.facility_air_quality_config
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('air_quality')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('air_quality')
      )
    )
  );

drop policy if exists facility_air_quality_config_delete
  on public.facility_air_quality_config;
create policy facility_air_quality_config_delete
  on public.facility_air_quality_config
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.is_facility_admin(facility_id)
        or public.has_module_admin_access('air_quality')
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Seeder: create the config row defaulting to the USIRA profile. Idempotent.
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_facility_air_quality_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id
  from public.air_quality_compliance_profiles
  where jurisdiction = 'USIRA';

  insert into public.facility_air_quality_config (facility_id, compliance_profile_id)
  values (p_facility_id, v_profile_id)
  on conflict (facility_id) do nothing;
end;
$$;

comment on function public.seed_default_facility_air_quality_config(uuid) is
  'Seeds a facility_air_quality_config row defaulting to the USIRA profile. Idempotent via on conflict do nothing on (facility_id).';

revoke execute on function public.seed_default_facility_air_quality_config(uuid) from public;
grant  execute on function public.seed_default_facility_air_quality_config(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Auto-seed on facility creation.
-- -----------------------------------------------------------------------------
create or replace function public.tg_seed_facility_air_quality_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_facility_air_quality_config(new.id);
  return new;
end;
$$;

revoke execute on function public.tg_seed_facility_air_quality_config() from public;

drop trigger if exists facilities_seed_air_quality_config on public.facilities;
create trigger facilities_seed_air_quality_config
  after insert on public.facilities
  for each row execute function public.tg_seed_facility_air_quality_config();

-- -----------------------------------------------------------------------------
-- Backfill existing facilities.
-- -----------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_facility_air_quality_config(f.id);
  end loop;
end;
$$;
