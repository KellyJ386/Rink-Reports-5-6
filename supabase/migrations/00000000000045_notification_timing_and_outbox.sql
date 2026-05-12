-- =============================================================================
-- 00000000000045_notification_timing_and_outbox.sql
--
-- Phase 4 of the production permission model: per-module notification
-- distribution rules.
--
-- Builds on the existing communication_routing_rules table (migration 9):
--   - Adds target_department_id so rules can name a department directly
--   - Adds a timing column ('immediate' | 'end_of_day' | 'weekly' | 'manual')
--   - Adds attach_pdf flag (UI only for now; no generator yet)
--   - Adds last_run_at / last_run_status for observability
--
-- Also creates notification_outbox so non-immediate sends can be queued.
-- The scheduler that drains the outbox is intentionally NOT wired up here;
-- see src/lib/notifications/scheduler-todo.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. routing_rules extensions
-- -----------------------------------------------------------------------------
alter table public.communication_routing_rules
  add column if not exists target_department_id uuid
    references public.departments(id) on delete cascade;

alter table public.communication_routing_rules
  add column if not exists timing text not null default 'immediate'
    check (timing in ('immediate', 'end_of_day', 'weekly', 'manual'));

alter table public.communication_routing_rules
  add column if not exists attach_pdf boolean not null default false;

alter table public.communication_routing_rules
  add column if not exists last_run_at timestamptz;

alter table public.communication_routing_rules
  add column if not exists last_run_status text;

-- Replace the target check to include department_id.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'communication_routing_rules_target_chk'
      and conrelid = 'public.communication_routing_rules'::regclass
  ) then
    alter table public.communication_routing_rules
      drop constraint communication_routing_rules_target_chk;
  end if;
end$$;

alter table public.communication_routing_rules
  add constraint communication_routing_rules_target_chk check (
    target_group_id is not null
    or target_role_key is not null
    or target_employee_id is not null
    or target_department_id is not null
  );

create index if not exists idx_communication_routing_rules_timing
  on public.communication_routing_rules (timing, is_active);

-- -----------------------------------------------------------------------------
-- 2. notification_outbox
-- -----------------------------------------------------------------------------
create table if not exists public.notification_outbox (
  id                    uuid primary key default gen_random_uuid(),
  facility_id           uuid not null references public.facilities(id) on delete cascade,
  rule_id               uuid references public.communication_routing_rules(id) on delete set null,
  source_module         text not null,
  source_record_id      uuid,
  recipient_employee_id uuid not null references public.employees(id) on delete cascade,
  subject               text,
  body                  text,
  attach_pdf            boolean not null default false,
  scheduled_for         timestamptz not null default now(),
  status                text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  sent_at               timestamptz,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);

comment on table public.notification_outbox is
  'Queue for non-immediate communication sends. Immediate routing skips this '
  'table and writes directly to communication_messages / communication_recipients.';

create index if not exists idx_notification_outbox_facility_status_due
  on public.notification_outbox (facility_id, status, scheduled_for);

create index if not exists idx_notification_outbox_recipient
  on public.notification_outbox (recipient_employee_id);

drop trigger if exists trg_notification_outbox_updated_at on public.notification_outbox;
create trigger trg_notification_outbox_updated_at
  before update on public.notification_outbox
  for each row execute function public.set_updated_at();

alter table public.notification_outbox enable row level security;

drop policy if exists notification_outbox_select on public.notification_outbox;
create policy notification_outbox_select
  on public.notification_outbox
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- Writes from the client are blocked; the dispatcher uses SECURITY DEFINER
-- helpers below.
drop policy if exists notification_outbox_insert on public.notification_outbox;
create policy notification_outbox_insert
  on public.notification_outbox
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists notification_outbox_update on public.notification_outbox;
create policy notification_outbox_update
  on public.notification_outbox
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  );

