-- =============================================================================
-- 00000000000009_communications_schema.sql
-- Communications module: 10 tables + RLS + retention helper.
--
-- In-app only (no email, SMS, attachments, analytics, photos).
-- Backbone for upcoming modules (Ice Operations, Refrigeration, Air Quality,
-- Accident Reports, Incident Reports, Scheduling) which write rows into
-- communication_alerts from day one.
--
-- Tables:
--   communication_groups
--   communication_group_members
--   communication_templates
--   communication_messages
--   communication_recipients
--   communication_alerts            <-- HOT PATH for other modules
--   communication_acknowledgements
--   communication_routing_rules
--   communication_recurring_reminders
--   communication_audit_log         (append-only)
--
-- Module key for permission helpers: 'communications'
-- Retention: 1 year via public.purge_old_communications() (schedule via Cron).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. communication_groups
-- -----------------------------------------------------------------------------
create table if not exists public.communication_groups (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  name         text not null,
  slug         text not null,
  description  text,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint communication_groups_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.communication_groups is
  'Communications: per-facility messaging groups (departments, roles, ad-hoc).';

create index if not exists idx_communication_groups_facility
  on public.communication_groups (facility_id);

drop trigger if exists trg_communication_groups_updated_at on public.communication_groups;
create trigger trg_communication_groups_updated_at
  before update on public.communication_groups
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. communication_group_members
-- -----------------------------------------------------------------------------
create table if not exists public.communication_group_members (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  group_id     uuid not null references public.communication_groups(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint communication_group_members_group_employee_uniq unique (group_id, employee_id)
);

comment on table public.communication_group_members is
  'Communications: employee membership in communication_groups.';

create index if not exists idx_communication_group_members_employee
  on public.communication_group_members (employee_id);

-- -----------------------------------------------------------------------------
-- 3. communication_templates
-- -----------------------------------------------------------------------------
create table if not exists public.communication_templates (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  name                     text not null,
  slug                     text not null,
  category                 text,
  subject                  text,
  body                     text not null,
  requires_acknowledgement boolean not null default false,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  constraint communication_templates_facility_slug_uniq unique (facility_id, slug)
);

comment on table public.communication_templates is
  'Communications: reusable message templates. category examples: shift_change, safety_briefing, general.';

create index if not exists idx_communication_templates_facility_category
  on public.communication_templates (facility_id, category);

drop trigger if exists trg_communication_templates_updated_at on public.communication_templates;
create trigger trg_communication_templates_updated_at
  before update on public.communication_templates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. communication_messages
-- -----------------------------------------------------------------------------
create table if not exists public.communication_messages (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  sender_employee_id       uuid references public.employees(id) on delete set null,
  template_id              uuid references public.communication_templates(id) on delete set null,
  subject                  text,
  body                     text not null,
  requires_acknowledgement boolean not null default false,
  sent_at                  timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

comment on table public.communication_messages is
  'Communications: a sent in-app message. Recipients tracked in communication_recipients.';

create index if not exists idx_communication_messages_facility_sent_at
  on public.communication_messages (facility_id, sent_at desc);
create index if not exists idx_communication_messages_sender
  on public.communication_messages (sender_employee_id);

drop trigger if exists trg_communication_messages_updated_at on public.communication_messages;
create trigger trg_communication_messages_updated_at
  before update on public.communication_messages
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. communication_recipients
-- -----------------------------------------------------------------------------
create table if not exists public.communication_recipients (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references public.facilities(id) on delete restrict,
  message_id       uuid not null references public.communication_messages(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  delivered_at     timestamptz,
  read_at          timestamptz,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  constraint communication_recipients_message_employee_uniq unique (message_id, employee_id)
);

comment on table public.communication_recipients is
  'Communications: per-employee delivery / read / ack timestamps for a message.';

create index if not exists idx_communication_recipients_employee_read
  on public.communication_recipients (employee_id, read_at);
create index if not exists idx_communication_recipients_message
  on public.communication_recipients (message_id);

-- -----------------------------------------------------------------------------
-- 6. communication_alerts                       <-- HOT PATH
-- -----------------------------------------------------------------------------
-- Note: source_record_id is a SOFT REFERENCE -- no FK because the target table
-- varies per source_module (ice_operations, refrigeration, accident_reports,
-- air_quality, incident_reports, scheduling, ...). Validation is the writing
-- module's responsibility.
-- area_id is also a soft reference; may match daily_report_areas or other
-- module-specific area-like tables. Nullable.
-- -----------------------------------------------------------------------------
create table if not exists public.communication_alerts (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  source_module               text not null,
  source_record_id            uuid,
  severity                    text not null
                                check (severity in ('info','warn','high','critical')),
  title                       text not null,
  body                        text,
  area_id                     uuid,
  created_by_employee_id      uuid references public.employees(id) on delete set null,
  requires_acknowledgement    boolean not null default false,
  resolved_at                 timestamptz,
  resolved_by_employee_id     uuid references public.employees(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz
);

comment on table public.communication_alerts is
  'Communications: alerts generated by source modules (ice_operations, refrigeration, accident_reports, air_quality, incident_reports, scheduling). source_record_id and area_id are soft references (no FK) because target table varies by source_module.';
comment on column public.communication_alerts.source_module is
  'Originating module key, e.g. ice_operations, refrigeration, accident_reports, air_quality, incident_reports, scheduling.';
comment on column public.communication_alerts.source_record_id is
  'Soft reference to source record; no FK -- target table varies by source_module.';
comment on column public.communication_alerts.area_id is
  'Soft reference to module-specific area row; no FK because area tables vary by module.';

create index if not exists idx_communication_alerts_facility_created
  on public.communication_alerts (facility_id, created_at desc);
create index if not exists idx_communication_alerts_source_module
  on public.communication_alerts (source_module);
create index if not exists idx_communication_alerts_severity
  on public.communication_alerts (severity);
create index if not exists idx_communication_alerts_resolved_at
  on public.communication_alerts (resolved_at);

drop trigger if exists trg_communication_alerts_updated_at on public.communication_alerts;
create trigger trg_communication_alerts_updated_at
  before update on public.communication_alerts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. communication_acknowledgements
-- Exactly ONE of (alert_id, message_id) must be set.
-- -----------------------------------------------------------------------------
create table if not exists public.communication_acknowledgements (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references public.facilities(id) on delete restrict,
  alert_id         uuid references public.communication_alerts(id) on delete cascade,
  message_id       uuid references public.communication_messages(id) on delete cascade,
  employee_id      uuid not null references public.employees(id) on delete cascade,
  acknowledged_at  timestamptz not null default now(),
  notes            text,
  created_at       timestamptz not null default now(),
  constraint communication_acknowledgements_one_target_chk check (
    (alert_id is not null and message_id is null)
    or (alert_id is null and message_id is not null)
  )
);

comment on table public.communication_acknowledgements is
  'Communications: append-only acknowledgements for an alert OR a message (exactly one). No UPDATE/DELETE policies.';

create unique index if not exists uniq_communication_ack_alert_employee
  on public.communication_acknowledgements (alert_id, employee_id)
  where alert_id is not null;

create unique index if not exists uniq_communication_ack_message_employee
  on public.communication_acknowledgements (message_id, employee_id)
  where message_id is not null;

create index if not exists idx_communication_acknowledgements_facility
  on public.communication_acknowledgements (facility_id);
create index if not exists idx_communication_acknowledgements_employee
  on public.communication_acknowledgements (employee_id);

-- -----------------------------------------------------------------------------
-- 8. communication_routing_rules
-- At least one target column (target_group_id, target_role_key, target_employee_id)
-- must be non-null.
-- -----------------------------------------------------------------------------
create table if not exists public.communication_routing_rules (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references public.facilities(id) on delete restrict,
  name                text,
  source_module       text not null,
  severity            text,
  area_id             uuid,
  target_group_id     uuid references public.communication_groups(id) on delete cascade,
  target_role_key     text,
  target_employee_id  uuid references public.employees(id) on delete cascade,
  is_active           boolean not null default true,
  priority            int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  constraint communication_routing_rules_target_chk check (
    target_group_id is not null
    or target_role_key is not null
    or target_employee_id is not null
  )
);

comment on table public.communication_routing_rules is
  'Communications: rules that route incoming alerts (by source_module / severity / area_id) to a group, role, or specific employee.';

create index if not exists idx_communication_routing_rules_facility_module_active
  on public.communication_routing_rules (facility_id, source_module, is_active);
create index if not exists idx_communication_routing_rules_priority
  on public.communication_routing_rules (priority desc);

drop trigger if exists trg_communication_routing_rules_updated_at on public.communication_routing_rules;
create trigger trg_communication_routing_rules_updated_at
  before update on public.communication_routing_rules
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 9. communication_recurring_reminders
-- -----------------------------------------------------------------------------
create table if not exists public.communication_recurring_reminders (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references public.facilities(id) on delete restrict,
  name             text not null,
  schedule_cron    text not null,
  template_id      uuid not null references public.communication_templates(id) on delete restrict,
  target_group_id  uuid references public.communication_groups(id) on delete cascade,
  target_role_key  text,
  last_run_at      timestamptz,
  next_run_at      timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

comment on table public.communication_recurring_reminders is
  'Communications: recurring reminders. schedule_cron is a cron-like string interpreted by the app worker (not pg_cron).';

create index if not exists idx_communication_recurring_reminders_facility_due
  on public.communication_recurring_reminders (facility_id, is_active, next_run_at);

drop trigger if exists trg_communication_recurring_reminders_updated_at on public.communication_recurring_reminders;
create trigger trg_communication_recurring_reminders_updated_at
  before update on public.communication_recurring_reminders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 10. communication_audit_log (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.communication_audit_log (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references public.facilities(id) on delete restrict,
  entity_type         text not null,
  entity_id           uuid,
  action              text not null,
  actor_employee_id   uuid references public.employees(id) on delete set null,
  before              jsonb,
  after               jsonb,
  ip                  inet,
  user_agent          text,
  created_at          timestamptz not null default now()
);

comment on table public.communication_audit_log is
  'Communications: append-only audit log. entity_type values e.g. message, alert, template, rule. No UPDATE/DELETE.';

create index if not exists idx_communication_audit_log_facility_created
  on public.communication_audit_log (facility_id, created_at desc);
create index if not exists idx_communication_audit_log_entity
  on public.communication_audit_log (entity_type, entity_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.communication_groups              enable row level security;
alter table public.communication_group_members       enable row level security;
alter table public.communication_templates           enable row level security;
alter table public.communication_messages            enable row level security;
alter table public.communication_recipients          enable row level security;
alter table public.communication_alerts              enable row level security;
alter table public.communication_acknowledgements    enable row level security;
alter table public.communication_routing_rules       enable row level security;
alter table public.communication_recurring_reminders enable row level security;
alter table public.communication_audit_log           enable row level security;

-- -----------------------------------------------------------------------------
-- communication_groups
-- -----------------------------------------------------------------------------
drop policy if exists communication_groups_select on public.communication_groups;
create policy communication_groups_select on public.communication_groups
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
    )
  );

drop policy if exists communication_groups_insert on public.communication_groups;
create policy communication_groups_insert on public.communication_groups
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_groups_update on public.communication_groups;
create policy communication_groups_update on public.communication_groups
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_groups_delete on public.communication_groups;
create policy communication_groups_delete on public.communication_groups
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_group_members
-- -----------------------------------------------------------------------------
drop policy if exists communication_group_members_select on public.communication_group_members;
create policy communication_group_members_select on public.communication_group_members
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
    )
  );

drop policy if exists communication_group_members_insert on public.communication_group_members;
create policy communication_group_members_insert on public.communication_group_members
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_group_members_update on public.communication_group_members;
create policy communication_group_members_update on public.communication_group_members
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_group_members_delete on public.communication_group_members;
create policy communication_group_members_delete on public.communication_group_members
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_templates
-- -----------------------------------------------------------------------------
drop policy if exists communication_templates_select on public.communication_templates;
create policy communication_templates_select on public.communication_templates
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
    )
  );

drop policy if exists communication_templates_insert on public.communication_templates;
create policy communication_templates_insert on public.communication_templates
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_templates_update on public.communication_templates;
create policy communication_templates_update on public.communication_templates
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_templates_delete on public.communication_templates;
create policy communication_templates_delete on public.communication_templates
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_messages
--   SELECT: super admin OR (same-facility AND module access)
--   INSERT: communications module access AND sender = current employee, OR admin
--   UPDATE/DELETE: admin only
-- -----------------------------------------------------------------------------
drop policy if exists communication_messages_select on public.communication_messages;
create policy communication_messages_select on public.communication_messages
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
    )
  );

