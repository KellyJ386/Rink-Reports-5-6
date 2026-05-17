-- =============================================================================
-- 00000000000064_refrigeration_field_is_required.sql
--
-- Adds is_required to refrigeration_fields. The staff submission form
-- already supports the concept (air-quality reading types have an
-- is_required column wired into the form's RequiredMark + aria-required
-- — see /reports/air-quality/_components/submission-form.tsx); the
-- refrigeration form's field schema just didn't expose the flag.
--
-- New rows default to false so existing facility configurations are
-- unchanged. An admin UI to toggle the column per-field is a follow-up
-- (today the column is set via SQL or future setup-tab additions).
-- =============================================================================

alter table public.refrigeration_fields
  add column if not exists is_required boolean not null default false;

comment on column public.refrigeration_fields.is_required is
  'When true, the field is marked as required in the staff submission '
  'form (visible asterisk + native HTML required + aria-required). '
  'Default false preserves the pre-migration behaviour for existing rows.';
