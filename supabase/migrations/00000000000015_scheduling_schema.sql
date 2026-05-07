-- =============================================================================
-- 00000000000015_scheduling_schema.sql
-- Scheduling module: 11 tables + RLS + seed-defaults helper + claim helper.
--
-- Premium scheduling module. Completely separate from reporting modules; only
-- connected to Employee/User Setup. Reuses the existing backbone
-- public.departments table -- no schedule_departments table.
--
-- Views supported by UI: day / week / month / employee / department.
-- Capabilities: open shifts, recurring shifts via templates, copy schedule,
-- draft / published lifecycle, time-off requests, availability submissions,
-- shift swaps with manager approval, claim of open shifts.
--
-- Notifications routed to schedule_notifications (in-app); the application may
-- additionally insert public.communication_alerts rows with
-- source_module = 'scheduling' for cross-module alert surfaces.
--
-- Compliance: minor-hour limits, weekly overtime, break compliance,
-- certification requirements -- expressed as schedule_compliance_rules rows.
-- Compliance results are stored on each shift in
-- schedule_shifts.compliance_warnings (jsonb array of string codes).
--
-- Module key for permission helpers: 'scheduling'
--
-- Deferred (NOT in this migration): auto-scheduling, PDF exports, retention
-- purge, labor cost / budgeting, clock in/out.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. schedule_settings (one row per facility)
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_settings (
  id                              uuid primary key default gen_random_uuid(),
  facility_id                     uuid not null references public.facilities(id) on delete restrict,
  week_start_day                  int  not null default 0
                                    check (week_start_day between 0 and 6),
  default_shift_minutes           int  not null default 480,
  minor_max_weekly_hours          numeric default 30,
  overtime_weekly_hours           numeric default 40,
  minimum_break_minutes           int default 30,
  minimum_break_after_hours       numeric default 5,
  swap_requires_manager_approval  boolean not null default true,
  open_shift_first_come           boolean not null default true,
  notify_on_publish               boolean not null default true,
  notify_on_overtime              boolean not null default true,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz,
  constraint schedule_settings_facility_uniq unique (facility_id)
);

comment on table public.schedule_settings is
  'Scheduling: per-facility module config. week_start_day uses 0=Sunday..6=Saturday. open_shift_first_come=true means staff may self-claim without admin approval (claim helper updates the parent shift directly); false means claim records a request that admin must approve before the parent shift gets the employee_id.';
comment on column public.schedule_settings.minor_max_weekly_hours is
  'Default weekly hour cap for minors. Per-rule overrides live in schedule_compliance_rules.params.';
comment on column public.schedule_settings.overtime_weekly_hours is
  'Weekly hours threshold above which a shift is considered overtime. Used to populate compliance_warnings and (optionally) trigger notify_on_overtime.';

