-- =============================================================================
-- 00000000000235_daily_report_form_builder_schema.sql
-- Daily Reports: custom form builder + multiple titled report instances.
--
-- Phase 1 (schema only) of the form-builder feature. No app code in this
-- migration; server actions land in a follow-up migration/PR.
--
-- NAMING NOTE: the feature request refers to "tabs" and says Daily Reports
-- has "up to 20 admin-configurable tabs" that "lock at end of day." Neither
-- matches the live schema: the work-zone concept staff pick from is
-- `public.daily_report_areas` (capped at 30 active, migration 7), and
-- `daily_report_submissions` is deliberately append-only with NO per-day lock
-- (migrations 156/161 — this is called out explicitly in
-- docs/training/modules/daily-reports.md as a ⚠ VERIFY against stale sales
-- copy). New tables below use `area_id` referencing `daily_report_areas`
-- rather than inventing a parallel `daily_report_tabs` concept, so custom
-- forms and multi-instance reports slot into the area/template hierarchy
-- staff already use.
--
-- Hierarchy:
--   daily_report_areas (existing, migration 7)
--     -> daily_report_form_templates (admin-authored; versioned via
--          supersedes_id/superseded_at/superseded_by, same idiom as
--          daily_report_submissions corrections, migration 218)
--          -> daily_report_form_fields
--     -> daily_report_instances (staff-authored; MULTIPLE titled instances
--          per area per day; template_id + a frozen template_snapshot so a
--          later template edit never changes how an existing instance
--          renders)
--
-- Locking: the live Daily Reports append-only model has no end-of-day lock,
-- and this migration does not add one to daily_report_submissions. Because
-- this new feature is a real "fill in over time, then submit" flow (staff
-- create an instance, save it repeatedly as a draft, then submit — unlike
-- the one-shot legacy checklist submit), it needs a real lock so a facility
-- can be closed out for a business date. `daily_report_day_locks` is scoped
-- to ONLY the new tables via `enforce_daily_report_instance_lock()` below;
-- it says nothing about the legacy daily_report_submissions flow.
--
-- The lock is enforced twice, deliberately: once in every write-policy's
-- USING/WITH CHECK, and once again in a BEFORE trigger on
-- daily_report_instances (mirroring schedule_shifts_publish_lock,
-- migration 148/226). A UI-only lock was a prior real regression (Employee
-- Scheduling's publish-lock) — this closes that class of bug at the DB
-- boundary regardless of which path a write takes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. daily_report_form_templates
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_form_templates (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  area_id        uuid not null references public.daily_report_areas(id) on delete cascade,
  name           text not null,
  is_active      boolean not null default true,
  version        int not null default 1,
  supersedes_id  uuid references public.daily_report_form_templates(id) on delete set null,
  superseded_at  timestamptz,
  superseded_by  uuid references public.daily_report_form_templates(id) on delete set null,
  created_by     uuid references public.employees(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  constraint daily_report_form_templates_version_positive check (version >= 1)
);

comment on table public.daily_report_form_templates is
  'Daily Reports form builder: an admin-defined custom form belonging to an area. Editing publishes a NEW row (version + supersedes_id/superseded_by); existing rows are never mutated into a new version — see migration 235 header. Instances snapshot fields at creation, so old instances render unaffected by later edits.';
comment on column public.daily_report_form_templates.version is
  'Monotonically increasing per supersede chain, starting at 1. Bookkeeping only in Phase 1 — the supersede RPC that increments it lands with the server actions.';
comment on column public.daily_report_form_templates.supersedes_id is
  'Set on a new version: the template row this one replaces. Mirrors daily_report_submissions.supersedes_id (migration 218).';
comment on column public.daily_report_form_templates.superseded_at is
  'Set on the OLD row once a new version is published. NULL means this is the current version of its chain.';

create index if not exists idx_daily_report_form_templates_facility_area
  on public.daily_report_form_templates (facility_id, area_id);
create index if not exists idx_daily_report_form_templates_active
  on public.daily_report_form_templates (facility_id, area_id, is_active)
  where is_active;

-- At most one active (non-superseded) new version may point at a given
-- template as its predecessor, so a supersede chain can't branch.
create unique index if not exists uniq_daily_report_form_templates_supersedes
  on public.daily_report_form_templates (supersedes_id)
  where supersedes_id is not null;

drop trigger if exists trg_daily_report_form_templates_updated_at on public.daily_report_form_templates;
create trigger trg_daily_report_form_templates_updated_at
  before update on public.daily_report_form_templates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. daily_report_form_fields
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_form_fields (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  template_id  uuid not null references public.daily_report_form_templates(id) on delete cascade,
  label        text not null,
  field_type   text not null,
  options      jsonb,
  required     boolean not null default false,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint daily_report_form_fields_field_type_check
    check (field_type in ('text', 'textarea', 'number', 'select', 'multiselect', 'checkbox', 'time', 'date')),
  constraint daily_report_form_fields_options_shape
    check (options is null or jsonb_typeof(options) = 'array')
);

comment on table public.daily_report_form_fields is
  'Daily Reports form builder: one custom field on a daily_report_form_templates row. options holds the choice list for select/multiselect fields as a JSON array.';

create index if not exists idx_daily_report_form_fields_template
  on public.daily_report_form_fields (template_id, sort_order);
create index if not exists idx_daily_report_form_fields_facility
  on public.daily_report_form_fields (facility_id);

drop trigger if exists trg_daily_report_form_fields_updated_at on public.daily_report_form_fields;
create trigger trg_daily_report_form_fields_updated_at
  before update on public.daily_report_form_fields
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. daily_report_instances
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_instances (
  id                 uuid primary key default gen_random_uuid(),
  facility_id        uuid not null references public.facilities(id) on delete restrict,
  area_id            uuid not null references public.daily_report_areas(id) on delete restrict,
  report_date        date not null,
  title              text not null,
  template_id        uuid not null references public.daily_report_form_templates(id) on delete restrict,
  template_snapshot  jsonb not null,
  responses          jsonb not null default '{}'::jsonb,
  status             text not null default 'draft',
  employee_id        uuid references public.employees(id) on delete set null,
  submitted_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  constraint daily_report_instances_status_check check (status in ('draft', 'submitted')),
  constraint daily_report_instances_title_not_blank check (btrim(title) <> ''),
  constraint daily_report_instances_snapshot_shape check (jsonb_typeof(template_snapshot) = 'object'),
  constraint daily_report_instances_responses_shape check (jsonb_typeof(responses) = 'object')
);

comment on table public.daily_report_instances is
  'Daily Reports form builder: a staff-created, titled report instance against a form template. Multiple instances may exist per (facility, area, report_date) — e.g. two "Event Set Up" instances titled by event. template_snapshot freezes the field list at creation time so later template edits never change how an existing instance renders. Writes are gated by daily_report_day_locks for (facility_id, report_date) — see enforce_daily_report_instance_lock() below.';
comment on column public.daily_report_instances.template_snapshot is
  'Frozen copy of the template''s fields (and any relevant template metadata) at the moment this instance was created. Never re-derived from daily_report_form_fields after creation.';
comment on column public.daily_report_instances.responses is
  'Field responses keyed by field_id (as they appeared in template_snapshot at creation time).';
comment on column public.daily_report_instances.status is
  'draft: staff may still edit (saveReportInstance). submitted: append-only from here, mirrors the rest of Daily Reports — only a module admin may further edit.';

create index if not exists idx_daily_report_instances_facility_area_date
  on public.daily_report_instances (facility_id, area_id, report_date);
create index if not exists idx_daily_report_instances_facility_date
  on public.daily_report_instances (facility_id, report_date);
create index if not exists idx_daily_report_instances_employee
  on public.daily_report_instances (employee_id);
create index if not exists idx_daily_report_instances_template
  on public.daily_report_instances (template_id);

drop trigger if exists trg_daily_report_instances_updated_at on public.daily_report_instances;
create trigger trg_daily_report_instances_updated_at
  before update on public.daily_report_instances
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. daily_report_day_locks
--
-- One row per (facility, report_date) that has been closed out. Presence of
-- a row = locked. Scoped to the new form-builder tables only (see header);
-- does not affect daily_report_submissions. Phase 2 will add the actual
-- lock-setting path (an admin action and/or a CRON_SECRET-authenticated
-- route, per the api/cron/* convention) — this migration only adds the
-- table, the read helper, and the enforcement points that consult it.
-- -----------------------------------------------------------------------------
create table if not exists public.daily_report_day_locks (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  report_date  date not null,
  locked_at    timestamptz not null default now(),
  locked_by    uuid references public.employees(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint daily_report_day_locks_uniq unique (facility_id, report_date)
);

comment on table public.daily_report_day_locks is
  'One row per (facility_id, report_date) that has been locked for daily_report_instances writes. locked_by is nullable so a system/cron-driven lock (no acting employee) can be represented. Presence of a row = locked; there is no separate boolean.';

create index if not exists idx_daily_report_day_locks_facility
  on public.daily_report_day_locks (facility_id);

-- -----------------------------------------------------------------------------
-- 5. daily_report_day_is_locked(facility_id, report_date) -> bool
--
-- SECURITY DEFINER so it can be called from RLS policies (which run as the
-- querying user) and from server-action code via rpc() without needing a
-- SELECT grant on daily_report_day_locks itself.
-- -----------------------------------------------------------------------------
create or replace function public.daily_report_day_is_locked(
  p_facility_id uuid,
  p_report_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.daily_report_day_locks l
     where l.facility_id = p_facility_id
       and l.report_date = p_report_date
  );
$$;

comment on function public.daily_report_day_is_locked(uuid, date) is
  'True if (facility_id, report_date) has a daily_report_day_locks row. Used by daily_report_instances RLS policies and by enforce_daily_report_instance_lock(); Phase 2 server actions call this directly (via rpc) before attempting a write so they can return a friendly error instead of relying on the DB rejection alone.';

revoke execute on function public.daily_report_day_is_locked(uuid, date) from public, anon;
grant  execute on function public.daily_report_day_is_locked(uuid, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. enforce_daily_report_instance_lock() trigger
--
-- Defense-in-depth alongside the RLS WITH CHECK clauses below: rejects any
-- INSERT/UPDATE/DELETE on daily_report_instances for a locked
-- (facility_id, report_date), regardless of which write path is used.
-- Trusted backend roles bypass (same shape as schedule_shifts_publish_lock,
-- migrations 148/226) so a service-role sync/cron path or a future
-- SECURITY DEFINER correction RPC can still act deliberately on a locked
-- day if one is ever introduced.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_daily_report_instance_lock()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid := coalesce(new.facility_id, old.facility_id);
  v_report_date date := coalesce(new.report_date, old.report_date);
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if public.daily_report_day_is_locked(v_facility_id, v_report_date) then
    raise exception
      'Daily report instances for % are locked and can no longer be created, edited, or deleted.',
      v_report_date
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.enforce_daily_report_instance_lock() is
  'BEFORE INSERT/UPDATE/DELETE guard: rejects any end-user write to daily_report_instances for a locked (facility_id, report_date). Trusted backend roles bypass, mirroring schedule_shifts_publish_lock (migrations 148/226). Do not repeat the Employee Scheduling publish-lock regression (UI-only enforcement) here.';

drop trigger if exists trg_daily_report_instances_lock on public.daily_report_instances;
create trigger trg_daily_report_instances_lock
  before insert or update or delete on public.daily_report_instances
  for each row execute function public.enforce_daily_report_instance_lock();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.daily_report_form_templates enable row level security;
alter table public.daily_report_form_fields    enable row level security;
alter table public.daily_report_instances      enable row level security;
alter table public.daily_report_day_locks      enable row level security;

-- -----------------------------------------------------------------------------
-- daily_report_form_templates
--   SELECT: super admin OR same-facility + has_module_access('daily_reports')
--           (module-level view, no area check — matches the existing
--           daily_report_areas/templates/checklist_items config tables).
--   INSERT/UPDATE/DELETE: super admin OR same-facility + module admin.
-- -----------------------------------------------------------------------------
drop policy if exists daily_report_form_templates_select on public.daily_report_form_templates;
create policy daily_report_form_templates_select on public.daily_report_form_templates
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists daily_report_form_templates_insert on public.daily_report_form_templates;
create policy daily_report_form_templates_insert on public.daily_report_form_templates
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_form_templates_update on public.daily_report_form_templates;
create policy daily_report_form_templates_update on public.daily_report_form_templates
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

drop policy if exists daily_report_form_templates_delete on public.daily_report_form_templates;
create policy daily_report_form_templates_delete on public.daily_report_form_templates
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- daily_report_form_fields — same shape as daily_report_checklist_items.
-- -----------------------------------------------------------------------------
drop policy if exists daily_report_form_fields_select on public.daily_report_form_fields;
create policy daily_report_form_fields_select on public.daily_report_form_fields
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists daily_report_form_fields_insert on public.daily_report_form_fields;
create policy daily_report_form_fields_insert on public.daily_report_form_fields
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_form_fields_update on public.daily_report_form_fields;
create policy daily_report_form_fields_update on public.daily_report_form_fields
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

drop policy if exists daily_report_form_fields_delete on public.daily_report_form_fields;
create policy daily_report_form_fields_delete on public.daily_report_form_fields
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- daily_report_instances
--   SELECT: super admin OR (same-facility AND (module admin OR (module view
--           + area view access))). Matches daily_report_submissions.
--   INSERT: super admin OR (same-facility + module submit-level + area
--           submit access + employee_id = current_employee_id() + day not
--           locked).
--   UPDATE: module admin may always edit. The owning employee may edit ONLY
--           while the row is still 'draft' (checked against the OLD row) and
--           the day is not locked; with check re-verifies ownership/area but
--           deliberately does not re-require status='draft' on the NEW row,
--           since submitReportInstance's own draft->submitted transition is
--           itself an UPDATE that must be allowed. Once a row is submitted,
--           the next UPDATE attempt's OLD.status is 'submitted' and the
--           owner branch stops matching — staff cannot edit a submitted
--           instance, mirroring the rest of Daily Reports.
--   DELETE: admin only (no deleteReportInstance action is planned).
-- -----------------------------------------------------------------------------
drop policy if exists daily_report_instances_select on public.daily_report_instances;
create policy daily_report_instances_select on public.daily_report_instances
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or (
          public.current_employee_module_permission('daily_reports')
            >= 'view'::public.module_permission_level
          and public.has_area_access('daily_reports', area_id)
        )
      )
    )
  );

drop policy if exists daily_report_instances_insert on public.daily_report_instances;
create policy daily_report_instances_insert on public.daily_report_instances
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and employee_id = public.current_employee_id()
      and public.current_employee_module_permission('daily_reports')
            >= 'submit'::public.module_permission_level
      and public.has_area_submit_access('daily_reports', area_id)
      and not public.daily_report_day_is_locked(facility_id, report_date)
    )
  );

drop policy if exists daily_report_instances_update on public.daily_report_instances;
create policy daily_report_instances_update on public.daily_report_instances
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
    or (
      facility_id = public.current_facility_id()
      and employee_id = public.current_employee_id()
      and status = 'draft'
      and public.current_employee_module_permission('daily_reports')
            >= 'submit'::public.module_permission_level
      and public.has_area_submit_access('daily_reports', area_id)
      and not public.daily_report_day_is_locked(facility_id, report_date)
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
    or (
      facility_id = public.current_facility_id()
      and employee_id = public.current_employee_id()
      and public.current_employee_module_permission('daily_reports')
            >= 'submit'::public.module_permission_level
      and public.has_area_submit_access('daily_reports', area_id)
      and not public.daily_report_day_is_locked(facility_id, report_date)
    )
  );

drop policy if exists daily_report_instances_delete on public.daily_report_instances;
create policy daily_report_instances_delete on public.daily_report_instances
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- -----------------------------------------------------------------------------
-- daily_report_day_locks
--   SELECT: super admin OR same-facility + module view access (staff should
--           be able to see a day is locked, e.g. to render the read-only
--           state described in Phase 3).
--   INSERT/DELETE: super admin OR same-facility + module admin (manual
--           lock/unlock). No UPDATE policy: a lock is a set-once fact —
--           "moving" a lock to a different date is an unlock + re-lock.
--           A service-role cron path (Phase 2) bypasses RLS entirely, same
--           as every other api/cron/* route in this app.
-- -----------------------------------------------------------------------------
drop policy if exists daily_report_day_locks_select on public.daily_report_day_locks;
create policy daily_report_day_locks_select on public.daily_report_day_locks
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists daily_report_day_locks_insert on public.daily_report_day_locks;
create policy daily_report_day_locks_insert on public.daily_report_day_locks
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_day_locks_delete on public.daily_report_day_locks;
create policy daily_report_day_locks_delete on public.daily_report_day_locks
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );
