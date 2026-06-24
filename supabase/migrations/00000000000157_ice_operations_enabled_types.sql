-- Ice Operations: per-facility visibility for the (code-defined) operation
-- types. The four operation types are intentionally code-coupled — each maps to
-- a distinct form + jsonb payload shape + validation — so they can't be created
-- from the admin UI, but a facility can choose which of them its staff see.
--
-- NULL or empty = all operations enabled (prior behavior, fail-open). Values are
-- a subset of {ice_make, circle_check, edging, blade_change}.

alter table public.ice_operations_settings
  add column if not exists enabled_operation_types text[];

comment on column public.ice_operations_settings.enabled_operation_types is
  'Subset of operation types visible to staff (ice_make/circle_check/edging/blade_change). NULL/empty = all enabled. The types themselves are code-defined; this only gates visibility.';
