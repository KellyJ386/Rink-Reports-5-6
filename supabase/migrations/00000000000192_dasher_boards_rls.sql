-- =============================================================================
-- 00000000000192_dasher_boards_rls.sql
-- Dasher Boards: RLS policies + guard triggers.
--
-- Authorization model (approved mapping of the module's role gates onto the
-- user_permissions action model — roles only seed defaults, migration 82/193):
--   "facility_manager+"  -> enabled `admin`  action  (has_module_admin_access)
--   "supervisor+"        -> enabled `edit`   action  (has_module_edit_access, NEW)
--   "staff+"             -> enabled `submit` action  (has_module_submit_access, NEW)
--   read                 -> enabled `view`   action  (has_module_access)
--
-- Every write path is enforced at BOTH the server-action layer and here (RLS +
-- triggers). UI-only enforcement is a defect (the Employee Scheduling
-- publish-lock lesson); the completed-inspection lock below is therefore
-- policy-enforced AND trigger-enforced, mirroring schedule_shifts_publish_lock
-- (migration 148) defense-in-depth.
--
-- Guard-trigger exemption tier (in addition to super_admin):
--   * auth.role() = 'service_role'  — trusted backend jobs (retention, etc.)
--   * current_setting('rr.dasher_boards_guard_bypass') = 'on' — explicit
--     governed bypass, same pattern as rr.publish_lock_bypass (migration 148).
--
-- SECURITY DEFINER functions introduced here (flagged per module spec):
--   * public.has_module_submit_access(text)  — mirrors migration 91 style
--   * public.has_module_edit_access(text)    — mirrors migration 91 style
-- All guard trigger functions are SECURITY INVOKER (plain) and only call the
-- existing SECURITY DEFINER helpers.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Module-level submit/edit helpers (mirror has_module_access, migration 91)
-- -----------------------------------------------------------------------------
create or replace function public.has_module_submit_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_module_key is not null
    and (
      public.is_super_admin()
      or exists (
        select 1
          from public.user_permissions up
         where up.user_id     = auth.uid()
           and up.facility_id = public.current_facility_id()
           and up.module_name = p_module_key
           and up.action      = 'submit'::public.user_action
           and up.enabled     = true
      )
    );
$$;

comment on function public.has_module_submit_access(text) is
  'True if super admin OR the current user has an enabled `submit` grant on the '
  'named module at their current facility (public.user_permissions). Module-level '
  'sibling of has_area_submit_access; introduced for Dasher Boards (migration 192).';

create or replace function public.has_module_edit_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_module_key is not null
    and (
      public.is_super_admin()
      or exists (
        select 1
          from public.user_permissions up
         where up.user_id     = auth.uid()
           and up.facility_id = public.current_facility_id()
           and up.module_name = p_module_key
           and up.action      = 'edit'::public.user_action
           and up.enabled     = true
      )
    );
$$;

comment on function public.has_module_edit_access(text) is
  'True if super admin OR the current user has an enabled `edit` grant on the '
  'named module at their current facility (public.user_permissions). The '
  '"supervisor+" tier for Dasher Boards ack/resolve (migration 192).';

revoke execute on function public.has_module_submit_access(text) from public, anon;
revoke execute on function public.has_module_edit_access(text)   from public, anon;
grant execute on function public.has_module_submit_access(text) to authenticated;
grant execute on function public.has_module_edit_access(text)   to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Guard-exemption helper used by the trigger functions below.
--    SECURITY INVOKER; composes existing SECURITY DEFINER helpers only.
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_guard_exempt()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select
    public.is_super_admin()
    or coalesce(auth.role(), '') = 'service_role'
    or coalesce(current_setting('rr.dasher_boards_guard_bypass', true), '') = 'on';
$$;

comment on function public.dasher_boards_guard_exempt() is
  'True when Dasher Boards guard triggers should stand down: super admin, '
  'service-role backend, or the governed rr.dasher_boards_guard_bypass setting '
  '(same escape-hatch pattern as rr.publish_lock_bypass, migration 148).';