drop policy if exists communication_messages_insert on public.communication_messages;
create policy communication_messages_insert on public.communication_messages
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('communications')
        or (
          public.has_module_access('communications')
          and sender_employee_id = public.current_employee_id()
        )
      )
    )
  );

drop policy if exists communication_messages_update on public.communication_messages;
create policy communication_messages_update on public.communication_messages
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_messages_delete on public.communication_messages;
create policy communication_messages_delete on public.communication_messages
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_recipients
--   SELECT: super admin OR comms admin OR own row
--   INSERT: super admin OR comms admin OR sender of the parent message
--   UPDATE: recipient (read_at / acknowledged_at) -- column-level not enforced
--   DELETE: admin only
-- -----------------------------------------------------------------------------
drop policy if exists communication_recipients_select on public.communication_recipients;
create policy communication_recipients_select on public.communication_recipients
  for select to authenticated
  using (
    public.is_super_admin()
    or public.has_module_admin_access('communications')
    or (
      facility_id = public.current_facility_id()
      and employee_id = public.current_employee_id()
    )
  );

drop policy if exists communication_recipients_insert on public.communication_recipients;
create policy communication_recipients_insert on public.communication_recipients
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('communications')
        or exists (
          select 1
          from public.communication_messages m
          where m.id = message_id
            and m.sender_employee_id = public.current_employee_id()
        )
      )
    )
  );

