-- =============================================================================
-- 00000000000007_daily_reports_schema.sql
-- Daily Reports module: 6 tables + RLS + retention helper.
--
-- Hierarchy:
--   daily_report_areas (max 30 active per facility)
--     -> daily_report_templates
--          -> daily_report_checklist_items
--          -> daily_report_submissions
--               -> daily_report_submission_items
--               -> daily_report_notes
--
-- Strict facility isolation. RLS enforced everywhere.
-- Retention: submissions older than 14 days purged via
-- public.purge_old_daily_reports() (schedule via Supabase Cron Jobs).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. daily_report_areas
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_areas (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  color        text,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint daily_report_areas_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.daily_report_areas is
  'Daily Reports: per-facility checklist areas (max 30 active per facility).';

create index if not exists idx_daily_report_areas_facility
  on public.daily_report_areas (facility_id);
create index if not exists idx_daily_report_areas_facility_active
  on public.daily_report_areas (facility_id, is_active);

drop trigger if exists trg_daily_report_areas_updated_at on public.daily_report_areas;
create trigger trg_daily_report_areas_updated_at
  before update on public.daily_report_areas
  for each row execute function public.set_updated_at();

-- Enforce: at most 30 active areas per facility.
create or replace function public.enforce_daily_report_areas_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if new.is_active is true then
    select count(*) into v_count
      from public.daily_report_areas
     where facility_id = new.facility_id
       and is_active = true
       and (tg_op = 'INSERT' or id <> new.id);
    if v_count >= 30 then
      raise exception 'Facility % already has 30 active daily report areas (max).', new.facility_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_daily_report_areas_cap() is
  'Trigger: raises if a facility would exceed 30 active daily_report_areas.';

drop trigger if exists trg_daily_report_areas_cap on public.daily_report_areas;
create trigger trg_daily_report_areas_cap
  before insert or update on public.daily_report_areas
  for each row execute function public.enforce_daily_report_areas_cap();

-- -----------------------------------------------------------------------------
-- 2. daily_report_templates
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_templates (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  area_id      uuid not null references public.daily_report_areas(id) on delete cascade,
  name         text not null,
  description  text,
  is_active    boolean not null default true,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.daily_report_templates is
  'Daily Reports: templates within an area; group of checklist items.';

create index if not exists idx_daily_report_templates_facility_area
  on public.daily_report_templates (facility_id, area_id);
create index if not exists idx_daily_report_templates_area
  on public.daily_report_templates (area_id);

drop trigger if exists trg_daily_report_templates_updated_at on public.daily_report_templates;
create trigger trg_daily_report_templates_updated_at
  before update on public.daily_report_templates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. daily_report_checklist_items
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  template_id  uuid not null references public.daily_report_templates(id) on delete cascade,
  label        text not null,
  description  text,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.daily_report_checklist_items is
  'Daily Reports: individual checkbox rows belonging to a template.';

create index if not exists idx_daily_report_checklist_items_template
  on public.daily_report_checklist_items (template_id);
create index if not exists idx_daily_report_checklist_items_facility
  on public.daily_report_checklist_items (facility_id);

drop trigger if exists trg_daily_report_checklist_items_updated_at on public.daily_report_checklist_items;
create trigger trg_daily_report_checklist_items_updated_at
  before update on public.daily_report_checklist_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. daily_report_submissions
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_submissions (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  area_id       uuid not null references public.daily_report_areas(id) on delete restrict,
  template_id   uuid not null references public.daily_report_templates(id) on delete restrict,
  employee_id   uuid references public.employees(id) on delete set null,
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

comment on table public.daily_report_submissions is
  'Daily Reports: a single submission against a template by an employee.';

create index if not exists idx_daily_report_submissions_facility_submitted
  on public.daily_report_submissions (facility_id, submitted_at desc);
create index if not exists idx_daily_report_submissions_area_submitted
  on public.daily_report_submissions (area_id, submitted_at desc);
create index if not exists idx_daily_report_submissions_employee
  on public.daily_report_submissions (employee_id);
create index if not exists idx_daily_report_submissions_template
  on public.daily_report_submissions (template_id);

drop trigger if exists trg_daily_report_submissions_updated_at on public.daily_report_submissions;
create trigger trg_daily_report_submissions_updated_at
  before update on public.daily_report_submissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. daily_report_submission_items
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_submission_items (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references public.facilities(id) on delete restrict,
  submission_id       uuid not null references public.daily_report_submissions(id) on delete cascade,
  checklist_item_id   uuid references public.daily_report_checklist_items(id) on delete set null,
  label_snapshot      text not null,
  is_checked          boolean not null default false,
  created_at          timestamptz not null default now()
);

comment on table public.daily_report_submission_items is
  'Daily Reports: per-item check state for a submission. label_snapshot preserves history if the underlying checklist item is later edited or removed.';

create index if not exists idx_daily_report_submission_items_submission
  on public.daily_report_submission_items (submission_id);
create index if not exists idx_daily_report_submission_items_checklist_item
  on public.daily_report_submission_items (checklist_item_id);

-- Unique per submission per checklist item (only when checklist_item_id present)
create unique index if not exists uniq_daily_report_submission_items_sub_item
  on public.daily_report_submission_items (submission_id, checklist_item_id)
  where checklist_item_id is not null;

-- -----------------------------------------------------------------------------
-- 6. daily_report_notes
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_notes (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  submission_id   uuid not null references public.daily_report_submissions(id) on delete cascade,
  employee_id     uuid references public.employees(id) on delete set null,
  body            text not null,
  is_admin_note   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

comment on table public.daily_report_notes is
  'Daily Reports: free-text notes attached to a submission. is_admin_note differentiates staff-authored vs. admin-authored notes.';

create index if not exists idx_daily_report_notes_submission_created
  on public.daily_report_notes (submission_id, created_at);
create index if not exists idx_daily_report_notes_facility
  on public.daily_report_notes (facility_id);

drop trigger if exists trg_daily_report_notes_updated_at on public.daily_report_notes;
create trigger trg_daily_report_notes_updated_at
  before update on public.daily_report_notes
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.daily_report_areas            enable row level security;
alter table public.daily_report_templates        enable row level security;
alter table public.daily_report_checklist_items  enable row level security;
alter table public.daily_report_submissions      enable row level security;
alter table public.daily_report_submission_items enable row level security;
alter table public.daily_report_notes            enable row level security;

-- -----------------------------------------------------------------------------
-- Admin tables: areas, templates, checklist_items
--   SELECT: super admin OR same-facility + has_module_access('daily_reports')
--   INSERT/UPDATE/DELETE: super admin OR same-facility + module admin access
-- -----------------------------------------------------------------------------

-- daily_report_areas
drop policy if exists daily_report_areas_select on public.daily_report_areas;
create policy daily_report_areas_select on public.daily_report_areas
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists daily_report_areas_insert on public.daily_report_areas;
create policy daily_report_areas_insert on public.daily_report_areas
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_areas_update on public.daily_report_areas;
create policy daily_report_areas_update on public.daily_report_areas
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_areas_delete on public.daily_report_areas;
create policy daily_report_areas_delete on public.daily_report_areas
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- daily_report_templates
drop policy if exists daily_report_templates_select on public.daily_report_templates;
create policy daily_report_templates_select on public.daily_report_templates
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists daily_report_templates_insert on public.daily_report_templates;
create policy daily_report_templates_insert on public.daily_report_templates
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_templates_update on public.daily_report_templates;
create policy daily_report_templates_update on public.daily_report_templates
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_templates_delete on public.daily_report_templates;
create policy daily_report_templates_delete on public.daily_report_templates
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- daily_report_checklist_items
drop policy if exists daily_report_checklist_items_select on public.daily_report_checklist_items;
create policy daily_report_checklist_items_select on public.daily_report_checklist_items
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists daily_report_checklist_items_insert on public.daily_report_checklist_items;
create policy daily_report_checklist_items_insert on public.daily_report_checklist_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_checklist_items_update on public.daily_report_checklist_items;
create policy daily_report_checklist_items_update on public.daily_report_checklist_items
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_checklist_items_delete on public.daily_report_checklist_items;
create policy daily_report_checklist_items_delete on public.daily_report_checklist_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- daily_report_submissions
--   SELECT: super admin OR (same-facility AND (module admin OR (module access AND area access)))
--   INSERT: super admin OR (same-facility + module access + area access + employee_id = current_employee_id)
--   UPDATE/DELETE: admin only (managers cannot edit)
-- -----------------------------------------------------------------------------
drop policy if exists daily_report_submissions_select on public.daily_report_submissions;
create policy daily_report_submissions_select on public.daily_report_submissions
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or (
          public.has_module_access('daily_reports')
          and public.has_area_access('daily_reports', area_id)
        )
      )
    )
  );

drop policy if exists daily_report_submissions_insert on public.daily_report_submissions;
create policy daily_report_submissions_insert on public.daily_report_submissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
      and public.has_area_access('daily_reports', area_id)
      and employee_id = public.current_employee_id()
    )
  );

