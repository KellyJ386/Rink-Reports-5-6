-- 00000000000077_user_permissions_replace.sql
--
-- Replaces the (employees + role_module_permission_defaults +
-- module_permissions) permission system with a single per-user grid:
-- `user_permissions` rows of (user_id, facility_id, module_name, action).
--
-- The four actions are: view, submit, edit, admin (least -> most).
-- A user has access only if an `enabled = true` row exists for that
-- (facility, module, action). No fallback to roles. No fallback to anything.
--
-- The legacy resolver functions
--   effective_module_permission(employee_id, module_key)
--   effective_module_permission_with_source(employee_id, module_key)
--   current_employee_module_permission(module_key)
-- keep their signatures and return the old `module_permission_level` enum,
-- but now derive the level from `user_permissions` instead of the dropped
-- `module_permissions` / `role_module_permission_defaults` tables. Every
-- RLS policy in migrations 30 and 71 calls those resolvers, so policies
-- continue to work without changes.
--
-- Backfill mapping (old enum -> set of actions seeded as enabled=true):
--   none                                          -> (nothing)
--   view                                          -> view
--   submit                                        -> view, submit
--   edit_own, edit_all                            -> view, submit, edit
--   approve, publish, manage_settings, admin      -> view, submit, edit, admin
--
-- Reverse mapping (user_permissions -> enum), used by the resolvers so
-- existing RLS keeps comparing against the enum:
--   has admin   -> 'admin'
--   has edit    -> 'edit_all'
--   has submit  -> 'submit'
--   has view    -> 'view'
--   none        -> 'none'

begin;

-- -----------------------------------------------------------------------------
-- 1. user_action enum + user_permissions table
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_action') then
    create type public.user_action as enum ('view', 'submit', 'edit', 'admin');
  end if;
end$$;

create table if not exists public.user_permissions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id)      on delete cascade,
  facility_id  uuid not null references public.facilities(id) on delete cascade,
  module_name  text not null,
  action       public.user_action not null,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint user_permissions_module_name_check check (
    module_name in (
      'daily_reports', 'ice_depth', 'ice_operations',
      'incident_reports', 'accident_reports', 'refrigeration',
      'air_quality', 'scheduling', 'communications', 'admin'
    )
  ),
  constraint user_permissions_unique unique (user_id, facility_id, module_name, action)
);

create index if not exists user_permissions_lookup_idx
  on public.user_permissions (user_id, facility_id, module_name)
  where enabled = true;

create index if not exists user_permissions_facility_module_idx
  on public.user_permissions (facility_id, module_name);

-- updated_at trigger (reuses the project-wide helper from migration 3).
drop trigger if exists trg_user_permissions_set_updated_at on public.user_permissions;
create trigger trg_user_permissions_set_updated_at
  before update on public.user_permissions
  for each row execute function public.set_updated_at();

alter table public.user_permissions enable row level security;

-- super_admin: full access. Facility admin (has admin action on 'admin' module
-- in that facility): full access within their facility. Users may read their own.
drop policy if exists user_permissions_select on public.user_permissions;
create policy user_permissions_select on public.user_permissions
  for select to authenticated
  using (
    public.is_super_admin()
    or user_id = auth.uid()
    or exists (
      select 1 from public.user_permissions caller
      where caller.user_id     = auth.uid()
        and caller.facility_id = user_permissions.facility_id
        and caller.module_name = 'admin'
        and caller.action      = 'admin'
        and caller.enabled     = true
    )
  );

drop policy if exists user_permissions_write on public.user_permissions;
create policy user_permissions_write on public.user_permissions
  for all to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.user_permissions caller
      where caller.user_id     = auth.uid()
        and caller.facility_id = user_permissions.facility_id
        and caller.module_name = 'admin'
        and caller.action      = 'admin'
        and caller.enabled     = true
    )
  )
  with check (
    public.is_super_admin()
    or exists (
      select 1 from public.user_permissions caller
      where caller.user_id     = auth.uid()
        and caller.facility_id = user_permissions.facility_id
        and caller.module_name = 'admin'
        and caller.action      = 'admin'
        and caller.enabled     = true
    )
  );