-- =============================================================================
-- 3. Config tables: read = module view, write = module admin
--    (dasher_boards_rinks, _asset_subtypes, _issue_categories, _checklist_items,
--     _assets, _retired_labels)
-- =============================================================================

-- ---- dasher_boards_rinks ----------------------------------------------------
alter table public.dasher_boards_rinks enable row level security;

drop policy if exists dasher_boards_rinks_select on public.dasher_boards_rinks;
create policy dasher_boards_rinks_select on public.dasher_boards_rinks
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_rinks_insert on public.dasher_boards_rinks;
create policy dasher_boards_rinks_insert on public.dasher_boards_rinks
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_rinks_update on public.dasher_boards_rinks;
create policy dasher_boards_rinks_update on public.dasher_boards_rinks
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_rinks_delete on public.dasher_boards_rinks;
create policy dasher_boards_rinks_delete on public.dasher_boards_rinks
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

-- ---- dasher_boards_asset_subtypes ------------------------------------------
alter table public.dasher_boards_asset_subtypes enable row level security;

drop policy if exists dasher_boards_asset_subtypes_select on public.dasher_boards_asset_subtypes;
create policy dasher_boards_asset_subtypes_select on public.dasher_boards_asset_subtypes
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_asset_subtypes_insert on public.dasher_boards_asset_subtypes;
create policy dasher_boards_asset_subtypes_insert on public.dasher_boards_asset_subtypes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_asset_subtypes_update on public.dasher_boards_asset_subtypes;
create policy dasher_boards_asset_subtypes_update on public.dasher_boards_asset_subtypes
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_asset_subtypes_delete on public.dasher_boards_asset_subtypes;
create policy dasher_boards_asset_subtypes_delete on public.dasher_boards_asset_subtypes
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

-- ---- dasher_boards_issue_categories ----------------------------------------
alter table public.dasher_boards_issue_categories enable row level security;

drop policy if exists dasher_boards_issue_categories_select on public.dasher_boards_issue_categories;
create policy dasher_boards_issue_categories_select on public.dasher_boards_issue_categories
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_issue_categories_insert on public.dasher_boards_issue_categories;
create policy dasher_boards_issue_categories_insert on public.dasher_boards_issue_categories
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_issue_categories_update on public.dasher_boards_issue_categories;
create policy dasher_boards_issue_categories_update on public.dasher_boards_issue_categories
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_issue_categories_delete on public.dasher_boards_issue_categories;
create policy dasher_boards_issue_categories_delete on public.dasher_boards_issue_categories
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

-- ---- dasher_boards_checklist_items -----------------------------------------
alter table public.dasher_boards_checklist_items enable row level security;

drop policy if exists dasher_boards_checklist_items_select on public.dasher_boards_checklist_items;
create policy dasher_boards_checklist_items_select on public.dasher_boards_checklist_items
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_checklist_items_insert on public.dasher_boards_checklist_items;
create policy dasher_boards_checklist_items_insert on public.dasher_boards_checklist_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_checklist_items_update on public.dasher_boards_checklist_items;
create policy dasher_boards_checklist_items_update on public.dasher_boards_checklist_items
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_checklist_items_delete on public.dasher_boards_checklist_items;
create policy dasher_boards_checklist_items_delete on public.dasher_boards_checklist_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

-- ---- dasher_boards_assets ---------------------------------------------------
alter table public.dasher_boards_assets enable row level security;

drop policy if exists dasher_boards_assets_select on public.dasher_boards_assets;
create policy dasher_boards_assets_select on public.dasher_boards_assets
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_assets_insert on public.dasher_boards_assets;
create policy dasher_boards_assets_insert on public.dasher_boards_assets
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_assets_update on public.dasher_boards_assets;
create policy dasher_boards_assets_update on public.dasher_boards_assets
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

