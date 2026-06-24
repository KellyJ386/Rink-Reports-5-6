-- Refrigeration: configurable max readings (rounds) per shift.
-- NULL = unlimited / unspecified (prior behavior). When set, the staff form
-- caps the round number and the submit path rejects a round_no outside
-- 1..readings_per_shift. Admin-controlled via refrigeration settings.

alter table public.refrigeration_settings
  add column if not exists readings_per_shift smallint;

alter table public.refrigeration_settings
  drop constraint if exists refrigeration_settings_readings_per_shift_check;
alter table public.refrigeration_settings
  add constraint refrigeration_settings_readings_per_shift_check
  check (readings_per_shift is null or (readings_per_shift between 1 and 99));

comment on column public.refrigeration_settings.readings_per_shift is
  'Max reading rounds per shift (admin-configured). NULL = unlimited. Enforced app-side: round_no must be between 1 and this value.';
