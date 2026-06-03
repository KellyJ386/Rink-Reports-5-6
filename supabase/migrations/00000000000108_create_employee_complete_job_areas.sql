-- =============================================================================
-- 00000000000108_create_employee_complete_job_areas.sql
-- Extend create_employee_complete() to atomically assign job areas alongside
-- the employee row and department links.
--
-- Why here (and not a second RPC): employee creation already funnels through
-- this single SECURITY DEFINER function so the insert + its links share one
-- transaction (full rollback on any failure -- no orphaned/half-created rows).
-- Adding the job-area links here keeps that guarantee and a single creation
-- path for both the single-add and bulk-add server actions.
--
-- Two new trailing OPTIONAL params (default null) -> backward compatible with
-- existing callers that omit them.
--
-- Defense-in-depth inside the function (it is SECURITY DEFINER, so RLS does
-- NOT constrain its internal reads):
--   * every job-area id must belong to p_facility_id, else raise;
--   * at most 4 distinct areas (backstop to the app-level check and the
--     constraint trigger trg_employee_job_area_assignments_cap).
-- =============================================================================

-- Drop the old 14-arg signature so the new 16-arg version fully replaces it
-- (adding params would otherwise create a second overload and ambiguity).
drop function if exists public.create_employee_complete(
  uuid, uuid, text, text, text, text, text, boolean, text, text, date, uuid, uuid[], uuid
);

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
  p_primary_department_id    uuid    default null,
  p_job_area_ids             uuid[]  default null,
  p_primary_job_area_id      uuid    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp_id    uuid;
  v_dept_id   uuid;
  v_area_id   uuid;
  v_areas     uuid[];
  v_valid_cnt int;
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

  -- Insert job-area links (if any).
  if p_job_area_ids is not null and array_length(p_job_area_ids, 1) > 0 then
    -- De-duplicate the requested ids.
    select array_agg(distinct x) into v_areas from unnest(p_job_area_ids) as x;

    -- Hard cap (backstop to the app-level check and the constraint trigger).
    if array_length(v_areas, 1) > 4 then
      raise exception 'create_employee_complete: at most 4 job areas per employee';
    end if;

    -- Facility ownership: every id must belong to p_facility_id.
    select count(*) into v_valid_cnt
    from public.employee_job_areas
    where facility_id = p_facility_id and id = any(v_areas);

    if v_valid_cnt <> array_length(v_areas, 1) then
      raise exception 'create_employee_complete: one or more job areas do not belong to this facility';
    end if;

    foreach v_area_id in array v_areas loop
      insert into public.employee_job_area_assignments (
        facility_id, employee_id, job_area_id, is_primary
      ) values (
        p_facility_id, v_emp_id, v_area_id,
        (v_area_id = coalesce(p_primary_job_area_id, '00000000-0000-0000-0000-000000000000'::uuid))
      )
      on conflict (employee_id, job_area_id) do nothing;
    end loop;
  end if;

  return v_emp_id;
end;
$$;

comment on function public.create_employee_complete(uuid, uuid, text, text, text, text, text, boolean, text, text, date, uuid, uuid[], uuid, uuid[], uuid) is
  'Atomically inserts an employee row plus its department and job-area links. '
  'Restricted to facility admins/GMs and platform super_admins. Validates that '
  'every job area belongs to p_facility_id and caps at 4 areas per employee. '
  'Custom field values are persisted separately by the caller.';

revoke execute on function public.create_employee_complete(uuid, uuid, text, text, text, text, text, boolean, text, text, date, uuid, uuid[], uuid, uuid[], uuid)
  from public, anon;
grant  execute on function public.create_employee_complete(uuid, uuid, text, text, text, text, text, boolean, text, text, date, uuid, uuid[], uuid, uuid[], uuid)
  to authenticated;