drop trigger if exists trg_schedule_settings_updated_at on public.schedule_settings;
create trigger trg_schedule_settings_updated_at
  before update on public.schedule_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. schedule_templates  (declared before schedule_shifts because of FK)
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_templates (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  name          text not null,
  slug          text not null,
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint schedule_templates_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.schedule_templates is
  'Scheduling: named recurring schedule templates owned by a facility. Apply-to-week generates schedule_shifts rows whose template_origin_id points back here. Slug is unique per facility.';

drop trigger if exists trg_schedule_templates_updated_at on public.schedule_templates;
create trigger trg_schedule_templates_updated_at
  before update on public.schedule_templates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. schedule_shifts
-- The actual scheduled shifts. employee_id NULL means the shift is "open" and
-- should have a paired schedule_open_shifts row.
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_shifts (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  department_id               uuid not null references public.departments(id) on delete restrict,
  employee_id                 uuid references public.employees(id) on delete set null,
  starts_at                   timestamptz not null,
  ends_at                     timestamptz not null,
  break_minutes               int default 0,
  role_label                  text,
  notes                       text,
  status                      text not null default 'draft'
                                check (status in ('draft','published','cancelled')),
  published_at                timestamptz,
  published_by_employee_id    uuid references public.employees(id) on delete set null,
  recurring_parent_id         uuid references public.schedule_shifts(id) on delete set null,
  template_origin_id          uuid references public.schedule_templates(id) on delete set null,
  compliance_warnings         jsonb not null default '[]'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz,
  constraint schedule_shifts_time_order_chk check (ends_at > starts_at)
);

comment on table public.schedule_shifts is
  'Scheduling: one row per scheduled shift. employee_id IS NULL signals an "open" shift; the paired schedule_open_shifts row drives the claim flow. status lifecycle: draft -> published -> (optionally) cancelled. Only module admins write here directly; staff effects flow through claim/swap helpers. compliance_warnings is a jsonb array of short string codes (e.g. ["minor_overtime","missing_certification"]) computed server-side.';
comment on column public.schedule_shifts.employee_id is
  'NULL = unassigned ("open shift"). Pair with a schedule_open_shifts row to surface in the claim UI.';
comment on column public.schedule_shifts.recurring_parent_id is
  'Optional link from a generated occurrence to a parent shift -- v1 use is light; included for forward-compatibility with native recurring rules.';
comment on column public.schedule_shifts.template_origin_id is
  'Set when the shift was produced by applying a schedule_templates row. Lets the UI distinguish ad-hoc edits from template-derived rows.';
comment on column public.schedule_shifts.compliance_warnings is
  'JSON array of short string codes. Examples: "minor_overtime", "minor_weekly_cap", "missing_certification", "no_break", "back_to_back". UI renders chips and tooltips. App-computed (not DB-enforced).';

create index if not exists idx_schedule_shifts_facility_starts
  on public.schedule_shifts (facility_id, starts_at);

create index if not exists idx_schedule_shifts_department_starts
  on public.schedule_shifts (department_id, starts_at);

create index if not exists idx_schedule_shifts_employee_starts
  on public.schedule_shifts (employee_id, starts_at);

create index if not exists idx_schedule_shifts_status
  on public.schedule_shifts (status);

create index if not exists idx_schedule_shifts_employee_published
  on public.schedule_shifts (employee_id, status)
  where status = 'published';

drop trigger if exists trg_schedule_shifts_updated_at on public.schedule_shifts;
create trigger trg_schedule_shifts_updated_at
  before update on public.schedule_shifts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. schedule_template_shifts
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_template_shifts (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  template_id     uuid not null references public.schedule_templates(id) on delete cascade,
  department_id   uuid not null references public.departments(id) on delete restrict,
  day_of_week     int  not null check (day_of_week between 0 and 6),
  start_time      time not null,
  end_time        time not null,
  break_minutes   int default 0,
  role_label      text,
  staff_count     int  not null default 1 check (staff_count >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  constraint schedule_template_shifts_time_order_chk check (end_time > start_time)
);

comment on table public.schedule_template_shifts is
  'Scheduling: one row per recurring slot inside a template. day_of_week 0=Sunday..6=Saturday. staff_count expands to N schedule_shifts when the template is applied to a week.';

create index if not exists idx_schedule_template_shifts_template_dow
  on public.schedule_template_shifts (template_id, day_of_week);

drop trigger if exists trg_schedule_template_shifts_updated_at on public.schedule_template_shifts;
create trigger trg_schedule_template_shifts_updated_at
  before update on public.schedule_template_shifts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. schedule_availability
-- Employee-submitted blocks of when they ARE / are NOT available.
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_availability (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references public.facilities(id) on delete restrict,
  employee_id         uuid not null references public.employees(id) on delete cascade,
  day_of_week         int  not null check (day_of_week between 0 and 6),
  start_time          time not null,
  end_time            time not null,
  availability_type   text not null default 'available'
                        check (availability_type in ('available','unavailable','preferred')),
  effective_from      date,
  effective_to        date,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  constraint schedule_availability_time_order_chk check (end_time > start_time)
);

comment on table public.schedule_availability is
  'Scheduling: employee-submitted weekly availability blocks. Multiple rows per employee/day are allowed (e.g. available 09:00-12:00 and 16:00-20:00). availability_type distinguishes hard "unavailable", default "available", and "preferred" (soft preference). effective_from / effective_to bound a temporary block; NULLs mean indefinite.';

create index if not exists idx_schedule_availability_employee_dow
  on public.schedule_availability (employee_id, day_of_week);

drop trigger if exists trg_schedule_availability_updated_at on public.schedule_availability;
create trigger trg_schedule_availability_updated_at
  before update on public.schedule_availability
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. schedule_time_off_requests
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_time_off_requests (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  employee_id                 uuid not null references public.employees(id) on delete cascade,
  starts_at                   timestamptz not null,
  ends_at                     timestamptz not null,
  reason                      text,
  status                      text not null default 'pending'
                                check (status in ('pending','approved','denied','cancelled')),
  approved_by_employee_id     uuid references public.employees(id) on delete set null,
  decided_at                  timestamptz,
  decision_note               text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz,
  constraint schedule_time_off_time_order_chk check (ends_at > starts_at)
);

comment on table public.schedule_time_off_requests is
  'Scheduling: employee-submitted time-off requests. Lifecycle: pending -> approved | denied | cancelled. Self-cancel is permitted via UPDATE policy; admins decide approve/deny. The schedule_notifications row of type ''time_off_decided'' is fired by the app on decision.';

create index if not exists idx_schedule_time_off_employee_starts
  on public.schedule_time_off_requests (employee_id, starts_at);

create index if not exists idx_schedule_time_off_status_starts
  on public.schedule_time_off_requests (status, starts_at);

create index if not exists idx_schedule_time_off_facility_status
  on public.schedule_time_off_requests (facility_id, status);

drop trigger if exists trg_schedule_time_off_updated_at on public.schedule_time_off_requests;
create trigger trg_schedule_time_off_updated_at
  before update on public.schedule_time_off_requests
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. schedule_swap_requests
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_swap_requests (
  id                              uuid primary key default gen_random_uuid(),
  facility_id                     uuid not null references public.facilities(id) on delete restrict,
  requester_employee_id           uuid not null references public.employees(id) on delete cascade,
  requester_shift_id              uuid not null references public.schedule_shifts(id) on delete cascade,
  target_employee_id              uuid references public.employees(id) on delete set null,
  target_shift_id                 uuid references public.schedule_shifts(id) on delete set null,
  status                          text not null default 'pending'
                                    check (status in ('pending','accepted','manager_approved','denied','cancelled')),
  manager_approver_employee_id    uuid references public.employees(id) on delete set null,
  accepted_at                     timestamptz,
  approved_at                     timestamptz,
  decided_at                      timestamptz,
  decision_note                   text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz
);

comment on table public.schedule_swap_requests is
  'Scheduling: shift-swap and shift-coverage requests.
State machine:
  pending           -- created by requester
  accepted          -- target employee accepted (or any-qualified picked it up); awaits manager if settings.swap_requires_manager_approval = true
  manager_approved  -- manager approved; the app then mutates the parent schedule_shifts.employee_id assignments
  denied            -- denied by target or manager
  cancelled         -- cancelled by requester before resolution
target_employee_id NULL = "any qualified" (one-way coverage). target_shift_id NULL = coverage rather than two-way swap.';

create index if not exists idx_schedule_swap_requester
  on public.schedule_swap_requests (requester_employee_id);

create index if not exists idx_schedule_swap_target
  on public.schedule_swap_requests (target_employee_id);

create index if not exists idx_schedule_swap_status
  on public.schedule_swap_requests (status);

create index if not exists idx_schedule_swap_requester_shift
  on public.schedule_swap_requests (requester_shift_id);

drop trigger if exists trg_schedule_swap_updated_at on public.schedule_swap_requests;
create trigger trg_schedule_swap_updated_at
  before update on public.schedule_swap_requests
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 8. schedule_open_shifts
-- One row per "open" parent shift (employee_id null on schedule_shifts).
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_open_shifts (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  shift_id                    uuid not null references public.schedule_shifts(id) on delete cascade,
  claimed_by_employee_id      uuid references public.employees(id) on delete set null,
  claimed_at                  timestamptz,
  claim_status                text not null default 'open'
                                check (claim_status in ('open','claimed','filled','expired','cancelled')),
  expires_at                  timestamptz,
  approval_required           boolean not null default false,
  approved_by_employee_id     uuid references public.employees(id) on delete set null,
  approved_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz,
  constraint schedule_open_shifts_shift_uniq unique (shift_id)
);

comment on table public.schedule_open_shifts is
  'Scheduling: surfaces a schedule_shifts row whose employee_id IS NULL into the staff-facing claim queue.
claim_status lifecycle:
  open       -- not yet claimed
  claimed    -- a staff member has claimed; if approval_required=false the parent shift is also assigned (final state then transitions to ''filled'')
  filled     -- claim accepted; parent schedule_shifts.employee_id now set
  expired    -- expires_at passed without a claim
  cancelled  -- admin cancelled the listing
approval_required is snapshotted at creation from schedule_settings.open_shift_first_come (false there => approval_required true here).';
comment on column public.schedule_open_shifts.approval_required is
  'Snapshot of (NOT settings.open_shift_first_come) at creation time. true = staff claim records intent but admin must approve before parent shift is reassigned.';

create index if not exists idx_schedule_open_shifts_status_expires
  on public.schedule_open_shifts (claim_status, expires_at);

create index if not exists idx_schedule_open_shifts_claimed_by
  on public.schedule_open_shifts (claimed_by_employee_id);

drop trigger if exists trg_schedule_open_shifts_updated_at on public.schedule_open_shifts;
create trigger trg_schedule_open_shifts_updated_at
  before update on public.schedule_open_shifts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 9. schedule_publish_events  (append-only audit)
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_publish_events (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  published_by_employee_id    uuid references public.employees(id) on delete set null,
  range_starts_at             timestamptz not null,
  range_ends_at               timestamptz not null,
  shift_count                 int not null,
  notes                       text,
  created_at                  timestamptz not null default now()
);

comment on table public.schedule_publish_events is
  'Scheduling: append-only audit row each time a schedule range is published. shift_count is the number of schedule_shifts moved from draft to published in that batch. No UPDATE/DELETE policies.';

create index if not exists idx_schedule_publish_events_facility_created
  on public.schedule_publish_events (facility_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 10. schedule_compliance_rules
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_compliance_rules (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  name          text not null,
  rule_type     text not null
                  check (rule_type in (
                    'minor_max_hours','overtime','break_required',
                    'certification_required','min_rest_between_shifts','custom'
                  )),
  params        jsonb not null default '{}'::jsonb,
  description   text,
  is_active     boolean not null default true,
  sort_order    int default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint schedule_compliance_rules_facility_name_uniq unique (facility_id, name)
);

comment on table public.schedule_compliance_rules is
  'Scheduling: per-facility compliance rules. Rules are evaluated by the app/server when shifts are saved or published; matched codes are written to schedule_shifts.compliance_warnings. rule_type is the discriminator the UI uses to render a typed editor. params is the rule''s parameters; see column comment for known shapes.';
comment on column public.schedule_compliance_rules.params is
  'JSON object whose shape depends on rule_type. Known shapes:
    minor_max_hours        -> { "max_weekly_hours": number, "applies_to_minors": boolean }
    overtime               -> { "weekly_threshold": number }
    break_required         -> { "after_hours": number, "min_minutes": number }
    certification_required -> { "certification_keys": string[] }
    min_rest_between_shifts-> { "min_hours": number }
    custom                 -> arbitrary; UI shows raw JSON editor.
The UI should treat rule_type as the dispatcher. Unknown keys must be preserved on save (read-modify-write) so future shapes are forward-compatible.';

create index if not exists idx_schedule_compliance_rules_facility_type_active
  on public.schedule_compliance_rules (facility_id, rule_type, is_active);

drop trigger if exists trg_schedule_compliance_rules_updated_at on public.schedule_compliance_rules;
create trigger trg_schedule_compliance_rules_updated_at
  before update on public.schedule_compliance_rules
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 11. schedule_notifications (in-app notification inbox)
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_notifications (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references public.facilities(id) on delete restrict,
  employee_id         uuid not null references public.employees(id) on delete cascade,
  notification_type   text not null
                        check (notification_type in (
                          'schedule_published','shift_changed','open_shift_available',
                          'swap_request_received','swap_approved','swap_denied',
                          'time_off_decided','overtime_warning'
                        )),
  shift_id            uuid references public.schedule_shifts(id) on delete cascade,
  swap_id             uuid references public.schedule_swap_requests(id) on delete cascade,
  time_off_id         uuid references public.schedule_time_off_requests(id) on delete cascade,
  payload             jsonb not null default '{}'::jsonb,
  read_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

comment on table public.schedule_notifications is
  'Scheduling: in-app notification inbox per employee. Optional FK columns (shift_id, swap_id, time_off_id) link the notification to the originating row when applicable. payload carries any extra context the UI needs to render without joining (e.g. snapshotted shift times). read_at NULL = unread.';

create index if not exists idx_schedule_notifications_employee_unread
  on public.schedule_notifications (employee_id, read_at nulls first, created_at desc);

drop trigger if exists trg_schedule_notifications_updated_at on public.schedule_notifications;
create trigger trg_schedule_notifications_updated_at
  before update on public.schedule_notifications
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Seed defaults helper
-- =============================================================================
create or replace function public.seed_default_scheduling_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.schedule_settings
    (facility_id, week_start_day, default_shift_minutes,
     minor_max_weekly_hours, overtime_weekly_hours,
     minimum_break_minutes, minimum_break_after_hours,
     swap_requires_manager_approval, open_shift_first_come,
     notify_on_publish, notify_on_overtime)
  values
    (p_facility_id, 0, 480,
     30, 40,
     30, 5,
     true, true,
     true, true)
  on conflict (facility_id) do nothing;

  insert into public.schedule_compliance_rules
    (facility_id, name, rule_type, params, description, is_active, sort_order)
  values
    (p_facility_id,
     'Minors limited to 30 hours / week',
     'minor_max_hours',
     '{"max_weekly_hours":30,"applies_to_minors":true}'::jsonb,
     'Block scheduling minors for more than 30 hours in any rolling Sun-Sat week.',
     true, 10)
  on conflict (facility_id, name) do nothing;

  insert into public.schedule_compliance_rules
    (facility_id, name, rule_type, params, description, is_active, sort_order)
  values
    (p_facility_id,
     'Overtime threshold 40h',
     'overtime',
     '{"weekly_threshold":40}'::jsonb,
     'Flag shifts that push an employee over 40 hours in a week.',
     true, 20)
  on conflict (facility_id, name) do nothing;

  insert into public.schedule_compliance_rules
    (facility_id, name, rule_type, params, description, is_active, sort_order)
  values
    (p_facility_id,
     'Required break after 5h',
     'break_required',
     '{"after_hours":5,"min_minutes":30}'::jsonb,
     'Any shift longer than 5 hours must include at least a 30 minute break.',
     true, 30)
  on conflict (facility_id, name) do nothing;
end;
$$;

comment on function public.seed_default_scheduling_config(uuid) is
  'Seeds default schedule_settings and three baseline schedule_compliance_rules rows for a facility. Idempotent.';

revoke execute on function public.seed_default_scheduling_config(uuid) from public;
grant  execute on function public.seed_default_scheduling_config(uuid) to service_role;

-- =============================================================================
-- Staff claim helper (SECURITY DEFINER)
-- =============================================================================
create or replace function public.scheduling_claim_open_shift(p_open_shift_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id   uuid := public.current_employee_id();
  v_facility_id   uuid := public.current_facility_id();
  v_open          public.schedule_open_shifts%rowtype;
begin
  if v_employee_id is null then
    raise exception 'No current employee context.' using errcode = '28000';
  end if;
  if not public.has_module_access('scheduling') then
    raise exception 'Scheduling module access required.' using errcode = '42501';
  end if;

  select * into v_open
    from public.schedule_open_shifts
   where id = p_open_shift_id
     for update;

  if not found then
    return false;
  end if;
  if v_open.facility_id <> v_facility_id then
    raise exception 'Open shift does not belong to caller facility.' using errcode = '42501';
  end if;
  if v_open.claim_status <> 'open' then
    return false;
  end if;

  if v_open.approval_required = false then
    update public.schedule_open_shifts
       set claim_status            = 'filled',
           claimed_by_employee_id  = v_employee_id,
           claimed_at              = now(),
           approved_by_employee_id = v_employee_id,
           approved_at             = now()
     where id = p_open_shift_id;

    update public.schedule_shifts
       set employee_id = v_employee_id
     where id = v_open.shift_id
       and employee_id is null;
  else
    update public.schedule_open_shifts
       set claim_status           = 'claimed',
           claimed_by_employee_id = v_employee_id,
           claimed_at             = now()
     where id = p_open_shift_id;
  end if;

  return true;
end;
$$;

comment on function public.scheduling_claim_open_shift(uuid) is
  'Staff claim flow for an open shift. Honors schedule_open_shifts.approval_required: false => immediate fill (parent schedule_shifts.employee_id set); true => pending claim awaiting admin approval. Verifies has_module_access(''scheduling'') and same-facility. Returns true if the row was claimed by this call, false if it was no longer open.';

revoke execute on function public.scheduling_claim_open_shift(uuid) from public;
grant  execute on function public.scheduling_claim_open_shift(uuid) to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.schedule_settings              enable row level security;
alter table public.schedule_templates             enable row level security;
alter table public.schedule_template_shifts       enable row level security;
alter table public.schedule_compliance_rules      enable row level security;
alter table public.schedule_shifts                enable row level security;
alter table public.schedule_availability          enable row level security;
alter table public.schedule_time_off_requests     enable row level security;
alter table public.schedule_swap_requests         enable row level security;
alter table public.schedule_open_shifts           enable row level security;
alter table public.schedule_publish_events        enable row level security;
alter table public.schedule_notifications         enable row level security;

-- ---- helper macro pattern --------------------------------------------------
-- Config tables: super_admin OR (facility AND module access) for SELECT,
--                super_admin OR (facility AND module admin)   for write.
-- ----------------------------------------------------------------------------

-- schedule_settings -----------------------------------------------------------
drop policy if exists schedule_settings_select on public.schedule_settings;
create policy schedule_settings_select on public.schedule_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists schedule_settings_insert on public.schedule_settings;
create policy schedule_settings_insert on public.schedule_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_settings_update on public.schedule_settings;
create policy schedule_settings_update on public.schedule_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_settings_delete on public.schedule_settings;
create policy schedule_settings_delete on public.schedule_settings
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- schedule_templates ----------------------------------------------------------
drop policy if exists schedule_templates_select on public.schedule_templates;
create policy schedule_templates_select on public.schedule_templates
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists schedule_templates_insert on public.schedule_templates;
create policy schedule_templates_insert on public.schedule_templates
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_templates_update on public.schedule_templates;
create policy schedule_templates_update on public.schedule_templates
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_templates_delete on public.schedule_templates;
create policy schedule_templates_delete on public.schedule_templates
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- schedule_template_shifts ----------------------------------------------------
drop policy if exists schedule_template_shifts_select on public.schedule_template_shifts;
create policy schedule_template_shifts_select on public.schedule_template_shifts
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists schedule_template_shifts_insert on public.schedule_template_shifts;
create policy schedule_template_shifts_insert on public.schedule_template_shifts
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_template_shifts_update on public.schedule_template_shifts;
create policy schedule_template_shifts_update on public.schedule_template_shifts
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_template_shifts_delete on public.schedule_template_shifts;
create policy schedule_template_shifts_delete on public.schedule_template_shifts
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- schedule_compliance_rules ---------------------------------------------------
drop policy if exists schedule_compliance_rules_select on public.schedule_compliance_rules;
create policy schedule_compliance_rules_select on public.schedule_compliance_rules
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists schedule_compliance_rules_insert on public.schedule_compliance_rules;
create policy schedule_compliance_rules_insert on public.schedule_compliance_rules
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_compliance_rules_update on public.schedule_compliance_rules;
create policy schedule_compliance_rules_update on public.schedule_compliance_rules
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_compliance_rules_delete on public.schedule_compliance_rules;
create policy schedule_compliance_rules_delete on public.schedule_compliance_rules
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- schedule_shifts -------------------------------------------------------------
-- Staff cannot directly create/edit shifts: writes are admin-only. Staff
-- effects flow through scheduling_claim_open_shift() and the swap workflow.
drop policy if exists schedule_shifts_select on public.schedule_shifts;
create policy schedule_shifts_select on public.schedule_shifts
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists schedule_shifts_insert on public.schedule_shifts;
create policy schedule_shifts_insert on public.schedule_shifts
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_shifts_update on public.schedule_shifts;
create policy schedule_shifts_update on public.schedule_shifts
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_shifts_delete on public.schedule_shifts;
create policy schedule_shifts_delete on public.schedule_shifts
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- schedule_availability -------------------------------------------------------
-- Employees can manage their own rows; admins see/manage all in facility.
drop policy if exists schedule_availability_select on public.schedule_availability;
create policy schedule_availability_select on public.schedule_availability
  for select to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or employee_id = public.current_employee_id()
  );

drop policy if exists schedule_availability_insert on public.schedule_availability;
create policy schedule_availability_insert on public.schedule_availability
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or (
      employee_id = public.current_employee_id()
      and facility_id = public.current_facility_id()
    )
  );

drop policy if exists schedule_availability_update on public.schedule_availability;
create policy schedule_availability_update on public.schedule_availability
  for update to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or (
      employee_id = public.current_employee_id()
      and facility_id = public.current_facility_id()
    )
  )
  with check (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or (
      employee_id = public.current_employee_id()
      and facility_id = public.current_facility_id()
    )
  );

drop policy if exists schedule_availability_delete on public.schedule_availability;
create policy schedule_availability_delete on public.schedule_availability
  for delete to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or (
      employee_id = public.current_employee_id()
      and facility_id = public.current_facility_id()
    )
  );

-- schedule_time_off_requests --------------------------------------------------
drop policy if exists schedule_time_off_select on public.schedule_time_off_requests;
create policy schedule_time_off_select on public.schedule_time_off_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or employee_id = public.current_employee_id()
  );

