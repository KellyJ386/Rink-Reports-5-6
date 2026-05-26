-- =============================================================================
-- 00000000000086_dispatch_authz_gate_restore.sql
--
-- Security fix: restore the authorization gate on
-- dispatch_rules_for_submission().
--
-- Migration 49 hardened this SECURITY DEFINER function so a caller must be a
-- platform super_admin, OR be acting inside their own facility AND hold
-- submit-or-higher on the source module. Migration 63 later recreated the
-- function to thread requires_acknowledgement through to the outbox, but the
-- new body OMITTED the gate — leaving any authenticated caller able to dispatch
-- notifications into ANY facility's inbox with attacker-controlled subject /
-- body / routing targets.
--
-- This migration recreates the migration-63 body (incl. requires_acknowledgement)
-- with the migration-49 gate restored. The rls-isolation suite's H4 assertions
-- guard against exactly this regression.
-- =============================================================================

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

  -- AuthZ: the caller must either be a platform super_admin, or be acting
  -- inside their own facility AND hold submit-or-higher on the source module.
  -- This stops authenticated users from injecting messages into a facility's
  -- inbox with attacker-controlled subjects/bodies and routing targets they
  -- wouldn't otherwise be able to reach.
  if not public.is_super_admin() then
    if p_facility_id <> public.current_facility_id() then
      raise exception 'dispatch_rules_for_submission: facility mismatch';
    end if;
    if public.current_employee_module_permission(p_source_module)
       < 'submit'::module_permission_level then
      raise exception
        'dispatch_rules_for_submission: caller lacks submit permission on %',
        p_source_module;
    end if;
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
    case v_rule.timing
      when 'immediate'    then v_sched := now();
      when 'end_of_day'   then v_sched := date_trunc('day', now()) + interval '23 hours 59 minutes';
      when 'weekly'       then
        v_sched := date_trunc('week', now() + interval '1 week') + interval '9 hours';
      when 'manual'       then v_sched := null;
      else                     v_sched := now();
    end case;

    for v_emp_id in select employee_id from public.resolve_rule_recipients(v_rule.id)
    loop
      insert into public.notification_outbox (
        facility_id, rule_id, source_module, source_record_id,
        recipient_employee_id, subject, body, attach_pdf,
        requires_acknowledgement, scheduled_for, status
      ) values (
        p_facility_id, v_rule.id, p_source_module, p_source_record_id,
        v_emp_id, p_subject, p_body, coalesce(v_rule.attach_pdf, false),
        coalesce(v_rule.requires_acknowledgement, false),
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

revoke execute on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text) from public, anon;
grant  execute on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text) to authenticated;
