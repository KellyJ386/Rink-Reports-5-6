-- =============================================================================
-- 00000000000202_dasher_boards_editor_spec_writes.sql
--
-- Let EDIT-tier users (managers) enter the glass/door replacement spec from the
-- main module. Today every write to dasher_boards_assets is admin-only, both at
-- the RLS layer (this migration's parent, 192) and the server-action layer
-- (resolveAdminContext). The manager role already carries the `edit` grant on
-- dasher_boards (canonical_role_permission_grants, migration 198), so this opens
-- the SPEC — and only the spec — to that tier.
--
-- Enforcement stays at BOTH layers (the scheduling publish-lock bypass is the
-- named anti-pattern): the server action gains an edit-OR-admin guard, and here
-- we (a) admit edit-tier to the assets UPDATE policy and (b) add a BEFORE UPDATE
-- column guard so an edit-tier caller — even via a forged/direct request — can
-- change ONLY the five spec columns. Admins (and the guard-exempt roles) keep
-- full write. INSERT/DELETE stay admin-only.
--
-- There is NO permission tier hierarchy: has_module_admin_access and
-- has_module_edit_access are independent exact-action checks, so an admin-only
-- grant returns FALSE from has_module_edit_access. Every gate below is therefore
-- `admin OR edit`, and the guard's admin-first branch is what keeps admins out
-- of the edit-only column freeze.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Admit edit-tier to the assets UPDATE policy (admin OR edit). INSERT and
--    DELETE are intentionally left admin-only.
-- -----------------------------------------------------------------------------
drop policy if exists dasher_boards_assets_update on public.dasher_boards_assets;
create policy dasher_boards_assets_update on public.dasher_boards_assets
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and (public.has_module_admin_access('dasher_boards')
             or public.has_module_edit_access('dasher_boards')))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and (public.has_module_admin_access('dasher_boards')
             or public.has_module_edit_access('dasher_boards')))
  );

-- -----------------------------------------------------------------------------
-- 2. Column guard: edit-tier may change ONLY the glass replacement spec.
--    Mirrors dasher_boards_issues_guard (migration 192): exempt short-circuit,
--    then admin full-write, then an edit branch that freezes every structural /
--    identity column. Any non-exempt, non-admin, non-edit caller is rejected
--    outright (defense in depth behind the RLS row gate).
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_assets_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.dasher_boards_guard_exempt() then
    return new;
  end if;

  -- Admins retain full write. This admin-first branch matters because the
  -- helpers have no hierarchy — an admin does NOT satisfy has_module_edit_access,
  -- so without it an admin would be caught by the edit-only freeze below.
  if public.has_module_admin_access('dasher_boards') then
    return new;
  end if;

  if public.has_module_edit_access('dasher_boards') then
    -- Edit tier (managers): the five spec columns only. `updated_at` is left
    -- free (the set_updated_at trigger maintains it).
    if new.id                is distinct from old.id
       or new.facility_id       is distinct from old.facility_id
       or new.rink_id           is distinct from old.rink_id
       or new.asset_type        is distinct from old.asset_type
       or new.subtype_id        is distinct from old.subtype_id
       or new.label             is distinct from old.label
       or new.sequence_position is distinct from old.sequence_position
       or new.parent_board_id   is distinct from old.parent_board_id
       or new.is_active         is distinct from old.is_active
       or new.created_at        is distinct from old.created_at
    then
      raise exception 'dasher_boards: edit grant may only change the glass replacement spec';
    end if;
    return new;
  end if;

  -- Neither exempt, admin, nor edit: the RLS row gate should already have
  -- blocked this, so a reachable raise here means a policy/guard drift.
  raise exception 'dasher_boards: not authorized to modify assets';
end;
$$;

drop trigger if exists trg_dasher_boards_assets_guard on public.dasher_boards_assets;
create trigger trg_dasher_boards_assets_guard
  before update on public.dasher_boards_assets
  for each row execute function public.dasher_boards_assets_guard();

comment on function public.dasher_boards_assets_guard() is
  'BEFORE UPDATE column guard on dasher_boards_assets: exempt roles and module admins may change any column; edit-tier (managers) may change ONLY the glass replacement spec (glass_width_in/glass_height_in/glass_thickness_in/glass_material/spec_notes); all else is rejected. Pairs with the admin-OR-edit UPDATE policy so edit-tier cannot rewrite structural/identity columns via a direct request.';