drop policy if exists dasher_boards_assets_delete on public.dasher_boards_assets;
create policy dasher_boards_assets_delete on public.dasher_boards_assets
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );

-- ---- dasher_boards_retired_labels (append-only; admin writes) ---------------
alter table public.dasher_boards_retired_labels enable row level security;

drop policy if exists dasher_boards_retired_labels_select on public.dasher_boards_retired_labels;
create policy dasher_boards_retired_labels_select on public.dasher_boards_retired_labels
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_retired_labels_insert on public.dasher_boards_retired_labels;
create policy dasher_boards_retired_labels_insert on public.dasher_boards_retired_labels
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );
-- No UPDATE/DELETE policies: append-only (super_admin bypasses RLS via policies above only; deletes denied).

-- ---- dasher_boards_asset_events (append-only audit) -------------------------
alter table public.dasher_boards_asset_events enable row level security;

drop policy if exists dasher_boards_asset_events_select on public.dasher_boards_asset_events;
create policy dasher_boards_asset_events_select on public.dasher_boards_asset_events
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_asset_events_insert on public.dasher_boards_asset_events;
create policy dasher_boards_asset_events_insert on public.dasher_boards_asset_events
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('dasher_boards'))
  );
-- No UPDATE/DELETE policies: append-only.

-- =============================================================================
-- 4. dasher_boards_issues
--    insert = submit-grant, own report; update = edit-grant (ack/resolve) or
--    reporter (description/category, unresolved only) — columns policed by
--    trigger below; delete = super_admin only.
-- =============================================================================
alter table public.dasher_boards_issues enable row level security;

drop policy if exists dasher_boards_issues_select on public.dasher_boards_issues;
create policy dasher_boards_issues_select on public.dasher_boards_issues
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_issues_insert on public.dasher_boards_issues;
create policy dasher_boards_issues_insert on public.dasher_boards_issues
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_submit_access('dasher_boards')
      and reported_by = public.current_employee_id()
    )
  );

drop policy if exists dasher_boards_issues_update on public.dasher_boards_issues;
create policy dasher_boards_issues_update on public.dasher_boards_issues
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_edit_access('dasher_boards')
        or public.has_module_admin_access('dasher_boards')
        or (reported_by = public.current_employee_id() and resolved_at is null)
      )
    )
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists dasher_boards_issues_delete on public.dasher_boards_issues;
create policy dasher_boards_issues_delete on public.dasher_boards_issues
  for delete to authenticated
  using (public.is_super_admin());

-- Column-level protection (RLS cannot express per-column rules):
--   * identity/linkage columns are frozen for everyone below the exempt tier
--   * resolved issues are immutable
--   * edit-grant may change ONLY ack/resolution fields (+ action_taken, supervisor_id)
--   * reporters may change ONLY description/category on their own unresolved issues
--   * module admins may additionally correct description/category/severity/
--     supervisor assignment, but never linkage or resolution history rewrites
create or replace function public.dasher_boards_issues_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_admin bool;
  v_is_edit  bool;
