-- =============================================================================
-- 00000000000104_incident_report_children.sql
-- Incident Report redesign child tables:
--   incident_report_spaces  (multi-select facility spaces per report)
--   incident_witnesses      (0..3 per report; split phone/email contact)
--   incident_change_log     (append-only audit trail)
--
-- All write access is gated on the parent incident_reports edit window
-- (added in 00000000000103) or module admin access, mirroring the accident
-- equivalents.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. incident_report_spaces (report <-> facility_spaces join, multi-select)
-- -----------------------------------------------------------------------------
create table if not exists public.incident_report_spaces (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  incident_id  uuid not null references public.incident_reports(id) on delete cascade,
  space_id     uuid not null references public.facility_spaces(id) on delete restrict,
  created_at   timestamptz not null default now(),
  constraint incident_report_spaces_uniq unique (incident_id, space_id)
);

comment on table public.incident_report_spaces is
  'Incident Reports: many-to-many link of a report to the facility spaces it applies to. "Other" free text lives on incident_reports.location_other.';

create index if not exists idx_incident_report_spaces_incident
  on public.incident_report_spaces (incident_id);
create index if not exists idx_incident_report_spaces_space
  on public.incident_report_spaces (space_id);
create index if not exists idx_incident_report_spaces_facility
  on public.incident_report_spaces (facility_id);

-- -----------------------------------------------------------------------------
-- 2. incident_witnesses (0..3 per report; ordered by sort_order)
--    Split contact into phone + email (diverges from accident_witnesses).
-- -----------------------------------------------------------------------------
create table if not exists public.incident_witnesses (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  incident_id  uuid not null references public.incident_reports(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  phone        text,
  email        text,
  statement    text,
  sort_order   int  not null default 0 check (sort_order >= 0 and sort_order <= 2),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  -- At least one contact (phone or email) is required per witness.
  constraint incident_witnesses_contact_present
    check (
      (phone is not null and length(btrim(phone)) > 0)
      or (email is not null and length(btrim(email)) > 0)
    ),
  constraint incident_witnesses_uniq_per_report unique (incident_id, sort_order)
);

comment on table public.incident_witnesses is
  'Incident Reports: up to 3 witnesses per report. Name + at least one of phone/email required. Editable while the parent report is within its 24h edit window.';

create index if not exists idx_incident_witnesses_incident
  on public.incident_witnesses (incident_id);
create index if not exists idx_incident_witnesses_facility
  on public.incident_witnesses (facility_id);

drop trigger if exists trg_incident_witnesses_updated_at on public.incident_witnesses;
create trigger trg_incident_witnesses_updated_at
  before update on public.incident_witnesses
  for each row execute function public.set_updated_at();

-- Cap to 3 witnesses per report. (The unique index on (incident_id, sort_order)
-- with the 0..2 check already prevents more than 3; this gives a clear error.)
create or replace function public.enforce_incident_witnesses_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count int;
begin
  select count(*) into current_count
    from public.incident_witnesses
    where incident_id = NEW.incident_id;
  if current_count >= 3 then
    raise exception 'Incident reports can have at most 3 witnesses';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_incident_witnesses_cap on public.incident_witnesses;
create trigger trg_incident_witnesses_cap
  before insert on public.incident_witnesses
  for each row execute function public.enforce_incident_witnesses_cap();

-- -----------------------------------------------------------------------------
-- 3. incident_change_log (append-only audit trail)
-- -----------------------------------------------------------------------------
create table if not exists public.incident_change_log (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  incident_id  uuid not null references public.incident_reports(id) on delete cascade,
  employee_id  uuid references public.employees(id) on delete set null,
  action       text not null,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.incident_change_log is
  'Incident Reports: append-only audit log. action e.g. create, update, add_witness, remove_witness. Visible to admins only. No update/delete policies.';

create index if not exists idx_incident_change_log_incident_created
  on public.incident_change_log (incident_id, created_at);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.incident_report_spaces enable row level security;
alter table public.incident_witnesses     enable row level security;
alter table public.incident_change_log    enable row level security;

-- -----------------------------------------------------------------------------
-- incident_report_spaces
--   SELECT: super admin OR (same-facility AND (module admin OR own parent))
--   INSERT/UPDATE/DELETE: super admin OR (same-facility AND
--     (module admin OR (own parent AND within edit window)))
-- -----------------------------------------------------------------------------
drop policy if exists incident_report_spaces_select on public.incident_report_spaces;
create policy incident_report_spaces_select on public.incident_report_spaces
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('incident_reports')
        or exists (
          select 1
          from public.incident_reports r
          where r.id = incident_id
            and r.employee_id = public.current_employee_id()
        )
      )
    )
  );

drop policy if exists incident_report_spaces_insert on public.incident_report_spaces;
create policy incident_report_spaces_insert on public.incident_report_spaces
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.incident_reports r
        where r.id = incident_id
          and (
            public.has_module_admin_access('incident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  );

drop policy if exists incident_report_spaces_delete on public.incident_report_spaces;
create policy incident_report_spaces_delete on public.incident_report_spaces
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.incident_reports r
        where r.id = incident_id
          and (
            public.has_module_admin_access('incident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- incident_witnesses (mirror incident_report_spaces; UPDATE allowed in-window)
-- -----------------------------------------------------------------------------
drop policy if exists incident_witnesses_select on public.incident_witnesses;
create policy incident_witnesses_select on public.incident_witnesses
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('incident_reports')
        or exists (
          select 1
          from public.incident_reports r
          where r.id = incident_id
            and r.employee_id = public.current_employee_id()
        )
      )
    )
  );

drop policy if exists incident_witnesses_insert on public.incident_witnesses;
create policy incident_witnesses_insert on public.incident_witnesses
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.incident_reports r
        where r.id = incident_id
          and (
            public.has_module_admin_access('incident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  );

drop policy if exists incident_witnesses_update on public.incident_witnesses;
create policy incident_witnesses_update on public.incident_witnesses
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.incident_reports r
        where r.id = incident_id
          and (
            public.has_module_admin_access('incident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.incident_reports r
        where r.id = incident_id
          and (
            public.has_module_admin_access('incident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  );

drop policy if exists incident_witnesses_delete on public.incident_witnesses;
create policy incident_witnesses_delete on public.incident_witnesses
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and exists (
        select 1
        from public.incident_reports r
        where r.id = incident_id
          and (
            public.has_module_admin_access('incident_reports')
            or (
              r.employee_id = public.current_employee_id()
              and now() <= r.edit_window_ends_at
            )
          )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- incident_change_log (append-only)
--   SELECT: super_admin OR module admin
--   INSERT: any authenticated user in same facility (server is the writer;
--           write authority is gated upstream by incident_reports update policy)
--   UPDATE/DELETE: no policies -> denied
-- -----------------------------------------------------------------------------
drop policy if exists incident_change_log_select on public.incident_change_log;
create policy incident_change_log_select on public.incident_change_log
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('incident_reports')
    )
  );

drop policy if exists incident_change_log_insert on public.incident_change_log;
create policy incident_change_log_insert on public.incident_change_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- (No update / delete policies -- append-only.)
