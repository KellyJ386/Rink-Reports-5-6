-- =============================================================================
-- 00000000000049_security_hardening.sql
--
-- Security review remediation for the Phase 1–5 + PDF pipeline. Three fixes:
--
--   H4: dispatch_rules_for_submission() gated by caller's facility AND by
--       current_employee_module_permission(p_source_module) >= 'submit'.
--       Closes same-tenant message injection by arbitrary authenticated users.
--
--   M1: notification_outbox INSERT/UPDATE policies tightened. The original
--       policy allowed facility admins to insert rows directly, contradicting
--       the comment ("Writes from the client are blocked; the dispatcher uses
--       SECURITY DEFINER helpers"). Authenticated INSERT/UPDATE is now
--       blocked outright; only service-role (which bypasses RLS) and the
--       SECURITY DEFINER dispatcher/drainer functions can write. This makes
--       the comment match reality and removes a cross-recipient injection
--       vector that chained with the PDF render path.
--
--   M2: effective_module_permission(p_employee_id, p_module_key) and the
--       _with_source() variant gated to the caller's facility. They were
--       cross-facility enumeration oracles for any authenticated user.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- H4: dispatch_rules_for_submission gating
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

  -- AuthZ: the caller must either be a platform super_admin, or be acting
  -- inside their own facility AND hold submit-or-higher on the source module.
  -- This stops authenticated users from injecting messages into their own
  -- facility's inbox with attacker-controlled subjects/bodies and routing
  -- targets they wouldn't otherwise be able to reach.
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

comment on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text) is
  'Fans out a submission event to every matching routing rule. Gated so the '
  'caller must be in p_facility_id and hold submit-or-higher on p_source_module, '
  'unless they are a platform super_admin. Outbox rows are inserted with '
  'definer privileges (RLS bypassed) but only after the gate passes.';

revoke execute on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text)
  from public, anon;
grant  execute on function public.dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- M1: lock down notification_outbox INSERT / UPDATE for authenticated.
--
-- The dispatcher and drainer are SECURITY DEFINER and own the writes; the
-- cron route uses the service-role key which bypasses RLS. No app code
-- writes to this table directly from an authenticated client.
-- -----------------------------------------------------------------------------
drop policy if exists notification_outbox_insert on public.notification_outbox;
create policy notification_outbox_insert
  on public.notification_outbox
  for insert to authenticated
  with check (false);

drop policy if exists notification_outbox_update on public.notification_outbox;
create policy notification_outbox_update
  on public.notification_outbox
  for update to authenticated
  using (false)
  with check (false);

-- SELECT and DELETE policies from migration 45 are unchanged.

-- -----------------------------------------------------------------------------
-- M2: scope the resolver functions to the caller's facility.
--
-- Previous behaviour: any authenticated user could call
-- effective_module_permission(p_employee_id, ...) for any employee_id and
-- learn the resolved level — an enumeration oracle across tenants.
-- New behaviour: returns 'none' (and source='none' for the with_source
-- variant) when the target employee is not in the caller's facility, unless
-- the caller is a platform super_admin.
-- -----------------------------------------------------------------------------
create or replace function public.effective_module_permission(
  p_employee_id uuid,
  p_module_key  text
)
returns public.module_permission_level
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id     uuid;
  v_user_id     uuid;
  v_facility_id uuid;
  v_is_active   boolean;
  v_is_super    boolean;
  v_override    public.module_permission_level;
  v_role_def    public.module_permission_level;
  v_dept_max    public.module_permission_level;
  v_fac_def     public.module_permission_level;
begin
  if p_employee_id is null or p_module_key is null then
    return 'none'::module_permission_level;
  end if;

  select e.role_id, e.user_id, e.facility_id, e.is_active
    into v_role_id, v_user_id, v_facility_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true then
    return 'none'::module_permission_level;
  end if;

  -- Tenant gate: callers may only resolve permissions inside their own
  -- facility unless they are platform super_admins.
  if not public.is_super_admin() then
    if v_facility_id is null or v_facility_id <> public.current_facility_id() then
      return 'none'::module_permission_level;
    end if;
  end if;

  if v_user_id is not null then
    select u.is_super_admin into v_is_super
    from public.users u where u.id = v_user_id;
    if v_is_super then
      return 'admin'::module_permission_level;
    end if;
  end if;

  select mp.permission_level into v_override
  from public.module_permissions mp
  where mp.employee_id = p_employee_id
    and mp.module_key  = p_module_key
  limit 1;

  if v_override is not null then
    return v_override;
  end if;

  select rmd.permission_level into v_role_def
  from public.role_module_permission_defaults rmd
  where rmd.role_id    = v_role_id
    and rmd.module_key = p_module_key
  limit 1;

  if v_role_def is not null and v_role_def <> 'none'::module_permission_level then
    return v_role_def;
  end if;

  select max(dmd.permission_level) into v_dept_max
  from public.employee_departments ed
  join public.department_module_permission_defaults dmd
    on dmd.department_id = ed.department_id
  where ed.employee_id = p_employee_id
    and dmd.module_key = p_module_key;

  if v_dept_max is not null and v_dept_max <> 'none'::module_permission_level then
    return v_dept_max;
  end if;

  if v_facility_id is not null then
    select fmd.permission_level into v_fac_def
    from public.facility_module_permission_defaults fmd
    where fmd.facility_id = v_facility_id
      and fmd.module_key  = p_module_key
    limit 1;

    if v_fac_def is not null and v_fac_def <> 'none'::module_permission_level then
      return v_fac_def;
    end if;
  end if;

  return coalesce(v_role_def, 'none'::module_permission_level);
