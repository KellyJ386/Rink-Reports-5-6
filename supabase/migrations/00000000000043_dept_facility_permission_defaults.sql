-- =============================================================================
-- 00000000000043_dept_facility_permission_defaults.sql
--
-- Phase 1 of the production permission model. Adds the missing two tiers of
-- the resolver chain so the final priority order becomes:
--
--   1. Explicit per-employee override (module_permissions)
--   2. Role default            (role_module_permission_defaults)
--   3. MAX(department default) across the employee's department memberships
--      (department_module_permission_defaults, NEW)
--   4. Facility default        (facility_module_permission_defaults, NEW)
--   5. 'none'
--
-- The resolver is rewritten in place. Signature is unchanged, so every
-- RLS policy that calls has_module_permission() / current_employee_module_permission()
-- automatically picks up the new behaviour without policy edits.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. department_module_permission_defaults
-- -----------------------------------------------------------------------------
create table if not exists public.department_module_permission_defaults (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references public.facilities(id) on delete restrict,
  department_id    uuid not null references public.departments(id) on delete cascade,
  module_key       text not null,
  permission_level public.module_permission_level not null default 'none',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  constraint dept_mp_defaults_uniq unique (department_id, module_key)
);

comment on table public.department_module_permission_defaults is
  'Department-based fallback permissions. effective_module_permission() consults this '
  'after the employee override and role default tiers, taking MAX across all of the '
  'employee''s department memberships.';

create index if not exists idx_dept_mp_defaults_facility_id
  on public.department_module_permission_defaults (facility_id);
create index if not exists idx_dept_mp_defaults_department_id
  on public.department_module_permission_defaults (department_id);
create index if not exists idx_dept_mp_defaults_module_key
  on public.department_module_permission_defaults (module_key);

drop trigger if exists trg_dept_mp_defaults_updated_at
  on public.department_module_permission_defaults;
create trigger trg_dept_mp_defaults_updated_at
  before update on public.department_module_permission_defaults
  for each row execute function public.set_updated_at();

alter table public.department_module_permission_defaults enable row level security;

drop policy if exists dept_mp_defaults_select on public.department_module_permission_defaults;
create policy dept_mp_defaults_select
  on public.department_module_permission_defaults
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists dept_mp_defaults_insert on public.department_module_permission_defaults;
create policy dept_mp_defaults_insert
  on public.department_module_permission_defaults
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists dept_mp_defaults_update on public.department_module_permission_defaults;
create policy dept_mp_defaults_update
  on public.department_module_permission_defaults
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists dept_mp_defaults_delete on public.department_module_permission_defaults;
create policy dept_mp_defaults_delete
  on public.department_module_permission_defaults
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

-- -----------------------------------------------------------------------------
-- 2. facility_module_permission_defaults
-- -----------------------------------------------------------------------------
create table if not exists public.facility_module_permission_defaults (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references public.facilities(id) on delete cascade,
  module_key       text not null,
  permission_level public.module_permission_level not null default 'none',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  constraint facility_mp_defaults_uniq unique (facility_id, module_key)
);

comment on table public.facility_module_permission_defaults is
  'Facility-wide fallback permissions. Final tier before ''none'' in the resolver chain.';

create index if not exists idx_facility_mp_defaults_facility_id
  on public.facility_module_permission_defaults (facility_id);
create index if not exists idx_facility_mp_defaults_module_key
  on public.facility_module_permission_defaults (module_key);

drop trigger if exists trg_facility_mp_defaults_updated_at
  on public.facility_module_permission_defaults;
create trigger trg_facility_mp_defaults_updated_at
  before update on public.facility_module_permission_defaults
  for each row execute function public.set_updated_at();

alter table public.facility_module_permission_defaults enable row level security;

drop policy if exists facility_mp_defaults_select on public.facility_module_permission_defaults;
create policy facility_mp_defaults_select
  on public.facility_module_permission_defaults
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_mp_defaults_insert on public.facility_module_permission_defaults;
create policy facility_mp_defaults_insert
  on public.facility_module_permission_defaults
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists facility_mp_defaults_update on public.facility_module_permission_defaults;
create policy facility_mp_defaults_update
  on public.facility_module_permission_defaults
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists facility_mp_defaults_delete on public.facility_module_permission_defaults;
create policy facility_mp_defaults_delete
  on public.facility_module_permission_defaults
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

