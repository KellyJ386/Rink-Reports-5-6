-- =============================================================================
-- 00000000000100_user_account_management.sql
--
-- User Account Management feature.
--
-- 1. Adds self-service profile columns to public.users (mailing address,
--    emergency contact, and the SMS/text-notification opt-in flag).
-- 2. Adds public.can_edit_user_profile(target) — the single source of truth
--    for "who may edit whose profile" used by BOTH the users_update RLS
--    policy and the server action. Rule: a user may edit their own row, a
--    super admin may edit anyone, and otherwise an editor may edit a target
--    in the SAME facility only when the editor outranks the target
--    (strictly lower hierarchy_level). This encodes "Supervisors and above
--    can edit profiles of users below them" without hard-coding role keys,
--    so it keeps working as the role set evolves.
-- 3. Adds a BEFORE UPDATE guard trigger so a self-service edit can never
--    escalate privilege (flip is_super_admin / is_active) or move a user
--    between facilities. Privileged columns stay editable by super admins,
--    facility admins, and internal/service-role flows.
-- 4. Replaces the users_update policy to ALSO allow self + hierarchy edits
--    (the previous predicate — admin/super_admin same-facility — is kept,
--    so existing admin flows are unchanged).
-- 5. Adds public.profile_audit_log: append-only record of who edited whose
--    profile and which fields changed (written on supervisor+ edits).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Profile columns on public.users (phone already exists)
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists address_line1           text,
  add column if not exists address_line2           text,
  add column if not exists city                     text,
  add column if not exists state_province           text,
  add column if not exists postal_code              text,
  add column if not exists country                  text,
  add column if not exists emergency_contact_name   text,
  add column if not exists emergency_contact_phone  text,
  add column if not exists sms_opt_in               boolean not null default false;

comment on column public.users.sms_opt_in is
  'Master opt-in for text-message notifications. Must be checked before any '
  'SMS is dispatched to this user. When false, no SMS of any kind is sent.';

-- Bound the abuse surface / keep values sane. NOT VALID would let bad data
-- linger; the table is small so validate immediately.
alter table public.users
  drop constraint if exists users_profile_lengths_check;
alter table public.users
  add constraint users_profile_lengths_check check (
    (address_line1          is null or char_length(address_line1)          <= 200) and
    (address_line2          is null or char_length(address_line2)          <= 200) and
    (city                   is null or char_length(city)                   <= 120) and
    (state_province         is null or char_length(state_province)         <= 120) and
    (postal_code            is null or char_length(postal_code)            <= 40)  and
    (country                is null or char_length(country)                <= 120) and
    (emergency_contact_name is null or char_length(emergency_contact_name) <= 200) and
    (emergency_contact_phone is null or char_length(emergency_contact_phone) <= 40)
  );

