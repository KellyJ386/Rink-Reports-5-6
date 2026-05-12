-- =============================================================================
-- 00000000000039_backfill_and_sync_trigger.sql
--
-- Phase 2a of the Admin Control Center redesign (part 2).
--
--   1. Bidirectional sync trigger on module_permissions: keeps
--      permission_level and the legacy can_view/can_submit/can_admin flags
--      consistent regardless of which set of columns is written.
--   2. Backfill of permission_level from the existing flags.
--
-- The trigger runs BEFORE INSERT/UPDATE so derived values are written into
-- the row itself (no recursion).
--
-- Mapping (level <-> flags):
--   none            -> can_view=f, can_submit=f, can_admin=f
--   view            -> can_view=t, can_submit=f, can_admin=f
--   submit          -> can_view=t, can_submit=t, can_admin=f
--   edit_own        -> can_view=t, can_submit=t, can_admin=f
--   edit_all        -> can_view=t, can_submit=t, can_admin=f
--   approve         -> can_view=t, can_submit=t, can_admin=f
--   publish         -> can_view=t, can_submit=t, can_admin=f
--   manage_settings -> can_view=t, can_submit=t, can_admin=t
--   admin           -> can_view=t, can_submit=t, can_admin=t
--
-- Reverse (flags -> level), used when only the flag columns changed:
--   can_admin=t                  -> admin
--   can_submit=t & !can_admin    -> submit
--   can_view=t & !can_submit     -> view
--   else                         -> none
-- =============================================================================

create or replace function public.sync_module_permission_columns()
returns trigger
language plpgsql
as $$
declare
  v_level_changed boolean;
  v_flags_changed boolean;
begin
  if tg_op = 'INSERT' then
    -- On INSERT, prefer permission_level when it's non-default; otherwise
    -- derive from any flags the caller provided.
    if new.permission_level <> 'none'::module_permission_level then
      new.can_view   := new.permission_level >= 'view'::module_permission_level;
      new.can_submit := new.permission_level >= 'submit'::module_permission_level;
      new.can_admin  := new.permission_level >= 'manage_settings'::module_permission_level;
    else
      new.permission_level := case
        when new.can_admin  then 'admin'::module_permission_level
        when new.can_submit then 'submit'::module_permission_level
        when new.can_view   then 'view'::module_permission_level
        else 'none'::module_permission_level
      end;
      -- Re-derive flags so they're internally consistent with the resolved level.
      new.can_view   := new.permission_level >= 'view'::module_permission_level
                        and new.permission_level <> 'none'::module_permission_level;
      new.can_submit := new.permission_level >= 'submit'::module_permission_level;
      new.can_admin  := new.permission_level >= 'manage_settings'::module_permission_level;
    end if;
    return new;
  end if;

  -- UPDATE: detect which side the caller touched.
  v_level_changed := new.permission_level is distinct from old.permission_level;
  v_flags_changed :=
       new.can_view   is distinct from old.can_view
    or new.can_submit is distinct from old.can_submit
    or new.can_admin  is distinct from old.can_admin;

  if v_level_changed then
    -- permission_level wins. Derive flags from it.
    new.can_view   := new.permission_level >= 'view'::module_permission_level
                      and new.permission_level <> 'none'::module_permission_level;
    new.can_submit := new.permission_level >= 'submit'::module_permission_level;
    new.can_admin  := new.permission_level >= 'manage_settings'::module_permission_level;
  elsif v_flags_changed then
    -- Legacy caller changed only the flags. Map back to a level.
    new.permission_level := case
      when new.can_admin  then 'admin'::module_permission_level
      when new.can_submit then 'submit'::module_permission_level
      when new.can_view   then 'view'::module_permission_level
      else 'none'::module_permission_level
    end;
    -- Renormalize flags (e.g. caller set can_admin=t but left can_view=f).
    new.can_view   := new.permission_level >= 'view'::module_permission_level
                      and new.permission_level <> 'none'::module_permission_level;
    new.can_submit := new.permission_level >= 'submit'::module_permission_level;
    new.can_admin  := new.permission_level >= 'manage_settings'::module_permission_level;
  end if;

  return new;
end;
$$;

comment on function public.sync_module_permission_columns() is
  'Bidirectional sync between module_permissions.permission_level and the '
  'legacy can_view/can_submit/can_admin flags. Runs BEFORE INSERT/UPDATE.';

drop trigger if exists trg_module_permissions_sync_columns
  on public.module_permissions;
create trigger trg_module_permissions_sync_columns
  before insert or update on public.module_permissions
  for each row execute function public.sync_module_permission_columns();

-- -----------------------------------------------------------------------------
-- Backfill: populate permission_level for any rows still on the default
-- 'none' value. The trigger above re-normalizes the flag columns to match.
-- -----------------------------------------------------------------------------
update public.module_permissions
set permission_level = case
  when can_admin  then 'admin'::module_permission_level
  when can_submit then 'submit'::module_permission_level
  when can_view   then 'view'::module_permission_level
  else 'none'::module_permission_level
end
where permission_level = 'none'::module_permission_level
  and (can_view or can_submit or can_admin);