-- -----------------------------------------------------------------------------
-- 3. effective_module_permission() — full chain
--
-- Resolution order:
--   super_admin  -> 'admin'
--   override row -> override.permission_level (even if it's 'none')
--   role default -> rmd.permission_level
--   MAX(dept defaults across employee's departments)
--   facility default
--   'none'
--
-- Signature unchanged. RLS policies that call this need no edits.
-- -----------------------------------------------------------------------------
create or replace function public.effective_module_permission(
  p_employee_id uuid,
  p_module_key  text
)
returns public.module_permission_level
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id     uuid;
  v_user_id     uuid;
  v_facility_id uuid;
  v_is_active   boolean;
  v_is_super    boolean;
  v_override    public.module_permission_level;
  v_role_def    public.module_permission_level;
  v_dept_max    public.module_permission_level;
  v_fac_def     public.module_permission_level;
begin
  if p_employee_id is null or p_module_key is null then
    return 'none'::module_permission_level;
  end if;

  select e.role_id, e.user_id, e.facility_id, e.is_active
    into v_role_id, v_user_id, v_facility_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true then
    return 'none'::module_permission_level;
  end if;

  if v_user_id is not null then
    select u.is_super_admin into v_is_super
    from public.users u where u.id = v_user_id;
    if v_is_super then
      return 'admin'::module_permission_level;
    end if;
  end if;

  -- Tier 1: per-employee override wins when present (even if 'none').
  select mp.permission_level into v_override
  from public.module_permissions mp
  where mp.employee_id = p_employee_id
    and mp.module_key  = p_module_key
  limit 1;

  if v_override is not null then
    return v_override;
  end if;

  -- Tier 2: role default.
  select rmd.permission_level into v_role_def
  from public.role_module_permission_defaults rmd
  where rmd.role_id    = v_role_id
    and rmd.module_key = p_module_key
  limit 1;

  if v_role_def is not null and v_role_def <> 'none'::module_permission_level then
    return v_role_def;
  end if;

  -- Tier 3: MAX across the employee's department defaults.
  -- Enum ordering is meaningful: max() works on enums.
  select max(dmd.permission_level) into v_dept_max
  from public.employee_departments ed
  join public.department_module_permission_defaults dmd
    on dmd.department_id = ed.department_id
  where ed.employee_id = p_employee_id
    and dmd.module_key = p_module_key;

  if v_dept_max is not null and v_dept_max <> 'none'::module_permission_level then
    return v_dept_max;
  end if;

  -- Tier 4: facility default.
  if v_facility_id is not null then
    select fmd.permission_level into v_fac_def
    from public.facility_module_permission_defaults fmd
    where fmd.facility_id = v_facility_id
      and fmd.module_key  = p_module_key
    limit 1;

    if v_fac_def is not null and v_fac_def <> 'none'::module_permission_level then
      return v_fac_def;
    end if;
  end if;

  -- Tier 5: if role default was 'none' explicitly, honour that. Otherwise default to 'none'.
  return coalesce(v_role_def, 'none'::module_permission_level);
end;
$$;

comment on function public.effective_module_permission(uuid, text) is
  'Resolves (employee, module) using: super_admin -> override -> role default -> '
  'MAX(department defaults) -> facility default -> none. Higher tiers short-circuit '
  'only when they return a non-none level; an explicit override of ''none'' still wins.';

revoke execute on function public.effective_module_permission(uuid, text) from public, anon;
grant  execute on function public.effective_module_permission(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. effective_module_permission_with_source(employee_id, module_key)
--
-- Returns the resolved level plus a text tag describing which tier produced it.
-- Used by the employee detail "Module Access" tab so the admin can see *why*
-- an employee has a given permission and decide whether to override.
-- Source values: 'super_admin' | 'override' | 'role' | 'department' |
--                'facility' | 'none'.
-- -----------------------------------------------------------------------------
create or replace function public.effective_module_permission_with_source(
  p_employee_id uuid,
  p_module_key  text,
  out level     public.module_permission_level,
  out source    text
)
returns record
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id     uuid;
  v_user_id     uuid;
  v_facility_id uuid;
  v_is_active   boolean;
  v_is_super    boolean;
  v_override    public.module_permission_level;
  v_role_def    public.module_permission_level;
  v_dept_max    public.module_permission_level;
  v_fac_def     public.module_permission_level;
begin
  level  := 'none'::module_permission_level;
  source := 'none';

  if p_employee_id is null or p_module_key is null then
    return;
  end if;

  select e.role_id, e.user_id, e.facility_id, e.is_active
    into v_role_id, v_user_id, v_facility_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true then
    return;
  end if;

  if v_user_id is not null then
    select u.is_super_admin into v_is_super
    from public.users u where u.id = v_user_id;
    if v_is_super then
      level := 'admin'::module_permission_level;
      source := 'super_admin';
      return;
    end if;
  end if;

  select mp.permission_level into v_override
  from public.module_permissions mp
  where mp.employee_id = p_employee_id and mp.module_key = p_module_key
  limit 1;

  if v_override is not null then
    level := v_override;
    source := 'override';
    return;
  end if;

  select rmd.permission_level into v_role_def
  from public.role_module_permission_defaults rmd
  where rmd.role_id = v_role_id and rmd.module_key = p_module_key
  limit 1;

  if v_role_def is not null and v_role_def <> 'none'::module_permission_level then
    level := v_role_def;
    source := 'role';
    return;
  end if;

  select max(dmd.permission_level) into v_dept_max
  from public.employee_departments ed
  join public.department_module_permission_defaults dmd
    on dmd.department_id = ed.department_id
  where ed.employee_id = p_employee_id
    and dmd.module_key = p_module_key;

  if v_dept_max is not null and v_dept_max <> 'none'::module_permission_level then
    level := v_dept_max;
    source := 'department';
    return;
  end if;

  if v_facility_id is not null then
    select fmd.permission_level into v_fac_def
    from public.facility_module_permission_defaults fmd
    where fmd.facility_id = v_facility_id and fmd.module_key = p_module_key
    limit 1;

    if v_fac_def is not null and v_fac_def <> 'none'::module_permission_level then
      level := v_fac_def;
      source := 'facility';
      return;
    end if;
  end if;

  if v_role_def is not null then
    level := v_role_def;
    source := 'role';
    return;
  end if;

  level := 'none'::module_permission_level;
  source := 'none';
end;
$$;

comment on function public.effective_module_permission_with_source(uuid, text) is
  'Like effective_module_permission() but also returns the tier that produced '
  'the level: super_admin, override, role, department, facility, or none.';

revoke execute on function public.effective_module_permission_with_source(uuid, text)
  from public, anon;
grant  execute on function public.effective_module_permission_with_source(uuid, text)
  to authenticated;
