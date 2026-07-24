-- =============================================================================
-- 00000000000205_dasher_boards_asset_checks.sql
--
-- Per-asset Pass/Fail condition check during a walk. As the assigned inspector
-- walks the boards, they tap each piece and mark it Pass or Fail with a free-
-- text note. This is a lightweight, walk-scoped checkoff — distinct from the
-- persistent issue pipeline (repair/cleaning) and from the cadenced checklist.
--
-- Structurally a sibling of dasher_boards_checklist_responses: one row per
-- (inspection, asset), writable by the walk's inspector (submit grant) while the
-- walk is open, immutable once the walk is signed off. Enforced at the RLS layer
-- AND a guard trigger (defense in depth, the module standard).
-- =============================================================================

create table if not exists public.dasher_boards_asset_checks (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  inspection_id  uuid not null references public.dasher_boards_inspections(id) on delete cascade,
  asset_id       uuid not null references public.dasher_boards_assets(id) on delete restrict,
  status         text not null check (status in ('pass', 'fail')),
  note           text,
  checked_by     uuid references public.employees(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  constraint dasher_boards_asset_checks_uniq unique (inspection_id, asset_id)
);

comment on table public.dasher_boards_asset_checks is
  'Dasher Boards: per-asset Pass/Fail condition check recorded during a walk (one row per inspection+asset). Written by the walk''s inspector (submit grant) while the walk is open; immutable once the inspection is completed. Separate from the persistent issue pipeline and the cadenced checklist.';

create index if not exists idx_dasher_boards_asset_checks_inspection
  on public.dasher_boards_asset_checks (inspection_id);
create index if not exists idx_dasher_boards_asset_checks_asset
  on public.dasher_boards_asset_checks (asset_id);

drop trigger if exists trg_dasher_boards_asset_checks_updated_at on public.dasher_boards_asset_checks;
create trigger trg_dasher_boards_asset_checks_updated_at
  before update on public.dasher_boards_asset_checks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — mirrors dasher_boards_checklist_responses (migration 192 §6).
-- -----------------------------------------------------------------------------
alter table public.dasher_boards_asset_checks enable row level security;

drop policy if exists dasher_boards_asset_checks_select on public.dasher_boards_asset_checks;
create policy dasher_boards_asset_checks_select on public.dasher_boards_asset_checks
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('dasher_boards'))
  );

drop policy if exists dasher_boards_asset_checks_insert on public.dasher_boards_asset_checks;
create policy dasher_boards_asset_checks_insert on public.dasher_boards_asset_checks
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

drop policy if exists dasher_boards_asset_checks_update on public.dasher_boards_asset_checks;
create policy dasher_boards_asset_checks_update on public.dasher_boards_asset_checks
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

drop policy if exists dasher_boards_asset_checks_delete on public.dasher_boards_asset_checks;
create policy dasher_boards_asset_checks_delete on public.dasher_boards_asset_checks
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- Guard: immutable once the parent walk is completed; linkage frozen on update.
-- -----------------------------------------------------------------------------
create or replace function public.dasher_boards_asset_checks_guard()
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
    raise exception 'dasher_boards: asset checks are immutable once the inspection is completed';
  end if;

  if tg_op = 'UPDATE' then
    if new.inspection_id is distinct from old.inspection_id
       or new.asset_id    is distinct from old.asset_id
       or new.facility_id is distinct from old.facility_id
    then
      raise exception 'dasher_boards: asset-check linkage columns are immutable';
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_dasher_boards_asset_checks_guard on public.dasher_boards_asset_checks;
create trigger trg_dasher_boards_asset_checks_guard
  before insert or update or delete on public.dasher_boards_asset_checks
  for each row execute function public.dasher_boards_asset_checks_guard();
