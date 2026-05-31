-- ---------------------------------------------------------------------------
-- Circle-check items: response_type + is_response_required
-- ---------------------------------------------------------------------------
-- Adds two config columns to the per-facility circle-check checklist so an
-- item can be answered either as pass/fail (default) or as a free-text
-- response. is_response_required is only meaningful for text items: it marks
-- whether the free-text answer is mandatory. For pass_fail items it is ignored.
--
-- Idempotent: safe to re-run. Already applied on the remote project; this file
-- keeps local/CI in sync with that state.
-- ---------------------------------------------------------------------------

alter table public.ice_operations_circle_check_items
  add column if not exists response_type text not null default 'pass_fail',
  add column if not exists is_response_required boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ice_operations_circle_check_items'::regclass
      and conname = 'ice_operations_circle_check_items_response_type_chk'
  ) then
    alter table public.ice_operations_circle_check_items
      add constraint ice_operations_circle_check_items_response_type_chk
      check (response_type in ('pass_fail', 'text'));
  end if;
end $$;

comment on column public.ice_operations_circle_check_items.response_type is
  'How staff answer this circle-check item: pass_fail (default) or text (free-text response).';
comment on column public.ice_operations_circle_check_items.is_response_required is
  'For text response_type only: whether the free-text answer is mandatory. Ignored for pass_fail items.';