drop policy if exists daily_report_submissions_update on public.daily_report_submissions;
create policy daily_report_submissions_update on public.daily_report_submissions
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_submissions_delete on public.daily_report_submissions;
create policy daily_report_submissions_delete on public.daily_report_submissions
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- daily_report_submission_items
--   SELECT: defer to parent submission via EXISTS subquery (RLS on parent table
--           is evaluated for the caller, keeping logic DRY).
--   INSERT: same-facility + module access; the submission INSERT policy is the
--           real gatekeeper — children rely on parent's RLS to be created.
--   UPDATE/DELETE: admin only.
-- -----------------------------------------------------------------------------
drop policy if exists daily_report_submission_items_select on public.daily_report_submission_items;
create policy daily_report_submission_items_select on public.daily_report_submission_items
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.daily_report_submissions s
      where s.id = submission_id
    )
  );

drop policy if exists daily_report_submission_items_insert on public.daily_report_submission_items;
create policy daily_report_submission_items_insert on public.daily_report_submission_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists daily_report_submission_items_update on public.daily_report_submission_items;
create policy daily_report_submission_items_update on public.daily_report_submission_items
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_submission_items_delete on public.daily_report_submission_items;
create policy daily_report_submission_items_delete on public.daily_report_submission_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- daily_report_notes
--   SELECT: super admin OR (same-facility AND (module admin OR (module access AND area access on parent submission)))
--           Implemented via EXISTS subquery against submissions; relies on
--           submissions RLS for the readability check.
--   INSERT: same-facility + module access (app sets is_admin_note correctly)
--   UPDATE/DELETE: admin only.
-- -----------------------------------------------------------------------------
drop policy if exists daily_report_notes_select on public.daily_report_notes;
create policy daily_report_notes_select on public.daily_report_notes
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.daily_report_submissions s
      where s.id = submission_id
    )
  );