begin
  if public.dasher_boards_guard_exempt() then
    return new;
  end if;

  -- Resolved issues are immutable (carry-forward record).
  if old.resolved_at is not null then
    raise exception 'dasher_boards: resolved issues are immutable';
  end if;

  -- Identity / linkage columns are frozen for all non-exempt callers.
  if new.id                is distinct from old.id
     or new.facility_id       is distinct from old.facility_id
     or new.rink_id           is distinct from old.rink_id
     or new.asset_id          is distinct from old.asset_id
     or new.checklist_item_id is distinct from old.checklist_item_id
     or new.reported_by       is distinct from old.reported_by
     or new.inspection_id     is distinct from old.inspection_id
     or new.created_at        is distinct from old.created_at
  then
    raise exception 'dasher_boards: issue identity/linkage columns are immutable';
  end if;

  v_is_admin := public.has_module_admin_access('dasher_boards');
  v_is_edit  := public.has_module_edit_access('dasher_boards');

  if v_is_admin then
    -- Admins may correct report fields and perform ack/resolve; nothing more
    -- to police (linkage already frozen above).
    return new;
  end if;

  if v_is_edit then
    -- Supervisors (edit grant): ack / resolve / action_taken / supervisor
    -- reassignment only. Report content stays the reporter's.
    if new.description is distinct from old.description
       or new.category_id is distinct from old.category_id
       or new.severity    is distinct from old.severity
    then
      raise exception 'dasher_boards: edit grant may only change ack/resolution fields';
    end if;
    return new;
  end if;

  -- Reporter path (RLS already restricted to own unresolved rows):
  -- description/category only.
  if new.severity          is distinct from old.severity
     or new.action_taken      is distinct from old.action_taken
     or new.supervisor_id     is distinct from old.supervisor_id
     or new.supervisor_ack_at is distinct from old.supervisor_ack_at
     or new.resolved_by       is distinct from old.resolved_by
     or new.resolved_at       is distinct from old.resolved_at
  then
    raise exception 'dasher_boards: reporters may only edit description/category on their own unresolved issues';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dasher_boards_issues_guard on public.dasher_boards_issues;
create trigger trg_dasher_boards_issues_guard
  before update on public.dasher_boards_issues
  for each row execute function public.dasher_boards_issues_guard();

-- =============================================================================
-- 5. dasher_boards_inspections — the module's lock concept
--    insert/update own = submit-grant; COMPLETED ROWS ARE IMMUTABLE (policy AND
--    trigger — the Employee Scheduling lesson); delete = super_admin only.
-- =============================================================================
alter table public.dasher_boards_inspections enable row level security;

drop policy if exists dasher_boards_inspections_select on public.dasher_boards_inspections;
create policy dasher_boards_inspections_select on public.dasher_boards_inspections
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_inspections_insert on public.dasher_boards_inspections;
create policy dasher_boards_inspections_insert on public.dasher_boards_inspections
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_submit_access('dasher_boards')
      and inspector_id = public.current_employee_id()
      and completed_at is null
    )
  );

-- USING sees the OLD row: completed_at must still be null, and only the
-- inspector may touch their own open walk.
drop policy if exists dasher_boards_inspections_update on public.dasher_boards_inspections;
create policy dasher_boards_inspections_update on public.dasher_boards_inspections
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and completed_at is null
      and inspector_id = public.current_employee_id()
      and public.has_module_submit_access('dasher_boards')
    )
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists dasher_boards_inspections_delete on public.dasher_boards_inspections;
create policy dasher_boards_inspections_delete on public.dasher_boards_inspections
  for delete to authenticated
  using (public.is_super_admin());

create or replace function public.dasher_boards_inspections_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.dasher_boards_guard_exempt() then
    return coalesce(new, old);
  end if;

  -- Once signed off, the walk record is immutable — including un-completing it.
  if old.completed_at is not null then
    raise exception 'dasher_boards: completed inspections are immutable';
  end if;

  if tg_op = 'UPDATE' then
    if new.id            is distinct from old.id
       or new.facility_id  is distinct from old.facility_id
       or new.rink_id      is distinct from old.rink_id
       or new.inspector_id is distinct from old.inspector_id
       or new.started_at   is distinct from old.started_at
       or new.created_at   is distinct from old.created_at
    then
      raise exception 'dasher_boards: inspection identity columns are immutable';
    end if;
    return new;
  end if;

  return old; -- DELETE of an open walk (RLS already limits to super_admin)
end;
$$;

drop trigger if exists trg_dasher_boards_inspections_guard on public.dasher_boards_inspections;
create trigger trg_dasher_boards_inspections_guard
  before update or delete on public.dasher_boards_inspections
  for each row execute function public.dasher_boards_inspections_guard();