-- ---------------------------------------------------------------------------
-- 2. can_edit_user_profile(target) -> boolean
-- ---------------------------------------------------------------------------
create or replace function public.can_edit_user_profile(p_target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_editor          uuid := auth.uid();
  v_editor_facility uuid;
  v_target_facility uuid;
  v_editor_level    int;
  v_target_level    int;
begin
  if v_editor is null or p_target_user_id is null then
    return false;
  end if;

  -- Always allowed to edit your own profile.
  if p_target_user_id = v_editor then
    return true;
  end if;

  -- Super admins may edit anyone.
  if public.is_super_admin() then
    return true;
  end if;

  select u.facility_id into v_editor_facility from public.users u where u.id = v_editor;
  select u.facility_id into v_target_facility from public.users u where u.id = p_target_user_id;

  -- Cross-facility edits are never allowed for non-super-admins.
  if v_editor_facility is null
     or v_target_facility is null
     or v_editor_facility <> v_target_facility then
    return false;
  end if;

  -- A user's effective rank is their strongest (lowest-numbered) active role
  -- in their facility. Lower hierarchy_level == more powerful.
  select min(r.hierarchy_level) into v_editor_level
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.user_id = v_editor
    and e.is_active = true
    and e.facility_id = v_editor_facility;

  select min(r.hierarchy_level) into v_target_level
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.user_id = p_target_user_id
    and e.is_active = true
    and e.facility_id = v_target_facility;

  if v_editor_level is null or v_target_level is null then
    return false;
  end if;

  -- Editor must strictly outrank the target (cannot edit peers or superiors).
  return v_editor_level < v_target_level;
end;
$$;

comment on function public.can_edit_user_profile(uuid) is
  'True iff the calling user may edit the given target user profile: self, '
  'super admin, or a strictly-higher-ranked editor in the same facility. '
  'Used by the users_update RLS policy and the account server action.';

revoke execute on function public.can_edit_user_profile(uuid) from public, anon;
grant  execute on function public.can_edit_user_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Privilege-escalation guard for self-service edits
-- ---------------------------------------------------------------------------
create or replace function public.guard_users_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Internal / service-role / migration flows (no end-user JWT) are exempt;
  -- RLS does not apply to them either.
  if auth.uid() is null then
    return new;
  end if;

  -- Super admins and facility admins are allowed to change privileged columns
  -- (e.g. activating/deactivating users, moving facilities).
  if public.is_super_admin() or public.is_facility_admin(old.facility_id) then
    return new;
  end if;

  -- Everyone else (self-service / supervisor profile edits) must not be able
  -- to escalate privilege or relocate a user.
  if new.id            is distinct from old.id
     or new.is_super_admin is distinct from old.is_super_admin
     or new.is_active      is distinct from old.is_active
     or new.facility_id    is distinct from old.facility_id then
    raise exception 'Not allowed to modify privileged account fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_users_profile_update() is
  'BEFORE UPDATE guard on public.users: blocks non-admin edits from changing '
  'id / is_super_admin / is_active / facility_id (privilege escalation).';

drop trigger if exists users_profile_update_guard on public.users;
create trigger users_profile_update_guard
  before update on public.users
  for each row
  execute function public.guard_users_profile_update();

-- ---------------------------------------------------------------------------
-- 4. users_update policy: add self + hierarchy edits (admin path preserved)
-- ---------------------------------------------------------------------------
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (current_user_role() = any (array['admin'::text, 'super_admin'::text])))
    or (id = (select auth.uid()))
    or public.can_edit_user_profile(id)
  )
  with check (
    is_super_admin()
    or ((facility_id = current_facility_id()) and (current_user_role() = any (array['admin'::text, 'super_admin'::text])))
    or (id = (select auth.uid()))
    or public.can_edit_user_profile(id)
  );

-- ---------------------------------------------------------------------------
-- 5. profile_audit_log (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.profile_audit_log (
  id             uuid        primary key default gen_random_uuid(),
  facility_id    uuid        references public.facilities(id) on delete set null,
  edited_by      uuid        not null references public.users(id) on delete cascade,
  target_user_id uuid        not null references public.users(id) on delete cascade,
  changed_fields jsonb       not null,
  created_at     timestamptz not null default now()
);

create index if not exists profile_audit_log_target_idx
  on public.profile_audit_log (target_user_id, created_at desc);
create index if not exists profile_audit_log_facility_idx
  on public.profile_audit_log (facility_id, created_at desc);

alter table public.profile_audit_log enable row level security;

-- Insert: the actor may only log their own edits, and only for a target they
-- are actually allowed to edit.
drop policy if exists profile_audit_log_insert on public.profile_audit_log;
create policy profile_audit_log_insert on public.profile_audit_log
  for insert to authenticated
  with check (
    edited_by = (select auth.uid())
    and public.can_edit_user_profile(target_user_id)
  );

-- Select: super admins, facility admins, the editor, and the affected user.
drop policy if exists profile_audit_log_select on public.profile_audit_log;
create policy profile_audit_log_select on public.profile_audit_log
  for select to authenticated
  using (
    is_super_admin()
    or public.is_facility_admin(facility_id)
    or target_user_id = (select auth.uid())
    or edited_by = (select auth.uid())
  );

-- No update/delete policies: the log is append-only.

comment on table public.profile_audit_log is
  'Append-only record of supervisor+ edits to other users profiles: who '
  'edited, whose profile, and which fields changed.';

commit;