end;
$$;

comment on function public.effective_module_permission(uuid, text) is
  'Resolves (employee, module). Returns ''none'' when the target employee is '
  'not in the caller''s facility (unless caller is super_admin). Otherwise '
  'walks override -> role default -> MAX(department defaults) -> facility '
  'default -> none.';

revoke execute on function public.effective_module_permission(uuid, text) from public, anon;
grant  execute on function public.effective_module_permission(uuid, text) to authenticated;

create or replace function public.effective_module_permission_with_source(
  p_employee_id uuid,
  p_module_key  text,
  out level     public.module_permission_level,
  out source    text
)
returns record
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id     uuid;
  v_user_id     uuid;
  v_facility_id uuid;
  v_is_active   boolean;
  v_is_super    boolean;
  v_override    public.module_permission_level;
  v_role_def    public.module_permission_level;
  v_dept_max    public.module_permission_level;
  v_fac_def     public.module_permission_level;
begin
  level  := 'none'::module_permission_level;
  source := 'none';

  if p_employee_id is null or p_module_key is null then
    return;
  end if;

  select e.role_id, e.user_id, e.facility_id, e.is_active
    into v_role_id, v_user_id, v_facility_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true then
    return;
  end if;

  if not public.is_super_admin() then
    if v_facility_id is null or v_facility_id <> public.current_facility_id() then
      return;
    end if;
  end if;

  if v_user_id is not null then
    select u.is_super_admin into v_is_super
    from public.users u where u.id = v_user_id;
    if v_is_super then
      level := 'admin'::module_permission_level;
      source := 'super_admin';
      return;
    end if;
  end if;

  select mp.permission_level into v_override
  from public.module_permissions mp
  where mp.employee_id = p_employee_id and mp.module_key = p_module_key
  limit 1;

  if v_override is not null then
    level := v_override;
    source := 'override';
    return;
  end if;

  select rmd.permission_level into v_role_def
  from public.role_module_permission_defaults rmd
  where rmd.role_id = v_role_id and rmd.module_key = p_module_key
  limit 1;

  if v_role_def is not null and v_role_def <> 'none'::module_permission_level then
    level := v_role_def;
    source := 'role';
    return;
  end if;

  select max(dmd.permission_level) into v_dept_max
  from public.employee_departments ed
  join public.department_module_permission_defaults dmd
    on dmd.department_id = ed.department_id
  where ed.employee_id = p_employee_id
    and dmd.module_key = p_module_key;

  if v_dept_max is not null and v_dept_max <> 'none'::module_permission_level then
    level := v_dept_max;
    source := 'department';
    return;
  end if;

  if v_facility_id is not null then
    select fmd.permission_level into v_fac_def
    from public.facility_module_permission_defaults fmd
    where fmd.facility_id = v_facility_id and fmd.module_key = p_module_key
    limit 1;

    if v_fac_def is not null and v_fac_def <> 'none'::module_permission_level then
      level := v_fac_def;
      source := 'facility';
      return;
    end if;
  end if;

  if v_role_def is not null then
    level := v_role_def;
    source := 'role';
    return;
  end if;

  level := 'none'::module_permission_level;
  source := 'none';
end;
$$;

comment on function public.effective_module_permission_with_source(uuid, text) is
  'Like effective_module_permission() but also returns the tier that produced '
  'the level. Cross-facility callers (non-super_admin) get (none, none).';

revoke execute on function public.effective_module_permission_with_source(uuid, text)
  from public, anon;
grant  execute on function public.effective_module_permission_with_source(uuid, text)
  to authenticated;
