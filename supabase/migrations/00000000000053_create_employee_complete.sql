-- =============================================================================
-- 00000000000053_create_employee_complete.sql
--
-- Atomic employee creation with department links.
--
-- Replaces the multi-step client-side approach in employees/actions.ts that
-- used best-effort rollback to handle partial failures. Everything here runs
-- in a single PL/pgSQL block (implicit transaction) so a failure at any point
-- causes a full rollback — no orphaned employee rows.
--
-- Custom field values are NOT handled here; they remain a separate server
-- action step (persistCustomFieldValues) because they require iterating the
-- facility's field definitions, which would complicate this function
-- significantly for minimal gain. An employee missing CF values is a much
-- less severe state than an orphaned employee row.
-- =============================================================================

create or replace function public.create_employee_complete(
  p_facility_id              uuid,
  p_role_id                  uuid,
  p_first_name               text,
  p_last_name                text,
  p_email                    text    default null,
  p_phone                    text    default null,
  p_employee_code            text    default null,
  p_is_minor                 boolean default false,
  p_emergency_contact_name   text    default null,
  p_emergency_contact_phone  text    default null,
  p_hire_date                date    default null,
  p_created_by               uuid    default null,
  p_department_ids           uuid[]  default null,
  p_primary_department_id    uuid    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp_id  uuid;
  v_dept_id uuid;
begin
  -- AuthZ: caller must be in p_facility_id AND hold at least 'admin' role
  -- key (admin, gm, super_admin), OR be a platform super_admin.
  if not public.is_super_admin() then
    if p_facility_id is null or p_facility_id <> public.current_facility_id() then
      raise exception 'create_employee_complete: facility mismatch';
    end if;
    if public.current_user_role() not in ('admin', 'gm', 'super_admin') then
      raise exception 'create_employee_complete: caller lacks admin privilege';
    end if;
  end if;

  -- Basic required-field validation.
  if length(trim(coalesce(p_first_name, ''))) = 0 then
    raise exception 'create_employee_complete: first_name is required';
  end if;
  if length(trim(coalesce(p_last_name, ''))) = 0 then
    raise exception 'create_employee_complete: last_name is required';
  end if;
  if p_role_id is null then
    raise exception 'create_employee_complete: role_id is required';
  end if;

  -- Insert the employee row.
  insert into public.employees (
    facility_id, role_id,
    first_name, last_name, email, phone,
    employee_code, is_minor,
    emergency_contact_name, emergency_contact_phone,
    hire_date, is_active, created_by
  ) values (
    p_facility_id, p_role_id,
    trim(p_first_name), trim(p_last_name),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_employee_code, '')), ''),
    coalesce(p_is_minor, false),
    nullif(trim(coalesce(p_emergency_contact_name, '')), ''),
    nullif(trim(coalesce(p_emergency_contact_phone, '')), ''),
    p_hire_date, true, p_created_by
  )
  returning id into v_emp_id;

  -- Insert department links (if any).
  if p_department_ids is not null and array_length(p_department_ids, 1) > 0 then
    foreach v_dept_id in array p_department_ids loop
      insert into public.employee_departments (
        facility_id, employee_id, department_id, is_primary
      ) values (
        p_facility_id, v_emp_id, v_dept_id,
        (v_dept_id = coalesce(p_primary_department_id, '00000000-0000-0000-0000-000000000000'::uuid))
      )
      on conflict (employee_id, department_id) do nothing;
    end loop;
  end if;

  return v_emp_id;
end;
$$;

comment on function public.create_employee_complete(uuid, uuid, text, text, text, text, text, boolean, text, text, date, uuid, uuid[], uuid) is
  'Atomically inserts an employee row and its department links. '
  'Restricted to facility admins/GMs and platform super_admins. '
  'Custom field values are persisted separately by the caller.';

revoke execute on function public.create_employee_complete(uuid, uuid, text, text, text, text, text, boolean, text, text, date, uuid, uuid[], uuid)
  from public, anon;
grant  execute on function public.create_employee_complete(uuid, uuid, text, text, text, text, text, boolean, text, text, date, uuid, uuid[], uuid)
  to authenticated;
