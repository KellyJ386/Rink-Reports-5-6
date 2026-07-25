-- =============================================================================
-- 00000000000209_strip_retired_role_references.sql
--
-- Remove the last live references to the retired 'gm' and 'supervisor' role
-- keys. The roles were retired in migrations 58/87 ('gm' folded into 'admin'),
-- and migration 188 added the roles_key_not_retired CHECK so they can never be
-- re-seeded — but three surfaces still carried the old keys:
--
--   1. employee_certifications write policies — migration 98 had already
--      stripped 'gm'; migration 119 (M5) deliberately re-added it while
--      aligning the policy shape. Since no employee can hold a 'gm' role
--      (the CHECK forbids the key), the term is inert — but inert grants in
--      live policies are exactly how the org chart and the written rules
--      drift apart. Same for the role_permission_defaults policies
--      (unchanged since migration 79).
--   2. Four SECURITY DEFINER admin gates listing 'gm' in their role checks.
--   3. canonical_role_permission_grants(): 23 dead seed rows ('gm' +
--      'supervisor') — the same rows migration 188's header called out as
--      the source of retired roles reappearing on facility create.
--
-- A regression probe in supabase/tests/rls_isolation.sql now scans
-- pg_policies and these functions for retired keys so this class of drift
-- fails CI instead of accumulating.
-- =============================================================================

-- 1. Policies: drop 'gm' from the role arrays (shape otherwise unchanged).
alter policy employee_certifications_insert on public.employee_certifications
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

alter policy employee_certifications_update on public.employee_certifications
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

alter policy employee_certifications_delete on public.employee_certifications
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

alter policy role_permission_defaults_insert on public.role_permission_defaults
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

alter policy role_permission_defaults_update on public.role_permission_defaults
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

alter policy role_permission_defaults_delete on public.role_permission_defaults
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_user_role() = any (array['admin', 'super_admin'])
    )
  );

-- 2. Function gates: same bodies as live, minus 'gm' in the role lists.