drop policy if exists communication_recipients_update on public.communication_recipients;
create policy communication_recipients_update on public.communication_recipients
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('communications')
        or employee_id = public.current_employee_id()
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('communications')
        or employee_id = public.current_employee_id()
      )
    )
  );

drop policy if exists communication_recipients_delete on public.communication_recipients;
create policy communication_recipients_delete on public.communication_recipients
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_alerts
--   SELECT: super admin OR (same-facility AND module access)
--   INSERT: super admin OR (same-facility AND
--            (has_module_access on the row's source_module
--             OR has_module_admin_access('communications')))
--           This relaxation lets other modules write alerts using their own
--           module-key permission.
--   UPDATE/DELETE: comms admin only.
-- -----------------------------------------------------------------------------
drop policy if exists communication_alerts_select on public.communication_alerts;
create policy communication_alerts_select on public.communication_alerts
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
    )
  );

drop policy if exists communication_alerts_insert on public.communication_alerts;
create policy communication_alerts_insert on public.communication_alerts
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_access(source_module)
        or public.has_module_admin_access('communications')
      )
    )
  );

drop policy if exists communication_alerts_update on public.communication_alerts;
create policy communication_alerts_update on public.communication_alerts
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_alerts_delete on public.communication_alerts;
create policy communication_alerts_delete on public.communication_alerts
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_acknowledgements (append-only -- no UPDATE/DELETE policies)
--   SELECT: super admin OR (same-facility AND module access)
--   INSERT: own ack only (employee_id = current_employee_id) OR comms admin
-- -----------------------------------------------------------------------------
drop policy if exists communication_acknowledgements_select on public.communication_acknowledgements;
create policy communication_acknowledgements_select on public.communication_acknowledgements
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
    )
  );

