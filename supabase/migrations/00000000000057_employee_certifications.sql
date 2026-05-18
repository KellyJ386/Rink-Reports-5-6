-- 00000000000057_employee_certifications.sql
--
-- Tracks per-employee certifications and training (CPR, refrigeration
-- operator, first aid, etc.) with optional issue and expiration dates.
-- Surfaced as a sub-section on the employee detail page so admins can
-- see who's coming due.

begin;

create table if not exists public.employee_certifications (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete cascade,
  employee_id   uuid not null references public.employees(id)  on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  issuer        text check (issuer is null or length(issuer) <= 200),
  issued_at     date,
  expires_at    date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists employee_certifications_facility_idx
  on public.employee_certifications (facility_id);
create index if not exists employee_certifications_employee_idx
  on public.employee_certifications (employee_id);
create index if not exists employee_certifications_expires_idx
  on public.employee_certifications (expires_at)
  where expires_at is not null;

drop trigger if exists trg_employee_certifications_touch on public.employee_certifications;
create trigger trg_employee_certifications_touch
  before update on public.employee_certifications
  for each row execute function public.set_updated_at();

alter table public.employee_certifications enable row level security;

drop policy if exists employee_certifications_select on public.employee_certifications;
create policy employee_certifications_select
  on public.employee_certifications
  for select
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists employee_certifications_write on public.employee_certifications;
create policy employee_certifications_write
  on public.employee_certifications
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

comment on table public.employee_certifications is
  'Per-employee certifications and training records with optional '
  'issuance and expiration dates. Facility-scoped via RLS.';

commit;
