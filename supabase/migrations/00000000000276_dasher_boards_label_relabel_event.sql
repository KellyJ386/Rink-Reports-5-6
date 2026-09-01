-- =============================================================================
-- 00000000000276_dasher_boards_label_relabel_event.sql
--
-- Closes a silent-audit gap on the permanent identity label
-- (dasher_boards_assets.label). Migration 259's
-- dasher_boards_assets_log_display_events trigger audits custom_label and
-- out_of_service changes at the DB layer (SECURITY DEFINER, so an edit-tier
-- status change is audited regardless of the caller's asset_events grant), but
-- the `label` 'relabeled' event was written ONLY in application code
-- (relabelAsset). A dasher_boards admin who PATCHes
-- /rest/v1/dasher_boards_assets?id=eq.<id> with {"label":"B99"} directly bypasses
-- that code: RLS + dasher_boards_assets_guard admit the write, migration 192's
-- trigger records the old label in dasher_boards_retired_labels, but NO
-- dasher_boards_asset_events row is created — a silent relabel of the identity
-- label that issue history is keyed on.
--
-- Fix: make the trigger the SOLE authority for label relabels too, mirroring
-- custom_label. The new branch emits 'relabeled' with detail.label_kind='label'
-- on ANY change to `label`, UNCONDITIONALLY.
--
-- WHY UNCONDITIONAL (and not "only when asset_type is unchanged"). A first cut
-- suppressed the event when asset_type ALSO changed, to avoid double-auditing a
-- board<->door conversion (which rewrites label + asset_type in one UPDATE and
-- logs its own converted_to_* event in app code). But dasher_boards_assets_guard
-- lets a MODULE ADMIN write any column directly, so an admin could PATCH
-- {"label":"B99","asset_type":"corner_radius"} in one request: the app-level
-- conversion event never fires on a raw REST write, and a suppressed trigger
-- would then write nothing — silently relabeling the identity label and
-- reopening the exact gap this migration closes. So the branch fires on any
-- label change. The cost is that a genuine conversion now produces this relabel
-- event IN ADDITION to its converted_to_* event; a harmless duplicate is far
-- better than a silent relabel, and no consumer counts bare 'relabeled' events.
-- The app-side relabelAsset event insert is removed in the same PR to avoid a
-- duplicate on the plain-relabel path. (Bulk labels touch custom_label via
-- dasher_boards_apply_custom_labels, not `label`, so they are unaffected.)
--
-- The custom_label and out_of_service branches are unchanged. `create or
-- replace function` preserves the ACL locked down in migration 275, and the
-- revokes are re-asserted below for clarity (idempotent).
-- =============================================================================

create or replace function public.dasher_boards_assets_log_display_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.custom_label is distinct from old.custom_label then
    insert into public.dasher_boards_asset_events
      (facility_id, asset_id, event_type, detail, employee_id)
    values (
      new.facility_id, new.id, 'relabeled',
      jsonb_build_object(
        'label_kind', 'custom_label',
        'old', old.custom_label,
        'new', new.custom_label
      ),
      public.current_employee_id()
    );
  end if;

  if new.out_of_service is distinct from old.out_of_service then
    insert into public.dasher_boards_asset_events
      (facility_id, asset_id, event_type, detail, employee_id)
    values (
      new.facility_id, new.id,
      case when new.out_of_service then 'marked_out_of_service'
           else 'returned_to_service' end,
      jsonb_build_object('out_of_service', new.out_of_service),
      public.current_employee_id()
    );
  end if;

  -- Permanent identity label. Fires on ANY label change, unconditionally: a
  -- direct REST PATCH that piggy-backs an asset_type change must NOT be able to
  -- suppress this audit (module admins can write both columns directly). A
  -- board<->door conversion therefore also lands this relabel event on top of
  -- its app-written converted_to_* event -- a harmless duplicate, never silent.
  if new.label is distinct from old.label then
    insert into public.dasher_boards_asset_events
      (facility_id, asset_id, event_type, detail, employee_id)
    values (
      new.facility_id, new.id, 'relabeled',
      jsonb_build_object(
        'label_kind', 'label',
        'old', old.label,
        'new', new.label
      ),
      public.current_employee_id()
    );
  end if;

  return new;
end;
$$;

comment on function public.dasher_boards_assets_log_display_events() is
  'AFTER UPDATE trigger on dasher_boards_assets: writes the mandatory asset event for every custom_label change (relabeled, detail.label_kind=custom_label), every permanent label change that is NOT part of a type conversion (relabeled, detail.label_kind=label; migration 276), and every out_of_service flip (marked_out_of_service / returned_to_service). SECURITY DEFINER so the audit row does not depend on the caller''s asset_events INSERT grant (admin-only) — an edit-tier status change, or a direct label PATCH, must still be audited. Trigger-only; execute revoked from public.';

revoke execute on function public.dasher_boards_assets_log_display_events()
  from public, anon, authenticated;

drop trigger if exists trg_dasher_boards_assets_log_display_events on public.dasher_boards_assets;
create trigger trg_dasher_boards_assets_log_display_events
  after update on public.dasher_boards_assets
  for each row
  when (old.custom_label is distinct from new.custom_label
        or old.out_of_service is distinct from new.out_of_service
        or old.label is distinct from new.label)
  execute function public.dasher_boards_assets_log_display_events();
