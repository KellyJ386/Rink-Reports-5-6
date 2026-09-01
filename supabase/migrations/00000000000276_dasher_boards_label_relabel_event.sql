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
-- custom_label. The new branch emits 'relabeled' with detail.label_kind='label'.
--
-- CONVERT SUPPRESSION. A board<->door conversion (convertAssetToDoor /
-- convertDoorToBoard) rewrites `label` AND `asset_type` in one UPDATE and writes
-- its own 'converted_to_door' / 'converted_to_board' event in app code. The new
-- branch is therefore guarded on asset_type being UNCHANGED, so a conversion is
-- not double-audited as a bare relabel. A plain relabel (relabelAsset) and a
-- direct PATCH both change only `label`, so both now produce exactly one
-- trigger-written event. The app-side relabelAsset event insert is removed in
-- the same PR to avoid a duplicate. (Bulk labels touch custom_label via
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

  -- Permanent identity label. Guarded on asset_type being UNCHANGED so a
  -- board<->door conversion (which rewrites label AND asset_type and logs its
  -- own converted_to_* event) is not also double-audited as a bare relabel.
  if new.label is distinct from old.label
     and new.asset_type is not distinct from old.asset_type then
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
