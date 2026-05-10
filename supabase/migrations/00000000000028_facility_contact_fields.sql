alter table public.facilities
  add column if not exists address  text,
  add column if not exists zip_code text,
  add column if not exists phone    text;