drop policy if exists notification_outbox_delete on public.notification_outbox;
create policy notification_outbox_delete
  on public.notification_outbox
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 3. resolve_rule_recipients(rule_id) -> employee_id[]
--
-- Expands a single rule's target_* columns into the unique set of active
-- employees that should receive the notification. Used by the Preview
-- Recipients button and by the dispatcher.
-- -----------------------------------------------------------------------------
create or replace function public.resolve_rule_recipients(p_rule_id uuid)
returns table (employee_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule record;
begin
  select * into v_rule from public.communication_routing_rules where id = p_rule_id;
  if not found then
    return;
  end if;

  if not (
    public.is_super_admin()
    or v_rule.facility_id = public.current_facility_id()
  ) then
    return;
  end if;

  return query
  with
    via_employee as (
      select v_rule.target_employee_id as employee_id
      where v_rule.target_employee_id is not null
    ),
    via_role as (
      select e.id
      from public.employees e
      join public.roles r on r.id = e.role_id
      where v_rule.target_role_key is not null
        and r.key = v_rule.target_role_key
        and e.facility_id = v_rule.facility_id
        and e.is_active = true
    ),
    via_department as (
      select ed.employee_id
      from public.employee_departments ed
      join public.employees e on e.id = ed.employee_id
      where v_rule.target_department_id is not null
        and ed.department_id = v_rule.target_department_id
        and e.is_active = true
    ),
    via_group as (
      select cgm.employee_id
      from public.communication_group_members cgm
      join public.employees e on e.id = cgm.employee_id
      where v_rule.target_group_id is not null
        and cgm.group_id = v_rule.target_group_id
        and e.is_active = true
    )
  select distinct employee_id
  from (
    select * from via_employee
    union all select * from via_role
    union all select * from via_department
    union all select * from via_group
  ) all_targets
  where employee_id is not null;
end;
$$;

revoke execute on function public.resolve_rule_recipients(uuid) from public, anon;
grant  execute on function public.resolve_rule_recipients(uuid) to authenticated;

comment on function public.resolve_rule_recipients(uuid) is
  'Expands a routing rule''s target_* columns to a unique set of active employee_ids.';

-- -----------------------------------------------------------------------------
-- 4. dispatch_rules_for_submission(facility_id, source_module, source_record_id, severity, area_id)
--
-- For each active rule matching (facility_id, source_module) and matching the
-- supplied severity/area filters, resolve recipients then either:
--   - timing = 'immediate' : insert into notification_outbox AND set status='sent'
--     immediately (an in-app delivery worker can later expand to comm_messages).
--   - other timings        : insert into notification_outbox as 'pending' with
--                            scheduled_for = end-of-day / next-Monday / now.
--
-- Returns the count of outbox rows created.
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_rules_for_submission(
  p_facility_id      uuid,
  p_source_module    text,
  p_source_record_id uuid,
  p_severity         text default null,
  p_area_id          uuid default null,
  p_subject          text default null,
  p_body             text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule    record;
  v_emp_id  uuid;
  v_sched   timestamptz;
  v_count   integer := 0;
begin
  if p_facility_id is null or p_source_module is null then
    return 0;
  end if;

  for v_rule in
    select *
    from public.communication_routing_rules
    where facility_id = p_facility_id
      and source_module = p_source_module
      and is_active = true
      and (severity is null or severity = p_severity)
      and (area_id is null or area_id = p_area_id)
    order by priority desc, created_at asc
  loop
    -- Compute scheduled_for based on timing.
    case v_rule.timing
      when 'immediate'    then v_sched := now();
      when 'end_of_day'   then v_sched := date_trunc('day', now()) + interval '23 hours 59 minutes';
      when 'weekly'       then
        -- Next Monday 09:00 UTC.
        v_sched := date_trunc('week', now() + interval '1 week') + interval '9 hours';
      when 'manual'       then v_sched := null;
      else                     v_sched := now();
    end case;

    for v_emp_id in select employee_id from public.resolve_rule_recipients(v_rule.id)
    loop
      insert into public.notification_outbox (
        facility_id, rule_id, source_module, source_record_id,
        recipient_employee_id, subject, body, attach_pdf,
        scheduled_for, status
      ) values (
        p_facility_id, v_rule.id, p_source_module, p_source_record_id,
        v_emp_id, p_subject, p_body, coalesce(v_rule.attach_pdf, false),
        coalesce(v_sched, now() + interval '100 years'),
        case
          when v_rule.timing = 'manual' then 'pending'
          when v_rule.timing = 'immediate' then 'sent'
          else 'pending'
        end
      );
      v_count := v_count + 1;
    end loop;

    update public.communication_routing_rules
      set last_run_at = now(), last_run_status = 'dispatched'
    where id = v_rule.id;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text)
  from public, anon;
grant  execute on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text)
  to authenticated;

comment on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text) is
  'Fans out a submission event to every matching routing rule, queueing each '
  'recipient in notification_outbox. Immediate timing marks sent=true; other '
  'timings stay pending until a scheduler (not yet implemented) processes them.';
