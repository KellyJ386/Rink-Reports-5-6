-- =============================================================================
-- 00000000000203_dasher_boards_review_fixes.sql
--
-- Fixes from the module's adversarial review. All DB-side changes in one file:
--   12. Audit regression: widen dasher_boards_asset_events INSERT so edit-tier
--       (managers) can write their spec_updated audit row (migration 202 opened
--       the assets UPDATE to edit but left the events INSERT admin-only, so the
--       audit row was silently RLS-rejected).
--    8. Resolved-issue immutability parity: the issues UPDATE USING now also
--       excludes resolved rows for edit/admin (was guard-only), matching the
--       completed-inspection lock's both-layers standard.
--    9. Facility scoping: a trigger rejects an issue whose supervisor_id /
--       resolved_by / category_id belongs to another facility (dangling
--       cross-facility references were previously possible).
--   10. Glass integrity: a trigger enforces that a glass_panel's parent is a
--       board_panel in the SAME rink/facility (checked on insert or whenever the
--       parent link changes — never on a plain spec/is_active update, so board→
--       door conversion is unaffected).
--   11. dasher_boards_shift_positions could settle a row at sequence_position 0
--       for p_from=1, p_delta=-1; reject that degenerate shift.
--    6. Offline idempotency: dasher_boards_issues gains source_local_id + a
--       partial unique index so a crash-window re-drive of a queued report_issue
--       cannot double-insert (server threads the queue localId).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 12. asset_events INSERT: admin, OR edit for the spec_updated audit row only.
-- -----------------------------------------------------------------------------
drop policy if exists dasher_boards_asset_events_insert on public.dasher_boards_asset_events;
create policy dasher_boards_asset_events_insert on public.dasher_boards_asset_events
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('dasher_boards')
        or (
          public.has_module_edit_access('dasher_boards')
          and event_type = 'spec_updated'
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 8. Resolved issues are immutable at the RLS layer too (edit/admin branches).
--    WITH CHECK is unchanged so the resolve transition (setting resolved_at) is
--    still allowed; only targeting an already-resolved row is blocked.
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
          reported_by = public.current_employee_id()
          and public.has_module_submit_access('dasher_boards')
        )
      )
    )
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- -----------------------------------------------------------------------------
-- 9. Issue facility-scope validation. SECURITY DEFINER so the same-facility
--    lookups are deterministic regardless of the caller's RLS visibility.
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_issues_facility_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.supervisor_id is not null
     and not exists (
       select 1 from public.employees e
        where e.id = new.supervisor_id and e.facility_id = new.facility_id
     ) then
    raise exception 'dasher_boards: supervisor must belong to the issue''s facility';
  end if;

  if new.resolved_by is not null
     and not exists (
       select 1 from public.employees e
        where e.id = new.resolved_by and e.facility_id = new.facility_id
     ) then
    raise exception 'dasher_boards: resolver must belong to the issue''s facility';
  end if;

  if new.category_id is not null
     and not exists (
       select 1 from public.dasher_boards_issue_categories c
        where c.id = new.category_id and c.facility_id = new.facility_id
     ) then
    raise exception 'dasher_boards: category must belong to the issue''s facility';
  end if;

  return new;
end;
$$;

revoke execute on function public.dasher_boards_issues_facility_scope() from public, anon;

drop trigger if exists trg_dasher_boards_issues_facility_scope on public.dasher_boards_issues;
create trigger trg_dasher_boards_issues_facility_scope
  before insert or update on public.dasher_boards_issues
  for each row execute function public.dasher_boards_issues_facility_scope();

-- -----------------------------------------------------------------------------
-- 10. Glass parent must be a same-rink board_panel. Only checked on insert or
--     when the parent link actually changes, so a board→door conversion (which
--     leaves the glass child's parent_board_id untouched) is never rejected.
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_assets_glass_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.asset_type = 'glass_panel' and new.parent_board_id is not null
     and (tg_op = 'INSERT'
          or new.parent_board_id is distinct from old.parent_board_id) then
    if not exists (
      select 1 from public.dasher_boards_assets p
       where p.id = new.parent_board_id
         and p.asset_type = 'board_panel'
         and p.rink_id = new.rink_id
         and p.facility_id = new.facility_id
    ) then
      raise exception 'dasher_boards: glass parent must be a board panel in the same rink';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.dasher_boards_assets_glass_parent() from public, anon;

drop trigger if exists trg_dasher_boards_assets_glass_parent on public.dasher_boards_assets;
create trigger trg_dasher_boards_assets_glass_parent
  before insert or update on public.dasher_boards_assets
  for each row execute function public.dasher_boards_assets_glass_parent();

-- -----------------------------------------------------------------------------
-- 11. shift_positions: reject the degenerate shift that would settle a row at
--     sequence_position 0. (Gap-close always calls with p_from >= 2; this makes
--     the invalid case explicit instead of silently producing position 0.)
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_shift_positions(
  p_rink_id uuid,
  p_from    int,
  p_delta   int
) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if p_delta is null or p_delta not in (-1, 1) then
    raise exception 'dasher_boards: shift delta must be -1 or 1';
  end if;
  if p_delta = -1 and p_from <= 1 then
    raise exception 'dasher_boards: cannot shift positions below 1';
  end if;

  update public.dasher_boards_assets
     set sequence_position = -(sequence_position + p_delta)
   where rink_id = p_rink_id
     and sequence_position >= p_from;
  get diagnostics v_count = row_count;

  update public.dasher_boards_assets
     set sequence_position = -sequence_position
   where rink_id = p_rink_id
     and sequence_position < 0;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Offline idempotency key for report_issue re-drives.
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_issues
  add column if not exists source_local_id uuid;

comment on column public.dasher_boards_issues.source_local_id is
  'Offline-queue local id of the submission that created this issue (null for online reports). Makes a crash-window replay re-drive idempotent via the partial unique index below.';

create unique index if not exists idx_dasher_boards_issues_source_local
  on public.dasher_boards_issues (rink_id, source_local_id)
  where source_local_id is not null;