drop policy if exists schedule_time_off_insert on public.schedule_time_off_requests;
create policy schedule_time_off_insert on public.schedule_time_off_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      employee_id = public.current_employee_id()
      and facility_id = public.current_facility_id()
      and status = 'pending'
    )
  );

-- Admin can update freely; employee can update their own (app limits to cancel).
drop policy if exists schedule_time_off_update on public.schedule_time_off_requests;
create policy schedule_time_off_update on public.schedule_time_off_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or employee_id = public.current_employee_id()
  )
  with check (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or employee_id = public.current_employee_id()
  );

drop policy if exists schedule_time_off_delete on public.schedule_time_off_requests;
create policy schedule_time_off_delete on public.schedule_time_off_requests
  for delete to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
  );

-- schedule_swap_requests ------------------------------------------------------
drop policy if exists schedule_swap_select on public.schedule_swap_requests;
create policy schedule_swap_select on public.schedule_swap_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or (
      facility_id = public.current_facility_id()
      and (
        requester_employee_id = public.current_employee_id()
        or target_employee_id = public.current_employee_id()
      )
    )
  );

drop policy if exists schedule_swap_insert on public.schedule_swap_requests;
create policy schedule_swap_insert on public.schedule_swap_requests
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      requester_employee_id = public.current_employee_id()
      and facility_id = public.current_facility_id()
    )
  );

