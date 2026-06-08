-- =============================================================================
-- 00000000000124_refrigeration_select_options_normalize.sql
-- Refrigeration item 1a: normalize select-field options into {key,label}.
--
-- Migration 109 seeded `refrigeration_fields.options` for select fields as a
-- JSON array of bare strings (e.g. '["Running","Staged","Off"]'). The staff
-- form's option parser only accepts the canonical object form
-- ([{ "key": ..., "label": ... }]) that the admin editor writes, so every
-- seeded Status option was silently dropped and the dropdown rendered empty.
--
-- This rewrites any string-element arrays into [{key,label}] objects (key =
-- label = the string), matching the admin editor format. Object-shaped arrays
-- are left untouched, so it is idempotent and never clobbers admin edits.
--
-- Facility-agnostic and safe on fresh DBs (no select fields => zero updates).
--
-- ROLLBACK: none required (data normalization only; the parser also tolerates
-- the legacy string form).
-- =============================================================================
begin;

update public.refrigeration_fields f
   set options = sub.new_options,
       updated_at = now()
  from (
    select fld.id,
           (
             select jsonb_agg(
               case
                 when jsonb_typeof(elem) = 'string'
                   then jsonb_build_object('key', elem #>> '{}', 'label', elem #>> '{}')
                 else elem
               end
             )
             from jsonb_array_elements(fld.options) as elem
           ) as new_options
      from public.refrigeration_fields fld
     where fld.field_type = 'select'
       and jsonb_typeof(fld.options) = 'array'
       and exists (
         select 1
           from jsonb_array_elements(fld.options) as e
          where jsonb_typeof(e) = 'string'
       )
  ) sub
 where f.id = sub.id;

commit;
