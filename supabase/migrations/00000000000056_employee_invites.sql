-- 00000000000056_employee_invites.sql
--
-- Tracks pending magic-link invitations sent to employees. An invite is
-- created when an admin adds an employee with an email but no linked
-- auth user. On first successful login (via Supabase magic link), the
-- application binds the auth.users.id onto employees.user_id and marks
-- the invite as accepted.
--
-- Status transitions:
--   pending  -> sent       (after Supabase sends the email)
--   sent     -> accepted   (on first login that binds employees.user_id)
--   pending|sent -> revoked (admin cancel)
--   pending|sent -> expired (TTL pass)

begin;

create table if not exists public.employee_invites (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete cascade,
  employee_id   uuid not null references public.employees(id)  on delete cascade,
  email         text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'sent', 'accepted', 'revoked', 'expired')),
  sent_at       timestamptz,
  accepted_at   timestamptz,
  expires_at    timestamptz,
  invited_by    uuid references auth.users(id) on delete set null,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists employee_invites_facility_idx
  on public.employee_invites (facility_id);
create index if not exists employee_invites_employee_idx
  on public.employee_invites (employee_id);
create unique index if not exists employee_invites_active_uniq
  on public.employee_invites (employee_id)
  where status in ('pending', 'sent');

drop trigger if exists trg_employee_invites_touch on public.employee_invites;
create trigger trg_employee_invites_touch
  before update on public.employee_invites
  for each row execute function public.touch_updated_at();

alter table public.employee_invites enable row level security;

drop policy if exists employee_invites_select on public.employee_invites;
create policy employee_invites_select
  on public.employee_invites
  for select
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists employee_invites_write on public.employee_invites;
create policy employee_invites_write
  on public.employee_invites
  for all
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1 from public.employees me
        join public.roles r on r.id = me.role_id
        where me.user_id = auth.uid()
          and me.is_active
          and r.key in ('admin', 'super_admin')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1 from public.employees me
        join public.roles r on r.id = me.role_id
        where me.user_id = auth.uid()
          and me.is_active
          and r.key in ('admin', 'super_admin')
      )
    )
  );

comment on table public.employee_invites is
  'Pending and historical magic-link invitations sent to employees. One '
  'active (pending|sent) invite per employee at a time.';

commit;