-- -----------------------------------------------------------------------------
-- 2. Backfill from existing permission system
--
-- For each active employee with a user_id, compute the effective level the
-- old way (override -> role default -> none), then explode into action rows.
-- Super admins get every (action, module) row in every facility they're
-- attached to via `users.facility_id` (if any), so cross-facility super_admin
-- behavior continues to be governed by public.is_super_admin() in resolvers.
-- -----------------------------------------------------------------------------

do $$
declare
  v_inserted bigint := 0;
  v_super_inserted bigint := 0;
  v_employee_count bigint := 0;
begin
  select count(*) into v_employee_count
  from public.employees e
  where e.is_active = true and e.user_id is not null;

  raise notice 'user_permissions backfill: scanning % active employees', v_employee_count;

  with resolved as (
    select
      e.user_id,
      e.facility_id,
      m.module_name,
      coalesce(mp.permission_level, rmd.permission_level, 'none'::public.module_permission_level) as level
    from public.employees e
    cross join (
      values
        ('daily_reports'),    ('ice_depth'),       ('ice_operations'),
        ('incident_reports'), ('accident_reports'),('refrigeration'),
        ('air_quality'),      ('scheduling'),      ('communications'),
        ('admin')
    ) as m(module_name)
    left join public.module_permissions mp
           on mp.employee_id = e.id and mp.module_key = m.module_name
    left join public.role_module_permission_defaults rmd
           on rmd.role_id    = e.role_id and rmd.module_key = m.module_name
    where e.is_active = true and e.user_id is not null
  ),
  exploded as (
    select user_id, facility_id, module_name, action::public.user_action
    from resolved
    cross join lateral (
      select unnest(
        case
          when level = 'none'                                     then array[]::text[]
          when level = 'view'                                     then array['view']
          when level = 'submit'                                   then array['view','submit']
          when level in ('edit_own','edit_all')                   then array['view','submit','edit']
          when level in ('approve','publish','manage_settings','admin')
                                                                  then array['view','submit','edit','admin']
          else array[]::text[]
        end
      ) as action
    ) a
  )
  insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
  select user_id, facility_id, module_name, action, true
  from exploded
  on conflict (user_id, facility_id, module_name, action) do nothing;

  get diagnostics v_inserted = row_count;
  raise notice 'user_permissions backfill: inserted % rows from employee overrides + role defaults', v_inserted;

  -- Super admins: grant every action on every module at their primary facility
  -- (if set). is_super_admin() in resolvers handles users without a facility.
  insert into public.user_permissions (user_id, facility_id, module_name, action, enabled)
  select u.id, u.facility_id, m.module_name, a.action, true
  from public.users u
  cross join (values
    ('daily_reports'), ('ice_depth'), ('ice_operations'),
    ('incident_reports'), ('accident_reports'), ('refrigeration'),
    ('air_quality'), ('scheduling'), ('communications'), ('admin')
  ) m(module_name)
  cross join (values ('view'::public.user_action), ('submit'), ('edit'), ('admin')) a(action)
  where u.is_super_admin = true and u.facility_id is not null
  on conflict (user_id, facility_id, module_name, action) do nothing;

  get diagnostics v_super_inserted = row_count;
  raise notice 'user_permissions backfill: inserted % super_admin rows', v_super_inserted;
end$$;

-- -----------------------------------------------------------------------------
-- 3. New helper functions for app-level checks
-- -----------------------------------------------------------------------------

create or replace function public.user_has_permission(
  p_user_id     uuid,
  p_facility_id uuid,
  p_module_name text,
  p_action      public.user_action
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.is_super_admin from public.users u where u.id = p_user_id),
    false
  )
  or exists (
    select 1 from public.user_permissions
    where user_id     = p_user_id
      and facility_id = p_facility_id
      and module_name = p_module_name
      and action      = p_action
      and enabled     = true
  );
$$;

comment on function public.user_has_permission(uuid, uuid, text, public.user_action) is
  'True iff (user, facility, module, action) is enabled, or the user is a global super_admin.';

revoke execute on function public.user_has_permission(uuid, uuid, text, public.user_action) from public, anon;
grant  execute on function public.user_has_permission(uuid, uuid, text, public.user_action) to authenticated;

