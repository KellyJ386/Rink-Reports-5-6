-- Add city, state, and email columns to facilities so Admin Control Center
-- → Facility Settings can persist a complete mailing address and contact email.
-- All three columns are nullable to match the existing address/zip_code/phone
-- columns added previously.

alter table public.facilities
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists email text;