drop policy if exists schedule_swap_update on public.schedule_swap_requests;
create policy schedule_swap_update on public.schedule_swap_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or requester_employee_id = public.current_employee_id()
    or target_employee_id    = public.current_employee_id()
  )
  with check (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or requester_employee_id = public.current_employee_id()
    or target_employee_id    = public.current_employee_id()
  );

drop policy if exists schedule_swap_delete on public.schedule_swap_requests;
create policy schedule_swap_delete on public.schedule_swap_requests
  for delete to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
  );

-- schedule_open_shifts --------------------------------------------------------
-- Admin-only writes. Staff "claim" must go through scheduling_claim_open_shift().
drop policy if exists schedule_open_shifts_select on public.schedule_open_shifts;
create policy schedule_open_shifts_select on public.schedule_open_shifts
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling')
    )
  );

drop policy if exists schedule_open_shifts_insert on public.schedule_open_shifts;
create policy schedule_open_shifts_insert on public.schedule_open_shifts
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_open_shifts_update on public.schedule_open_shifts;
create policy schedule_open_shifts_update on public.schedule_open_shifts
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_open_shifts_delete on public.schedule_open_shifts;
create policy schedule_open_shifts_delete on public.schedule_open_shifts
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- schedule_publish_events (append-only, admin-only) ---------------------------
drop policy if exists schedule_publish_events_select on public.schedule_publish_events;
create policy schedule_publish_events_select on public.schedule_publish_events
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

drop policy if exists schedule_publish_events_insert on public.schedule_publish_events;
create policy schedule_publish_events_insert on public.schedule_publish_events
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

-- (No update/delete policies -- append-only.)

-- schedule_notifications ------------------------------------------------------
drop policy if exists schedule_notifications_select on public.schedule_notifications;
create policy schedule_notifications_select on public.schedule_notifications
  for select to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or employee_id = public.current_employee_id()
  );

-- INSERT: any authenticated user in same facility (server code is the writer).
drop policy if exists schedule_notifications_insert on public.schedule_notifications;
create policy schedule_notifications_insert on public.schedule_notifications
  for insert to authenticated
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- UPDATE: recipient (sets read_at) or admin.
drop policy if exists schedule_notifications_update on public.schedule_notifications;
create policy schedule_notifications_update on public.schedule_notifications
  for update to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or employee_id = public.current_employee_id()
  )
  with check (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
    or employee_id = public.current_employee_id()
  );

drop policy if exists schedule_notifications_delete on public.schedule_notifications;
create policy schedule_notifications_delete on public.schedule_notifications
  for delete to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('scheduling')
  );