drop policy if exists communication_acknowledgements_insert on public.communication_acknowledgements;
create policy communication_acknowledgements_insert on public.communication_acknowledgements
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('communications')
        or (
          public.has_module_access('communications')
          and employee_id = public.current_employee_id()
        )
      )
    )
  );

-- (No update / delete policies -- append-only.)

-- -----------------------------------------------------------------------------
-- communication_routing_rules
-- -----------------------------------------------------------------------------
drop policy if exists communication_routing_rules_select on public.communication_routing_rules;
create policy communication_routing_rules_select on public.communication_routing_rules
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
    )
  );

drop policy if exists communication_routing_rules_insert on public.communication_routing_rules;
create policy communication_routing_rules_insert on public.communication_routing_rules
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_routing_rules_update on public.communication_routing_rules;
create policy communication_routing_rules_update on public.communication_routing_rules
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_routing_rules_delete on public.communication_routing_rules;
create policy communication_routing_rules_delete on public.communication_routing_rules
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_recurring_reminders
-- -----------------------------------------------------------------------------
drop policy if exists communication_recurring_reminders_select on public.communication_recurring_reminders;
create policy communication_recurring_reminders_select on public.communication_recurring_reminders
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications')
    )
  );

drop policy if exists communication_recurring_reminders_insert on public.communication_recurring_reminders;
create policy communication_recurring_reminders_insert on public.communication_recurring_reminders
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_recurring_reminders_update on public.communication_recurring_reminders;
create policy communication_recurring_reminders_update on public.communication_recurring_reminders
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_recurring_reminders_delete on public.communication_recurring_reminders;
create policy communication_recurring_reminders_delete on public.communication_recurring_reminders
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