create or replace function public.current_user_has_permission(
  p_module_name text,
  p_action      public.user_action
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_fac uuid;
begin
  if v_uid is null then return false; end if;
  if public.is_super_admin() then return true; end if;

  v_fac := public.current_facility_id();
  if v_fac is null then return false; end if;

  return exists (
    select 1 from public.user_permissions
    where user_id     = v_uid
      and facility_id = v_fac
      and module_name = p_module_name
      and action      = p_action
      and enabled     = true
  );
end;
$$;

revoke execute on function public.current_user_has_permission(text, public.user_action) from public, anon;
grant  execute on function public.current_user_has_permission(text, public.user_action) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Rewrite legacy resolvers to read from user_permissions.
--    Signatures and return types preserved so existing RLS keeps working.
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
  v_user_id     uuid;
  v_facility_id uuid;
  v_is_active   boolean;
  v_is_super    boolean;
  v_has_admin   boolean;
  v_has_edit    boolean;
  v_has_submit  boolean;
  v_has_view    boolean;
begin
  if p_employee_id is null or p_module_key is null then
    return 'none'::module_permission_level;
  end if;

  select e.user_id, e.facility_id, e.is_active
    into v_user_id, v_facility_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true or v_user_id is null then
    return 'none'::module_permission_level;
  end if;

  if not public.is_super_admin() then
    if v_facility_id is null or v_facility_id <> public.current_facility_id() then
      return 'none'::module_permission_level;
    end if;
  end if;

  select u.is_super_admin into v_is_super from public.users u where u.id = v_user_id;
  if v_is_super then
    return 'admin'::module_permission_level;
  end if;

  select
    bool_or(action = 'admin'  and enabled),
    bool_or(action = 'edit'   and enabled),
    bool_or(action = 'submit' and enabled),
    bool_or(action = 'view'   and enabled)
    into v_has_admin, v_has_edit, v_has_submit, v_has_view
  from public.user_permissions
  where user_id     = v_user_id
    and facility_id = v_facility_id
    and module_name = p_module_key;

  if coalesce(v_has_admin,  false) then return 'admin'::module_permission_level;    end if;
  if coalesce(v_has_edit,   false) then return 'edit_all'::module_permission_level; end if;
  if coalesce(v_has_submit, false) then return 'submit'::module_permission_level;   end if;
  if coalesce(v_has_view,   false) then return 'view'::module_permission_level;     end if;
  return 'none'::module_permission_level;
end;
$$;

revoke execute on function public.effective_module_permission(uuid, text) from public, anon;
grant  execute on function public.effective_module_permission(uuid, text) to authenticated;

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
begin
  level  := public.effective_module_permission(p_employee_id, p_module_key);
  source := case
    when level = 'none'::module_permission_level then 'none'
    when (select u.is_super_admin
            from public.employees e
            join public.users u on u.id = e.user_id
           where e.id = p_employee_id) then 'super_admin'
    else 'user_permissions'
  end;
end;
$$;

revoke execute on function public.effective_module_permission_with_source(uuid, text) from public, anon;
grant  execute on function public.effective_module_permission_with_source(uuid, text) to authenticated;

-- current_employee_module_permission already delegates to
-- effective_module_permission via current_employee_id(); no change needed.

-- -----------------------------------------------------------------------------
-- 5. Mark the legacy tables deprecated. We do NOT drop them yet because ~25
-- report pages still read from `module_permissions` directly (see grep output
-- in the PR description). The resolver functions no longer touch them, so the
-- tables are inert from a permission-enforcement perspective but remain
-- readable. A follow-up sweep should rewrite those pages to query
-- `user_permissions` (or `current_user_has_permission()`) and then drop the
-- tables in a later migration.
-- -----------------------------------------------------------------------------

comment on table public.module_permissions is
  'DEPRECATED as of migration 77. Source of truth is now public.user_permissions. '
  'Resolver functions no longer read this table. Drop after report pages are migrated.';

comment on table public.role_module_permission_defaults is
  'DEPRECATED as of migration 77. Source of truth is now public.user_permissions. '
  'Resolver functions no longer read this table. Drop after admin/roles page is migrated.';

commit;
