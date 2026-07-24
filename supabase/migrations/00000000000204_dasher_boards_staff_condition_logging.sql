-- =============================================================================
-- 00000000000204_dasher_boards_staff_condition_logging.sql
--
-- Staff-facing condition logging: as staff walk the boards they record what
-- needs repair, what needs cleaning, and what's already been fixed.
--
--   * Cleaning: the seeded issue categories were all damage/repair. Add default
--     cleaning categories per asset type so "needs cleaning" is a first-class
--     choice in the report form (admins can still edit the list). Backfill
--     existing facilities.
--
--   * "Already fixed": resolving an issue was edit-tier (manager) only. Open it
--     to submit-tier (staff) for NON-severity-A issues; severity-A (safety
--     critical) still requires a supervisor to sign off. Enforced at every
--     layer: the issues UPDATE RLS admits a submit user to resolve any B/C
--     issue (or edit their own report), and the column guard restricts a submit
--     resolver to the resolution fields and blocks A resolution. Acknowledge
--     stays edit-only (the supervisor safety step).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Default cleaning categories (added to the seed; backfilled below).
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_dasher_boards_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Door subtypes.
  insert into public.dasher_boards_asset_subtypes (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'door', s.label, s.sort_order
  from (values
    ('Bench', 0),
    ('Scoreboard', 1),
    ('Public Skate', 2),
    ('Zamboni', 3)
  ) as s(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: board panels (repair + cleaning).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'board_panel', c.label, c.sort_order
  from (values
    ('Facing damage', 0),
    ('Protruding/missing fastener', 1),
    ('Panel joint misalignment', 2),
    ('Kickplate damage', 3),
    ('Caprail damage', 4),
    ('Resurfacer impact', 5),
    ('Needs cleaning', 7),
    ('Debris/buildup', 8),
    ('Other', 9)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: glass panels (repair + cleaning).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'glass_panel', c.label, c.sort_order
  from (values
    ('Crack', 0),
    ('Chip/sharp edge', 1),
    ('Not seated/rattle', 2),
    ('Crazing at clamp', 3),
    ('Gasket damaged/missing', 4),
    ('Needs cleaning', 6),
    ('Film/residue', 7),
    ('Other', 8)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;

  -- Issue categories: doors (repair + cleaning).
  insert into public.dasher_boards_issue_categories (facility_id, asset_type, label, sort_order)
  select p_facility_id, 'door', c.label, c.sort_order
  from (values
    ('Latch not holding', 0),
    ('Hinge/sag', 1),
    ('Not flush with board line', 2),
    ('Threshold damage', 3),
    ('Door glass damage', 4),
    ('Hardware protruding ice-side', 5),
    ('Needs cleaning', 7),
    ('Other', 8)
  ) as c(label, sort_order)
  on conflict (facility_id, asset_type, label) do nothing;
end;
$$;

-- Backfill the new cleaning categories for every existing facility. The seed is
-- idempotent (on conflict do nothing), so this only adds the missing rows.
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_dasher_boards_config(f.id);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Issues UPDATE RLS: admit submit-tier (staff) to resolve non-A issues, and
--    keep reporter self-edit. Edit/admin unchanged. Resolved rows stay frozen
--    (migration 203). Column-level limits are enforced by the guard below.
-- -----------------------------------------------------------------------------
drop policy if exists dasher_boards_issues_update on public.dasher_boards_issues;
create policy dasher_boards_issues_update on public.dasher_boards_issues
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and resolved_at is null
      and (
        public.has_module_edit_access('dasher_boards')
        or public.has_module_admin_access('dasher_boards')
        or (
          public.has_module_submit_access('dasher_boards')
          and (
            -- resolve (mark fixed) any non-A issue, OR edit your own report
            severity <> 'a'
            or reported_by = public.current_employee_id()
          )
        )
      )
    )
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- -----------------------------------------------------------------------------
-- 3. Column guard: add the submit-tier branch. A submit user may EITHER resolve
--    a non-A issue (resolution fields only) OR, as the reporter, edit
--    description/category on their own unresolved issue — never change severity/
--    action/supervisor/ack, and never resolve a severity-A issue.
-- -----------------------------------------------------------------------------
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

  -- Submit tier (staff). RLS has already restricted the reachable rows.
  -- Path 1: resolving a non-A issue (mark fixed) — resolution fields only.
  if new.resolved_at is distinct from old.resolved_at
     or new.resolved_by is distinct from old.resolved_by
  then
    if old.severity = 'a' then
      raise exception 'dasher_boards: severity-A issues require a supervisor to resolve';
    end if;
    if new.description      is distinct from old.description
       or new.category_id      is distinct from old.category_id
       or new.severity         is distinct from old.severity
       or new.action_taken     is distinct from old.action_taken
       or new.supervisor_id    is distinct from old.supervisor_id
       or new.supervisor_ack_at is distinct from old.supervisor_ack_at
    then
      raise exception 'dasher_boards: resolving may change only the resolution fields';
    end if;
    return new;
  end if;

  -- Path 2: the reporter editing their own unresolved report (desc/category).
  if old.reported_by is distinct from public.current_employee_id() then
    raise exception 'dasher_boards: you may only edit issues you reported';
  end if;
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