-- -----------------------------------------------------------------------------
-- communication_audit_log (append-only)
--   SELECT: super admin OR comms admin
--   INSERT: any authenticated user in same facility (server-side writes)
-- -----------------------------------------------------------------------------
drop policy if exists communication_audit_log_select on public.communication_audit_log;
create policy communication_audit_log_select on public.communication_audit_log
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('communications')
    )
  );

drop policy if exists communication_audit_log_insert on public.communication_audit_log;
create policy communication_audit_log_insert on public.communication_audit_log
  for insert to authenticated
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- (No update / delete policies -- append-only.)

-- =============================================================================
-- Retention: purge messages, alerts, audit log older than 1 year.
-- Cascades clear recipients + acknowledgements via FK ON DELETE CASCADE.
--
-- NOTE: This function is NOT auto-scheduled here. To enable daily purges:
--   Supabase Dashboard -> Database -> Cron Jobs (or pg_cron if installed):
--     select cron.schedule(
--       'purge_old_communications_daily',
--       '30 3 * * *',
--       $$select public.purge_old_communications();$$
--     );
-- =============================================================================
create or replace function public.purge_old_communications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msgs   integer;
  v_alerts integer;
  v_audit  integer;
begin
  delete from public.communication_messages
   where sent_at < now() - interval '1 year';
  get diagnostics v_msgs = row_count;

  delete from public.communication_alerts
   where created_at < now() - interval '1 year';
  get diagnostics v_alerts = row_count;

  delete from public.communication_audit_log
   where created_at < now() - interval '1 year';
  get diagnostics v_audit = row_count;

  return v_msgs + v_alerts + v_audit;
end;
$$;

comment on function public.purge_old_communications() is
  'Deletes communication_messages, communication_alerts, and communication_audit_log rows older than 1 year. Cascades to recipients and acknowledgements. Schedule via Supabase Cron (pg_cron) - not auto-scheduled by this migration.';

revoke execute on function public.purge_old_communications() from public;
grant  execute on function public.purge_old_communications() to service_role;
