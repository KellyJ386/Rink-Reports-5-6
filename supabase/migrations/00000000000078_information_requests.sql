-- 00000000000078_information_requests.sql
--
-- Public-facing "Request Information" submissions from the splash page.
-- These come from unauthenticated visitors, so the table accepts inserts
-- from the `anon` role and is otherwise admin-only.

begin;

create table if not exists public.information_requests (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  email           text        not null,
  company         text        not null,
  -- Address kept as free-form components so US, Canadian, and international
  -- formats all fit. `address_country` is the only required address field;
  -- everything else may be blank for partial international addresses.
  address_line1   text        not null default '',
  address_line2   text        not null default '',
  address_city    text        not null default '',
  address_region  text        not null default '',
  address_postal  text        not null default '',
  address_country text        not null,
  note            text        not null default '',
  status          text        not null default 'new',
  created_at      timestamptz not null default now()
);

create index if not exists information_requests_created_at_idx
  on public.information_requests (created_at desc);

alter table public.information_requests enable row level security;

-- Anonymous visitors and authenticated users can submit a request.
drop policy if exists information_requests_insert on public.information_requests;
create policy information_requests_insert on public.information_requests
  for insert to anon, authenticated
  with check (true);

-- Only super admins can read / update / delete the queue.
drop policy if exists information_requests_select on public.information_requests;
create policy information_requests_select on public.information_requests
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists information_requests_update on public.information_requests;
create policy information_requests_update on public.information_requests
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists information_requests_delete on public.information_requests;
create policy information_requests_delete on public.information_requests
  for delete to authenticated
  using (public.is_super_admin());

commit;