drop policy if exists daily_report_notes_insert on public.daily_report_notes;
create policy daily_report_notes_insert on public.daily_report_notes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
      and exists (
        select 1
        from public.daily_report_submissions s
        where s.id = submission_id
      )
    )
  );

drop policy if exists daily_report_notes_update on public.daily_report_notes;
create policy daily_report_notes_update on public.daily_report_notes
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_notes_delete on public.daily_report_notes;
create policy daily_report_notes_delete on public.daily_report_notes
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- =============================================================================
-- Retention: purge submissions older than 14 days.
-- Cascades clear submission_items + notes via FK ON DELETE CASCADE.
--
-- NOTE: This function is NOT auto-scheduled here. To enable daily purges:
--   Supabase Dashboard -> Database -> Cron Jobs (or pg_cron if installed):
--     select cron.schedule(
--       'purge_old_daily_reports_daily',
--       '15 3 * * *',
--       $$select public.purge_old_daily_reports();$$
--     );
-- =============================================================================
create or replace function public.purge_old_daily_reports()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.daily_report_submissions
   where submitted_at < now() - interval '14 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_old_daily_reports() is
  'Deletes daily_report_submissions older than 14 days (cascades to items + notes). Schedule via Supabase Cron (pg_cron) - not auto-scheduled by this migration.';

revoke execute on function public.purge_old_daily_reports() from public;
grant  execute on function public.purge_old_daily_reports() to service_role;
