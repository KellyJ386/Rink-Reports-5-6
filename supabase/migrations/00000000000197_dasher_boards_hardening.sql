-- =============================================================================
-- 00000000000197_dasher_boards_hardening.sql
-- Fixes from the post-build adversarial review (four DB-layer findings):
--
-- 1. dasher_boards_issues UPDATE policy: the reporter's own-unresolved-issue
--    branch never re-checked module permission, so an employee whose
--    dasher_boards grants were fully revoked could still edit their old open
--    issues. The branch now also requires an enabled `submit` grant, matching
--    the INSERT policy.
-- 2. Severity-A check constraint now enforces BOTH spec requirements at the
--    DB layer: supervisor AND action_taken (action_taken was app-layer only).
-- 3. Label permanence on hard delete: removeAsset may hard-delete a
--    zero-history asset, but its label previously vanished from both the live
--    set and dasher_boards_retired_labels — the next allocation could hand
--    the same number to a different physical asset. An AFTER DELETE trigger
--    now retires the label. (Deliberate consequence: numbers are burned even
--    by delete-and-redo flows; see 4.)
-- 4. dasher_boards_generate_perimeter now starts numbering from the
--    high-water mark of live + retired labels instead of 1, so a cleared and
--    regenerated rink continues at B41.. instead of colliding with the newly
--    retired B1..B40.
-- =============================================================================

begin;

-- 1. Reporter branch of the issues UPDATE policy requires the submit grant.
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
        or (
          reported_by = public.current_employee_id()
          and resolved_at is null
          and public.has_module_submit_access('dasher_boards')
        )
      )
    )
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- 2. Severity A requires supervisor AND action taken (both spec'd).
alter table public.dasher_boards_issues
  drop constraint if exists dasher_boards_issues_a_requires_supervisor;
alter table public.dasher_boards_issues
  add constraint dasher_boards_issues_a_requires_supervisor check (
    severity <> 'a'
    or (supervisor_id is not null and action_taken is not null)
  );

comment on constraint dasher_boards_issues_a_requires_supervisor
  on public.dasher_boards_issues is
  'Severity-A issues always name a supervisor AND record the action taken (both were previously only app-enforced for action_taken).';

-- 3. Hard-deleted assets retire their labels too.
create or replace function public.dasher_boards_assets_retire_on_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.dasher_boards_retired_labels (facility_id, rink_id, label)
  values (old.facility_id, old.rink_id, old.label)
  on conflict (rink_id, label) do nothing;
  return old;
end;
$$;

drop trigger if exists trg_dasher_boards_assets_retire_on_delete on public.dasher_boards_assets;
create trigger trg_dasher_boards_assets_retire_on_delete
  after delete on public.dasher_boards_assets
  for each row execute function public.dasher_boards_assets_retire_on_delete();

comment on function public.dasher_boards_assets_retire_on_delete() is
  'Labels are permanent identity even across hard deletes: a deleted asset''s label lands in dasher_boards_retired_labels (asset_id null — the row is gone) so nextLabel/label_check can never reissue it.';

-- 4. Generation continues from the label high-water mark (live + retired).
create or replace function public.dasher_boards_generate_perimeter(
  p_rink_id uuid,
  p_count   int
) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
  v_existing    int;
  v_board_id    uuid;
  v_b_start     int;
  v_g_start     int;
  i             int;
begin
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'dasher_boards: position count must be between 1 and 500';
  end if;

  select facility_id into v_facility_id
    from public.dasher_boards_rinks
   where id = p_rink_id;
  if v_facility_id is null then
    raise exception 'dasher_boards: rink not found';
  end if;

  select count(*) into v_existing
    from public.dasher_boards_assets
   where rink_id = p_rink_id;
  if v_existing > 0 then
    raise exception 'dasher_boards: rink already has perimeter assets; use the granular editor instead';
  end if;

  -- Never reuse a number: continue past every B/G ever used on this rink
  -- (retired labels included — a cleared rink regenerates at B<max+1>..).
  select coalesce(max((substring(label from '^B(\d+)$'))::int), 0)
    into v_b_start
    from public.dasher_boards_retired_labels
   where rink_id = p_rink_id and label ~ '^B\d+$';
  select coalesce(max((substring(label from '^G(\d+)$'))::int), 0)
    into v_g_start
    from public.dasher_boards_retired_labels
   where rink_id = p_rink_id and label ~ '^G\d+$';

  for i in 1..p_count loop
    insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, label, sequence_position)
    values
      (v_facility_id, p_rink_id, 'board_panel', 'B' || (v_b_start + i), i)
    returning id into v_board_id;

    insert into public.dasher_boards_assets
      (facility_id, rink_id, asset_type, label, parent_board_id)
    values
      (v_facility_id, p_rink_id, 'glass_panel', 'G' || (v_g_start + i), v_board_id);
  end loop;

  return p_count;
end;
$$;

commit;