CREATE OR REPLACE FUNCTION public.copy_role_permission_defaults(p_source_role_id uuid, p_target_role_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_src_facility uuid;
  v_tgt_facility uuid;
  v_copied       integer := 0;
begin
  select facility_id into v_src_facility from public.roles where id = p_source_role_id;
  select facility_id into v_tgt_facility from public.roles where id = p_target_role_id;

  if v_src_facility is null or v_tgt_facility is null then
    raise exception 'Source or target role not found';
  end if;

  if v_src_facility <> v_tgt_facility then
    raise exception 'Cannot copy across facilities';
  end if;

  if not (
    public.is_super_admin()
    or (
      v_tgt_facility = public.current_facility_id()
      and public.current_user_role() in ('admin', 'super_admin')
    )
  ) then
    raise exception 'Not authorised';
  end if;

  with src as (
    select module_key, permission_level
    from public.role_module_permission_defaults
    where role_id = p_source_role_id
  ),
  upsert as (
    insert into public.role_module_permission_defaults
      (facility_id, role_id, module_key, permission_level)
    select v_tgt_facility, p_target_role_id, module_key, permission_level
    from src
    on conflict (role_id, module_key)
    do update set permission_level = excluded.permission_level,
                  updated_at       = now()
    returning 1
  )
  select count(*)::int into v_copied from upsert;

  return v_copied;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.create_employee_complete(p_facility_id uuid, p_role_id uuid, p_first_name text, p_last_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_employee_code text DEFAULT NULL::text, p_is_minor boolean DEFAULT false, p_emergency_contact_name text DEFAULT NULL::text, p_emergency_contact_phone text DEFAULT NULL::text, p_hire_date date DEFAULT NULL::date, p_created_by uuid DEFAULT NULL::uuid, p_department_ids uuid[] DEFAULT NULL::uuid[], p_primary_department_id uuid DEFAULT NULL::uuid, p_job_area_ids uuid[] DEFAULT NULL::uuid[], p_primary_job_area_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_emp_id    uuid;
  v_dept_id   uuid;
  v_area_id   uuid;
  v_areas     uuid[];
  v_valid_cnt int;
begin
  -- AuthZ: caller must be in p_facility_id AND hold at least 'admin' role
  -- key (admin, super_admin), OR be a platform super_admin.
  if not public.is_super_admin() then
    if p_facility_id is null or p_facility_id <> public.current_facility_id() then
      raise exception 'create_employee_complete: facility mismatch';
    end if;
    if public.current_user_role() not in ('admin', 'super_admin') then
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
$function$

;

CREATE OR REPLACE FUNCTION public.deactivate_role(p_role_id uuid, p_force boolean DEFAULT false)
 RETURNS TABLE(ok boolean, employee_count integer, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_facility_id uuid;
  v_is_system   boolean;
  v_count       integer;
begin
  select r.facility_id, r.is_system into v_facility_id, v_is_system
  from public.roles r where r.id = p_role_id;

  if v_facility_id is null then
    return query select false, 0, 'Role not found'::text;
    return;
  end if;

  -- Authorisation: super_admin or facility-scoped admin/super_admin.
  if not (
    public.is_super_admin()
    or (
      v_facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'super_admin')
    )
  ) then
    return query select false, 0, 'Not authorised'::text;
    return;
  end if;

  if v_is_system and not public.is_super_admin() then
    return query select false, 0, 'System roles cannot be deactivated by facility admins'::text;
    return;
  end if;

  select count(*)::int into v_count
  from public.employees e
  where e.role_id = p_role_id and e.is_active = true;

  if v_count > 0 and not p_force then
    return query select false, v_count,
      format('%s active employee(s) still assigned. Pass force=true to confirm.', v_count);
    return;
  end if;

  update public.roles
    set is_active = false, deactivated_at = now()
  where id = p_role_id;

  return query select true, v_count, 'Role deactivated'::text;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.reactivate_role(p_role_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_facility_id uuid;
begin
  select r.facility_id into v_facility_id
  from public.roles r where r.id = p_role_id;

  if v_facility_id is null then
    return false;
  end if;

  if not (
    public.is_super_admin()
    or (
      v_facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'super_admin')
    )
  ) then
    return false;
  end if;

  update public.roles
    set is_active = true, deactivated_at = null
  where id = p_role_id;

  return true;
end;
$function$

;

-- 3. Canonical grants: identical to the migration-198 matrix minus the 23
--    dead 'gm'/'supervisor' rows. No live role_permission_defaults rows can
--    reference these keys (roles_key_not_retired), so this is seed-side only.

CREATE OR REPLACE FUNCTION public.canonical_role_permission_grants()
 RETURNS TABLE(role_key text, module_name text, action user_action)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with ceilings(role_key, module_name, ceiling) as (
    values
      -- admin (Control Center)
      ('super_admin','admin','admin'::public.user_action),
      ('admin','admin','admin'::public.user_action),
      ('manager','admin','view'::public.user_action),
      -- daily_reports
      ('super_admin','daily_reports','admin'::public.user_action),
      ('admin','daily_reports','admin'::public.user_action),
      ('manager','daily_reports','admin'::public.user_action),
      ('staff','daily_reports','submit'::public.user_action),
      ('driver','daily_reports','submit'::public.user_action),
      -- ice_depth
      ('super_admin','ice_depth','admin'::public.user_action),
      ('admin','ice_depth','admin'::public.user_action),
      ('manager','ice_depth','admin'::public.user_action),
      ('staff','ice_depth','submit'::public.user_action),
      ('driver','ice_depth','submit'::public.user_action),
      -- ice_operations
      ('super_admin','ice_operations','admin'::public.user_action),
      ('admin','ice_operations','admin'::public.user_action),
      ('manager','ice_operations','admin'::public.user_action),
      ('staff','ice_operations','submit'::public.user_action),
      ('driver','ice_operations','edit'::public.user_action),
      -- refrigeration
      ('super_admin','refrigeration','admin'::public.user_action),
      ('admin','refrigeration','admin'::public.user_action),
      ('manager','refrigeration','admin'::public.user_action),
      ('staff','refrigeration','submit'::public.user_action),
      ('driver','refrigeration','submit'::public.user_action),
      -- incident_reports
      ('super_admin','incident_reports','admin'::public.user_action),
      ('admin','incident_reports','admin'::public.user_action),
      ('manager','incident_reports','admin'::public.user_action),
      ('staff','incident_reports','submit'::public.user_action),
      ('driver','incident_reports','submit'::public.user_action),
      -- accident_reports
      ('super_admin','accident_reports','admin'::public.user_action),
      ('admin','accident_reports','admin'::public.user_action),
      ('manager','accident_reports','admin'::public.user_action),
      ('staff','accident_reports','submit'::public.user_action),
      ('driver','accident_reports','submit'::public.user_action),
      -- air_quality
      ('super_admin','air_quality','admin'::public.user_action),
      ('admin','air_quality','admin'::public.user_action),
      ('manager','air_quality','admin'::public.user_action),
      ('staff','air_quality','submit'::public.user_action),
      ('driver','air_quality','view'::public.user_action),
      -- scheduling
      ('super_admin','scheduling','admin'::public.user_action),
      ('admin','scheduling','admin'::public.user_action),
      ('manager','scheduling','admin'::public.user_action),
      ('staff','scheduling','view'::public.user_action),
      ('driver','scheduling','view'::public.user_action),
      -- communications
      ('super_admin','communications','admin'::public.user_action),
      ('admin','communications','admin'::public.user_action),
      ('manager','communications','admin'::public.user_action),
      ('staff','communications','submit'::public.user_action),
      ('driver','communications','submit'::public.user_action),
      -- facility_paperwork (document library: manage for admin-tier roles,
      -- read for everyone else; facility_documents RLS writes stay gated on
      -- is_facility_admin regardless)
      ('super_admin','facility_paperwork','admin'::public.user_action),
      ('admin','facility_paperwork','admin'::public.user_action),
      ('manager','facility_paperwork','admin'::public.user_action),
      ('staff','facility_paperwork','view'::public.user_action),
      ('driver','facility_paperwork','view'::public.user_action),
      -- dasher_boards (added migration 193; manager deliberately edit, not admin)
      ('super_admin','dasher_boards','admin'::public.user_action),
      ('admin','dasher_boards','admin'::public.user_action),
      ('manager','dasher_boards','edit'::public.user_action),
      ('staff','dasher_boards','submit'::public.user_action),
      ('driver','dasher_boards','submit'::public.user_action)
  ),
  action_levels(action, lvl) as (
    values
      ('view'::public.user_action, 1),
      ('submit'::public.user_action, 2),
      ('edit'::public.user_action, 3),
      ('admin'::public.user_action, 4)
  )
  select c.role_key, c.module_name, al.action
  from ceilings c
  join action_levels cl on cl.action = c.ceiling
  join action_levels al on al.lvl <= cl.lvl
$function$

;