-- =============================================================================
-- 6. dasher_boards_checklist_responses
--    insert/update = the walk's inspector while the walk is open; immutable
--    once the parent inspection is completed (policy join + trigger).
-- =============================================================================
alter table public.dasher_boards_checklist_responses enable row level security;

drop policy if exists dasher_boards_checklist_responses_select on public.dasher_boards_checklist_responses;
create policy dasher_boards_checklist_responses_select on public.dasher_boards_checklist_responses
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_checklist_responses_insert on public.dasher_boards_checklist_responses;
create policy dasher_boards_checklist_responses_insert on public.dasher_boards_checklist_responses
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_submit_access('dasher_boards')
      and exists (
        select 1 from public.dasher_boards_inspections i
         where i.id = inspection_id
           and i.inspector_id = public.current_employee_id()
           and i.completed_at is null
      )
    )
  );

drop policy if exists dasher_boards_checklist_responses_update on public.dasher_boards_checklist_responses;
create policy dasher_boards_checklist_responses_update on public.dasher_boards_checklist_responses
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_submit_access('dasher_boards')
      and exists (
        select 1 from public.dasher_boards_inspections i
         where i.id = inspection_id
           and i.inspector_id = public.current_employee_id()
           and i.completed_at is null
      )
    )
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists dasher_boards_checklist_responses_delete on public.dasher_boards_checklist_responses;
create policy dasher_boards_checklist_responses_delete on public.dasher_boards_checklist_responses
  for delete to authenticated
  using (public.is_super_admin());

create or replace function public.dasher_boards_checklist_responses_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inspection_id uuid;
  v_completed_at  timestamptz;
begin
  if public.dasher_boards_guard_exempt() then
    return coalesce(new, old);
  end if;

  v_inspection_id := case when tg_op = 'INSERT' then new.inspection_id else old.inspection_id end;

  select i.completed_at into v_completed_at
    from public.dasher_boards_inspections i
   where i.id = v_inspection_id;

  if v_completed_at is not null then
    raise exception 'dasher_boards: responses are immutable once the inspection is completed';
  end if;

  if tg_op = 'UPDATE' then
    if new.inspection_id is distinct from old.inspection_id
       or new.item_id     is distinct from old.item_id
       or new.facility_id is distinct from old.facility_id
    then
      raise exception 'dasher_boards: response linkage columns are immutable';
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_dasher_boards_checklist_responses_guard on public.dasher_boards_checklist_responses;
create trigger trg_dasher_boards_checklist_responses_guard
  before insert or update or delete on public.dasher_boards_checklist_responses
  for each row execute function public.dasher_boards_checklist_responses_guard();

-- =============================================================================
-- 7. Label permanence triggers on dasher_boards_assets
--    * reject any insert/relabel that resurrects a retired label
--    * auto-record the old label as retired on every label change
-- =============================================================================
create or replace function public.dasher_boards_assets_label_check()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.label = old.label then
    return new;
  end if;

  if exists (
    select 1 from public.dasher_boards_retired_labels rl
     where rl.rink_id = new.rink_id
       and rl.label   = new.label
  ) then
    raise exception 'dasher_boards: label "%" was retired on this rink and can never be reused', new.label;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dasher_boards_assets_label_check on public.dasher_boards_assets;
create trigger trg_dasher_boards_assets_label_check
  before insert or update of label on public.dasher_boards_assets
  for each row execute function public.dasher_boards_assets_label_check();

create or replace function public.dasher_boards_assets_retire_old_label()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.label is distinct from old.label then
    insert into public.dasher_boards_retired_labels (facility_id, rink_id, label, asset_id)
    values (old.facility_id, old.rink_id, old.label, old.id)
    on conflict (rink_id, label) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dasher_boards_assets_retire_old_label on public.dasher_boards_assets;
create trigger trg_dasher_boards_assets_retire_old_label
  after update of label on public.dasher_boards_assets
  for each row execute function public.dasher_boards_assets_retire_old_label();

commit;
