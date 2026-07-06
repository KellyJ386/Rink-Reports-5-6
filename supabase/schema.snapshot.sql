--
-- PostgreSQL database dump
--




--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: employee_custom_field_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_custom_field_type AS ENUM (
    'text',
    'number',
    'date',
    'boolean'
);


--
-- Name: module_permission_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.module_permission_level AS ENUM (
    'none',
    'view',
    'submit',
    'edit_own',
    'edit_all',
    'approve',
    'publish',
    'manage_settings',
    'admin'
);


--
-- Name: TYPE module_permission_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.module_permission_level IS 'Ordered permission grain for the Admin Control Center. Ordinal comparison is meaningful: a higher level implies all lower-level capabilities.';


--
-- Name: schedule_publish_request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.schedule_publish_request_status AS ENUM (
    'pending',
    'rejected',
    'published'
);


--
-- Name: user_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_action AS ENUM (
    'view',
    'submit',
    'edit',
    'admin'
);


--
-- Name: apply_role_permission_defaults(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_role_permission_defaults(p_user_id uuid, p_facility_id uuid, p_role_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if p_user_id is null or p_facility_id is null or p_role_id is null then
    raise exception 'apply_role_permission_defaults: user_id, facility_id and role_id are required';
  end if;

  -- super_admin bypasses resolution via the flag; seeding rows would be noise.
  if coalesce((select u.is_super_admin from public.users u where u.id = p_user_id), false) then
    return;
  end if;

  -- 1) Seed/refresh from defaults. ON CONFLICT update is filtered to role_default rows,
  --    so manual_override rows are preserved untouched.
  insert into public.user_permissions as up (user_id, facility_id, module_name, action, enabled, source)
  select p_user_id, p_facility_id, d.module_name, d.action, d.enabled, 'role_default'
  from public.role_permission_defaults d
  where d.facility_id = p_facility_id
    and d.role_id = p_role_id
  on conflict (user_id, facility_id, module_name, action)
  do update set
    enabled = excluded.enabled,
    source = 'role_default',
    updated_at = now()
  where up.source = 'role_default';

  -- 2) Role change: disable role_default rows the new role no longer grants.
  --    Preserve audit trail (disable, not delete). Manual overrides untouched.
  update public.user_permissions up
  set enabled = false, updated_at = now()
  where up.user_id = p_user_id
    and up.facility_id = p_facility_id
    and up.source = 'role_default'
    and up.enabled = true
    and not exists (
      select 1 from public.role_permission_defaults d
      where d.facility_id = p_facility_id
        and d.role_id = p_role_id
        and d.module_name = up.module_name
        and d.action = up.action
        and d.enabled = true
    );
end;
$$;


--
-- Name: FUNCTION apply_role_permission_defaults(p_user_id uuid, p_facility_id uuid, p_role_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_role_permission_defaults(p_user_id uuid, p_facility_id uuid, p_role_id uuid) IS 'Seeds public.user_permissions for one user from role_permission_defaults. Idempotent; preserves manual_override rows; disables stale role_default rows on role change; no-op for super_admin. Internal worker - call via guarded entry points only.';


--
-- Name: audit_row_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_row_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_fac_col   text := coalesce(tg_argv[0], 'facility_id');
  v_action    text;
  v_before    jsonb;
  v_after     jsonb;
  v_facility  uuid;
  v_entity_id uuid;
  v_row       jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after  := to_jsonb(new);
    v_row    := v_after;
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_row    := v_after;
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_before := to_jsonb(old);
    v_after  := null;
    v_row    := v_before;
  else
    return coalesce(new, old);
  end if;

  begin
    v_facility := (v_row ->> v_fac_col)::uuid;
  exception when others then
    v_facility := null;
  end;

  begin
    v_entity_id := (v_row ->> 'id')::uuid;
  exception when others then
    v_entity_id := null;
  end;

  -- audit_logs.facility_id is NOT NULL. If we cannot resolve a tenant id
  -- (very unusual: orphaned row, table doesn't carry facility_id at all)
  -- skip the audit entry rather than failing the original DML.
  if v_facility is null then
    return coalesce(new, old);
  end if;

  insert into public.audit_logs (
    facility_id,
    actor_user_id,
    actor_employee_id,
    action,
    entity_type,
    entity_id,
    before,
    after
  ) values (
    v_facility,
    auth.uid(),
    public.current_employee_id(),
    v_action,
    tg_table_name::text,
    v_entity_id,
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;


--
-- Name: FUNCTION audit_row_change(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_row_change() IS 'Generic AFTER trigger function: appends a row to audit_logs describing the INSERT/UPDATE/DELETE. Pass the facility-id column name as the first trigger argument; defaults to ''facility_id''. Skips silently if facility cannot be resolved so it never blocks the underlying DML.';


--
-- Name: can_edit_user_profile(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_user_profile(p_target_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_editor          uuid := auth.uid();
  v_editor_facility uuid;
  v_target_facility uuid;
  v_editor_level    int;
  v_target_level    int;
begin
  if v_editor is null or p_target_user_id is null then
    return false;
  end if;

  -- Always allowed to edit your own profile.
  if p_target_user_id = v_editor then
    return true;
  end if;

  -- Super admins may edit anyone.
  if public.is_super_admin() then
    return true;
  end if;

  select u.facility_id into v_editor_facility from public.users u where u.id = v_editor;
  select u.facility_id into v_target_facility from public.users u where u.id = p_target_user_id;

  -- Cross-facility edits are never allowed for non-super-admins.
  if v_editor_facility is null
     or v_target_facility is null
     or v_editor_facility <> v_target_facility then
    return false;
  end if;

  -- A user's effective rank is their strongest (lowest-numbered) active role
  -- in their facility. Lower hierarchy_level == more powerful.
  select min(r.hierarchy_level) into v_editor_level
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.user_id = v_editor
    and e.is_active = true
    and e.facility_id = v_editor_facility;

  select min(r.hierarchy_level) into v_target_level
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.user_id = p_target_user_id
    and e.is_active = true
    and e.facility_id = v_target_facility;

  if v_editor_level is null or v_target_level is null then
    return false;
  end if;

  -- Editor must strictly outrank the target (cannot edit peers or superiors).
  return v_editor_level < v_target_level;
end;
$$;


--
-- Name: FUNCTION can_edit_user_profile(p_target_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.can_edit_user_profile(p_target_user_id uuid) IS 'True iff the calling user may edit the given target user profile: self, super admin, or a strictly-higher-ranked editor in the same facility. Used by the users_update RLS policy and the account server action.';


--
-- Name: canonical_role_permission_grants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_role_permission_grants() RETURNS TABLE(role_key text, module_name text, action public.user_action)
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with ceilings(role_key, module_name, ceiling) as (
    values
      -- admin (Control Center)
      ('super_admin','admin','admin'::public.user_action),
      ('admin','admin','admin'::public.user_action),
      ('gm','admin','admin'::public.user_action),
      ('manager','admin','view'::public.user_action),
      -- daily_reports
      ('super_admin','daily_reports','admin'::public.user_action),
      ('admin','daily_reports','admin'::public.user_action),
      ('gm','daily_reports','admin'::public.user_action),
      ('manager','daily_reports','admin'::public.user_action),
      ('supervisor','daily_reports','edit'::public.user_action),
      ('staff','daily_reports','submit'::public.user_action),
      ('driver','daily_reports','submit'::public.user_action),
      -- ice_depth
      ('super_admin','ice_depth','admin'::public.user_action),
      ('admin','ice_depth','admin'::public.user_action),
      ('gm','ice_depth','admin'::public.user_action),
      ('manager','ice_depth','admin'::public.user_action),
      ('supervisor','ice_depth','edit'::public.user_action),
      ('staff','ice_depth','submit'::public.user_action),
      ('driver','ice_depth','submit'::public.user_action),
      -- ice_operations
      ('super_admin','ice_operations','admin'::public.user_action),
      ('admin','ice_operations','admin'::public.user_action),
      ('gm','ice_operations','admin'::public.user_action),
      ('manager','ice_operations','admin'::public.user_action),
      ('supervisor','ice_operations','edit'::public.user_action),
      ('staff','ice_operations','submit'::public.user_action),
      ('driver','ice_operations','edit'::public.user_action),
      -- refrigeration
      ('super_admin','refrigeration','admin'::public.user_action),
      ('admin','refrigeration','admin'::public.user_action),
      ('gm','refrigeration','admin'::public.user_action),
      ('manager','refrigeration','admin'::public.user_action),
      ('supervisor','refrigeration','edit'::public.user_action),
      ('staff','refrigeration','submit'::public.user_action),
      ('driver','refrigeration','submit'::public.user_action),
      -- incident_reports
      ('super_admin','incident_reports','admin'::public.user_action),
      ('admin','incident_reports','admin'::public.user_action),
      ('gm','incident_reports','admin'::public.user_action),
      ('manager','incident_reports','admin'::public.user_action),
      ('supervisor','incident_reports','edit'::public.user_action),
      ('staff','incident_reports','submit'::public.user_action),
      ('driver','incident_reports','submit'::public.user_action),
      -- accident_reports
      ('super_admin','accident_reports','admin'::public.user_action),
      ('admin','accident_reports','admin'::public.user_action),
      ('gm','accident_reports','admin'::public.user_action),
      ('manager','accident_reports','admin'::public.user_action),
      ('supervisor','accident_reports','edit'::public.user_action),
      ('staff','accident_reports','submit'::public.user_action),
      ('driver','accident_reports','submit'::public.user_action),
      -- air_quality
      ('super_admin','air_quality','admin'::public.user_action),
      ('admin','air_quality','admin'::public.user_action),
      ('gm','air_quality','admin'::public.user_action),
      ('manager','air_quality','admin'::public.user_action),
      ('supervisor','air_quality','edit'::public.user_action),
      ('staff','air_quality','submit'::public.user_action),
      ('driver','air_quality','view'::public.user_action),
      -- scheduling
      ('super_admin','scheduling','admin'::public.user_action),
      ('admin','scheduling','admin'::public.user_action),
      ('gm','scheduling','admin'::public.user_action),
      ('manager','scheduling','admin'::public.user_action),
      ('supervisor','scheduling','edit'::public.user_action),
      ('staff','scheduling','view'::public.user_action),
      ('driver','scheduling','view'::public.user_action),
      -- communications
      ('super_admin','communications','admin'::public.user_action),
      ('admin','communications','admin'::public.user_action),
      ('gm','communications','admin'::public.user_action),
      ('manager','communications','admin'::public.user_action),
      ('supervisor','communications','edit'::public.user_action),
      ('staff','communications','submit'::public.user_action),
      ('driver','communications','submit'::public.user_action),
      -- facility_paperwork (document library: manage for admin-tier roles,
      -- read for everyone else; facility_documents RLS writes stay gated on
      -- is_facility_admin regardless)
      ('super_admin','facility_paperwork','admin'::public.user_action),
      ('admin','facility_paperwork','admin'::public.user_action),
      ('gm','facility_paperwork','admin'::public.user_action),
      ('manager','facility_paperwork','admin'::public.user_action),
      ('supervisor','facility_paperwork','view'::public.user_action),
      ('staff','facility_paperwork','view'::public.user_action),
      ('driver','facility_paperwork','view'::public.user_action)
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
$$;


--
-- Name: FUNCTION canonical_role_permission_grants(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.canonical_role_permission_grants() IS 'Canonical per-role default permission grants (expanded to cumulative actions), keyed by role key. Source for seed_role_permission_defaults_for_facility() and the roles auto-seed trigger.';


--
-- Name: certification_types_sync_names(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.certification_types_sync_names() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.name is distinct from old.name then
    update public.job_area_certification_requirements
       set cert_name = new.name
     where certification_type_id = new.id;
  end if;
  return new;
end;
$$;


--
-- Name: check_rate_limit(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_rate_limit(p_bucket text, p_identifier text, p_max integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_window_start timestamptz;
  v_hits         integer;
begin
  -- Defensive: a non-positive window or max would make the limiter meaningless.
  if p_window_seconds is null or p_window_seconds <= 0
     or p_max is null or p_max < 0
     or p_bucket is null or p_identifier is null then
    -- Fail open at the DB layer for clearly malformed input rather than
    -- erroring; the caller's own validation is the real gate.
    return true;
  end if;

  -- Align to a fixed window: all hits in the same [k*window, (k+1)*window)
  -- slice share one counter row.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_counters (bucket, identifier, window_start, hits)
  values (p_bucket, p_identifier, v_window_start, 1)
  on conflict (bucket, identifier, window_start)
  do update set hits = public.rate_limit_counters.hits + 1
  returning hits into v_hits;

  return v_hits <= p_max;
end;
$$;


--
-- Name: FUNCTION check_rate_limit(p_bucket text, p_identifier text, p_max integer, p_window_seconds integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_rate_limit(p_bucket text, p_identifier text, p_max integer, p_window_seconds integer) IS 'Atomically counts one hit for (bucket, identifier) in the current fixed window of p_window_seconds. Returns true if the running count is <= p_max (allowed) or false if over the limit. Backs the public lead-form rate limit. Reads/writes public.rate_limit_counters as table owner (RLS-enabled, no policies).';


--
-- Name: cleanup_daily_report_area_permissions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_daily_report_area_permissions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  delete from public.module_area_permissions
  where module_key = 'daily_reports' and area_id = old.id;
  return old;
end;
$$;


--
-- Name: FUNCTION cleanup_daily_report_area_permissions(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cleanup_daily_report_area_permissions() IS 'AFTER DELETE on daily_report_areas: removes per-area permission grants for the deleted area — the ON DELETE CASCADE a polymorphic soft reference cannot express. SECURITY DEFINER so an area delete by a module admin also clears grants regardless of the caller''s module_area_permissions write scope.';


--
-- Name: copy_role_permission_defaults(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_role_permission_defaults(p_source_role_id uuid, p_target_role_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
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
$$;


--
-- Name: FUNCTION copy_role_permission_defaults(p_source_role_id uuid, p_target_role_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.copy_role_permission_defaults(p_source_role_id uuid, p_target_role_id uuid) IS 'Copies all role_module_permission_defaults rows from source to target role. Requires both roles in the same facility and admin/gm/super_admin auth.';


--
-- Name: create_employee_complete(uuid, uuid, text, text, text, text, text, boolean, text, text, date, uuid, uuid[], uuid, uuid[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_employee_complete(p_facility_id uuid, p_role_id uuid, p_first_name text, p_last_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_employee_code text DEFAULT NULL::text, p_is_minor boolean DEFAULT false, p_emergency_contact_name text DEFAULT NULL::text, p_emergency_contact_phone text DEFAULT NULL::text, p_hire_date date DEFAULT NULL::date, p_created_by uuid DEFAULT NULL::uuid, p_department_ids uuid[] DEFAULT NULL::uuid[], p_primary_department_id uuid DEFAULT NULL::uuid, p_job_area_ids uuid[] DEFAULT NULL::uuid[], p_primary_job_area_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION create_employee_complete(p_facility_id uuid, p_role_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text, p_employee_code text, p_is_minor boolean, p_emergency_contact_name text, p_emergency_contact_phone text, p_hire_date date, p_created_by uuid, p_department_ids uuid[], p_primary_department_id uuid, p_job_area_ids uuid[], p_primary_job_area_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_employee_complete(p_facility_id uuid, p_role_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text, p_employee_code text, p_is_minor boolean, p_emergency_contact_name text, p_emergency_contact_phone text, p_hire_date date, p_created_by uuid, p_department_ids uuid[], p_primary_department_id uuid, p_job_area_ids uuid[], p_primary_job_area_id uuid) IS 'Atomically inserts an employee row plus its department and job-area links. Restricted to facility admins/GMs and platform super_admins. Validates that every job area belongs to p_facility_id and caps at 4 areas per employee. Custom field values are persisted separately by the caller.';


--
-- Name: create_facility_with_roles(text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_facility_with_roles(p_name text, p_slug text, p_timezone text, p_address text DEFAULT NULL::text, p_zip_code text DEFAULT NULL::text, p_phone text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  v_facility_id uuid;
begin
  -- Only platform super_admins may create facilities.
  if not public.is_super_admin() then
    raise exception 'create_facility_with_roles: caller is not a super_admin';
  end if;

  if length(trim(p_name)) < 2 then
    raise exception 'create_facility_with_roles: name is too short';
  end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'create_facility_with_roles: invalid slug format';
  end if;

  insert into public.facilities (
    name, slug, timezone, address, zip_code, phone, is_active
  ) values (
    trim(p_name), lower(trim(p_slug)), coalesce(nullif(trim(p_timezone), ''), 'America/New_York'),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_zip_code, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    true
  )
  returning id into v_facility_id;

  insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
  values
    (v_facility_id, 'super_admin', 'Super Admin',    0, true),
    (v_facility_id, 'admin',       'Administrator',  1, true),
    (v_facility_id, 'gm',          'General Manager',2, true),
    (v_facility_id, 'manager',     'Manager',        3, true),
    (v_facility_id, 'supervisor',  'Supervisor',     4, true),
    (v_facility_id, 'staff',       'Staff',          5, true)
  on conflict (facility_id, key) do nothing;

  -- Seed scheduling defaults (settings + baseline compliance rules). Idempotent.
  perform public.seed_default_scheduling_config(v_facility_id);

  -- Seed the standard daily-report Operations Checklists catalog. Idempotent.
  perform public.seed_default_daily_report_checklists(v_facility_id);

  return v_facility_id;
end;
$_$;


--
-- Name: FUNCTION create_facility_with_roles(p_name text, p_slug text, p_timezone text, p_address text, p_zip_code text, p_phone text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_facility_with_roles(p_name text, p_slug text, p_timezone text, p_address text, p_zip_code text, p_phone text) IS 'Atomically creates a facility, seeds its six canonical system roles, default scheduling config, and the standard daily-report checklist catalog. Restricted to platform super_admins. Returns the new facility UUID.';


--
-- Name: current_employee_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_employee_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select e.id
  from public.employees e
  where e.user_id = auth.uid()
    and e.is_active = true
  limit 1;
$$;


--
-- Name: FUNCTION current_employee_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_employee_id() IS 'Returns the active employee id linked to the current auth user (or NULL).';


--
-- Name: current_employee_module_permission(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_employee_module_permission(p_module_key text) RETURNS public.module_permission_level
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_emp uuid;
begin
  if public.is_super_admin() then
    return 'admin'::module_permission_level;
  end if;

  v_emp := public.current_employee_id();
  if v_emp is null then
    return 'none'::module_permission_level;
  end if;

  return public.effective_module_permission(v_emp, p_module_key);
end;
$$;


--
-- Name: FUNCTION current_employee_module_permission(p_module_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_employee_module_permission(p_module_key text) IS 'Returns the effective permission level for the current authenticated user on the given module, or ''none'' if not authenticated / not an active employee.';


--
-- Name: current_facility_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_facility_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select u.facility_id
  from public.users u
  where u.id = auth.uid();
$$;


--
-- Name: FUNCTION current_facility_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_facility_id() IS 'Returns the home facility_id of the current user. NULL for super admins.';


--
-- Name: current_user_has_permission(text, public.user_action); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_has_permission(p_module_name text, p_action public.user_action) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_fac uuid;
begin
  if v_uid is null then return false; end if;
  if public.is_super_admin() then return true; end if;

  v_fac := public.current_facility_id();
  if v_fac is null then return false; end if;

  return exists (
    select 1 from public.user_permissions
    where user_id     = v_uid
      and facility_id = v_fac
      and module_name = p_module_name
      and action      = p_action
      and enabled     = true
  );
end;
$$;


--
-- Name: current_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select auth.uid();
$$;


--
-- Name: FUNCTION current_user_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_user_id() IS 'Returns the current authenticated user id (auth.uid()).';




--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    facility_id uuid,
    email public.citext NOT NULL,
    full_name text,
    phone text,
    is_super_admin boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    address_line1 text,
    address_line2 text,
    city text,
    state_province text,
    postal_code text,
    country text,
    emergency_contact_name text,
    emergency_contact_phone text,
    sms_opt_in boolean DEFAULT false NOT NULL,
    CONSTRAINT users_profile_lengths_check CHECK ((((address_line1 IS NULL) OR (char_length(address_line1) <= 200)) AND ((address_line2 IS NULL) OR (char_length(address_line2) <= 200)) AND ((city IS NULL) OR (char_length(city) <= 120)) AND ((state_province IS NULL) OR (char_length(state_province) <= 120)) AND ((postal_code IS NULL) OR (char_length(postal_code) <= 40)) AND ((country IS NULL) OR (char_length(country) <= 120)) AND ((emergency_contact_name IS NULL) OR (char_length(emergency_contact_name) <= 200)) AND ((emergency_contact_phone IS NULL) OR (char_length(emergency_contact_phone) <= 40))))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS 'App-level user profile, 1:1 with auth.users. Super admins may have NULL facility_id.';


--
-- Name: COLUMN users.facility_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.facility_id IS 'Home facility. NULL is permitted ONLY for super admins.';


--
-- Name: COLUMN users.is_super_admin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.is_super_admin IS 'Cross-tenant administrator. Bypasses facility isolation in RLS.';


--
-- Name: COLUMN users.sms_opt_in; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.sms_opt_in IS 'Master opt-in for text-message notifications. Must be checked before any SMS is dispatched to this user. When false, no SMS of any kind is sent.';


--
-- Name: current_user_record(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_record() RETURNS public.users
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select u.* from public.users u where u.id = auth.uid();
$$;


--
-- Name: FUNCTION current_user_record(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_user_record() IS 'Returns the public.users row for the current authenticated user, or NULL.';


--
-- Name: current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select r.key
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.user_id = auth.uid()
    and e.is_active = true
  limit 1;
$$;


--
-- Name: FUNCTION current_user_role(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_user_role() IS 'Role key (e.g. ''gm'', ''manager'') for the current user, derived via employees -> roles.';


--
-- Name: deactivate_role(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deactivate_role(p_role_id uuid, p_force boolean DEFAULT false) RETURNS TABLE(ok boolean, employee_count integer, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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

  -- Authorisation: super_admin or facility-scoped admin/gm/super_admin.
  if not (
    public.is_super_admin()
    or (
      v_facility_id = public.current_facility_id()
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
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
$$;


--
-- Name: FUNCTION deactivate_role(p_role_id uuid, p_force boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.deactivate_role(p_role_id uuid, p_force boolean) IS 'Marks a role inactive. Refuses unless force=true when active employees are still assigned. System roles can only be deactivated by platform super admins.';


--
-- Name: dispatch_rules_for_submission(uuid, text, uuid, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dispatch_rules_for_submission(p_facility_id uuid, p_source_module text, p_source_record_id uuid, p_severity text DEFAULT NULL::text, p_area_id uuid DEFAULT NULL::uuid, p_subject text DEFAULT NULL::text, p_body text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
        -- Every row enters the queue as 'pending'; the drain worker claims
        -- pending rows whose scheduled_for has passed and flips them to 'sent'
        -- after fanning into communication_messages. 'immediate' rows get
        -- scheduled_for = now() so they drain on the next cycle. Marking them
        -- 'sent' here (the historical behavior) meant the drain never claimed
        -- them, so immediate notifications were silently never delivered.
        'pending'
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


--
-- Name: FUNCTION dispatch_rules_for_submission(p_facility_id uuid, p_source_module text, p_source_record_id uuid, p_severity text, p_area_id uuid, p_subject text, p_body text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.dispatch_rules_for_submission(p_facility_id uuid, p_source_module text, p_source_record_id uuid, p_severity text, p_area_id uuid, p_subject text, p_body text) IS 'Fans out a submission event to every matching routing rule. Gated so the caller must be in p_facility_id and hold submit-or-higher on p_source_module, unless they are a platform super_admin. Outbox rows are inserted with definer privileges (RLS bypassed) but only after the gate passes.';


--
-- Name: drain_notification_outbox(integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.drain_notification_outbox(p_max_rows integer DEFAULT 500, p_facility_id uuid DEFAULT NULL::uuid) RETURNS TABLE(sent_count integer, failed_count integer, message_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_sent         int := 0;
  v_failed       int := 0;
  v_message_cnt  int := 0;
  v_grp          record;
  v_msg_id       uuid;
  v_outbox_ids   uuid[];
begin
  if not (public.is_super_admin() or session_user = 'postgres' or session_user = 'service_role') then
    raise exception 'drain_notification_outbox: not authorised';
  end if;

  if p_facility_id is null
     and public.is_super_admin()
     and session_user not in ('postgres', 'service_role') then
    raise notice 'drain_notification_outbox: super_admin called without p_facility_id; draining all tenants';
  end if;

  create temp table if not exists _drain_claim (
    id uuid primary key,
    facility_id uuid,
    rule_id uuid,
    source_module text,
    source_record_id uuid,
    recipient_employee_id uuid,
    subject text,
    body text,
    pdf_url text,
    requires_acknowledgement boolean
  ) on commit drop;

  delete from _drain_claim;

  insert into _drain_claim (
    id, facility_id, rule_id, source_module, source_record_id,
    recipient_employee_id, subject, body, pdf_url, requires_acknowledgement
  )
  select id, facility_id, rule_id, source_module, source_record_id,
         recipient_employee_id, subject, body, pdf_url, requires_acknowledgement
  from public.notification_outbox
  where status = 'pending'
    and scheduled_for <= now()
    and (p_facility_id is null or facility_id = p_facility_id)
  order by scheduled_for asc
  limit greatest(p_max_rows, 1)
  for update skip locked;

  if not exists (select 1 from _drain_claim) then
    return query select 0, 0, 0;
    return;
  end if;

  for v_grp in
    select facility_id,
           coalesce(rule_id::text, '~no-rule~') as rule_bucket,
           coalesce(source_record_id::text, '~no-record~') as record_bucket,
           coalesce(subject, source_module) as subject_bucket
    from _drain_claim
    group by 1, 2, 3, 4
  loop
    -- One message per group. requires_acknowledgement is identical inside
    -- a group because all rows came from the same dispatch call against the
    -- same rule, so the representative row's value is authoritative.
    insert into public.communication_messages (
      facility_id, sender_employee_id, subject, body,
      requires_acknowledgement, pdf_url
    )
    select c.facility_id, null, c.subject, c.body,
           coalesce(c.requires_acknowledgement, false), c.pdf_url
    from _drain_claim c
    where c.facility_id = v_grp.facility_id
      and coalesce(c.rule_id::text, '~no-rule~') = v_grp.rule_bucket
      and coalesce(c.source_record_id::text, '~no-record~') = v_grp.record_bucket
      and coalesce(c.subject, c.source_module) = v_grp.subject_bucket
    limit 1
    returning id into v_msg_id;

    v_message_cnt := v_message_cnt + 1;

    insert into public.communication_recipients (
      facility_id, message_id, employee_id
    )
    select distinct c.facility_id, v_msg_id, c.recipient_employee_id
    from _drain_claim c
    where c.facility_id = v_grp.facility_id
      and coalesce(c.rule_id::text, '~no-rule~') = v_grp.rule_bucket
      and coalesce(c.source_record_id::text, '~no-record~') = v_grp.record_bucket
      and coalesce(c.subject, c.source_module) = v_grp.subject_bucket
    on conflict (message_id, employee_id) do nothing;

    select array_agg(c.id) into v_outbox_ids
    from _drain_claim c
    where c.facility_id = v_grp.facility_id
      and coalesce(c.rule_id::text, '~no-rule~') = v_grp.rule_bucket
      and coalesce(c.source_record_id::text, '~no-record~') = v_grp.record_bucket
      and coalesce(c.subject, c.source_module) = v_grp.subject_bucket;

    update public.notification_outbox
      set status = 'sent', sent_at = now()
    where id = any(v_outbox_ids);
  end loop;

  select count(*) into v_sent
  from public.notification_outbox o
  where o.id in (select id from _drain_claim)
    and o.status = 'sent';

  select count(*) into v_failed
  from public.notification_outbox o
  where o.id in (select id from _drain_claim)
    and o.status = 'failed';

  return query select v_sent, v_failed, v_message_cnt;
end;
$$;


--
-- Name: FUNCTION drain_notification_outbox(p_max_rows integer, p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.drain_notification_outbox(p_max_rows integer, p_facility_id uuid) IS 'Worker function: processes due notification_outbox rows by inserting into communication_messages/communication_recipients. p_facility_id NULL drains every tenant (cron behaviour); when set, the SELECT is scoped to that facility. Restricted to platform super_admins and the postgres/service_role session users.';


--
-- Name: effective_module_permission(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.effective_module_permission(p_employee_id uuid, p_module_key text) RETURNS public.module_permission_level
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_user_id     uuid;
  v_facility_id uuid;
  v_is_active   boolean;
  v_is_super    boolean;
  v_has_admin   boolean;
  v_has_edit    boolean;
  v_has_submit  boolean;
  v_has_view    boolean;
begin
  if p_employee_id is null or p_module_key is null then
    return 'none'::module_permission_level;
  end if;

  select e.user_id, e.facility_id, e.is_active
    into v_user_id, v_facility_id, v_is_active
  from public.employees e
  where e.id = p_employee_id;

  if not found or v_is_active is not true or v_user_id is null then
    return 'none'::module_permission_level;
  end if;

  if not public.is_super_admin() then
    if v_facility_id is null or v_facility_id <> public.current_facility_id() then
      return 'none'::module_permission_level;
    end if;
  end if;

  select u.is_super_admin into v_is_super from public.users u where u.id = v_user_id;
  if v_is_super then
    return 'admin'::module_permission_level;
  end if;

  select
    bool_or(action = 'admin'  and enabled),
    bool_or(action = 'edit'   and enabled),
    bool_or(action = 'submit' and enabled),
    bool_or(action = 'view'   and enabled)
    into v_has_admin, v_has_edit, v_has_submit, v_has_view
  from public.user_permissions
  where user_id     = v_user_id
    and facility_id = v_facility_id
    and module_name = p_module_key;

  if coalesce(v_has_admin,  false) then return 'admin'::module_permission_level;    end if;
  if coalesce(v_has_edit,   false) then return 'edit_all'::module_permission_level; end if;
  if coalesce(v_has_submit, false) then return 'submit'::module_permission_level;   end if;
  if coalesce(v_has_view,   false) then return 'view'::module_permission_level;     end if;
  return 'none'::module_permission_level;
end;
$$;


--
-- Name: FUNCTION effective_module_permission(p_employee_id uuid, p_module_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.effective_module_permission(p_employee_id uuid, p_module_key text) IS 'Resolves (employee, module). Returns ''none'' when the target employee is not in the caller''s facility (unless caller is super_admin). Walks override -> role default -> none.';


--
-- Name: effective_module_permission_with_source(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.effective_module_permission_with_source(p_employee_id uuid, p_module_key text, OUT level public.module_permission_level, OUT source text) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  level  := public.effective_module_permission(p_employee_id, p_module_key);
  source := case
    when level = 'none'::module_permission_level then 'none'
    when (select u.is_super_admin
            from public.employees e
            join public.users u on u.id = e.user_id
           where e.id = p_employee_id) then 'super_admin'
    else 'user_permissions'
  end;
end;
$$;


--
-- Name: FUNCTION effective_module_permission_with_source(p_employee_id uuid, p_module_key text, OUT level public.module_permission_level, OUT source text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.effective_module_permission_with_source(p_employee_id uuid, p_module_key text, OUT level public.module_permission_level, OUT source text) IS 'Like effective_module_permission() but also returns the tier that produced the level. Cross-facility callers (non-super_admin) get (none, none).';


--
-- Name: enforce_accident_witnesses_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_accident_witnesses_cap() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  current_count int;
begin
  select count(*) into current_count
    from public.accident_witnesses
    where accident_id = NEW.accident_id;
  if current_count >= 5 then
    raise exception 'Accident reports can have at most 5 witnesses';
  end if;
  return NEW;
end;
$$;


--
-- Name: enforce_daily_report_areas_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_daily_report_areas_cap() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION enforce_daily_report_areas_cap(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_daily_report_areas_cap() IS 'Trigger: raises if a facility would exceed 30 active daily_report_areas.';


--
-- Name: enforce_employee_job_area_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_employee_job_area_cap() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.employee_job_area_assignments
  where employee_id = new.employee_id;

  if v_count > 4 then
    raise exception
      'Employee % cannot be assigned more than 4 job areas (attempted %).',
      new.employee_id, v_count
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_employee_job_area_cap(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_employee_job_area_cap() IS 'Constraint-trigger guard: rejects inserts/updates that would give an employee more than 4 job-area assignments.';


--
-- Name: enforce_group_member_facility_match(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_group_member_facility_match() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_group_fac    uuid;
  v_employee_fac uuid;
begin
  select facility_id into v_group_fac
  from public.communication_groups
  where id = new.group_id;

  if v_group_fac is null then
    raise exception 'communication_group_members.group_id % does not exist',
      new.group_id;
  end if;

  if v_group_fac <> new.facility_id then
    raise exception
      'communication_group_members.facility_id (%) does not match group facility (%)',
      new.facility_id, v_group_fac;
  end if;

  select facility_id into v_employee_fac
  from public.employees
  where id = new.employee_id;

  if v_employee_fac is null then
    raise exception 'communication_group_members.employee_id % does not exist',
      new.employee_id;
  end if;

  if v_employee_fac <> new.facility_id then
    raise exception
      'communication_group_members.facility_id (%) does not match employee facility (%)',
      new.facility_id, v_employee_fac;
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION enforce_group_member_facility_match(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_group_member_facility_match() IS 'BEFORE INSERT/UPDATE trigger: ensures the group and employee referenced by a communication_group_members row both live in the same facility as the row itself. Closes a gap in the RLS policy where only the row''s own facility_id was checked. Applies to all writers including service-role.';


--
-- Name: enforce_ice_depth_layouts_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_ice_depth_layouts_cap() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_count int;
begin
  if new.is_active is true then
    select count(*) into v_count
      from public.ice_depth_layouts
     where facility_id = new.facility_id
       and is_active = true
       and (tg_op = 'INSERT' or id <> new.id);
    if v_count >= 8 then
      raise exception 'Facility % already has 8 active ice_depth_layouts (max).', new.facility_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION enforce_ice_depth_layouts_cap(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_ice_depth_layouts_cap() IS 'Trigger: raises if a facility would exceed 8 active ice_depth_layouts. Skipped when is_active is being toggled off.';


--
-- Name: enforce_ice_depth_points_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_ice_depth_points_cap() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_count int;
begin
  if new.is_active is true then
    select count(*) into v_count
      from public.ice_depth_points
     where layout_id = new.layout_id
       and is_active = true
       and (tg_op = 'INSERT' or id <> new.id);
    if v_count >= 60 then
      raise exception 'Layout % already has 60 active ice_depth_points (max).', new.layout_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION enforce_ice_depth_points_cap(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_ice_depth_points_cap() IS 'Trigger: raises if a layout would exceed 60 active ice_depth_points. Skipped when is_active is being toggled off.';


--
-- Name: enforce_incident_witnesses_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_incident_witnesses_cap() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  current_count int;
begin
  select count(*) into current_count
    from public.incident_witnesses
    where incident_id = NEW.incident_id;
  if current_count >= 3 then
    raise exception 'Incident reports can have at most 3 witnesses';
  end if;
  return NEW;
end;
$$;


--
-- Name: enforce_recipient_delivery_column_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_recipient_delivery_column_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.email_status            is distinct from old.email_status
     or new.email_sent_at        is distinct from old.email_sent_at
     or new.email_error          is distinct from old.email_error
     or new.email_attempts       is distinct from old.email_attempts
     or new.email_next_attempt_at is distinct from old.email_next_attempt_at
     or new.email_claim_token    is distinct from old.email_claim_token
     or new.delivered_at         is distinct from old.delivered_at
  then
    -- Service-role / postgres sessions (the send + drain crons) carry no JWT
    -- subject; comms admins run the Deliveries-tab retry under their own
    -- session and legitimately reset email_status / email_attempts.
    if auth.uid() is null
       or public.is_super_admin()
       or public.has_module_admin_access('communications')
    then
      return new;
    end if;
    raise exception
      'communication_recipients delivery columns are managed by the delivery pipeline';
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION enforce_recipient_delivery_column_guard(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_recipient_delivery_column_guard() IS 'BEFORE UPDATE trigger on communication_recipients: RLS lets a recipient update their own row (read_at / acknowledged_at), but Postgres RLS has no column granularity, so this trigger rejects changes to the email-delivery state columns unless the writer is the service role, a super admin, or a communications admin.';


--
-- Name: get_employee_counts_by_facility(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_employee_counts_by_facility() RETURNS TABLE(facility_id uuid, employee_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select e.facility_id, count(*)::bigint as employee_count
  from public.employees e
  where public.is_super_admin()
     or e.facility_id = public.current_facility_id()
  group by e.facility_id;
$$;


--
-- Name: FUNCTION get_employee_counts_by_facility(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_employee_counts_by_facility() IS 'One row per facility with the total employee count. Super-admins see every facility; everyone else sees only their own (SECURITY DEFINER would otherwise leak cross-tenant counts). Used by admin/facility and admin/super-admin pages.';


--
-- Name: guard_users_profile_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_users_profile_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  -- Internal / service-role / migration flows (no end-user JWT) are exempt;
  -- RLS does not apply to them either.
  if auth.uid() is null then
    return new;
  end if;

  -- Super admins may change anything.
  if public.is_super_admin() then
    return new;
  end if;

  -- Only super admins may EVER change super-admin status or a user id,
  -- regardless of facility-admin status. This is the fix for D-01: the check
  -- runs BEFORE the facility-admin exemption below.
  if new.id is distinct from old.id
     or new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'Only super admins may modify super-admin status'
      using errcode = '42501';
  end if;

  -- Facility admins may still change the remaining privileged columns
  -- (activate/deactivate, move facility) for users in their facility.
  if public.is_facility_admin(old.facility_id) then
    return new;
  end if;

  -- Everyone else (self-service / supervisor profile edits) must not be able
  -- to toggle active status or relocate a user.
  if new.is_active   is distinct from old.is_active
     or new.facility_id is distinct from old.facility_id then
    raise exception 'Not allowed to modify privileged account fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION guard_users_profile_update(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_users_profile_update() IS 'BEFORE UPDATE guard on public.users: blocks non-admin edits from changing id / is_super_admin / is_active / facility_id (privilege escalation).';


--
-- Name: has_area_access(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_area_access(p_module_key text, p_area_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select
    p_module_key is not null
    and p_area_id is not null
    and (
      public.is_super_admin()
      or public.has_module_admin_access(p_module_key)
      or (
        public.has_module_access(p_module_key)
        and (
          -- No explicit per-area rows for this employee+module -> full access.
          not exists (
            select 1
              from public.module_area_permissions map
              join public.employees e on e.id = map.employee_id
             where e.user_id     = auth.uid()
               and e.is_active   = true
               and map.module_key = p_module_key
          )
          -- Otherwise require a matching area row with can_view = true.
          or exists (
            select 1
              from public.module_area_permissions map
              join public.employees e on e.id = map.employee_id
             where e.user_id     = auth.uid()
               and e.is_active   = true
               and map.module_key = p_module_key
               and map.area_id    = p_area_id
               and map.can_view   = true
          )
        )
      )
    );
$$;


--
-- Name: FUNCTION has_area_access(p_module_key text, p_area_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_area_access(p_module_key text, p_area_id uuid) IS 'True if super admin, module admin (user_permissions admin), OR the user has module view (user_permissions) AND either has no per-area rows for this module (full access) or an explicit module_area_permissions row with can_view = true for the area. Module-level checks migrated to user_permissions in migration 90; per-area source stays module_area_permissions.';


--
-- Name: has_area_submit_access(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_area_submit_access(p_module_key text, p_area_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select
    p_module_key is not null
    and p_area_id is not null
    and (
      public.is_super_admin()
      or public.has_module_admin_access(p_module_key)
      or (
        -- Module-level submit via user_permissions (was module_permissions path).
        exists (
          select 1
            from public.user_permissions up
           where up.user_id     = auth.uid()
             and up.facility_id = public.current_facility_id()
             and up.module_name = p_module_key
             and up.action      = 'submit'::public.user_action
             and up.enabled     = true
        )
        and (
          -- No explicit per-area rows for this employee+module -> full access.
          not exists (
            select 1
              from public.module_area_permissions map
              join public.employees e on e.id = map.employee_id
             where e.user_id     = auth.uid()
               and e.is_active   = true
               and map.module_key = p_module_key
          )
          -- Otherwise require a matching area row with can_submit = true.
          or exists (
            select 1
              from public.module_area_permissions map
              join public.employees e on e.id = map.employee_id
             where e.user_id     = auth.uid()
               and e.is_active   = true
               and map.module_key = p_module_key
               and map.area_id    = p_area_id
               and map.can_submit = true
          )
        )
      )
    );
$$;


--
-- Name: FUNCTION has_area_submit_access(p_module_key text, p_area_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_area_submit_access(p_module_key text, p_area_id uuid) IS 'True iff the caller may SUBMIT in the given area for the module: super admin, module admin, OR module-level `submit` (user_permissions) AND either no per-area rows for this module (full access) or a matching module_area_permissions row with can_submit = true. Module-level gate migrated to user_permissions in migration 90.';


--
-- Name: has_module_access(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_module_access(p_module_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select
    p_module_key is not null
    and (
      public.is_super_admin()
      or exists (
        select 1
          from public.user_permissions up
         where up.user_id     = auth.uid()
           and up.facility_id = public.current_facility_id()
           and up.module_name = p_module_key
           and up.enabled     = true
      )
    );
$$;


--
-- Name: FUNCTION has_module_access(p_module_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_module_access(p_module_key text) IS 'True if super admin OR the current user has ANY enabled grant (view / submit / edit / admin) on the named module at their current facility (public.user_permissions). Any enabled action implies the user must be able to read the module''s config, so the read gate is no longer view-only (migration 123, was view-only in migration 91).';


--
-- Name: has_module_admin_access(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_module_admin_access(p_module_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select
    p_module_key is not null
    and (
      public.is_super_admin()
      or exists (
        select 1
          from public.user_permissions up
         where up.user_id     = auth.uid()
           and up.facility_id = public.current_facility_id()
           and up.module_name = p_module_key
           and up.action      = 'admin'::public.user_action
           and up.enabled     = true
      )
    );
$$;


--
-- Name: FUNCTION has_module_admin_access(p_module_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_module_admin_access(p_module_key text) IS 'True if super admin OR the current user has an enabled `admin` grant on the named module at their current facility (public.user_permissions). Migrated off the deprecated module_permissions table in migration 90.';


--
-- Name: hide_dashboard_module(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hide_dashboard_module(p_module_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.employees
     set hidden_modules =
           case
             when hidden_modules @> array[p_module_key]
               then hidden_modules
             else array_append(hidden_modules, p_module_key)
           end
   where user_id  = auth.uid()
     and is_active = true;
end;
$$;


--
-- Name: FUNCTION hide_dashboard_module(p_module_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.hide_dashboard_module(p_module_key text) IS 'Adds a module key to the caller''s own employees.hidden_modules array. No-op if already hidden. Only affects rows where user_id = auth.uid() and is_active = true.';


--
-- Name: is_facility_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_facility_admin(p_facility_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.user_permissions
    where user_id     = auth.uid()
      and facility_id = p_facility_id
      and module_name = 'admin'
      and action      = 'admin'
      and enabled     = true
  );
$$;


--
-- Name: FUNCTION is_facility_admin(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_facility_admin(p_facility_id uuid) IS 'True iff the calling user has the admin action on the admin module for the given facility. SECURITY DEFINER to avoid recursing into user_permissions RLS.';


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select u.is_super_admin from public.users u where u.id = auth.uid()),
    false
  );
$$;


--
-- Name: FUNCTION is_super_admin(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_super_admin() IS 'True if the current user has the cross-tenant super_admin flag.';


--
-- Name: purge_module_data(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_module_data(p_facility_id uuid, p_module_key text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_keep_days integer;
  v_cutoff    timestamptz;
  v_deleted   integer;
  v_total     integer := 0;
begin
  if not (
    public.is_super_admin()
    or public.is_facility_admin(p_facility_id)
  ) then
    raise exception 'Not authorized to purge data for this facility.';
  end if;

  if p_module_key = 'scheduling' then
    raise exception 'Manual purge is not supported for scheduling.';
  end if;

  if p_module_key = 'audit_logs' then
    -- Fixed compliance window; not configurable via retention_settings.
    delete from public.audit_logs
     where facility_id = p_facility_id
       and created_at < now() - interval '7 years';
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  select keep_days into v_keep_days
    from public.retention_settings
   where facility_id = p_facility_id
     and module_key = p_module_key;

  if v_keep_days is null then
    raise exception 'No retention rule configured for this module. Save one first.';
  end if;
  if v_keep_days = 0 then
    raise exception 'Retention for this module is set to keep records forever.';
  end if;

  v_cutoff := now() - (v_keep_days || ' days')::interval;

  case p_module_key
    when 'daily_reports' then
      delete from public.daily_report_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'communications' then
      delete from public.communication_messages
       where facility_id = p_facility_id and sent_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_alerts
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

      delete from public.communication_audit_log
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'accident_reports' then
      delete from public.accident_reports
       where facility_id = p_facility_id and created_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'incident_reports' then
      delete from public.incident_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'refrigeration' then
      delete from public.refrigeration_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'air_quality' then
      delete from public.air_quality_reports
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_operations' then
      delete from public.ice_operations_submissions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    when 'ice_depth' then
      delete from public.ice_depth_sessions
       where facility_id = p_facility_id and submitted_at < v_cutoff;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;

    else
      raise exception 'Unknown module key: %', p_module_key;
  end case;

  return v_total;
end;
$$;


--
-- Name: FUNCTION purge_module_data(p_facility_id uuid, p_module_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.purge_module_data(p_facility_id uuid, p_module_key text) IS 'Facility-scoped manual purge for the admin Retention module. Authorization enforced internally (super admin or facility admin); keep_days read from retention_settings ignoring auto_purge; audit_logs fixed at 7 years.';


--
-- Name: purge_old_accident_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_accident_reports() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'accident_reports'
       and auto_purge = true
  loop
    delete from public.accident_reports
     where facility_id = v_row.facility_id
       and created_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;


--
-- Name: purge_old_air_quality_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_air_quality_reports() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'air_quality'
       and auto_purge = true
  loop
    delete from public.air_quality_reports
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;


--
-- Name: purge_old_audit_logs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_audit_logs() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_deleted integer;
begin
  delete from public.audit_logs
   where created_at < now() - interval '7 years';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


--
-- Name: purge_old_communications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_communications() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'communications'
       and auto_purge = true
  loop
    delete from public.communication_messages
     where facility_id = v_row.facility_id
       and sent_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.communication_alerts
     where facility_id = v_row.facility_id
       and created_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;

    delete from public.communication_audit_log
     where facility_id = v_row.facility_id
       and created_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;


--
-- Name: FUNCTION purge_old_communications(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.purge_old_communications() IS 'Deletes communication_messages, communication_alerts, and communication_audit_log rows older than 1 year. Cascades to recipients and acknowledgements. Schedule via Supabase Cron (pg_cron) - not auto-scheduled by this migration.';


--
-- Name: purge_old_daily_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_daily_reports() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'daily_reports'
       and auto_purge = true
  loop
    delete from public.daily_report_submissions
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;


--
-- Name: FUNCTION purge_old_daily_reports(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.purge_old_daily_reports() IS 'Deletes daily_report_submissions older than 14 days (cascades to items + notes). Schedule via Supabase Cron (pg_cron) - not auto-scheduled by this migration.';


--
-- Name: purge_old_ice_depth_sessions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_ice_depth_sessions() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'ice_depth'
       and auto_purge = true
  loop
    delete from public.ice_depth_sessions
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;


--
-- Name: FUNCTION purge_old_ice_depth_sessions(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.purge_old_ice_depth_sessions() IS 'Nightly retention worker for ice_depth (mirrors migration 24). Deletes ice_depth_sessions older than keep_days for auto_purge facilities; children cascade. Invoked by the run-retention-purge cron as service_role.';


--
-- Name: purge_old_ice_operations_submissions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_ice_operations_submissions() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'ice_operations'
       and auto_purge = true
  loop
    delete from public.ice_operations_submissions
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;


--
-- Name: purge_old_incident_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_incident_reports() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'incident_reports'
       and auto_purge = true
  loop
    delete from public.incident_reports
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;


--
-- Name: purge_old_notification_outbox(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_notification_outbox() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
begin
  delete from public.notification_outbox
   where status in ('sent', 'cancelled')
     and coalesce(sent_at, updated_at, created_at) < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.notification_outbox
   where status = 'failed'
     and coalesce(updated_at, created_at) < now() - interval '180 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  return v_total;
end;
$$;


--
-- Name: FUNCTION purge_old_notification_outbox(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.purge_old_notification_outbox() IS 'Retention purge for terminal notification_outbox rows: sent/cancelled > 90 days, failed > 180 days. Pending rows are never touched. service_role only; invoked by /api/cron/run-retention-purge.';


--
-- Name: purge_old_offline_sync_queue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_offline_sync_queue() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
begin
  delete from public.offline_sync_queue
   where sync_status = 'synced'
     and coalesce(synced_at, created_at) < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.offline_sync_queue
   where sync_status = 'failed'
     and created_at < now() - interval '180 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  return v_total;
end;
$$;


--
-- Name: FUNCTION purge_old_offline_sync_queue(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.purge_old_offline_sync_queue() IS 'Retention purge for terminal offline_sync_queue rows: synced > 90 days, failed > 180 days. Pending rows are never touched (they may still replay). service_role only; invoked by /api/cron/run-retention-purge.';


--
-- Name: purge_old_rate_limit_counters(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_rate_limit_counters() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_deleted integer;
begin
  -- Anything older than a day is far past any window we use (largest window is
  -- 10 minutes for the lead form). Keep a generous margin.
  delete from public.rate_limit_counters
  where window_start < (clock_timestamp() - interval '1 day');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


--
-- Name: FUNCTION purge_old_rate_limit_counters(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.purge_old_rate_limit_counters() IS 'Deletes rate_limit_counters rows whose window closed more than a day ago. Service-role only; intended to run from the retention sweep.';


--
-- Name: purge_old_refrigeration_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_refrigeration_reports() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_total   integer := 0;
  v_deleted integer;
  v_row     record;
begin
  for v_row in
    select facility_id, keep_days
      from public.retention_settings
     where module_key = 'refrigeration'
       and auto_purge = true
  loop
    delete from public.refrigeration_reports
     where facility_id = v_row.facility_id
       and submitted_at < now() - (v_row.keep_days || ' days')::interval;
    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;


--
-- Name: rate_limit_information_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rate_limit_information_requests() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  -- Per-email bucket: 5 submissions/hour, mirroring the route's per-IP cap.
  if not public.check_rate_limit(
    'information_requests_email', lower(new.email), 5, 3600
  ) then
    raise exception 'Too many requests. Please try again later.'
      using errcode = 'P0001';
  end if;
  -- Coarse global bucket so rotating emails cannot bypass the per-email cap:
  -- 100 submissions/hour across the whole table (a legitimate marketing page
  -- for a pre-launch product is nowhere near this; raise it when it is).
  if not public.check_rate_limit(
    'information_requests_global', 'all', 100, 3600
  ) then
    raise exception 'Too many requests. Please try again later.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION rate_limit_information_requests(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.rate_limit_information_requests() IS 'BEFORE INSERT on information_requests: fixed-window rate limits (5/hour per email, 100/hour global) via check_rate_limit(). Closes the direct-PostgREST bypass of the API route''s per-IP limit — the anon key is public, so the table itself must meter writes.';


--
-- Name: reactivate_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reactivate_role(p_role_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
      and public.current_user_role() in ('admin', 'gm', 'super_admin')
    )
  ) then
    return false;
  end if;

  update public.roles
    set is_active = true, deactivated_at = null
  where id = p_role_id;

  return true;
end;
$$;


--
-- Name: reapply_role_defaults_for_role(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reapply_role_defaults_for_role(p_facility_id uuid, p_role_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_count integer := 0;
  v_user  uuid;
begin
  if not (public.is_super_admin() or public.is_facility_admin(p_facility_id)) then
    raise exception 'reapply_role_defaults_for_role: not authorized';
  end if;

  for v_user in
    select distinct e.user_id
    from public.employees e
    where e.facility_id = p_facility_id
      and e.role_id = p_role_id
      and e.user_id is not null
      and e.is_active = true
  loop
    perform public.apply_role_permission_defaults(v_user, p_facility_id, p_role_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


--
-- Name: FUNCTION reapply_role_defaults_for_role(p_facility_id uuid, p_role_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reapply_role_defaults_for_role(p_facility_id uuid, p_role_id uuid) IS 'Admin-guarded. Re-applies role_permission_defaults to all active employees holding the role (preserves manual_override rows). Use after editing a role''s default matrix.';


--
-- Name: resolve_rule_recipients(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_rule_recipients(p_rule_id uuid) RETURNS TABLE(employee_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
  -- Qualify with the subquery alias: the RETURN TABLE OUT column is also named
  -- employee_id, so an unqualified reference is ambiguous (plpgsql
  -- variable_conflict). Behaviour-preserving — still the all_targets column.
  select distinct all_targets.employee_id
  from (
    select * from via_employee
    union all select * from via_role
    union all select * from via_department
    union all select * from via_group
  ) all_targets
  where all_targets.employee_id is not null;
end;
$$;


--
-- Name: FUNCTION resolve_rule_recipients(p_rule_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.resolve_rule_recipients(p_rule_id uuid) IS 'Expands a routing rule''s target_* columns to a unique set of active employee_ids. Includes a facility check (is_super_admin OR rule.facility_id = current_facility_id), but that check is DEFENCE IN DEPTH only — the primary tenant gate for dispatch lives in dispatch_rules_for_submission (migration 49). Future refactors that add a wrapper around this function must NOT rely on the inner check.';


--
-- Name: schedule_shifts_publish_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_shifts_publish_lock() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  -- Governed contexts may mutate / create a published shift:
  --   * SECURITY DEFINER scheduling RPCs run as the table owner ('postgres');
  --   * trusted backend roles (service_role / supabase_admin);
  --   * an explicit transaction-local bypass flag set by a governed writer
  --     (select set_config('rr.publish_lock_bypass','on',true)).
  -- A direct write from an end-user role — i.e. the grid/edit/create server
  -- actions or a crafted request — is rejected.
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- INSERT: a brand-new shift must be a draft. Publishing happens only through
  -- the governed two-person publish-request RPC (draft -> published UPDATE,
  -- which runs as the table owner). Minting a 'published' row directly is the
  -- create-leg of the publish-lock bypass.
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      raise exception
        'Schedule is published and locked: a published shift cannot be created directly. Create a draft and publish it through the publish-request approval.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception
        'Schedule is published and locked: a published shift cannot be deleted directly. Cancel it through the scheduling tools or republish.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE: only a row that is ALREADY published is locked. Publishing a draft
  -- (old.status='draft' -> 'published') is how the publish RPC works, so it is
  -- allowed.
  if old.status = 'published' then
    raise exception
      'Schedule is published and locked: edits to a published shift require an explicit republish by a facility manager.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION schedule_shifts_publish_lock(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.schedule_shifts_publish_lock() IS 'Publish-lock backstop: rejects a direct INSERT of a published row, and a direct UPDATE/DELETE of an already-published row, from an end-user PostgREST role. Governed SECURITY DEFINER RPCs (run as the table owner) and trusted backend roles are allowed, so swap/claim/publish/cancel/open-fill keep working. Closes the publish-lock bypass (create + edit + delete legs).';


--
-- Name: schedule_swap_set_expiry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_swap_set_expiry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_hours int; v_shift_start timestamptz;
begin
  if new.expires_at is null then
    select swap_expiry_hours into v_hours from public.schedule_settings where facility_id = new.facility_id;
    select starts_at into v_shift_start from public.schedule_shifts where id = new.requester_shift_id;
    new.expires_at := least(coalesce(new.created_at, now()) + make_interval(hours => coalesce(v_hours, 72)), v_shift_start);
  end if;
  return new;
end $$;


--
-- Name: scheduling_admin_assign_open_shift(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_admin_assign_open_shift(p_open_shift_id uuid, p_employee_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_open        public.schedule_open_shifts%rowtype;
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
  v_updated     int;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_assign_open_shift: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_open from public.schedule_open_shifts where id = p_open_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Open shift not found.');
  end if;
  if not public.is_super_admin() and v_open.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_assign_open_shift: listing belongs to another facility'
      using errcode = '42501';
  end if;
  if v_open.claim_status not in ('open', 'claimed') then
    return jsonb_build_object('ok', false, 'error', 'Open shift is no longer available.');
  end if;

  select * into v_shift from public.schedule_shifts where id = v_open.shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Parent shift not found.');
  end if;

  if not exists (
    select 1 from public.employees e
     where e.id = p_employee_id and e.facility_id = v_open.facility_id
  ) then
    return jsonb_build_object('ok', false, 'error',
      'That employee isn''t part of your facility.');
  end if;

  -- Hard block: re-validate (cert / overtime / time-off / overlap / ...).
  v_codes := public.scheduling_assignment_violations(
    v_open.facility_id, p_employee_id,
    v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
    v_shift.job_area_id, v_shift.id);
  if array_length(v_codes, 1) is not null then
    return jsonb_build_object('ok', false, 'error', 'not_assignable',
      'violations', to_jsonb(v_codes));
  end if;

  update public.schedule_shifts
     set employee_id = p_employee_id
   where id = v_open.shift_id and employee_id is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error',
      'That shift was already assigned to someone else.');
  end if;

  update public.schedule_open_shifts
     set claim_status            = 'filled',
         claimed_by_employee_id  = p_employee_id,
         claimed_at              = now(),
         approved_by_employee_id = v_employee_id,
         approved_at             = now()
   where id = p_open_shift_id;

  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: FUNCTION scheduling_admin_assign_open_shift(p_open_shift_id uuid, p_employee_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_admin_assign_open_shift(p_open_shift_id uuid, p_employee_id uuid) IS 'Admin direct-assign of an open (published, unassigned) shift to an employee. SECURITY DEFINER (so it works under the publish-lock), facility-scoped, scheduling-admin gated, and hard-block re-validated via scheduling_assignment_violations. Returns jsonb {ok, error?, violations?}.';


--
-- Name: scheduling_admin_cancel_shift(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_admin_cancel_shift(p_shift_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_facility_id uuid := public.current_facility_id();
  v_shift       public.schedule_shifts%rowtype;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_cancel_shift: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_shift from public.schedule_shifts where id = p_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Shift not found.');
  end if;
  if not public.is_super_admin() and v_shift.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_cancel_shift: shift belongs to another facility'
      using errcode = '42501';
  end if;
  if v_shift.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;

  update public.schedule_shifts set status = 'cancelled' where id = p_shift_id;

  -- Tell the affected employee (if the shift was assigned).
  if v_shift.employee_id is not null then
    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, payload)
    values
      (v_shift.facility_id, v_shift.employee_id, 'shift_changed', p_shift_id,
       jsonb_build_object('message', 'A shift of yours was cancelled by a manager.'));
  end if;

  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: FUNCTION scheduling_admin_cancel_shift(p_shift_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_admin_cancel_shift(p_shift_id uuid) IS 'Admin cancel of a shift (draft or published). SECURITY DEFINER so a published shift can be cancelled through this governed path while the publish-lock trigger still rejects direct edits. Facility-scoped + scheduling-admin gated. Notifies the assigned employee (shift_changed) when the cancelled shift had one.';


--
-- Name: scheduling_admin_edit_published_shift(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, integer, text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_admin_edit_published_shift(p_shift_id uuid, p_employee_id uuid, p_job_area_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_break_minutes integer, p_role_label text, p_notes text, p_override_cert boolean DEFAULT false, p_override_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
  v_cert        text[];
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_edit_published_shift: scheduling admin required'
      using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'error', 'End must be after start.');
  end if;

  select * into v_shift from public.schedule_shifts where id = p_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Shift not found.');
  end if;
  if not public.is_super_admin() and v_shift.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_edit_published_shift: shift belongs to another facility'
      using errcode = '42501';
  end if;
  if v_shift.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'not_published');
  end if;

  -- Referenced employee / job area must belong to the shift's facility (the FKs
  -- don't enforce this).
  if p_employee_id is not null and not exists (
    select 1 from public.employees e
     where e.id = p_employee_id and e.facility_id = v_shift.facility_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'That employee isn''t part of your facility.');
  end if;
  if p_job_area_id is not null and not exists (
    select 1 from public.employee_job_areas j
     where j.id = p_job_area_id and j.facility_id = v_shift.facility_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'That job area isn''t part of your facility.');
  end if;

  -- Re-validate the candidate assignment, excluding this shift from its own
  -- weekly-hours / overlap / min-rest math.
  v_codes := public.scheduling_assignment_violations(
    v_shift.facility_id, p_employee_id,
    p_starts_at, p_ends_at, coalesce(p_break_minutes, 0),
    p_job_area_id, p_shift_id);

  -- Cert gaps hard-block unless a manager explicitly overrides (and we log it).
  select coalesce(array_agg(c), '{}') into v_cert
    from unnest(v_codes) as c where c like 'cert_missing:%';
  if array_length(v_cert, 1) is not null then
    if not p_override_cert then
      return jsonb_build_object('ok', false, 'error', 'cert_blocked',
        'violations', to_jsonb(v_cert));
    end if;
    perform public.scheduling_log_cert_override(
      p_employee_id, p_job_area_id, v_cert, p_shift_id, p_override_reason);
  end if;

  update public.schedule_shifts
     set employee_id              = p_employee_id,
         job_area_id              = p_job_area_id,
         starts_at                = p_starts_at,
         ends_at                  = p_ends_at,
         break_minutes            = coalesce(p_break_minutes, 0),
         role_label               = p_role_label,
         notes                    = p_notes,
         published_at             = now(),
         published_by_employee_id = v_employee_id
   where id = p_shift_id;

  -- Notify the affected employee(s) their published shift changed.
  insert into public.schedule_notifications
    (facility_id, employee_id, notification_type, shift_id, payload)
  select v_shift.facility_id, emp, 'shift_changed', p_shift_id,
         jsonb_build_object('message', 'A published shift of yours was updated by a manager.')
    from (
      select distinct emp from unnest(array[v_shift.employee_id, p_employee_id]) as emp
       where emp is not null
    ) recipients;

  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: FUNCTION scheduling_admin_edit_published_shift(p_shift_id uuid, p_employee_id uuid, p_job_area_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_break_minutes integer, p_role_label text, p_notes text, p_override_cert boolean, p_override_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_admin_edit_published_shift(p_shift_id uuid, p_employee_id uuid, p_job_area_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_break_minutes integer, p_role_label text, p_notes text, p_override_cert boolean, p_override_reason text) IS 'Governed republish-edit of a PUBLISHED shift. Scheduling-admin gated + facility-scoped, SECURITY DEFINER (writes through the publish-lock). Hard-blocks a missing/expired required cert unless p_override_cert (then logged via scheduling_log_cert_override). Applies the full field set, re-stamps publish metadata, notifies affected employees. Returns jsonb {ok, error?, violations?}.';


--
-- Name: scheduling_apply_swap(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_apply_swap(p_swap_id uuid, p_decision_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_swap        public.schedule_swap_requests%rowtype;
  v_req_shift   public.schedule_shifts%rowtype;
  v_tgt_shift   public.schedule_shifts%rowtype;
  v_codes       text[];
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_apply_swap: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_swap
    from public.schedule_swap_requests
   where id = p_swap_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Swap request not found.');
  end if;
  if not public.is_super_admin() and v_swap.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_apply_swap: swap belongs to another facility'
      using errcode = '42501';
  end if;
  if v_swap.status not in ('pending', 'accepted') then
    return jsonb_build_object('ok', false, 'error',
      format('Swap is already %s.', v_swap.status));
  end if;
  if v_swap.target_employee_id is null then
    return jsonb_build_object('ok', false, 'error',
      'Assign a target employee before approving.');
  end if;

  -- Lock both shifts in a stable order (avoids deadlock with a concurrent
  -- apply touching the same pair), then verify the swap's snapshot is fresh.
  perform 1
     from public.schedule_shifts
    where id in (v_swap.requester_shift_id, v_swap.target_shift_id)
    order by id
      for update;

  select * into v_req_shift
    from public.schedule_shifts where id = v_swap.requester_shift_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'The requester''s shift no longer exists.');
  end if;
  if v_req_shift.facility_id <> v_swap.facility_id then
    return jsonb_build_object('ok', false, 'error', 'Requester shift belongs to another facility.');
  end if;
  if v_req_shift.employee_id is distinct from v_swap.requester_employee_id then
    return jsonb_build_object('ok', false, 'error',
      'The requester''s shift was reassigned after this swap was filed. Deny or cancel the swap.');
  end if;

  if v_swap.target_shift_id is not null then
    select * into v_tgt_shift
      from public.schedule_shifts where id = v_swap.target_shift_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'The target''s shift no longer exists.');
    end if;
    if v_tgt_shift.facility_id <> v_swap.facility_id then
      return jsonb_build_object('ok', false, 'error', 'Target shift belongs to another facility.');
    end if;
    if v_tgt_shift.employee_id is distinct from v_swap.target_employee_id then
      return jsonb_build_object('ok', false, 'error',
        'The target''s shift was reassigned after this swap was filed. Deny or cancel the swap.');
    end if;
  end if;

  -- Hard block: validate each employee against the shift they are moving onto,
  -- excluding BOTH traded shifts so the counterpart doesn't false-positive
  -- double-booking / weekly hours / min-rest.
  v_codes := public.scheduling_assignment_violations(
    v_swap.facility_id, v_swap.target_employee_id,
    v_req_shift.starts_at, v_req_shift.ends_at, v_req_shift.break_minutes,
    v_req_shift.job_area_id, v_req_shift.id, v_swap.target_shift_id);
  if array_length(v_codes, 1) is not null then
    return jsonb_build_object('ok', false,
      'error', 'target_not_assignable', 'violations', to_jsonb(v_codes));
  end if;

  if v_swap.target_shift_id is not null then
    v_codes := public.scheduling_assignment_violations(
      v_swap.facility_id, v_swap.requester_employee_id,
      v_tgt_shift.starts_at, v_tgt_shift.ends_at, v_tgt_shift.break_minutes,
      v_tgt_shift.job_area_id, v_tgt_shift.id, v_req_shift.id);
    if array_length(v_codes, 1) is not null then
      return jsonb_build_object('ok', false,
        'error', 'requester_not_assignable', 'violations', to_jsonb(v_codes));
    end if;
  end if;

  -- Apply. target_shift_id NULL = one-way coverage: the target simply takes
  -- over the requester's shift.
  update public.schedule_shifts
     set employee_id = v_swap.target_employee_id
   where id = v_req_shift.id;

  if v_swap.target_shift_id is not null then
    update public.schedule_shifts
       set employee_id = v_swap.requester_employee_id
     where id = v_tgt_shift.id;
  end if;

  update public.schedule_swap_requests
     set status                       = 'manager_approved',
         approved_at                  = now(),
         decided_at                   = now(),
         manager_approver_employee_id = v_employee_id,
         decision_note                = coalesce(nullif(btrim(p_decision_note), ''), decision_note)
   where id = p_swap_id;

  insert into public.schedule_notifications
    (facility_id, employee_id, notification_type, swap_id, payload)
  values
    (v_swap.facility_id, v_swap.requester_employee_id, 'swap_approved', p_swap_id,
     jsonb_build_object('role', 'requester')),
    (v_swap.facility_id, v_swap.target_employee_id, 'swap_approved', p_swap_id,
     jsonb_build_object('role', 'target'));

  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: FUNCTION scheduling_apply_swap(p_swap_id uuid, p_decision_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_apply_swap(p_swap_id uuid, p_decision_note text) IS 'Admin swap approval. Atomically locks the swap + both shifts, verifies the swap snapshot is not stale, hard-block validates both directions (excluding both traded shifts), exchanges employee_ids (or applies one-way coverage when target_shift_id is null), marks the swap manager_approved, and notifies both employees. Returns jsonb {ok, error?, violations?}.';


--
-- Name: scheduling_approve_publish_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_approve_publish_request(p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_req         public.schedule_publish_requests%rowtype;
  v_settings    public.schedule_settings%rowtype;
  v_ids         uuid[];
  v_shift       record;
  v_codes       text[];
  v_blocked     int := 0;
  v_count       int := 0;
  v_open_count  int := 0;
  v_event_id    uuid;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_approve_publish_request: scheduling admin required'
      using errcode = '42501';
  end if;
  if v_employee_id is null then
    return jsonb_build_object('ok', false, 'error',
      'No active employee record for your account.');
  end if;

  select * into v_req
    from public.schedule_publish_requests
   where id = p_request_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;
  if not public.is_super_admin() and v_req.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_approve_publish_request: request belongs to another facility'
      using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error',
      format('Request is already %s.', v_req.status));
  end if;
  if v_req.requested_by_employee_id = v_employee_id then
    return jsonb_build_object('ok', false, 'error',
      'You cannot approve your own publish request.');
  end if;

  -- Lock the drafts in range so a concurrent edit can't slip between
  -- validation and publish.
  perform 1
     from public.schedule_shifts
    where facility_id = v_req.facility_id
      and status = 'draft'
      and starts_at >= v_req.range_starts_at
      and starts_at <  v_req.range_ends_at
    order by id
      for update;

  select array_agg(id) into v_ids
    from public.schedule_shifts
   where facility_id = v_req.facility_id
     and status = 'draft'
     and starts_at >= v_req.range_starts_at
     and starts_at <  v_req.range_ends_at;

  if v_ids is null then
    return jsonb_build_object('ok', false, 'error',
      'No draft shifts remain in range. Reject this request instead.');
  end if;

  -- Hard block: re-validate every assigned draft before publishing.
  for v_shift in
    select id, employee_id, starts_at, ends_at, break_minutes, job_area_id
      from public.schedule_shifts
     where id = any(v_ids)
       and employee_id is not null
  loop
    v_codes := public.scheduling_assignment_violations(
      v_req.facility_id, v_shift.employee_id,
      v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
      v_shift.job_area_id, v_shift.id);
    if array_length(v_codes, 1) is not null then
      v_blocked := v_blocked + 1;
    end if;
  end loop;
  if v_blocked > 0 then
    return jsonb_build_object('ok', false, 'error', format(
      'Cannot publish: %s assigned shift%s in this range now violate a scheduling rule. Resolve them (reassign, adjust time-off/availability, or fix the shift) and try again.',
      v_blocked, case when v_blocked = 1 then '' else 's' end));
  end if;

  update public.schedule_shifts
     set status                    = 'published',
         published_at              = now(),
         published_by_employee_id  = v_employee_id
   where id = any(v_ids);
  v_count := coalesce(array_length(v_ids, 1), 0);

  insert into public.schedule_publish_events
    (facility_id, published_by_employee_id, range_starts_at, range_ends_at, shift_count)
  values
    (v_req.facility_id, v_employee_id, v_req.range_starts_at, v_req.range_ends_at, v_count)
  returning id into v_event_id;

  select * into v_settings
    from public.schedule_settings
   where facility_id = v_req.facility_id;

  -- Surface unassigned published shifts in the staff claim queue.
  insert into public.schedule_open_shifts (facility_id, shift_id, claim_status, approval_required)
  select s.facility_id, s.id, 'open', not coalesce(v_settings.open_shift_first_come, true)
    from public.schedule_shifts s
   where s.id = any(v_ids)
     and s.employee_id is null
  on conflict (shift_id) do nothing;
  get diagnostics v_open_count = row_count;

  if coalesce(v_settings.notify_on_publish, true) then
    -- Per-shift notification for each assigned employee, linked to the
    -- publish event so acknowledgment progress can be reported per publish.
    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, publish_event_id, payload)
    select s.facility_id, s.employee_id, 'schedule_published', s.id, v_event_id,
           jsonb_build_object(
             'range_starts_at', v_req.range_starts_at,
             'range_ends_at',   v_req.range_ends_at)
      from public.schedule_shifts s
     where s.id = any(v_ids)
       and s.employee_id is not null;

    -- One summary notification per active employee when claimable shifts
    -- opened, so open shifts actually get seen.
    if v_open_count > 0 then
      insert into public.schedule_notifications
        (facility_id, employee_id, notification_type, payload)
      select v_req.facility_id, e.id, 'open_shift_available',
             jsonb_build_object(
               'count',           v_open_count,
               'range_starts_at', v_req.range_starts_at,
               'range_ends_at',   v_req.range_ends_at,
               'message', format('%s open shift%s available to claim.',
                                 v_open_count,
                                 case when v_open_count = 1 then '' else 's' end))
        from public.employees e
       where e.facility_id = v_req.facility_id
         and e.is_active;
    end if;
  end if;

  update public.schedule_publish_requests
     set status                  = 'published',
         decided_by_employee_id  = v_employee_id,
         decided_at              = now(),
         published_event_id      = v_event_id
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'shift_count', v_count, 'open_count', v_open_count);
end;
$$;


--
-- Name: FUNCTION scheduling_approve_publish_request(p_request_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_approve_publish_request(p_request_id uuid) IS 'Two-person publish approval, atomically: locks the request, re-validates every assigned draft, publishes, writes the audit event, creates schedule_open_shifts listings for unassigned shifts, notifies assigned employees per shift (stamping publish_event_id for acknowledgment tracking) and all active employees once when claimable shifts opened (honoring notify_on_publish), and finalizes the request. Returns jsonb {ok, error?, shift_count?, open_count?}.';


--
-- Name: scheduling_assignment_violations(uuid, uuid, timestamp with time zone, timestamp with time zone, integer, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_assignment_violations(p_facility_id uuid, p_employee_id uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_break_minutes integer, p_job_area_id uuid, p_exclude_shift_id uuid, p_exclude_shift_id2 uuid DEFAULT NULL::uuid) RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_codes        text[] := '{}';
  v_settings     public.schedule_settings%rowtype;
  v_tz           text;
  v_wsd          int;
  v_is_minor     boolean;
  v_gross_hours  numeric;
  v_this_hours   numeric;
  v_other_hours  numeric;
  v_total_hours  numeric;
  v_start_local  timestamp;  -- facility wall-clock
  v_end_local    timestamp;
  v_week_anchor  date;
  v_week_start   timestamptz;
  v_week_end     timestamptz;
  v_rule         record;
  v_req          record;
  v_max          numeric;
  v_thr          numeric;
  v_after        numeric;
  v_minm         numeric;
  v_minrest      numeric;
begin
  -- Caller scoping: only within your own facility (super admins anywhere).
  if not (
    public.is_super_admin()
    or (p_facility_id = public.current_facility_id() and public.has_module_access('scheduling'))
  ) then
    raise exception 'scheduling_assignment_violations: not authorized for this facility'
      using errcode = '42501';
  end if;

  -- Open / unassigned slot: nothing to validate.
  if p_employee_id is null or p_starts is null or p_ends is null then
    return v_codes;
  end if;

  select * into v_settings from public.schedule_settings where facility_id = p_facility_id;
  select is_minor into v_is_minor from public.employees where id = p_employee_id;
  select coalesce(timezone, 'UTC') into v_tz from public.facilities where id = p_facility_id;
  v_tz  := coalesce(v_tz, 'UTC');
  v_wsd := coalesce(v_settings.week_start_day, 0);

  v_gross_hours := extract(epoch from (p_ends - p_starts)) / 3600.0;
  v_this_hours  := v_gross_hours - coalesce(p_break_minutes, 0) / 60.0;

  -- Facility-local wall-clock representations of the candidate shift.
  v_start_local := p_starts at time zone v_tz;
  v_end_local   := p_ends   at time zone v_tz;

  -- Facility-local week containing the shift start, anchored on the
  -- configured week-start day. Local midnight -> timestamptz handles DST
  -- (167/169-hour weeks) correctly.
  v_week_anchor := v_start_local::date
    - ((extract(dow from v_start_local)::int - v_wsd + 7) % 7);
  v_week_start  := v_week_anchor::timestamp at time zone v_tz;
  v_week_end    := (v_week_anchor + 7)::timestamp at time zone v_tz;

  select coalesce(sum(
           extract(epoch from (s.ends_at - s.starts_at)) / 3600.0
           - coalesce(s.break_minutes, 0) / 60.0
         ), 0)
    into v_other_hours
    from public.schedule_shifts s
   where s.employee_id = p_employee_id
     and s.status in ('draft', 'published')
     and s.starts_at >= v_week_start
     and s.starts_at <  v_week_end
     and (p_exclude_shift_id  is null or s.id <> p_exclude_shift_id)
     and (p_exclude_shift_id2 is null or s.id <> p_exclude_shift_id2);

  v_total_hours := coalesce(v_other_hours, 0) + v_this_hours;

  -- ---- Active compliance rules --------------------------------------------
  for v_rule in
    select rule_type, params
      from public.schedule_compliance_rules
     where facility_id = p_facility_id
       and is_active
  loop
    if v_rule.rule_type = 'minor_max_hours' then
      v_max := coalesce((v_rule.params->>'max_weekly_hours')::numeric, v_settings.minor_max_weekly_hours);
      if coalesce(v_is_minor, false) and v_max is not null and v_total_hours > v_max then
        v_codes := array_append(v_codes, 'minor_overtime');
      end if;

    elsif v_rule.rule_type = 'overtime' then
      v_thr := coalesce((v_rule.params->>'weekly_threshold')::numeric, v_settings.overtime_weekly_hours);
      if v_thr is not null and v_total_hours > v_thr then
        v_codes := array_append(v_codes, 'overtime');
      end if;

    elsif v_rule.rule_type = 'break_required' then
      v_after := coalesce((v_rule.params->>'after_hours')::numeric, v_settings.minimum_break_after_hours);
      v_minm  := coalesce((v_rule.params->>'min_minutes')::numeric, v_settings.minimum_break_minutes);
      if v_after is not null and v_gross_hours > v_after
         and coalesce(p_break_minutes, 0) < coalesce(v_minm, 0) then
        v_codes := array_append(v_codes, 'break_required');
      end if;

    elsif v_rule.rule_type = 'min_rest_between_shifts' then
      v_minrest := coalesce((v_rule.params->>'min_hours')::numeric, (v_rule.params->>'min_rest_hours')::numeric);
      if v_minrest is not null and exists (
        select 1 from public.schedule_shifts s2
         where s2.employee_id = p_employee_id
           and s2.status in ('draft', 'published')
           and (p_exclude_shift_id  is null or s2.id <> p_exclude_shift_id)
           and (p_exclude_shift_id2 is null or s2.id <> p_exclude_shift_id2)
           and (
             (s2.ends_at   <= p_starts and (p_starts - s2.ends_at)   < (v_minrest * interval '1 hour')) or
             (s2.starts_at >= p_ends   and (s2.starts_at - p_ends)   < (v_minrest * interval '1 hour'))
           )
      ) then
        v_codes := array_append(v_codes, 'min_rest_between_shifts');
      end if;
    end if;
  end loop;

  -- ---- Intrinsic: double booking (overlapping assigned shift) --------------
  if exists (
    select 1 from public.schedule_shifts s3
     where s3.employee_id = p_employee_id
       and s3.status in ('draft', 'published')
       and (p_exclude_shift_id  is null or s3.id <> p_exclude_shift_id)
       and (p_exclude_shift_id2 is null or s3.id <> p_exclude_shift_id2)
       and s3.starts_at < p_ends
       and s3.ends_at   > p_starts
  ) then
    v_codes := array_append(v_codes, 'double_booked');
  end if;

  -- ---- Intrinsic: unavailable block ---------------------------------------
  -- Availability rows are recurring facility-local wall-clock blocks. Compare
  -- in facility-local terms, splitting a shift that crosses local midnight
  -- into [start, 24:00) on the start day and [00:00, end) on the end day.
  -- (Shifts longer than ~24h would need full middle-day handling; real shifts
  -- aren't.)
  if exists (
    select 1
      from (
        select extract(dow from v_start_local)::int as seg_dow,
               v_start_local::time                  as seg_start,
               case when v_start_local::date = v_end_local::date
                    then v_end_local::time
                    else time '24:00' end           as seg_end,
               v_start_local::date                  as seg_date
        union all
        select extract(dow from v_end_local)::int,
               time '00:00',
               v_end_local::time,
               v_end_local::date
         where v_start_local::date <> v_end_local::date
           and v_end_local::time > time '00:00'
      ) seg
      join public.schedule_availability a
        on a.employee_id = p_employee_id
       and a.availability_type = 'unavailable'
       and a.day_of_week = seg.seg_dow
       and a.start_time < seg.seg_end
       and a.end_time   > seg.seg_start
       and (a.effective_from is null or a.effective_from <= seg.seg_date)
       and (a.effective_to   is null or a.effective_to   >= seg.seg_date)
  ) then
    v_codes := array_append(v_codes, 'unavailable');
  end if;

  -- ---- Intrinsic: approved time-off ---------------------------------------
  if exists (
    select 1 from public.schedule_time_off_requests t
     where t.employee_id = p_employee_id
       and t.status = 'approved'
       and t.starts_at < p_ends
       and t.ends_at   > p_starts
  ) then
    v_codes := array_append(v_codes, 'time_off');
  end if;

  -- ---- Job-area qualification (opt-in via settings) -----------------------
  if p_job_area_id is not null and coalesce(v_settings.require_job_area_qualification, false) then
    if not exists (
      select 1 from public.employee_job_area_assignments j
       where j.employee_id = p_employee_id
         and j.job_area_id = p_job_area_id
    ) then
      v_codes := array_append(v_codes, 'not_qualified');
    end if;
  end if;

  -- ---- Required certifications for the job area ---------------------------
  -- Requirements reference the certification catalog; an employee satisfies
  -- one with a non-expired cert matched BY TYPE ID, or — legacy fallback for
  -- unlinked historical rows — by normalized name against the type's CURRENT
  -- name. Renaming a catalog entry can no longer break enforcement.
  if p_job_area_id is not null then
    for v_req in
      select r.certification_type_id, t.name as type_name
        from public.job_area_certification_requirements r
        join public.certification_types t on t.id = r.certification_type_id
       where r.facility_id = p_facility_id
         and r.job_area_id = p_job_area_id
         and r.is_active
         and t.is_active
    loop
      if not exists (
        select 1 from public.employee_certifications c
         where c.employee_id = p_employee_id
           and (
             c.certification_type_id = v_req.certification_type_id
             or (
               c.certification_type_id is null
               and lower(btrim(c.name)) = lower(btrim(v_req.type_name))
             )
           )
           and (c.expires_at is null or c.expires_at >= current_date)
      ) then
        v_codes := array_append(v_codes, 'cert_missing:' || v_req.type_name);
      end if;
    end loop;
  end if;

  -- De-duplicate.
  select coalesce(array_agg(distinct code), '{}')
    into v_codes
    from unnest(v_codes) as code;

  return v_codes;
end;
$$;


--
-- Name: FUNCTION scheduling_assignment_violations(p_facility_id uuid, p_employee_id uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_break_minutes integer, p_job_area_id uuid, p_exclude_shift_id uuid, p_exclude_shift_id2 uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_assignment_violations(p_facility_id uuid, p_employee_id uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_break_minutes integer, p_job_area_id uuid, p_exclude_shift_id uuid, p_exclude_shift_id2 uuid) IS 'Returns the array of hard-block violation codes for assigning an employee to a shift slot (empty = allowed). Single source of truth used by the admin server actions, the swap-apply / publish-approve / open-claim RPCs, and the staff self-claim RPC. Weekly windows and availability matching are computed on the facility''s local calendar (facilities.timezone, schedule_settings.week_start_day). Certification requirements join the certification_types catalog (id match, legacy name fallback for unlinked employee certs).';


--
-- Name: scheduling_claim_open_shift(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_claim_open_shift(p_open_shift_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_employee_id   uuid := public.current_employee_id();
  v_facility_id   uuid := public.current_facility_id();
  v_open          public.schedule_open_shifts%rowtype;
  v_shift         public.schedule_shifts%rowtype;
  v_codes         text[];
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

  select * into v_shift from public.schedule_shifts where id = v_open.shift_id;

  -- Hard-block: a staff member may not claim a shift they are not allowed to work.
  v_codes := public.scheduling_assignment_violations(
    v_facility_id, v_employee_id,
    v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
    v_shift.job_area_id, v_shift.id
  );
  if array_length(v_codes, 1) is not null then
    raise exception 'Cannot claim this shift: %', array_to_string(v_codes, ', ')
      using errcode = 'check_violation';
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


--
-- Name: FUNCTION scheduling_claim_open_shift(p_open_shift_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_claim_open_shift(p_open_shift_id uuid) IS 'Staff claim flow for an open shift. Enforces scheduling_assignment_violations() as a hard block before claiming. Honors schedule_open_shifts.approval_required. Returns true if claimed by this call, false if no longer open.';


--
-- Name: scheduling_decide_open_claim(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_decide_open_claim(p_open_shift_id uuid, p_approve boolean, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_open        public.schedule_open_shifts%rowtype;
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_decide_open_claim: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_open
    from public.schedule_open_shifts
   where id = p_open_shift_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Open shift not found.');
  end if;
  if not public.is_super_admin() and v_open.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_decide_open_claim: listing belongs to another facility'
      using errcode = '42501';
  end if;
  if v_open.claim_status <> 'claimed' or v_open.claimed_by_employee_id is null then
    return jsonb_build_object('ok', false, 'error',
      'This listing has no pending claim to decide.');
  end if;

  select * into v_shift
    from public.schedule_shifts
   where id = v_open.shift_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'The parent shift no longer exists.');
  end if;

  if p_approve then
    if v_shift.employee_id is not null then
      return jsonb_build_object('ok', false, 'error',
        'The shift was already assigned to someone else. Decline this claim.');
    end if;

    -- Re-validate the claimant at decision time.
    v_codes := public.scheduling_assignment_violations(
      v_open.facility_id, v_open.claimed_by_employee_id,
      v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
      v_shift.job_area_id, v_shift.id);
    if array_length(v_codes, 1) is not null then
      return jsonb_build_object('ok', false,
        'error', 'claimant_not_assignable', 'violations', to_jsonb(v_codes));
    end if;

    update public.schedule_shifts
       set employee_id = v_open.claimed_by_employee_id
     where id = v_shift.id;

    update public.schedule_open_shifts
       set claim_status            = 'filled',
           approved_by_employee_id = v_employee_id,
           approved_at             = now()
     where id = p_open_shift_id;

    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, payload)
    values
      (v_open.facility_id, v_open.claimed_by_employee_id, 'shift_changed',
       v_shift.id,
       jsonb_build_object(
         'message', 'Your open-shift claim was approved — the shift is yours.',
         'note', nullif(btrim(coalesce(p_note, '')), '')));

    return jsonb_build_object('ok', true, 'decision', 'approved');
  else
    update public.schedule_open_shifts
       set claim_status            = 'open',
           claimed_by_employee_id  = null,
           claimed_at              = null
     where id = p_open_shift_id;

    insert into public.schedule_notifications
      (facility_id, employee_id, notification_type, shift_id, payload)
    values
      (v_open.facility_id, v_open.claimed_by_employee_id, 'shift_changed',
       v_shift.id,
       jsonb_build_object(
         'message', 'Your open-shift claim was declined. The shift is open again.',
         'note', nullif(btrim(coalesce(p_note, '')), '')));

    return jsonb_build_object('ok', true, 'decision', 'declined');
  end if;
end;
$$;


--
-- Name: FUNCTION scheduling_decide_open_claim(p_open_shift_id uuid, p_approve boolean, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_decide_open_claim(p_open_shift_id uuid, p_approve boolean, p_note text) IS 'Admin decision on an approval-required open-shift claim. Approve: re-validates the claimant via scheduling_assignment_violations, assigns the still-unassigned parent shift, marks the listing filled, notifies the claimant. Decline: reopens the listing and notifies. Atomic and race-safe (FOR UPDATE on listing + shift). Returns jsonb {ok, decision?, error?, violations?}.';


--
-- Name: scheduling_expire_open_claims(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_expire_open_claims(p_limit integer DEFAULT 500) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_count int := 0; r record;
begin
  for r in select id from public.schedule_open_shifts
    where claim_status = 'open' and expires_at is not null and expires_at <= now()
    order by expires_at for update skip locked limit p_limit
  loop
    update public.schedule_open_shifts set claim_status='expired', updated_at=now() where id=r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;


--
-- Name: FUNCTION scheduling_expire_open_claims(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_expire_open_claims(p_limit integer) IS 'Sweeper: flips up to p_limit open (claim_status=''open'') open-shift listings whose expires_at has passed to ''expired'' (stamping updated_at). No notification is sent — an open listing has no single owner. Batched with FOR UPDATE SKIP LOCKED for safe concurrent cron invocation. Returns the number of listings expired. Invoked by /api/cron/expire-scheduling.';


--
-- Name: scheduling_expire_stale_swaps(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_expire_stale_swaps(p_limit integer DEFAULT 500) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_count int := 0; r record;
begin
  for r in select id, facility_id, requester_employee_id, target_employee_id
    from public.schedule_swap_requests
    where status in ('pending','accepted') and expires_at is not null and expires_at <= now()
    order by expires_at for update skip locked limit p_limit
  loop
    update public.schedule_swap_requests set status='expired', decided_at=now(), updated_at=now() where id=r.id;
    insert into public.schedule_notifications(facility_id, employee_id, swap_id, notification_type, payload)
      values (r.facility_id, r.requester_employee_id, r.id, 'swap_expired', jsonb_build_object('reason','expired'));
    if r.target_employee_id is not null then
      insert into public.schedule_notifications(facility_id, employee_id, swap_id, notification_type, payload)
        values (r.facility_id, r.target_employee_id, r.id, 'swap_expired', jsonb_build_object('reason','expired'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;


--
-- Name: FUNCTION scheduling_expire_stale_swaps(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_expire_stale_swaps(p_limit integer) IS 'Sweeper: flips up to p_limit pending/accepted swap requests whose expires_at has passed to ''expired'' (stamping decided_at/updated_at) and notifies the requester and, if set, the target with a swap_expired notification. Batched with FOR UPDATE SKIP LOCKED for safe concurrent cron invocation. Returns the number of swaps expired. Invoked by /api/cron/expire-scheduling.';


--
-- Name: scheduling_log_cert_override(uuid, uuid, text[], uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_log_cert_override(p_employee_id uuid, p_job_area_id uuid, p_violation_codes text[], p_shift_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_facility_id uuid := public.current_facility_id();
  v_emp_fac     uuid;
  v_missing     text[];
  v_id          uuid;
begin
  -- Override authority: facility_manager or above only.
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_log_cert_override: facility manager (scheduling admin) required'
      using errcode = '42501';
  end if;
  if p_employee_id is null or p_job_area_id is null then
    raise exception 'scheduling_log_cert_override: employee and job area are required'
      using errcode = '22023';
  end if;

  -- Facility scoping: the employee must belong to the caller's facility.
  select facility_id into v_emp_fac from public.employees where id = p_employee_id;
  if v_emp_fac is null then
    raise exception 'scheduling_log_cert_override: employee not found' using errcode = '22023';
  end if;
  if not public.is_super_admin() and v_emp_fac is distinct from v_facility_id then
    raise exception 'scheduling_log_cert_override: employee belongs to another facility'
      using errcode = '42501';
  end if;

  -- Pull the cert names out of the cert_missing:* codes for a tidy column.
  select coalesce(array_agg(substring(c from 'cert_missing:(.*)')), '{}')
    into v_missing
    from unnest(coalesce(p_violation_codes, '{}')) as c
   where c like 'cert_missing:%';

  insert into public.schedule_assignment_overrides
    (facility_id, shift_id, employee_id, job_area_id, override_type,
     violation_codes, missing_certs, reason, overridden_by_employee_id)
  values
    (v_emp_fac, p_shift_id, p_employee_id, p_job_area_id, 'cert_missing',
     coalesce(p_violation_codes, '{}'),
     v_missing,
     nullif(btrim(coalesce(p_reason, '')), ''),
     public.current_employee_id())
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: FUNCTION scheduling_log_cert_override(p_employee_id uuid, p_job_area_id uuid, p_violation_codes text[], p_shift_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_log_cert_override(p_employee_id uuid, p_job_area_id uuid, p_violation_codes text[], p_shift_id uuid, p_reason text) IS 'Records (and authorizes) a cert-gate override. Manager-gated (is_super_admin OR has_module_admin_access(scheduling)) and facility-scoped; the only writer of schedule_assignment_overrides. Returns the new audit row id.';


--
-- Name: scheduling_notify_swap_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduling_notify_swap_request(p_swap_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_swap        public.schedule_swap_requests%rowtype;
begin
  if v_employee_id is null then
    raise exception 'No current employee context.' using errcode = '28000';
  end if;

  select * into v_swap from public.schedule_swap_requests where id = p_swap_id;
  if not found then
    return false;
  end if;
  -- Only the swap's own requester may fire this, only toward a set target,
  -- and only while the swap is live.
  if v_swap.requester_employee_id is distinct from v_employee_id
     or v_swap.target_employee_id is null
     or v_swap.status <> 'pending' then
    return false;
  end if;
  -- Idempotent per swap.
  if exists (
    select 1 from public.schedule_notifications n
     where n.swap_id = p_swap_id
       and n.notification_type = 'swap_request_received'
  ) then
    return true;
  end if;

  insert into public.schedule_notifications
    (facility_id, employee_id, notification_type, swap_id, payload)
  values
    (v_swap.facility_id, v_swap.target_employee_id, 'swap_request_received',
     p_swap_id,
     jsonb_build_object('message', 'A coworker asked you to take a shift — review it on the swaps page.'));
  return true;
end;
$$;


--
-- Name: FUNCTION scheduling_notify_swap_request(p_swap_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.scheduling_notify_swap_request(p_swap_id uuid) IS 'Fires the swap_request_received notification to the swap''s target employee. Callable only by the swap''s requester (notification INSERT is otherwise admin-only since migration 136); idempotent per swap.';


--
-- Name: seed_default_accident_dropdowns(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_accident_dropdowns(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  -- body_part -- order roughly bottom-up; head_neck and arms retained as
  -- inactive for backwards compatibility. upper_arms / lower_arms are the
  -- canonical arm zones going forward.
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'body_part', 'feet',        'Feet',        1,  true),
    (p_facility_id, 'body_part', 'ankles',      'Ankles',      2,  true),
    (p_facility_id, 'body_part', 'lower_legs',  'Lower Legs',  3,  true),
    (p_facility_id, 'body_part', 'knees',       'Knees',       4,  true),
    (p_facility_id, 'body_part', 'upper_legs',  'Upper Legs',  5,  true),
    (p_facility_id, 'body_part', 'hips',        'Hips',        6,  true),
    (p_facility_id, 'body_part', 'torso',       'Torso',       7,  true),
    (p_facility_id, 'body_part', 'arms',        'Arms',        8,  false),
    (p_facility_id, 'body_part', 'elbows',      'Elbows',      9,  true),
    (p_facility_id, 'body_part', 'hands',       'Hands',       10, true),
    (p_facility_id, 'body_part', 'fingers',     'Fingers',     11, true),
    (p_facility_id, 'body_part', 'head_neck',   'Head/Neck',   12, false),
    (p_facility_id, 'body_part', 'head',        'Head',        13, true),
    (p_facility_id, 'body_part', 'face_jaw',    'Face / Jaw',  14, true),
    (p_facility_id, 'body_part', 'neck',        'Neck',        15, true),
    (p_facility_id, 'body_part', 'shoulders',   'Shoulders',   16, true),
    (p_facility_id, 'body_part', 'wrists',      'Wrists',      17, true),
    (p_facility_id, 'body_part', 'upper_arms',  'Upper Arms',  18, true),
    (p_facility_id, 'body_part', 'lower_arms',  'Lower Arms',  19, true)
  on conflict (facility_id, category, key) do nothing;

  -- severity (4) with colors
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, color, sort_order, is_active)
  values
    (p_facility_id, 'severity', 'low',      'Low',      '#16a34a', 1, true),
    (p_facility_id, 'severity', 'medium',   'Medium',   '#f59e0b', 2, true),
    (p_facility_id, 'severity', 'high',     'High',     '#ef4444', 3, true),
    (p_facility_id, 'severity', 'critical', 'Critical', '#7f1d1d', 4, true)
  on conflict (facility_id, category, key) do nothing;

  -- medical_attention (5); triggers_alert metadata on the three escalated keys
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active, metadata)
  values
    (p_facility_id, 'medical_attention', 'none',            'None',                  1, true, '{}'::jsonb),
    (p_facility_id, 'medical_attention', 'first_aid',       'First Aid',             2, true, '{}'::jsonb),
    (p_facility_id, 'medical_attention', 'medical_office',  'Medical Office Visit',  3, true, '{"triggers_alert": true}'::jsonb),
    (p_facility_id, 'medical_attention', 'er',              'Emergency Room',        4, true, '{"triggers_alert": true}'::jsonb),
    (p_facility_id, 'medical_attention', 'hospitalization', 'Hospitalization',       5, true, '{"triggers_alert": true}'::jsonb)
  on conflict (facility_id, category, key) do nothing;

  -- injury_type (10)
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'injury_type', 'cut',         'Cut',         1,  true),
    (p_facility_id, 'injury_type', 'bruise',      'Bruise',      2,  true),
    (p_facility_id, 'injury_type', 'sprain',      'Sprain',      3,  true),
    (p_facility_id, 'injury_type', 'strain',      'Strain',      4,  true),
    (p_facility_id, 'injury_type', 'fracture',    'Fracture',    5,  true),
    (p_facility_id, 'injury_type', 'concussion',  'Concussion',  6,  true),
    (p_facility_id, 'injury_type', 'burn',        'Burn',        7,  true),
    (p_facility_id, 'injury_type', 'puncture',    'Puncture',    8,  true),
    (p_facility_id, 'injury_type', 'dislocation', 'Dislocation', 9,  true),
    (p_facility_id, 'injury_type', 'other',       'Other',       10, true)
  on conflict (facility_id, category, key) do nothing;

  -- activity (8)
  insert into public.accident_dropdowns
    (facility_id, category, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'activity', 'skating',      'Skating',      1, true),
    (p_facility_id, 'activity', 'coaching',     'Coaching',     2, true),
    (p_facility_id, 'activity', 'instructing',  'Instructing',  3, true),
    (p_facility_id, 'activity', 'cleaning',     'Cleaning',     4, true),
    (p_facility_id, 'activity', 'maintenance',  'Maintenance',  5, true),
    (p_facility_id, 'activity', 'event_setup',  'Event Setup',  6, true),
    (p_facility_id, 'activity', 'walking',      'Walking',      7, true),
    (p_facility_id, 'activity', 'other',        'Other',        8, true)
  on conflict (facility_id, category, key) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_accident_dropdowns(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_accident_dropdowns(p_facility_id uuid) IS 'Seeds canonical accident_dropdowns values for a facility across all 6 categories. Idempotent via on conflict (facility_id, category, key) do nothing.';


--
-- Name: seed_default_air_quality_config(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_air_quality_config(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_co_id   uuid;
  v_co2_id  uuid;
begin
  -- 1) Reading types ---------------------------------------------------------
  insert into public.air_quality_reading_types
    (facility_id, key, label, unit, sort_order, is_active, is_required, decimals)
  values
    (p_facility_id, 'co',  'Carbon Monoxide', 'ppm', 0, true, true, 1),
    (p_facility_id, 'co2', 'Carbon Dioxide',  'ppm', 1, true, true, 0)
  on conflict (facility_id, key) do nothing;

  select id into v_co_id
  from public.air_quality_reading_types
  where facility_id = p_facility_id and key = 'co';

  select id into v_co2_id
  from public.air_quality_reading_types
  where facility_id = p_facility_id and key = 'co2';

  -- 2) Default settings ------------------------------------------------------
  insert into public.air_quality_settings
    (facility_id, testing_frequency, default_jurisdiction,
     alerts_enabled, default_alert_severity)
  values
    (p_facility_id, null, 'us_federal', true, 'high')
  on conflict (facility_id) do nothing;

  -- 3) Default thresholds (location-null = facility-wide defaults) -----------
  -- CO: alert at 25 ppm, compliance ceiling 50 ppm, severity 'high'.
  if v_co_id is not null
     and not exists (
       select 1 from public.air_quality_thresholds
       where reading_type_id = v_co_id
         and location_id is null
         and is_active = true
     )
  then
    insert into public.air_quality_thresholds
      (facility_id, reading_type_id, location_id,
       warn_min, warn_max, alert_min, alert_max,
       compliance_min, compliance_max, severity, is_active)
    values
      (p_facility_id, v_co_id, null,
       null, null, null, 25,
       null, 50, 'high', true);
  end if;

  -- CO2: alert at 1000 ppm, compliance ceiling 5000 ppm, severity 'warn'.
  if v_co2_id is not null
     and not exists (
       select 1 from public.air_quality_thresholds
       where reading_type_id = v_co2_id
         and location_id is null
         and is_active = true
     )
  then
    insert into public.air_quality_thresholds
      (facility_id, reading_type_id, location_id,
       warn_min, warn_max, alert_min, alert_max,
       compliance_min, compliance_max, severity, is_active)
    values
      (p_facility_id, v_co2_id, null,
       null, null, null, 1000,
       null, 5000, 'warn', true);
  end if;
end;
$$;


--
-- Name: FUNCTION seed_default_air_quality_config(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_air_quality_config(p_facility_id uuid) IS 'Seeds canonical air_quality reading types (co, co2), a default air_quality_settings row, and default location-null thresholds for CO and CO2. Idempotent.';


--
-- Name: seed_default_daily_report_checklists(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_daily_report_checklists(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
-- -----------------------------------------------------------------------------
-- 1. Areas (categories). One row per category; admins may rename/reorder/disable.
-- -----------------------------------------------------------------------------
with cat(slug, name, sort_order, color) as (
  values
    ('front-desk', 'Front Desk', 0, '#6366f1'),
    ('operations', 'Operations', 1, '#0ea5e9'),
    ('custodial-services', 'Custodial Services', 2, '#14b8a6'),
    ('pro-shop', 'Pro Shop', 3, '#8b5cf6'),
    ('concessions', 'Concessions', 4, '#f59e0b'),
    ('learn-to-skate', 'Learn to Skate', 5, '#ec4899'),
    ('public-sessions', 'Public Sessions', 6, '#22c55e'),
    ('safety-emergency', 'Safety & Emergency', 7, '#ef4444'),
    ('general-facility', 'General Facility', 8, '#64748b'),
    ('locker-rooms', 'Locker Rooms', 9, '#06b6d4'),
    ('parking-exterior', 'Parking / Exterior', 10, '#84cc16'),
    ('hvac-building-systems', 'HVAC / Building Systems', 11, '#3b82f6'),
    ('event-setup', 'Event Setup', 12, '#a855f7'),
    ('rental-equipment', 'Rental Equipment', 13, '#f97316'),
    ('skating-aids', 'Skating Aids', 14, '#10b981'),
    ('custom-reserved', 'Custom / Reserved', 15, '#94a3b8'),
    ('financials', 'Financials', 16, '#eab308')
)
insert into public.daily_report_areas (facility_id, name, slug, sort_order, color, is_active)
select f.id, c.name, c.slug, c.sort_order, c.color, true
from public.facilities f
cross join cat c
where f.id = p_facility_id
on conflict (facility_id, slug) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Templates: the Opening / Daily / Closing phase for each area.
-- -----------------------------------------------------------------------------
with tmpl(area_slug, name, sort_order) as (
  values
    ('front-desk', 'Opening', 0),
    ('front-desk', 'Daily', 1),
    ('front-desk', 'Closing', 2),
    ('operations', 'Opening', 0),
    ('operations', 'Daily', 1),
    ('operations', 'Closing', 2),
    ('custodial-services', 'Opening', 0),
    ('custodial-services', 'Daily', 1),
    ('custodial-services', 'Closing', 2),
    ('pro-shop', 'Opening', 0),
    ('pro-shop', 'Daily', 1),
    ('pro-shop', 'Closing', 2),
    ('concessions', 'Opening', 0),
    ('concessions', 'Daily', 1),
    ('concessions', 'Closing', 2),
    ('learn-to-skate', 'Opening', 0),
    ('learn-to-skate', 'Daily', 1),
    ('learn-to-skate', 'Closing', 2),
    ('public-sessions', 'Opening', 0),
    ('public-sessions', 'Daily', 1),
    ('public-sessions', 'Closing', 2),
    ('safety-emergency', 'Opening', 0),
    ('safety-emergency', 'Daily', 1),
    ('safety-emergency', 'Closing', 2),
    ('general-facility', 'Opening', 0),
    ('general-facility', 'Daily', 1),
    ('general-facility', 'Closing', 2),
    ('locker-rooms', 'Opening', 0),
    ('locker-rooms', 'Daily', 1),
    ('locker-rooms', 'Closing', 2),
    ('parking-exterior', 'Opening', 0),
    ('parking-exterior', 'Daily', 1),
    ('parking-exterior', 'Closing', 2),
    ('hvac-building-systems', 'Opening', 0),
    ('hvac-building-systems', 'Daily', 1),
    ('hvac-building-systems', 'Closing', 2),
    ('event-setup', 'Opening', 0),
    ('event-setup', 'Daily', 1),
    ('event-setup', 'Closing', 2),
    ('rental-equipment', 'Opening', 0),
    ('rental-equipment', 'Daily', 1),
    ('rental-equipment', 'Closing', 2),
    ('skating-aids', 'Opening', 0),
    ('skating-aids', 'Daily', 1),
    ('skating-aids', 'Closing', 2),
    ('custom-reserved', 'Opening', 0),
    ('custom-reserved', 'Daily', 1),
    ('custom-reserved', 'Closing', 2),
    ('financials', 'Opening', 0),
    ('financials', 'Daily', 1),
    ('financials', 'Closing', 2)
)
insert into public.daily_report_templates (facility_id, area_id, name, sort_order, is_active)
select a.facility_id, a.id, t.name, t.sort_order, true
from tmpl t
join public.daily_report_areas a
  on a.facility_id = p_facility_id and a.slug = t.area_slug
where not exists (
  select 1 from public.daily_report_templates dt
  where dt.area_id = a.id and dt.name = t.name
);

-- -----------------------------------------------------------------------------
-- 3. Checklist items: the individual checkbox rows for each phase template.
-- -----------------------------------------------------------------------------
with item(area_slug, template_name, sort_order, label) as (
  values
    ('front-desk', 'Opening', 0, 'Unlock front entrance and disarm the security/alarm system.'),
    ('front-desk', 'Opening', 1, 'Power on POS terminal, computer, and card reader; confirm connectivity.'),
    ('front-desk', 'Opening', 2, 'Count and verify the cash drawer float against the logged starting balance; sign the count sheet.'),
    ('front-desk', 'Opening', 3, 'Log in to the booking/scheduling system and review the day''s reservations, lessons, and rentals.'),
    ('front-desk', 'Opening', 4, 'Turn on lobby lighting, music, and schedule/TV monitors.'),
    ('front-desk', 'Opening', 5, 'Check voicemail and email; flag same-day cancellations or messages.'),
    ('front-desk', 'Opening', 6, 'Confirm shift staffing and review the daily schedule board.'),
    ('front-desk', 'Opening', 7, 'Stock waiver forms, day passes, punch cards, and brochures.'),
    ('front-desk', 'Opening', 8, 'Review handoff notes from the previous closing shift.'),
    ('front-desk', 'Daily', 0, 'Greet and check in arriving guests, skaters, and program participants.'),
    ('front-desk', 'Daily', 1, 'Process admissions, rentals, and retail transactions accurately.'),
    ('front-desk', 'Daily', 2, 'Collect and file signed liability waivers before granting ice access.'),
    ('front-desk', 'Daily', 3, 'Answer phones and respond to booking inquiries within service standards.'),
    ('front-desk', 'Daily', 4, 'Monitor session capacity and enforce headcount limits.'),
    ('front-desk', 'Daily', 5, 'Issue and track rental claim tickets or wristbands.'),
    ('front-desk', 'Daily', 6, 'Communicate session changes (resurfacing delays, closures) to guests.'),
    ('front-desk', 'Daily', 7, 'Log incidents, complaints, and refunds per policy.'),
    ('front-desk', 'Daily', 8, 'Coordinate with operations staff on ice schedule transitions.'),
    ('front-desk', 'Daily', 9, 'Keep the desk and lobby tidy; restock forms and supplies as needed.'),
    ('front-desk', 'Closing', 0, 'Reconcile the cash drawer; record the ending balance against the sales report.'),
    ('front-desk', 'Closing', 1, 'Run the end-of-day POS report (Z-report) and record totals.'),
    ('front-desk', 'Closing', 2, 'Prepare the bank deposit and secure cash per cash-handling policy.'),
    ('front-desk', 'Closing', 3, 'Log out of booking/POS systems and power down terminals.'),
    ('front-desk', 'Closing', 4, 'File the day''s signed waivers and completed paperwork.'),
    ('front-desk', 'Closing', 5, 'Clear voicemail and respond to outstanding messages.'),
    ('front-desk', 'Closing', 6, 'Tidy and restock the desk; turn off lobby monitors and music.'),
    ('front-desk', 'Closing', 7, 'Confirm all guests have exited the building.'),
    ('front-desk', 'Closing', 8, 'Turn off lobby lighting and secure the front desk.'),
    ('front-desk', 'Closing', 9, 'Record handoff notes for the next opening shift.'),
    ('operations', 'Opening', 0, 'Review the ice schedule and resurfacing/maintenance plan for the day.'),
    ('operations', 'Opening', 1, 'Inspect the ice surface for cracks, ruts, debris, or damage.'),
    ('operations', 'Opening', 2, 'Check and record ice surface temperature against the target range.'),
    ('operations', 'Opening', 3, 'Inspect the resurfacer (fuel/charge, water levels, blade condition) and bring it to ready.'),
    ('operations', 'Opening', 4, 'Inspect dasher boards, glass, and gates for damage or loose fasteners.'),
    ('operations', 'Opening', 5, 'Fill the resurfacer water tank with hot water at the correct temperature.'),
    ('operations', 'Opening', 6, 'Verify edger and snow-melt pit operation.'),
    ('operations', 'Opening', 7, 'Confirm rink lighting is fully operational.'),
    ('operations', 'Opening', 8, 'Review open work orders and pending maintenance items.'),
    ('operations', 'Daily', 0, 'Perform scheduled ice resurfacing between sessions on time.'),
    ('operations', 'Daily', 1, 'Conduct circle checks and edge work as scheduled.'),
    ('operations', 'Daily', 2, 'Patch low spots, ruts, and goal creases as needed.'),
    ('operations', 'Daily', 3, 'Monitor and adjust ice surface temperature throughout the day.'),
    ('operations', 'Daily', 4, 'Empty and rinse the snow-melt pit after each resurfacing.'),
    ('operations', 'Daily', 5, 'Refill the resurfacer water tank with hot water after each flood.'),
    ('operations', 'Daily', 6, 'Inspect and clear gate tracks and board areas.'),
    ('operations', 'Daily', 7, 'Log each resurfacing with operator, time, and notes.'),
    ('operations', 'Daily', 8, 'Coordinate ice transitions with front desk and program staff.'),
    ('operations', 'Daily', 9, 'Report equipment faults or ice-quality issues immediately.'),
    ('operations', 'Closing', 0, 'Perform the final resurfacing/flood per the overnight ice plan.'),
    ('operations', 'Closing', 1, 'Drain and clean the resurfacer; park it on a dry pad or board.'),
    ('operations', 'Closing', 2, 'Charge the electric resurfacer or top off fuel for the next day.'),
    ('operations', 'Closing', 3, 'Inspect and safely store the blade; note any blade-change needs.'),
    ('operations', 'Closing', 4, 'Empty and rinse the snow-melt pit.'),
    ('operations', 'Closing', 5, 'Record the final ice temperature and surface condition.'),
    ('operations', 'Closing', 6, 'Complete the operations log with all resurfacings and tasks.'),
    ('operations', 'Closing', 7, 'Secure all rink equipment, tools, and the resurfacer room.'),
    ('operations', 'Closing', 8, 'Verify all gates and doors to the ice are closed and secured.'),
    ('operations', 'Closing', 9, 'Record maintenance items and handoff for the next shift.'),
    ('custodial-services', 'Opening', 0, 'Access the custodial supply room and inventory key supplies.'),
    ('custodial-services', 'Opening', 1, 'Inspect restrooms; restock toilet paper, soap, and paper towels.'),
    ('custodial-services', 'Opening', 2, 'Empty and reline trash and recycling receptacles in public areas.'),
    ('custodial-services', 'Opening', 3, 'Spot-clean lobby floors, entry mats, and glass doors.'),
    ('custodial-services', 'Opening', 4, 'Wipe down the front desk, tables, and high-touch surfaces.'),
    ('custodial-services', 'Opening', 5, 'Address any overnight spills, leaks, or messes.'),
    ('custodial-services', 'Opening', 6, 'Confirm cleaning equipment (vacuum, auto-scrubber, mop) is functional.'),
    ('custodial-services', 'Opening', 7, 'Fill hand-sanitizer stations.'),
    ('custodial-services', 'Opening', 8, 'Review custodial notes from the prior shift.'),
    ('custodial-services', 'Daily', 0, 'Clean restrooms on a scheduled rotation and log each check.'),
    ('custodial-services', 'Daily', 1, 'Empty trash and recycling as bins reach capacity.'),
    ('custodial-services', 'Daily', 2, 'Spot-mop spills and wet areas promptly to remove slip hazards.'),
    ('custodial-services', 'Daily', 3, 'Wipe down high-touch surfaces (door handles, railings, benches).'),
    ('custodial-services', 'Daily', 4, 'Maintain lobby, bleacher, and spectator area cleanliness.'),
    ('custodial-services', 'Daily', 5, 'Restock restroom and sanitizer supplies as needed.'),
    ('custodial-services', 'Daily', 6, 'Respond to cleanup calls from staff promptly.'),
    ('custodial-services', 'Daily', 7, 'Keep entryways and walkways clear and dry.'),
    ('custodial-services', 'Daily', 8, 'Remove waste and recycling to the dumpster/compactor.'),
    ('custodial-services', 'Daily', 9, 'Log completed cleaning rounds.'),
    ('custodial-services', 'Closing', 0, 'Deep-clean and sanitize all restrooms; restock fully for the next day.'),
    ('custodial-services', 'Closing', 1, 'Empty all trash and recycling and replace liners.'),
    ('custodial-services', 'Closing', 2, 'Vacuum or auto-scrub lobby and high-traffic floors.'),
    ('custodial-services', 'Closing', 3, 'Clean and sanitize benches, tables, and locker room areas.'),
    ('custodial-services', 'Closing', 4, 'Clean glass doors, windows, and mirrors.'),
    ('custodial-services', 'Closing', 5, 'Clean and store all custodial equipment properly.'),
    ('custodial-services', 'Closing', 6, 'Refill all soap, towel, and sanitizer dispensers.'),
    ('custodial-services', 'Closing', 7, 'Remove all waste to the dumpster/compactor.'),
    ('custodial-services', 'Closing', 8, 'Inspect the facility for cleanliness before lockup.'),
    ('custodial-services', 'Closing', 9, 'Log completed closing tasks and note supply needs.'),
    ('pro-shop', 'Opening', 0, 'Unlock the pro shop and disarm any separate gate or alarm.'),
    ('pro-shop', 'Opening', 1, 'Power on POS, lighting, and display monitors.'),
    ('pro-shop', 'Opening', 2, 'Verify the cash drawer float and reconcile the starting balance.'),
    ('pro-shop', 'Opening', 3, 'Review the day''s skate-sharpening drop-offs and pickups.'),
    ('pro-shop', 'Opening', 4, 'Power on and inspect the sharpening machine; check wheel/stone condition.'),
    ('pro-shop', 'Opening', 5, 'Confirm special orders awaiting pickup and notify customers if needed.'),
    ('pro-shop', 'Opening', 6, 'Straighten displays and restock front-facing inventory.'),
    ('pro-shop', 'Opening', 7, 'Review low-stock alerts and flag reorders.'),
    ('pro-shop', 'Opening', 8, 'Check messages for sharpening or order inquiries.'),
    ('pro-shop', 'Daily', 0, 'Assist customers with retail purchases, fittings, and product questions.'),
    ('pro-shop', 'Daily', 1, 'Log sharpening orders with blade type, hollow/radius, and customer.'),
    ('pro-shop', 'Daily', 2, 'Sharpen to spec and inspect edges before returning skates.'),
    ('pro-shop', 'Daily', 3, 'Conduct skate and equipment fittings (skates, guards, protective gear).'),
    ('pro-shop', 'Daily', 4, 'Process transactions accurately at POS.'),
    ('pro-shop', 'Daily', 5, 'Maintain the sharpening machine: dress the wheel, clear shavings, check coolant.'),
    ('pro-shop', 'Daily', 6, 'Restock and face merchandise throughout the day.'),
    ('pro-shop', 'Daily', 7, 'Track inventory and flag items for reorder.'),
    ('pro-shop', 'Daily', 8, 'Handle special orders and customer follow-ups.'),
    ('pro-shop', 'Daily', 9, 'Keep the sharpening and retail areas clean and safe.'),
    ('pro-shop', 'Closing', 0, 'Complete all pending sharpening jobs or tag them for the next day.'),
    ('pro-shop', 'Closing', 1, 'Power down and clean the sharpening machine; clear metal shavings.'),
    ('pro-shop', 'Closing', 2, 'Reconcile the cash drawer and run the end-of-day sales report.'),
    ('pro-shop', 'Closing', 3, 'Secure cash/deposit per cash-handling policy.'),
    ('pro-shop', 'Closing', 4, 'Tidy and re-face merchandise displays.'),
    ('pro-shop', 'Closing', 5, 'Record inventory sold and update stock counts.'),
    ('pro-shop', 'Closing', 6, 'Log special orders and pickup status.'),
    ('pro-shop', 'Closing', 7, 'Power down POS, monitors, and equipment.'),
    ('pro-shop', 'Closing', 8, 'Turn off lighting and secure the pro shop.'),
    ('pro-shop', 'Closing', 9, 'Note handoff items and reorder needs.'),
    ('concessions', 'Opening', 0, 'Unlock the concession stand and disarm any separate alarm.'),
    ('concessions', 'Opening', 1, 'Wash hands and put on gloves/apron; review food-safety reminders.'),
    ('concessions', 'Opening', 2, 'Power on refrigeration, freezers, and hot-holding units; confirm operation.'),
    ('concessions', 'Opening', 3, 'Record refrigerator and freezer temperatures on the food-safety log.'),
    ('concessions', 'Opening', 4, 'Turn on and preheat cooking equipment (grill, fryer, warmers, popcorn machine).'),
    ('concessions', 'Opening', 5, 'Verify the cash drawer float and reconcile the starting balance.'),
    ('concessions', 'Opening', 6, 'Stock food, beverages, condiments, cups, and napkins.'),
    ('concessions', 'Opening', 7, 'Check expiration dates and rotate stock (FIFO).'),
    ('concessions', 'Opening', 8, 'Sanitize prep and service surfaces; set up sanitizer buckets.'),
    ('concessions', 'Opening', 9, 'Confirm the handwashing sink is stocked with soap, towels, and hot water.'),
    ('concessions', 'Daily', 0, 'Prepare and serve food and beverages following food-safety standards.'),
    ('concessions', 'Daily', 1, 'Record hot-holding and cold-holding temperatures on schedule.'),
    ('concessions', 'Daily', 2, 'Process transactions accurately at POS.'),
    ('concessions', 'Daily', 3, 'Maintain clean prep and service surfaces; refresh sanitizer buckets.'),
    ('concessions', 'Daily', 4, 'Restock items as they run low.'),
    ('concessions', 'Daily', 5, 'Monitor cooking equipment and discard food past hold times.'),
    ('concessions', 'Daily', 6, 'Practice proper handwashing and glove changes.'),
    ('concessions', 'Daily', 7, 'Keep floors dry and free of spills.'),
    ('concessions', 'Daily', 8, 'Manage waste and recycling.'),
    ('concessions', 'Daily', 9, 'Log temperature checks and any food-safety issues.'),
    ('concessions', 'Closing', 0, 'Discard perishables past hold time; date and store remaining stock (FIFO).'),
    ('concessions', 'Closing', 1, 'Record final equipment temperatures on the food-safety log.'),
    ('concessions', 'Closing', 2, 'Power down and clean cooking equipment (grill, fryer, warmers, popcorn machine).'),
    ('concessions', 'Closing', 3, 'Clean and filter fryer grease as scheduled.'),
    ('concessions', 'Closing', 4, 'Reconcile the cash drawer and run the end-of-day sales report.'),
    ('concessions', 'Closing', 5, 'Secure cash/deposit per cash-handling policy.'),
    ('concessions', 'Closing', 6, 'Clean and sanitize all prep, service, and storage surfaces.'),
    ('concessions', 'Closing', 7, 'Sweep and mop floors; empty trash and recycling.'),
    ('concessions', 'Closing', 8, 'Restock for the next day where possible.'),
    ('concessions', 'Closing', 9, 'Secure refrigeration, lock the stand, and log closing tasks.'),
    ('learn-to-skate', 'Opening', 0, 'Review the day''s class roster, levels, and instructor assignments.'),
    ('learn-to-skate', 'Opening', 1, 'Confirm instructor and coach staffing and check-in.'),
    ('learn-to-skate', 'Opening', 2, 'Set out skating aids, cones, markers, and teaching props.'),
    ('learn-to-skate', 'Opening', 3, 'Verify rental skates are available and sized for registered classes.'),
    ('learn-to-skate', 'Opening', 4, 'Confirm Learn to Skate ice times on the schedule.'),
    ('learn-to-skate', 'Opening', 5, 'Prepare attendance sheets and progress/badge tracking.'),
    ('learn-to-skate', 'Opening', 6, 'Review student medical notes or accommodations.'),
    ('learn-to-skate', 'Opening', 7, 'Confirm the class music/sound system is working.'),
    ('learn-to-skate', 'Opening', 8, 'Set up barriers or designated class zones on the ice.'),
    ('learn-to-skate', 'Opening', 9, 'Check messages for student absences or new registrations.'),
    ('learn-to-skate', 'Daily', 0, 'Check in students and take attendance per class.'),
    ('learn-to-skate', 'Daily', 1, 'Distribute and fit rental skates and helmets as needed.'),
    ('learn-to-skate', 'Daily', 2, 'Conduct classes per curriculum and skill level.'),
    ('learn-to-skate', 'Daily', 3, 'Track student progress and update badge/level records.'),
    ('learn-to-skate', 'Daily', 4, 'Manage class zones and safe spacing on shared ice.'),
    ('learn-to-skate', 'Daily', 5, 'Supervise students on and off the ice.'),
    ('learn-to-skate', 'Daily', 6, 'Communicate with parents/guardians at the boards.'),
    ('learn-to-skate', 'Daily', 7, 'Coordinate ice transitions with operations staff.'),
    ('learn-to-skate', 'Daily', 8, 'Address minor injuries per protocol and notify the front desk.'),
    ('learn-to-skate', 'Daily', 9, 'Collect and return skating aids and props between classes.'),
    ('learn-to-skate', 'Closing', 0, 'Collect attendance and finalize progress/badge records for the day.'),
    ('learn-to-skate', 'Closing', 1, 'Gather and store all skating aids, cones, and teaching props.'),
    ('learn-to-skate', 'Closing', 2, 'Collect rental skates and helmets; return to pro shop/rental.'),
    ('learn-to-skate', 'Closing', 3, 'Remove class barriers and zone markers from the ice.'),
    ('learn-to-skate', 'Closing', 4, 'Note make-up classes, absences, and follow-ups.'),
    ('learn-to-skate', 'Closing', 5, 'Communicate completed evaluations to the program coordinator.'),
    ('learn-to-skate', 'Closing', 6, 'Confirm all students have been picked up and exited.'),
    ('learn-to-skate', 'Closing', 7, 'Power down class music/sound equipment.'),
    ('learn-to-skate', 'Closing', 8, 'Tidy the program storage area.'),
    ('learn-to-skate', 'Closing', 9, 'Log session notes and handoff items.'),
    ('public-sessions', 'Opening', 0, 'Confirm public session times and capacity limits on the schedule.'),
    ('public-sessions', 'Opening', 1, 'Set up the admission/check-in station with wristbands or stamps.'),
    ('public-sessions', 'Opening', 2, 'Verify rental skates are stocked and sized for expected volume.'),
    ('public-sessions', 'Opening', 3, 'Brief skate guards/monitors on session rules and zones.'),
    ('public-sessions', 'Opening', 4, 'Confirm the ice has been resurfaced before the session.'),
    ('public-sessions', 'Opening', 5, 'Set out safety signage (skate at own risk, rules of the ice).'),
    ('public-sessions', 'Opening', 6, 'Confirm the first-aid kit and AED are accessible.'),
    ('public-sessions', 'Opening', 7, 'Set up skating aids if offered for the session.'),
    ('public-sessions', 'Opening', 8, 'Test the music/sound system and announcements.'),
    ('public-sessions', 'Opening', 9, 'Confirm benches and skate-change areas are ready.'),
    ('public-sessions', 'Daily', 0, 'Check in skaters and collect admissions and waivers.'),
    ('public-sessions', 'Daily', 1, 'Issue and track rental skates and skating aids.'),
    ('public-sessions', 'Daily', 2, 'Station skate guards to monitor the ice and enforce rules.'),
    ('public-sessions', 'Daily', 3, 'Enforce session capacity and direction-of-skating rules.'),
    ('public-sessions', 'Daily', 4, 'Conduct scheduled ice breaks/resurfacing per session length.'),
    ('public-sessions', 'Daily', 5, 'Monitor for unsafe behavior and intervene as needed.'),
    ('public-sessions', 'Daily', 6, 'Respond to falls/injuries per first-aid protocol; log incidents.'),
    ('public-sessions', 'Daily', 7, 'Make session announcements (breaks, last skate, closing).'),
    ('public-sessions', 'Daily', 8, 'Keep skate-change and bench areas orderly.'),
    ('public-sessions', 'Daily', 9, 'Coordinate end-of-session ice clearing.'),
    ('public-sessions', 'Closing', 0, 'Announce and clear the final session; ensure all skaters exit the ice.'),
    ('public-sessions', 'Closing', 1, 'Collect all rental skates and skating aids for processing.'),
    ('public-sessions', 'Closing', 2, 'Take down safety signage and the admission station.'),
    ('public-sessions', 'Closing', 3, 'Inspect the ice and surrounding areas for left items or hazards.'),
    ('public-sessions', 'Closing', 4, 'Reconcile the session admissions count with the front desk.'),
    ('public-sessions', 'Closing', 5, 'Log incidents and session notes.'),
    ('public-sessions', 'Closing', 6, 'Tidy benches, skate-change areas, and the lobby.'),
    ('public-sessions', 'Closing', 7, 'Confirm all guests have exited the building.'),
    ('public-sessions', 'Closing', 8, 'Hand off rental returns to pro shop/rental.'),
    ('public-sessions', 'Closing', 9, 'Note follow-ups for the next session.'),
    ('safety-emergency', 'Opening', 0, 'Verify all emergency exits are unlocked, unobstructed, and illuminated.'),
    ('safety-emergency', 'Opening', 1, 'Confirm first-aid kits are stocked and accessible.'),
    ('safety-emergency', 'Opening', 2, 'Check the AED: status indicator, pads in date, and battery.'),
    ('safety-emergency', 'Opening', 3, 'Test emergency communication equipment (radios, phones, PA).'),
    ('safety-emergency', 'Opening', 4, 'Confirm fire extinguishers are charged, tagged, and accessible.'),
    ('safety-emergency', 'Opening', 5, 'Verify emergency lighting and exit signs are functional.'),
    ('safety-emergency', 'Opening', 6, 'Review the day''s events for crowd and capacity considerations.'),
    ('safety-emergency', 'Opening', 7, 'Confirm on-shift staff know their emergency roles and procedures.'),
    ('safety-emergency', 'Opening', 8, 'Stock incident and accident report forms.'),
    ('safety-emergency', 'Opening', 9, 'Inspect public areas for slip and trip hazards.'),
    ('safety-emergency', 'Daily', 0, 'Monitor the facility for hazards (wet floors, blocked exits, ice debris).'),
    ('safety-emergency', 'Daily', 1, 'Keep emergency exits and pathways clear at all times.'),
    ('safety-emergency', 'Daily', 2, 'Respond to incidents and accidents per protocol; provide first aid.'),
    ('safety-emergency', 'Daily', 3, 'Document every incident and accident on the proper form.'),
    ('safety-emergency', 'Daily', 4, 'Enforce capacity limits for sessions and events.'),
    ('safety-emergency', 'Daily', 5, 'Keep first-aid kits and the AED accessible and stocked.'),
    ('safety-emergency', 'Daily', 6, 'Communicate hazards and resolutions to staff.'),
    ('safety-emergency', 'Daily', 7, 'Conduct periodic safety walk-throughs.'),
    ('safety-emergency', 'Daily', 8, 'Coordinate with operations on ice-related safety issues.'),
    ('safety-emergency', 'Daily', 9, 'Escalate emergencies per the emergency action plan.'),
    ('safety-emergency', 'Closing', 0, 'Confirm all incidents and accidents from the day are documented and filed.'),
    ('safety-emergency', 'Closing', 1, 'Restock first-aid supplies used during the day.'),
    ('safety-emergency', 'Closing', 2, 'Verify the AED and fire extinguishers remain accessible and intact.'),
    ('safety-emergency', 'Closing', 3, 'Confirm emergency exits are secure but functional for the next day.'),
    ('safety-emergency', 'Closing', 4, 'Confirm emergency lighting and exit signs remain operational.'),
    ('safety-emergency', 'Closing', 5, 'Review and file the day''s safety logs and reports.'),
    ('safety-emergency', 'Closing', 6, 'Note hazards requiring maintenance work orders.'),
    ('safety-emergency', 'Closing', 7, 'Confirm the building is clear of all occupants.'),
    ('safety-emergency', 'Closing', 8, 'Reset and charge emergency communication equipment.'),
    ('safety-emergency', 'Closing', 9, 'Hand off any open safety items to the next shift.'),
    ('general-facility', 'Opening', 0, 'Unlock the building and disarm the main security system.'),
    ('general-facility', 'Opening', 1, 'Turn on facility lighting (lobby, rink, corridors, restrooms).'),
    ('general-facility', 'Opening', 2, 'Walk the building interior and perimeter for overnight issues.'),
    ('general-facility', 'Opening', 3, 'Confirm heating/ventilation is at the occupied-operation target.'),
    ('general-facility', 'Opening', 4, 'Confirm all public areas are clean and presentable.'),
    ('general-facility', 'Opening', 5, 'Verify signage, schedules, and wayfinding are posted and current.'),
    ('general-facility', 'Opening', 6, 'Confirm all required staff have arrived and are stationed.'),
    ('general-facility', 'Opening', 7, 'Check for overnight alarms, leaks, or maintenance issues.'),
    ('general-facility', 'Opening', 8, 'Confirm network/Wi-Fi and phone systems are operational.'),
    ('general-facility', 'Opening', 9, 'Review the day''s master schedule across all areas.'),
    ('general-facility', 'Daily', 0, 'Monitor overall building condition and comfort throughout the day.'),
    ('general-facility', 'Daily', 1, 'Coordinate between departments (front desk, operations, programs).'),
    ('general-facility', 'Daily', 2, 'Address facility issues and generate work orders as needed.'),
    ('general-facility', 'Daily', 3, 'Maintain presentable public and spectator areas.'),
    ('general-facility', 'Daily', 4, 'Adjust lighting and HVAC for occupancy and energy use.'),
    ('general-facility', 'Daily', 5, 'Ensure compliance with capacity and safety standards.'),
    ('general-facility', 'Daily', 6, 'Respond to guest concerns escalated by staff.'),
    ('general-facility', 'Daily', 7, 'Track and follow up on open maintenance items.'),
    ('general-facility', 'Daily', 8, 'Confirm scheduled events and programs transition smoothly.'),
    ('general-facility', 'Daily', 9, 'Keep communication flowing between shifts and departments.'),
    ('general-facility', 'Closing', 0, 'Confirm all programs, sessions, and events have ended.'),
    ('general-facility', 'Closing', 1, 'Walk the building to verify all occupants have exited.'),
    ('general-facility', 'Closing', 2, 'Turn off non-essential lighting and equipment.'),
    ('general-facility', 'Closing', 3, 'Set HVAC to unoccupied/overnight settings.'),
    ('general-facility', 'Closing', 4, 'Confirm all interior doors and areas are secured.'),
    ('general-facility', 'Closing', 5, 'Verify all departments have completed their closing checklists.'),
    ('general-facility', 'Closing', 6, 'Address any end-of-day hazards or issues.'),
    ('general-facility', 'Closing', 7, 'Arm the security system and lock all exterior doors.'),
    ('general-facility', 'Closing', 8, 'Complete the master closing log.'),
    ('general-facility', 'Closing', 9, 'Note open items and handoff for the next opening shift.'),
    ('locker-rooms', 'Opening', 0, 'Unlock assigned locker rooms per the day''s schedule.'),
    ('locker-rooms', 'Opening', 1, 'Inspect for cleanliness; spot-clean floors, benches, and surfaces.'),
    ('locker-rooms', 'Opening', 2, 'Confirm locker-room restrooms/showers are stocked and clean.'),
    ('locker-rooms', 'Opening', 3, 'Check for left-behind items and route to lost-and-found.'),
    ('locker-rooms', 'Opening', 4, 'Verify lighting and ventilation are working.'),
    ('locker-rooms', 'Opening', 5, 'Confirm locker assignments for teams and programs are posted.'),
    ('locker-rooms', 'Opening', 6, 'Check for damage, vandalism, or maintenance needs.'),
    ('locker-rooms', 'Opening', 7, 'Empty and reline trash receptacles.'),
    ('locker-rooms', 'Opening', 8, 'Confirm rented/team lockers are ready.'),
    ('locker-rooms', 'Opening', 9, 'Note locker-room schedule conflicts for the day.'),
    ('locker-rooms', 'Daily', 0, 'Assign and unlock locker rooms for teams, programs, and rentals per schedule.'),
    ('locker-rooms', 'Daily', 1, 'Tidy locker rooms between groups.'),
    ('locker-rooms', 'Daily', 2, 'Restock supplies and empty trash as needed.'),
    ('locker-rooms', 'Daily', 3, 'Address spills, wet floors, and hazards promptly.'),
    ('locker-rooms', 'Daily', 4, 'Enforce locker-room rules and access policies.'),
    ('locker-rooms', 'Daily', 5, 'Respond to lost-and-found inquiries.'),
    ('locker-rooms', 'Daily', 6, 'Coordinate locker-room turnover between bookings.'),
    ('locker-rooms', 'Daily', 7, 'Report damage or maintenance issues.'),
    ('locker-rooms', 'Daily', 8, 'Ensure privacy and supervision policies are followed.'),
    ('locker-rooms', 'Daily', 9, 'Secure rooms between scheduled uses.'),
    ('locker-rooms', 'Closing', 0, 'Clear all locker rooms and confirm no occupants remain.'),
    ('locker-rooms', 'Closing', 1, 'Collect lost-and-found items; log and store them.'),
    ('locker-rooms', 'Closing', 2, 'Clean and sanitize floors, benches, showers, and restrooms.'),
    ('locker-rooms', 'Closing', 3, 'Empty all trash and replace liners.'),
    ('locker-rooms', 'Closing', 4, 'Restock supplies for the next day.'),
    ('locker-rooms', 'Closing', 5, 'Inspect for damage and note maintenance needs.'),
    ('locker-rooms', 'Closing', 6, 'Confirm all personal items are removed from day-use lockers.'),
    ('locker-rooms', 'Closing', 7, 'Turn off lighting and adjust ventilation as appropriate.'),
    ('locker-rooms', 'Closing', 8, 'Lock all locker rooms.'),
    ('locker-rooms', 'Closing', 9, 'Log closing tasks and any issues.'),
    ('parking-exterior', 'Opening', 0, 'Inspect the parking lot and walkways for hazards (ice, snow, debris, potholes).'),
    ('parking-exterior', 'Opening', 1, 'Confirm snow/ice removal and salting is complete (seasonal).'),
    ('parking-exterior', 'Opening', 2, 'Verify exterior lighting status (off for daytime, functional for evening).'),
    ('parking-exterior', 'Opening', 3, 'Confirm entrance signage and wayfinding are visible and intact.'),
    ('parking-exterior', 'Opening', 4, 'Clear and inspect building entrances and exits.'),
    ('parking-exterior', 'Opening', 5, 'Confirm accessible parking and ramps are clear and marked.'),
    ('parking-exterior', 'Opening', 6, 'Empty exterior trash receptacles as needed.'),
    ('parking-exterior', 'Opening', 7, 'Inspect for overnight vandalism, damage, or dumping.'),
    ('parking-exterior', 'Opening', 8, 'Confirm bike racks and exterior fixtures are secure.'),
    ('parking-exterior', 'Opening', 9, 'Note any exterior maintenance items.'),
    ('parking-exterior', 'Daily', 0, 'Monitor the lot for capacity and safe traffic flow during events.'),
    ('parking-exterior', 'Daily', 1, 'Maintain clear, safe walkways and entrances (de-ice/salt as needed).'),
    ('parking-exterior', 'Daily', 2, 'Respond to weather conditions (snow, ice, rain) promptly.'),
    ('parking-exterior', 'Daily', 3, 'Keep accessible parking and routes clear.'),
    ('parking-exterior', 'Daily', 4, 'Empty exterior trash receptacles as needed.'),
    ('parking-exterior', 'Daily', 5, 'Address spills, leaks, or hazards in exterior areas.'),
    ('parking-exterior', 'Daily', 6, 'Direct traffic and parking during peak events if needed.'),
    ('parking-exterior', 'Daily', 7, 'Monitor exterior lighting at dusk.'),
    ('parking-exterior', 'Daily', 8, 'Report exterior damage or safety issues.'),
    ('parking-exterior', 'Daily', 9, 'Coordinate with custodial on entrance cleanliness.'),
    ('parking-exterior', 'Closing', 0, 'Inspect the lot and walkways for end-of-day hazards.'),
    ('parking-exterior', 'Closing', 1, 'Confirm exterior lighting is on for evening/overnight safety.'),
    ('parking-exterior', 'Closing', 2, 'Clear and salt walkways and entrances (seasonal).'),
    ('parking-exterior', 'Closing', 3, 'Empty exterior trash receptacles.'),
    ('parking-exterior', 'Closing', 4, 'Confirm gates, exterior storage, and fixtures are secured.'),
    ('parking-exterior', 'Closing', 5, 'Check for left vehicles and note if applicable.'),
    ('parking-exterior', 'Closing', 6, 'Confirm entrances and exits are locked and secure.'),
    ('parking-exterior', 'Closing', 7, 'Note overnight weather-prep needs (plowing, salting).'),
    ('parking-exterior', 'Closing', 8, 'Log exterior conditions and maintenance items.'),
    ('parking-exterior', 'Closing', 9, 'Hand off weather/exterior items to the next shift.'),
    ('hvac-building-systems', 'Opening', 0, 'Review the building automation system (BAS) for overnight alarms or faults.'),
    ('hvac-building-systems', 'Opening', 1, 'Confirm heating/ventilation is set to occupied mode at target setpoints.'),
    ('hvac-building-systems', 'Opening', 2, 'Check dehumidification operation (critical for fog and condensation control).'),
    ('hvac-building-systems', 'Opening', 3, 'Verify air-handling units are running and no filter alarms are active.'),
    ('hvac-building-systems', 'Opening', 4, 'Record rink-side and lobby temperature and humidity readings.'),
    ('hvac-building-systems', 'Opening', 5, 'Inspect for condensation, fog, or ceiling drip over the ice.'),
    ('hvac-building-systems', 'Opening', 6, 'Confirm exhaust and fresh-air ventilation rates for occupancy.'),
    ('hvac-building-systems', 'Opening', 7, 'Check boiler/water-heater status and pressures.'),
    ('hvac-building-systems', 'Opening', 8, 'Verify CO/NO2 air-quality sensors are functioning.'),
    ('hvac-building-systems', 'Opening', 9, 'Log opening readings and any anomalies.'),
    ('hvac-building-systems', 'Daily', 0, 'Monitor temperature, humidity, and air quality throughout the day.'),
    ('hvac-building-systems', 'Daily', 1, 'Adjust ventilation and dehumidification for occupancy and conditions.'),
    ('hvac-building-systems', 'Daily', 2, 'Watch for fog/condensation over the ice and respond promptly.'),
    ('hvac-building-systems', 'Daily', 3, 'Record scheduled BAS/system readings each shift.'),
    ('hvac-building-systems', 'Daily', 4, 'Respond to comfort complaints (too warm, cold, or stuffy).'),
    ('hvac-building-systems', 'Daily', 5, 'Monitor air-quality readings and escalate per thresholds.'),
    ('hvac-building-systems', 'Daily', 6, 'Inspect and change/clean filters per schedule.'),
    ('hvac-building-systems', 'Daily', 7, 'Coordinate with refrigeration on heat load and ice conditions.'),
    ('hvac-building-systems', 'Daily', 8, 'Log system readings and any faults.'),
    ('hvac-building-systems', 'Daily', 9, 'Generate work orders for HVAC issues.'),
    ('hvac-building-systems', 'Closing', 0, 'Set heating/ventilation to unoccupied/overnight setpoints.'),
    ('hvac-building-systems', 'Closing', 1, 'Confirm dehumidification remains active per overnight requirements.'),
    ('hvac-building-systems', 'Closing', 2, 'Record end-of-day temperature, humidity, and air-quality readings.'),
    ('hvac-building-systems', 'Closing', 3, 'Resolve any system alarms before lockup.'),
    ('hvac-building-systems', 'Closing', 4, 'Verify air-handling and exhaust systems are in night mode.'),
    ('hvac-building-systems', 'Closing', 5, 'Confirm boiler/water-heater status for overnight.'),
    ('hvac-building-systems', 'Closing', 6, 'Inspect for overnight condensation or fog risk.'),
    ('hvac-building-systems', 'Closing', 7, 'Log closing readings and any open faults.'),
    ('hvac-building-systems', 'Closing', 8, 'Note any after-hours system monitoring needs.'),
    ('hvac-building-systems', 'Closing', 9, 'Hand off open HVAC items to the next shift.'),
    ('event-setup', 'Opening', 0, 'Review the event schedule and setup requirements for the day.'),
    ('event-setup', 'Opening', 1, 'Confirm event details against the booking/event sheet (times, layout, needs).'),
    ('event-setup', 'Opening', 2, 'Inspect and stage required equipment (chairs, tables, staging, barriers).'),
    ('event-setup', 'Opening', 3, 'Set up seating, spectator areas, and crowd-control barriers per layout.'),
    ('event-setup', 'Opening', 4, 'Confirm AV/sound, scoreboard, and lighting needs for the event.'),
    ('event-setup', 'Opening', 5, 'Coordinate ice prep and timing with operations.'),
    ('event-setup', 'Opening', 6, 'Set up registration/check-in or ticketing tables if needed.'),
    ('event-setup', 'Opening', 7, 'Post event signage and wayfinding.'),
    ('event-setup', 'Opening', 8, 'Verify event staffing and roles.'),
    ('event-setup', 'Opening', 9, 'Confirm vendor and rental deliveries have arrived.'),
    ('event-setup', 'Daily', 0, 'Execute setup per the approved layout and timeline.'),
    ('event-setup', 'Daily', 1, 'Manage AV, scoreboard, music, and lighting during the event.'),
    ('event-setup', 'Daily', 2, 'Maintain crowd-control barriers and spectator areas.'),
    ('event-setup', 'Daily', 3, 'Coordinate ice resurfacing and transitions around the event.'),
    ('event-setup', 'Daily', 4, 'Support event staff and respond to organizer requests.'),
    ('event-setup', 'Daily', 5, 'Monitor capacity and safety during the event.'),
    ('event-setup', 'Daily', 6, 'Manage signage and directional needs.'),
    ('event-setup', 'Daily', 7, 'Coordinate vendor and concession needs for the event.'),
    ('event-setup', 'Daily', 8, 'Log the event timeline and any issues.'),
    ('event-setup', 'Daily', 9, 'Communicate with front desk and operations throughout.'),
    ('event-setup', 'Closing', 0, 'Tear down event setup (seating, staging, barriers, tables).'),
    ('event-setup', 'Closing', 1, 'Power down and store AV, scoreboard, and lighting equipment.'),
    ('event-setup', 'Closing', 2, 'Return rented/borrowed equipment and confirm vendor pickups.'),
    ('event-setup', 'Closing', 3, 'Inspect the event space and ice for damage or left items.'),
    ('event-setup', 'Closing', 4, 'Coordinate post-event ice resurfacing with operations.'),
    ('event-setup', 'Closing', 5, 'Return the space to standard configuration.'),
    ('event-setup', 'Closing', 6, 'Collect and store all event signage.'),
    ('event-setup', 'Closing', 7, 'Reconcile event-related counts/revenue with the front desk.'),
    ('event-setup', 'Closing', 8, 'Log event-completion notes and any damage or issues.'),
    ('event-setup', 'Closing', 9, 'Hand off follow-ups (billing, damage reports) to the coordinator.'),
    ('rental-equipment', 'Opening', 0, 'Access the rental/skate room.'),
    ('rental-equipment', 'Opening', 1, 'Inventory rental skates by size and confirm counts against the log.'),
    ('rental-equipment', 'Opening', 2, 'Inspect skates for dull/damaged blades, broken laces, and loose rivets.'),
    ('rental-equipment', 'Opening', 3, 'Confirm helmets and protective gear are clean and undamaged.'),
    ('rental-equipment', 'Opening', 4, 'Set up the rental station (claim tickets, wristbands, or shoe-hold system).'),
    ('rental-equipment', 'Opening', 5, 'Post the sizing chart and rental pricing.'),
    ('rental-equipment', 'Opening', 6, 'Stock sizing tools and replacement laces.'),
    ('rental-equipment', 'Opening', 7, 'Sanitize high-touch rental gear per policy.'),
    ('rental-equipment', 'Opening', 8, 'Confirm sharpening status of rental skates.'),
    ('rental-equipment', 'Opening', 9, 'Review the day''s expected rental volume.'),
    ('rental-equipment', 'Daily', 0, 'Fit and issue rental skates, helmets, and gear by size.'),
    ('rental-equipment', 'Daily', 1, 'Track each rental with a claim ticket/wristband and the customer''s shoes.'),
    ('rental-equipment', 'Daily', 2, 'Inspect returned skates for damage; pull damaged pairs for repair.'),
    ('rental-equipment', 'Daily', 3, 'Sanitize helmets and shared gear between users.'),
    ('rental-equipment', 'Daily', 4, 'Re-rack returned skates by size.'),
    ('rental-equipment', 'Daily', 5, 'Maintain accurate rental counts throughout the session.'),
    ('rental-equipment', 'Daily', 6, 'Replace broken laces and address minor repairs.'),
    ('rental-equipment', 'Daily', 7, 'Flag skates needing sharpening or blade work.'),
    ('rental-equipment', 'Daily', 8, 'Keep the rental area organized and safe.'),
    ('rental-equipment', 'Daily', 9, 'Log damaged or out-of-service equipment.'),
    ('rental-equipment', 'Closing', 0, 'Collect all outstanding rentals; reconcile against claim tickets.'),
    ('rental-equipment', 'Closing', 1, 'Inspect all returned skates and gear for damage.'),
    ('rental-equipment', 'Closing', 2, 'Pull and tag skates needing sharpening or repair.'),
    ('rental-equipment', 'Closing', 3, 'Sanitize helmets and shared protective gear.'),
    ('rental-equipment', 'Closing', 4, 'Re-rack all skates by size and confirm inventory counts.'),
    ('rental-equipment', 'Closing', 5, 'Restock laces and rental supplies for the next day.'),
    ('rental-equipment', 'Closing', 6, 'Note missing or unreturned equipment.'),
    ('rental-equipment', 'Closing', 7, 'Secure the rental room.'),
    ('rental-equipment', 'Closing', 8, 'Update the rental inventory log.'),
    ('rental-equipment', 'Closing', 9, 'Hand off repair/sharpening needs to the pro shop.'),
    ('skating-aids', 'Opening', 0, 'Inventory skating aids (walkers/supports) and confirm counts.'),
    ('skating-aids', 'Opening', 1, 'Inspect each aid for cracks, sharp edges, loose parts, or damage.'),
    ('skating-aids', 'Opening', 2, 'Clean and sanitize aids per policy.'),
    ('skating-aids', 'Opening', 3, 'Stage aids at the designated distribution point near the ice.'),
    ('skating-aids', 'Opening', 4, 'Post rental pricing or program-inclusion information.'),
    ('skating-aids', 'Opening', 5, 'Ready the aid sign-out/tracking system.'),
    ('skating-aids', 'Opening', 6, 'Pull and tag any damaged aids out of service.'),
    ('skating-aids', 'Opening', 7, 'Confirm the storage area is accessible and organized.'),
    ('skating-aids', 'Opening', 8, 'Coordinate aid availability with Learn to Skate and public sessions.'),
    ('skating-aids', 'Opening', 9, 'Review expected demand for the day.'),
    ('skating-aids', 'Daily', 0, 'Distribute skating aids to skaters and track usage.'),
    ('skating-aids', 'Daily', 1, 'Demonstrate safe use of aids to first-time users.'),
    ('skating-aids', 'Daily', 2, 'Monitor aids on the ice for safe use and spacing.'),
    ('skating-aids', 'Daily', 3, 'Inspect aids on return for damage.'),
    ('skating-aids', 'Daily', 4, 'Sanitize aids between users per policy.'),
    ('skating-aids', 'Daily', 5, 'Re-stage available aids at the distribution point.'),
    ('skating-aids', 'Daily', 6, 'Pull and tag damaged aids during the session.'),
    ('skating-aids', 'Daily', 7, 'Maintain accurate counts of aids in use vs. available.'),
    ('skating-aids', 'Daily', 8, 'Coordinate with skate guards on aid users on the ice.'),
    ('skating-aids', 'Daily', 9, 'Log usage and any issues.'),
    ('skating-aids', 'Closing', 0, 'Collect all skating aids from the ice and distribution point.'),
    ('skating-aids', 'Closing', 1, 'Inspect each aid for damage; tag any needing repair or removal.'),
    ('skating-aids', 'Closing', 2, 'Sanitize all aids per policy.'),
    ('skating-aids', 'Closing', 3, 'Re-rack/store all aids and confirm the full inventory count.'),
    ('skating-aids', 'Closing', 4, 'Note missing or damaged aids.'),
    ('skating-aids', 'Closing', 5, 'Restock the distribution point for the next day.'),
    ('skating-aids', 'Closing', 6, 'Secure the storage area.'),
    ('skating-aids', 'Closing', 7, 'Update the skating-aid inventory log.'),
    ('skating-aids', 'Closing', 8, 'Confirm none are left on the ice or in walkways.'),
    ('skating-aids', 'Closing', 9, 'Hand off repair needs and counts to the next shift.'),
    ('custom-reserved', 'Opening', 0, 'Unlock and access the assigned area or space.'),
    ('custom-reserved', 'Opening', 1, 'Inspect the area for cleanliness, safety, and readiness.'),
    ('custom-reserved', 'Opening', 2, 'Confirm area-specific equipment and supplies are present and functional.'),
    ('custom-reserved', 'Opening', 3, 'Review the day''s bookings or scheduled use for this area.'),
    ('custom-reserved', 'Opening', 4, 'Set up the area per the day''s requirements.'),
    ('custom-reserved', 'Opening', 5, 'Verify lighting, ventilation, and comfort conditions.'),
    ('custom-reserved', 'Opening', 6, 'Check for damage or maintenance needs.'),
    ('custom-reserved', 'Opening', 7, 'Confirm area-specific safety equipment is accessible.'),
    ('custom-reserved', 'Opening', 8, 'Review handoff notes from the prior shift.'),
    ('custom-reserved', 'Opening', 9, '[Admin: add facility-specific opening items here.]'),
    ('custom-reserved', 'Daily', 0, 'Manage scheduled use and turnover for this area.'),
    ('custom-reserved', 'Daily', 1, 'Monitor the area for cleanliness, safety, and capacity.'),
    ('custom-reserved', 'Daily', 2, 'Restock supplies and address issues as they arise.'),
    ('custom-reserved', 'Daily', 3, 'Coordinate this area''s use with related departments.'),
    ('custom-reserved', 'Daily', 4, 'Respond to user and guest needs in this area.'),
    ('custom-reserved', 'Daily', 5, 'Track usage, bookings, or transactions specific to this area.'),
    ('custom-reserved', 'Daily', 6, 'Maintain area-specific equipment.'),
    ('custom-reserved', 'Daily', 7, 'Log any incidents or maintenance items.'),
    ('custom-reserved', 'Daily', 8, 'Enforce area-specific rules and policies.'),
    ('custom-reserved', 'Daily', 9, '[Admin: add facility-specific operational items here.]'),
    ('custom-reserved', 'Closing', 0, 'Clear the area and confirm no occupants remain.'),
    ('custom-reserved', 'Closing', 1, 'Clean and reset the area to standard configuration.'),
    ('custom-reserved', 'Closing', 2, 'Secure and store area-specific equipment and supplies.'),
    ('custom-reserved', 'Closing', 3, 'Inspect for damage and note maintenance needs.'),
    ('custom-reserved', 'Closing', 4, 'Reconcile any usage counts or revenue for this area.'),
    ('custom-reserved', 'Closing', 5, 'Restock for the next day.'),
    ('custom-reserved', 'Closing', 6, 'Turn off lighting and equipment; secure the space.'),
    ('custom-reserved', 'Closing', 7, 'Log closing tasks and open items.'),
    ('custom-reserved', 'Closing', 8, 'Hand off follow-ups to the next shift.'),
    ('custom-reserved', 'Closing', 9, '[Admin: add facility-specific closing items here.]'),
    ('financials', 'Opening', 0, 'Confirm all POS and cash drawers have verified starting floats.'),
    ('financials', 'Opening', 1, 'Reconcile prior-day deposits against the deposit log.'),
    ('financials', 'Opening', 2, 'Confirm prior-day Z-reports/sales summaries are filed.'),
    ('financials', 'Opening', 3, 'Verify the safe balance and petty cash against the log.'),
    ('financials', 'Opening', 4, 'Review outstanding invoices, deposits owed, and pending refunds.'),
    ('financials', 'Opening', 5, 'Confirm payment processing and card systems are online.'),
    ('financials', 'Opening', 6, 'Review the day''s expected revenue events (programs, rentals, events).'),
    ('financials', 'Opening', 7, 'Check for overnight chargebacks or payment discrepancies.'),
    ('financials', 'Opening', 8, 'Confirm change/coin supply is adequate for the day.'),
    ('financials', 'Opening', 9, 'Note financial handoff items from the prior shift.'),
    ('financials', 'Daily', 0, 'Monitor cash handling and POS accuracy across departments.'),
    ('financials', 'Daily', 1, 'Track revenue by category (admissions, rentals, retail, concessions, programs).'),
    ('financials', 'Daily', 2, 'Process refunds, voids, and adjustments per policy with documentation.'),
    ('financials', 'Daily', 3, 'Make mid-day deposits or cash pickups per cash-handling policy.'),
    ('financials', 'Daily', 4, 'Reconcile department drawers at shift changes.'),
    ('financials', 'Daily', 5, 'Document all financial exceptions and discrepancies.'),
    ('financials', 'Daily', 6, 'Manage petty-cash disbursements with receipts.'),
    ('financials', 'Daily', 7, 'Coordinate billing for events, rentals, and program registrations.'),
    ('financials', 'Daily', 8, 'Monitor payment processing for failures or holds.'),
    ('financials', 'Daily', 9, 'Log financial activity throughout the day.'),
    ('financials', 'Closing', 0, 'Collect and reconcile all department cash drawers against sales reports.'),
    ('financials', 'Closing', 1, 'Run consolidated end-of-day sales/Z-reports across all POS stations.'),
    ('financials', 'Closing', 2, 'Reconcile total cash, card, and other tender against system totals.'),
    ('financials', 'Closing', 3, 'Investigate and document any overages or shortages.'),
    ('financials', 'Closing', 4, 'Prepare the bank deposit and complete the deposit log.'),
    ('financials', 'Closing', 5, 'Secure all cash in the safe per cash-handling policy.'),
    ('financials', 'Closing', 6, 'Reset drawer floats for the next day.'),
    ('financials', 'Closing', 7, 'File all sales reports, deposit records, and exception documentation.'),
    ('financials', 'Closing', 8, 'Confirm payment-processing batches have settled.'),
    ('financials', 'Closing', 9, 'Complete the daily financial summary and hand off open items.')
)
insert into public.daily_report_checklist_items (facility_id, template_id, label, sort_order, is_active)
select t.facility_id, t.id, i.label, i.sort_order, true
from item i
join public.daily_report_areas a on a.facility_id = p_facility_id and a.slug = i.area_slug
join public.daily_report_templates t on t.area_id = a.id and t.name = i.template_name
where not exists (
  select 1 from public.daily_report_checklist_items ci
  where ci.template_id = t.id and ci.label = i.label
);

end;
$$;


--
-- Name: FUNCTION seed_default_daily_report_checklists(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_daily_report_checklists(p_facility_id uuid) IS 'Seeds the standard Operations Checklists catalog (17 areas, 51 phase templates, 506 items) for one facility. Idempotent. Called by create_facility_with_roles on facility creation; service_role may invoke it directly to backfill.';


--
-- Name: seed_default_facility_air_quality_config(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_facility_air_quality_config(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id
  from public.air_quality_compliance_profiles
  where jurisdiction = 'USIRA';

  insert into public.facility_air_quality_config (facility_id, compliance_profile_id)
  values (p_facility_id, v_profile_id)
  on conflict (facility_id) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_facility_air_quality_config(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_facility_air_quality_config(p_facility_id uuid) IS 'Seeds a facility_air_quality_config row defaulting to the USIRA profile. Idempotent via on conflict do nothing on (facility_id).';


--
-- Name: seed_default_facility_dropdown_options(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_facility_dropdown_options(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  -- Authorization guard (added in this migration). Reachable as an
  -- authenticated PostgREST RPC, so it must not trust an arbitrary
  -- p_facility_id. Allow:
  --   * trusted backend roles / the owner — under which the AFTER INSERT
  --     auto-seed trigger and create_facility_with_roles run in definer
  --     context (current_user is the owner, not the end user);
  --   * a super admin (public.is_super_admin());
  --   * a facility admin for THIS facility (public.is_facility_admin()).
  -- AND short-circuits, so the helpers (which read auth.uid()) are only called
  -- for an end-user role, never during provisioning. Mirrors requireAdmin()'s
  -- primary checks; the rare employee-role-only admin (not in user_permissions)
  -- should re-run provisioning rather than hit this RPC directly.
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
     and not public.is_super_admin()
     and not public.is_facility_admin(p_facility_id) then
    raise exception 'not authorized to seed dropdown options for this facility'
      using errcode = '42501';
  end if;

  -- facility_timezone: mirrors TIMEZONE_OPTIONS. key = IANA identifier (stored
  -- verbatim in facilities.timezone), display_name = friendly label.
  insert into public.facility_dropdown_options
    (facility_id, domain, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'facility_timezone', 'America/New_York',    'Eastern — New York',          1,  true),
    (p_facility_id, 'facility_timezone', 'America/Detroit',     'Eastern — Detroit',           2,  true),
    (p_facility_id, 'facility_timezone', 'America/Chicago',     'Central — Chicago',           3,  true),
    (p_facility_id, 'facility_timezone', 'America/Denver',      'Mountain — Denver',           4,  true),
    (p_facility_id, 'facility_timezone', 'America/Phoenix',     'Mountain (no DST) — Phoenix', 5,  true),
    (p_facility_id, 'facility_timezone', 'America/Los_Angeles', 'Pacific — Los Angeles',       6,  true),
    (p_facility_id, 'facility_timezone', 'America/Anchorage',   'Alaska — Anchorage',          7,  true),
    (p_facility_id, 'facility_timezone', 'Pacific/Honolulu',    'Hawaii — Honolulu',           8,  true),
    (p_facility_id, 'facility_timezone', 'America/Toronto',     'Eastern — Toronto',           9,  true),
    (p_facility_id, 'facility_timezone', 'America/Vancouver',   'Pacific — Vancouver',         10, true),
    (p_facility_id, 'facility_timezone', 'UTC',                 'UTC',                         11, true)
  on conflict (facility_id, domain, key) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_facility_dropdown_options(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_facility_dropdown_options(p_facility_id uuid) IS 'Seeds canonical facility_dropdown_options for a facility across all domains. Idempotent via on conflict (facility_id, domain, key) do nothing.';


--
-- Name: seed_default_facility_modules(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_facility_modules(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.facility_modules (facility_id, module_key, enabled)
  select p_facility_id, k, true
  from (values
    ('daily_reports'),
    ('ice_depth'),
    ('ice_operations'),
    ('refrigeration'),
    ('air_quality'),
    ('incident_reports'),
    ('accident_reports'),
    ('scheduling'),
    ('communications'),
    ('facility_paperwork')
  ) as m(k)
  on conflict (facility_id, module_key) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_facility_modules(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_facility_modules(p_facility_id uuid) IS 'Seeds facility_modules with every canonical module enabled. Idempotent via on conflict do nothing on (facility_id, module_key).';


--
-- Name: seed_default_facility_spaces(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_facility_spaces(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.facility_spaces (facility_id, name, slug, sort_order, is_active)
  values
    (p_facility_id, 'Main Rink',   'main_rink',   1,  true),
    (p_facility_id, 'Lobby',       'lobby',       2,  true),
    (p_facility_id, 'Locker Room', 'locker_room', 3,  true),
    (p_facility_id, 'Pro Shop',    'pro_shop',    4,  true),
    (p_facility_id, 'Parking Lot', 'parking_lot', 5,  true),
    (p_facility_id, 'Ice Surface', 'ice_surface', 6,  true),
    (p_facility_id, 'Bench',       'bench',       7,  true),
    (p_facility_id, 'Concession',  'concession',  8,  true),
    (p_facility_id, 'Boardroom',   'boardroom',   9,  true),
    (p_facility_id, 'Other',       'other',       10, true)
  on conflict (facility_id, slug) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_facility_spaces(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_facility_spaces(p_facility_id uuid) IS 'Seeds a generic starter set of facility spaces (shared across incident/accident/air-quality). Idempotent via on conflict do nothing on (facility_id, slug).';


--
-- Name: seed_default_ice_depth_settings(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_ice_depth_settings(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.ice_depth_settings
    (facility_id, measurement_unit, low_threshold, high_threshold,
     low_color, ok_color, high_color,
     alerts_enabled, alert_on, default_alert_severity)
  values
    (p_facility_id, 'inches', 0.99, 1.75,
     '#ef4444', '#22c55e', '#eab308',
     false, 'low', 'high')
  on conflict (facility_id) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_ice_depth_settings(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_ice_depth_settings(p_facility_id uuid) IS 'Seeds the default ice_depth_settings row for a facility (inches, 0.99/1.75 thresholds, red/green/yellow, alerts off). Idempotent. Does NOT seed layouts or points -- admin builds those manually per spec.';


--
-- Name: seed_default_ice_operations_config(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_ice_operations_config(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  r record;
begin
  insert into public.ice_operations_settings
    (facility_id, temperature_unit, alerts_enabled, default_alert_severity)
  values
    (p_facility_id, 'F', true, 'high')
  on conflict (facility_id) do nothing;

  for r in
    select * from (values
      ('Check oil level',          'ice_resurfacer', 0),
      ('Check tire pressure',      'ice_resurfacer', 1),
      ('Check blade sharpness',    'ice_resurfacer', 2),
      ('Inspect for fluid leaks',  'ice_resurfacer', 3),
      ('Check edger blade',        'edger',          4)
    ) as v(label, eq_type, sort_order)
  loop
    insert into public.ice_operations_circle_check_items
      (facility_id, label, applies_to_equipment_type, sort_order, is_active)
    select p_facility_id, r.label, r.eq_type, r.sort_order, true
    where not exists (
      select 1 from public.ice_operations_circle_check_items
      where facility_id = p_facility_id and label = r.label
    );
  end loop;
end;
$$;


--
-- Name: FUNCTION seed_default_ice_operations_config(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_ice_operations_config(p_facility_id uuid) IS 'Seeds the default ice_operations_settings row and a starter set of circle-check items for a facility. Idempotent. Does not seed rinks or equipment -- admin adds those.';


--
-- Name: seed_default_incident_activities(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_incident_activities(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.incident_activities (facility_id, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'public_skating',  'Public Skating',  1, true),
    (p_facility_id, 'hockey',          'Hockey',          2, true),
    (p_facility_id, 'figure_skating',  'Figure Skating',  3, true),
    (p_facility_id, 'learn_to_skate',  'Learn to Skate',  4, true),
    (p_facility_id, 'maintenance',     'Maintenance',     5, true)
  on conflict (facility_id, key) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_incident_activities(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_incident_activities(p_facility_id uuid) IS 'Seeds a generic starter set of incident activities. Idempotent via on conflict do nothing on (facility_id, key).';


--
-- Name: seed_default_incident_types_and_severities(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_incident_types_and_severities(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  -- Severities (lower sort_order = more critical, displayed first)
  insert into public.incident_severity_levels (facility_id, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'critical', 'Critical', 1, true),
    (p_facility_id, 'high',     'High',     2, true),
    (p_facility_id, 'medium',   'Medium',   3, true),
    (p_facility_id, 'low',      'Low',      4, true)
  on conflict (facility_id, key) do nothing;

  -- Incident types
  insert into public.incident_types (facility_id, name, slug, sort_order, is_active)
  values
    (p_facility_id, 'Theft',          'theft',          1, true),
    (p_facility_id, 'Vandalism',      'vandalism',      2, true),
    (p_facility_id, 'Safety Concern', 'safety_concern', 3, true),
    (p_facility_id, 'Other',          'other',          4, true)
  on conflict (facility_id, slug) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_incident_types_and_severities(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_incident_types_and_severities(p_facility_id uuid) IS 'Seeds 4 default incident severity levels and 4 default incident types for a facility. Idempotent via on conflict do nothing on the unique keys.';


--
-- Name: seed_default_refrigeration_sections(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_refrigeration_sections(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.refrigeration_sections
    (facility_id, slug, name, sort_order, is_active)
  values
    (p_facility_id, 'compressors',    'Compressors',     1, true),
    (p_facility_id, 'pumps',          'Pumps',           2, true),
    (p_facility_id, 'condensers',     'Condensers',      3, true),
    (p_facility_id, 'supply-return',  'Supply / Return', 4, true),
    (p_facility_id, 'machine-hours',  'Machine Hours',   5, true),
    (p_facility_id, 'alarms',         'Alarms',          6, true)
  on conflict (facility_id, slug) do nothing;

  insert into public.refrigeration_settings
    (facility_id, out_of_range_alerts_enabled, default_alert_severity)
  values
    (p_facility_id, false, 'warn')
  on conflict (facility_id) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_refrigeration_sections(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_refrigeration_sections(p_facility_id uuid) IS 'Seeds canonical refrigeration_sections (compressors, pumps, condensers, supply-return, machine-hours, alarms) and a default refrigeration_settings row for a facility. Idempotent, and slug-compatible with the admin console''s inline seeder.';


--
-- Name: seed_default_roles_for_facility(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_roles_for_facility(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.roles (facility_id, key, display_name, hierarchy_level, is_system)
  values
    (p_facility_id, 'super_admin', 'Super Admin',     0, true),
    (p_facility_id, 'admin',       'Administrator',   1, true),
    (p_facility_id, 'gm',          'General Manager', 2, true),
    (p_facility_id, 'manager',     'Manager',         3, true),
    (p_facility_id, 'supervisor',  'Supervisor',      4, true),
    (p_facility_id, 'staff',       'Staff',           5, true)
  on conflict (facility_id, key) do nothing;
end;
$$;


--
-- Name: FUNCTION seed_default_roles_for_facility(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_roles_for_facility(p_facility_id uuid) IS 'Seeds the six canonical system roles for a newly-created facility. Idempotent.';


--
-- Name: seed_default_scheduling_config(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_scheduling_config(p_facility_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.schedule_settings
    (facility_id, week_start_day, default_shift_minutes,
     minor_max_weekly_hours, overtime_weekly_hours,
     minimum_break_minutes, minimum_break_after_hours,
     swap_requires_manager_approval, open_shift_first_come,
     notify_on_publish, notify_on_overtime,
     availability_submission_enabled, require_job_area_qualification)
  values
    (p_facility_id, 0, 480,
     30, 40,
     30, 5,
     true, true,
     true, true,
     true, false)
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


--
-- Name: FUNCTION seed_default_scheduling_config(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_scheduling_config(p_facility_id uuid) IS 'Seeds default schedule_settings and three baseline schedule_compliance_rules rows for a facility. Idempotent.';


--
-- Name: seed_role_permission_defaults_for_facility(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_role_permission_defaults_for_facility(p_facility_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_count integer;
begin
  if not (public.is_super_admin() or public.is_facility_admin(p_facility_id)) then
    raise exception 'seed_role_permission_defaults_for_facility: not authorized';
  end if;

  insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
  select p_facility_id, r.id, g.module_name, g.action, true
  from public.canonical_role_permission_grants() g
  join public.roles r on r.facility_id = p_facility_id and r.key = g.role_key
  on conflict (facility_id, role_id, module_name, action)
    do update set enabled = excluded.enabled, updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: FUNCTION seed_role_permission_defaults_for_facility(p_facility_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_role_permission_defaults_for_facility(p_facility_id uuid) IS 'Admin-guarded. Seeds role_permission_defaults for all canonical roles in a facility from canonical_role_permission_grants(). Idempotent (upsert).';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: FUNCTION set_updated_at(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_updated_at() IS 'Trigger helper: sets NEW.updated_at = now() on UPDATE.';


--
-- Name: show_dashboard_module(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.show_dashboard_module(p_module_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.employees
     set hidden_modules = array_remove(hidden_modules, p_module_key)
   where user_id  = auth.uid()
     and is_active = true;
end;
$$;


--
-- Name: FUNCTION show_dashboard_module(p_module_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.show_dashboard_module(p_module_key text) IS 'Removes a module key from the caller''s own employees.hidden_modules array. No-op if not currently hidden.';


--
-- Name: submit_incident_report(uuid, uuid, uuid, uuid, uuid, text, text, text, timestamp with time zone, text, text, text, boolean, integer, boolean, uuid[], jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_incident_report(p_facility_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_severity_level_id uuid DEFAULT NULL::uuid, p_incident_type_id uuid DEFAULT NULL::uuid, p_activity_id uuid DEFAULT NULL::uuid, p_activity_other text DEFAULT NULL::text, p_location_other text DEFAULT NULL::text, p_immediate_actions text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reporter_name text DEFAULT NULL::text, p_reporter_phone text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_ambulance_flag boolean DEFAULT NULL::boolean, p_persons_involved integer DEFAULT NULL::integer, p_follow_up_required boolean DEFAULT NULL::boolean, p_space_ids uuid[] DEFAULT NULL::uuid[], p_witnesses jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_report public.incident_reports%rowtype;
begin
  insert into public.incident_reports (
    facility_id, employee_id, severity_level_id, incident_type_id,
    activity_id, activity_other, location_other, immediate_actions,
    occurred_at, reporter_name, reporter_phone, description,
    ambulance_flag, persons_involved, follow_up_required,
    status, submitted_at
  ) values (
    p_facility_id, p_employee_id, p_severity_level_id, p_incident_type_id,
    p_activity_id, p_activity_other, p_location_other, p_immediate_actions,
    p_occurred_at, p_reporter_name, p_reporter_phone, p_description,
    coalesce(p_ambulance_flag, false), p_persons_involved,
    coalesce(p_follow_up_required, false),
    'submitted', now()
  )
  returning * into v_report;

  insert into public.incident_report_spaces (incident_id, facility_id, space_id)
  select v_report.id, p_facility_id, sid
  from unnest(coalesce(p_space_ids, '{}'::uuid[])) as sid;

  insert into public.incident_witnesses
    (incident_id, facility_id, name, phone, email, statement, sort_order)
  select v_report.id, p_facility_id,
         w ->> 'name',
         nullif(w ->> 'phone', ''),
         nullif(w ->> 'email', ''),
         nullif(w ->> 'statement', ''),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_witnesses, '[]'::jsonb))
         with ordinality as t(w, ord);

  insert into public.incident_change_log
    (incident_id, facility_id, employee_id, action, before, after)
  values (
    v_report.id, p_facility_id, p_employee_id, 'create', null,
    jsonb_build_object(
      'id', v_report.id,
      'severity_level_id', v_report.severity_level_id,
      'incident_type_id', v_report.incident_type_id,
      'activity_id', v_report.activity_id,
      'activity_other', v_report.activity_other,
      'location_other', v_report.location_other,
      'immediate_actions', v_report.immediate_actions,
      'occurred_at', v_report.occurred_at,
      'submitted_at', v_report.submitted_at,
      'edit_window_ends_at', v_report.edit_window_ends_at,
      'reporter_name', v_report.reporter_name,
      'reporter_phone', v_report.reporter_phone,
      'description', v_report.description,
      'ambulance_flag', v_report.ambulance_flag,
      'persons_involved', v_report.persons_involved,
      'follow_up_required', v_report.follow_up_required,
      'space_ids', to_jsonb(coalesce(p_space_ids, '{}'::uuid[])),
      'witnesses', coalesce(p_witnesses, '[]'::jsonb)
    )
  );

  return v_report.id;
end;
$$;


--
-- Name: FUNCTION submit_incident_report(p_facility_id uuid, p_employee_id uuid, p_severity_level_id uuid, p_incident_type_id uuid, p_activity_id uuid, p_activity_other text, p_location_other text, p_immediate_actions text, p_occurred_at timestamp with time zone, p_reporter_name text, p_reporter_phone text, p_description text, p_ambulance_flag boolean, p_persons_involved integer, p_follow_up_required boolean, p_space_ids uuid[], p_witnesses jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.submit_incident_report(p_facility_id uuid, p_employee_id uuid, p_severity_level_id uuid, p_incident_type_id uuid, p_activity_id uuid, p_activity_other text, p_location_other text, p_immediate_actions text, p_occurred_at timestamp with time zone, p_reporter_name text, p_reporter_phone text, p_description text, p_ambulance_flag boolean, p_persons_involved integer, p_follow_up_required boolean, p_space_ids uuid[], p_witnesses jsonb) IS 'Atomic incident submission: report + spaces + witnesses + change log in one transaction. SECURITY INVOKER — RLS (008/103/104) still gates every write, so this grants no authority beyond the equivalent row-by-row inserts.';


--
-- Name: tg_seed_facility_air_quality_config(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_seed_facility_air_quality_config() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform public.seed_default_facility_air_quality_config(new.id);
  return new;
end;
$$;


--
-- Name: tg_seed_facility_modules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_seed_facility_modules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform public.seed_default_facility_modules(new.id);
  return new;
end;
$$;


--
-- Name: touch_role_permission_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_role_permission_defaults() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: trg_seed_facility_dropdown_options(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_seed_facility_dropdown_options() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform public.seed_default_facility_dropdown_options(new.id);
  return new;
end;
$$;


--
-- Name: trg_seed_role_permission_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_seed_role_permission_defaults() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.role_permission_defaults (facility_id, role_id, module_name, action, enabled)
  select new.facility_id, new.id, g.module_name, g.action, true
  from public.canonical_role_permission_grants() g
  where g.role_key = new.key
  on conflict (facility_id, role_id, module_name, action) do nothing;
  return new;
end;
$$;


--
-- Name: update_incident_report(uuid, uuid, uuid, uuid, text, text, text, timestamp with time zone, text, boolean, integer, boolean, uuid[], jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_incident_report(p_report_id uuid DEFAULT NULL::uuid, p_severity_level_id uuid DEFAULT NULL::uuid, p_incident_type_id uuid DEFAULT NULL::uuid, p_activity_id uuid DEFAULT NULL::uuid, p_activity_other text DEFAULT NULL::text, p_location_other text DEFAULT NULL::text, p_immediate_actions text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description text DEFAULT NULL::text, p_ambulance_flag boolean DEFAULT NULL::boolean, p_persons_involved integer DEFAULT NULL::integer, p_follow_up_required boolean DEFAULT NULL::boolean, p_space_ids uuid[] DEFAULT NULL::uuid[], p_witnesses jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_row    public.incident_reports%rowtype;
  v_before jsonb;
begin
  -- RLS select policy scopes visibility; the lock serializes concurrent edits.
  select * into v_row
  from public.incident_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception 'Report not found.';
  end if;

  v_before := jsonb_build_object(
    'severity_level_id', v_row.severity_level_id,
    'incident_type_id', v_row.incident_type_id,
    'activity_id', v_row.activity_id,
    'activity_other', v_row.activity_other,
    'location_other', v_row.location_other,
    'immediate_actions', v_row.immediate_actions,
    'occurred_at', v_row.occurred_at,
    'reporter_name', v_row.reporter_name,
    'reporter_phone', v_row.reporter_phone,
    'description', v_row.description,
    'ambulance_flag', v_row.ambulance_flag,
    'persons_involved', v_row.persons_involved,
    'follow_up_required', v_row.follow_up_required,
    'space_ids', (
      select coalesce(jsonb_agg(s.space_id order by s.space_id), '[]'::jsonb)
      from public.incident_report_spaces s
      where s.incident_id = p_report_id
    ),
    'witnesses', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', w.name, 'phone', w.phone,
            'email', w.email, 'statement', w.statement
          ) order by w.sort_order
        ),
        '[]'::jsonb
      )
      from public.incident_witnesses w
      where w.incident_id = p_report_id
    )
  );

  -- RLS update policy (103) enforces "owner within the edit window, or module
  -- admin". A row filtered out by the policy updates nothing → raise → the
  -- whole transaction (including nothing-yet) rolls back.
  update public.incident_reports set
    severity_level_id  = p_severity_level_id,
    incident_type_id   = p_incident_type_id,
    activity_id        = p_activity_id,
    activity_other     = p_activity_other,
    location_other     = p_location_other,
    immediate_actions  = p_immediate_actions,
    occurred_at        = p_occurred_at,
    description        = p_description,
    ambulance_flag     = coalesce(p_ambulance_flag, false),
    persons_involved   = p_persons_involved,
    follow_up_required = coalesce(p_follow_up_required, false)
  where id = p_report_id;
  if not found then
    raise exception 'You can no longer edit this report.';
  end if;

  -- Full replace of children (small row counts). Atomic here — a failed
  -- re-insert rolls the deletes back too, unlike the previous app-side path.
  delete from public.incident_report_spaces where incident_id = p_report_id;
  insert into public.incident_report_spaces (incident_id, facility_id, space_id)
  select p_report_id, v_row.facility_id, sid
  from unnest(coalesce(p_space_ids, '{}'::uuid[])) as sid;

  delete from public.incident_witnesses where incident_id = p_report_id;
  insert into public.incident_witnesses
    (incident_id, facility_id, name, phone, email, statement, sort_order)
  select p_report_id, v_row.facility_id,
         w ->> 'name',
         nullif(w ->> 'phone', ''),
         nullif(w ->> 'email', ''),
         nullif(w ->> 'statement', ''),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_witnesses, '[]'::jsonb))
         with ordinality as t(w, ord);

  insert into public.incident_change_log
    (incident_id, facility_id, employee_id, action, before, after)
  values (
    p_report_id, v_row.facility_id, public.current_employee_id(), 'update',
    v_before,
    jsonb_build_object(
      'severity_level_id', p_severity_level_id,
      'incident_type_id', p_incident_type_id,
      'activity_id', p_activity_id,
      'activity_other', p_activity_other,
      'location_other', p_location_other,
      'immediate_actions', p_immediate_actions,
      'occurred_at', p_occurred_at,
      'reporter_name', v_row.reporter_name,
      'reporter_phone', v_row.reporter_phone,
      'description', p_description,
      'ambulance_flag', coalesce(p_ambulance_flag, false),
      'persons_involved', p_persons_involved,
      'follow_up_required', coalesce(p_follow_up_required, false),
      'space_ids', to_jsonb(coalesce(p_space_ids, '{}'::uuid[])),
      'witnesses', coalesce(p_witnesses, '[]'::jsonb)
    )
  );
end;
$$;


--
-- Name: FUNCTION update_incident_report(p_report_id uuid, p_severity_level_id uuid, p_incident_type_id uuid, p_activity_id uuid, p_activity_other text, p_location_other text, p_immediate_actions text, p_occurred_at timestamp with time zone, p_description text, p_ambulance_flag boolean, p_persons_involved integer, p_follow_up_required boolean, p_space_ids uuid[], p_witnesses jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_incident_report(p_report_id uuid, p_severity_level_id uuid, p_incident_type_id uuid, p_activity_id uuid, p_activity_other text, p_location_other text, p_immediate_actions text, p_occurred_at timestamp with time zone, p_description text, p_ambulance_flag boolean, p_persons_involved integer, p_follow_up_required boolean, p_space_ids uuid[], p_witnesses jsonb) IS 'Atomic submitter/admin incident edit: snapshots before/after into incident_change_log and full-replaces spaces/witnesses in one transaction. SECURITY INVOKER — the 24h-window/admin RLS update policy (migration 103) still decides who may edit.';


--
-- Name: user_has_permission(uuid, uuid, text, public.user_action); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_permission(p_user_id uuid, p_facility_id uuid, p_module_name text, p_action public.user_action) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    (select u.is_super_admin from public.users u where u.id = p_user_id),
    false
  )
  or exists (
    select 1 from public.user_permissions
    where user_id     = p_user_id
      and facility_id = p_facility_id
      and module_name = p_module_name
      and action      = p_action
      and enabled     = true
  );
$$;


--
-- Name: FUNCTION user_has_permission(p_user_id uuid, p_facility_id uuid, p_module_name text, p_action public.user_action); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.user_has_permission(p_user_id uuid, p_facility_id uuid, p_module_name text, p_action public.user_action) IS 'True iff (user, facility, module, action) is enabled, or the user is a global super_admin.';


--
-- Name: validate_module_area_permission(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_module_area_permission() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.module_key = 'daily_reports' then
    if not exists (
      select 1 from public.daily_report_areas a
      where a.id = new.area_id and a.facility_id = new.facility_id
    ) then
      raise exception
        'module_area_permissions: area % does not exist in facility % for module daily_reports',
        new.area_id, new.facility_id;
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: FUNCTION validate_module_area_permission(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.validate_module_area_permission() IS 'BEFORE INSERT/UPDATE guard on module_area_permissions: the polymorphic area_id must reference an existing area in the same facility for the given module_key (daily_reports today). Added after 15 orphaned grants were found in production (2026-07-06 admin-area review).';


--
-- Name: accident_body_part_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accident_body_part_selections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    accident_id uuid NOT NULL,
    body_part_dropdown_id uuid NOT NULL,
    side text DEFAULT 'none'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    laterality text,
    CONSTRAINT accident_body_part_selections_laterality_check CHECK ((laterality = ANY (ARRAY['left'::text, 'right'::text]))),
    CONSTRAINT accident_body_part_selections_side_check CHECK ((side = ANY (ARRAY['front'::text, 'back'::text, 'both'::text, 'none'::text])))
);


--
-- Name: TABLE accident_body_part_selections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accident_body_part_selections IS 'Accident Reports: body parts selected on the SVG diagram (front/back/both/none) per accident. body_part_dropdown_id uses ON DELETE RESTRICT so admins cannot delete a body part referenced by historical reports.';


--
-- Name: COLUMN accident_body_part_selections.laterality; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accident_body_part_selections.laterality IS 'Left/right laterality for paired regions (arms, legs, shoulders, etc.). NULL for midline regions (head, neck, torso, hips, face_jaw) and for legacy rows submitted before paired-region splitting; the renderer treats NULL on a paired region as both sides.';


--
-- Name: accident_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accident_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    accident_id uuid NOT NULL,
    employee_id uuid,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE accident_change_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accident_change_log IS 'Accident Reports: append-only audit log. action e.g. create, update, add_body_part, remove_body_part. Visible to admins only. No update/delete policies.';


--
-- Name: accident_dropdowns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accident_dropdowns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    category text NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT accident_dropdowns_category_check CHECK ((category = ANY (ARRAY['injury_type'::text, 'body_part'::text, 'location'::text, 'activity'::text, 'medical_attention'::text, 'severity'::text])))
);


--
-- Name: TABLE accident_dropdowns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accident_dropdowns IS 'Accident Reports: per-facility admin-customizable dropdown values, partitioned by category. metadata extension point e.g. {"triggers_alert": true} on medical_attention rows.';


--
-- Name: accident_followup_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accident_followup_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    accident_id uuid NOT NULL,
    employee_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE accident_followup_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accident_followup_notes IS 'Accident Reports: append-only follow-up notes (used after the 24h edit window closes). No update/delete policies -- permanent history.';


--
-- Name: accident_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accident_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid,
    injured_person_name text NOT NULL,
    injured_person_contact text NOT NULL,
    description text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    location_dropdown_id uuid,
    activity_dropdown_id uuid,
    severity_dropdown_id uuid,
    medical_attention_dropdown_id uuid,
    primary_injury_type_dropdown_id uuid,
    workers_comp boolean DEFAULT false NOT NULL,
    workers_comp_acknowledged_at timestamp with time zone,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    edit_window_ends_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    injured_person_age smallint,
    CONSTRAINT accident_reports_injured_person_age_check CHECK (((injured_person_age IS NULL) OR ((injured_person_age >= 0) AND (injured_person_age <= 120))))
);


--
-- Name: TABLE accident_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accident_reports IS 'Accident Reports: per-facility accident submissions. Editable by submitter while now() <= edit_window_ends_at (24h default). Outside the window only admins may update; all changes should be logged in accident_change_log by the app.';


--
-- Name: COLUMN accident_reports.occurred_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accident_reports.occurred_at IS 'When the accident happened — a real UTC instant. Converted from the reporter''s wall clock using facilities.timezone at persist time (migration 174; earlier rows were reinterpreted from the legacy wall-clock-as-UTC encoding).';


--
-- Name: COLUMN accident_reports.location_dropdown_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accident_reports.location_dropdown_id IS 'Facility space where the accident occurred. References facility_spaces(id) (shared list) as of migration 142; retains its legacy column name.';


--
-- Name: COLUMN accident_reports.edit_window_ends_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accident_reports.edit_window_ends_at IS 'Convenience timestamp -- RLS update policy compares now() to this value to gate submitter edits.';


--
-- Name: COLUMN accident_reports.injured_person_age; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accident_reports.injured_person_age IS 'Age (years) of the injured person at the time of submission. Nullable for historical rows; the submission form requires it on new reports.';


--
-- Name: accident_witnesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accident_witnesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    accident_id uuid NOT NULL,
    name text NOT NULL,
    contact text,
    statement text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT accident_witnesses_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT accident_witnesses_sort_order_check CHECK (((sort_order >= 0) AND (sort_order <= 4)))
);


--
-- Name: TABLE accident_witnesses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accident_witnesses IS 'Accident Reports: up to 5 witnesses per accident. Captured by the submitter; editable while the parent report is within its 24h edit window.';


--
-- Name: accident_workers_comp_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accident_workers_comp_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE accident_workers_comp_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.accident_workers_comp_settings IS 'Accident Reports: admin-customizable Workers'' Comp instructions text shown when the workers_comp toggle is on. Exactly one is_active=true row per facility (partial unique index).';


--
-- Name: air_quality_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    changed_by uuid NOT NULL,
    reason text NOT NULL,
    before jsonb DEFAULT '{}'::jsonb NOT NULL,
    after jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE air_quality_change_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_change_log IS 'Append-only correction log for air quality submissions. Original submission rows are immutable; all changes are recorded here.';


--
-- Name: air_quality_compliance_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_compliance_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction text NOT NULL,
    display_name text NOT NULL,
    method text DEFAULT 'single'::text NOT NULL,
    is_binding boolean DEFAULT false NOT NULL,
    metrics jsonb DEFAULT '[]'::jsonb NOT NULL,
    tiers jsonb DEFAULT '{}'::jsonb NOT NULL,
    sampling_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    escalation_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    guidance_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT air_quality_compliance_profiles_method_check CHECK ((method = ANY (ARRAY['single'::text, 'twa_1hr'::text])))
);


--
-- Name: TABLE air_quality_compliance_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_compliance_profiles IS 'Global jurisdiction reference profiles for the Air Quality compliance engine. metrics/tiers/sampling_rules/escalation_rules are jsonb; method = single sample vs 1-hr TWA; is_binding distinguishes regulation (MN/MA) from guidance (WI/USIRA). Readable by all authenticated users; super_admin writes only.';


--
-- Name: COLUMN air_quality_compliance_profiles.tiers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_compliance_profiles.tiers IS 'Per-metric escalating tiers: { <metric>: { corrective?: {max?, consecutive?}, notification?: {...}, evacuation?: {...} } }. A value strictly greater than a tier max hits that tier; precedence evacuation > notification > corrective.';


--
-- Name: air_quality_compliance_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_compliance_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    jurisdiction text NOT NULL,
    rule_name text NOT NULL,
    rule_body text NOT NULL,
    effective_from date,
    effective_to date,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE air_quality_compliance_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_compliance_rules IS 'Air Quality: jurisdiction-aware compliance text shown to staff/admins. rule_body is markdown-ish but rendered as plain text by the UI.';


--
-- Name: COLUMN air_quality_compliance_rules.jurisdiction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_compliance_rules.jurisdiction IS 'Free-form jurisdiction key (e.g. ''us_federal'', ''on_canada'', ''eu''). Matched against air_quality_settings.default_jurisdiction.';


--
-- Name: air_quality_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    location_id uuid,
    name text NOT NULL,
    slug text NOT NULL,
    model text,
    serial_number text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE air_quality_equipment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_equipment IS 'Air Quality: equipment instances (monitors). location_id null = facility-wide / handheld. Admin controlled.';


--
-- Name: air_quality_followup_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_followup_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    report_id uuid NOT NULL,
    employee_id uuid,
    body text NOT NULL,
    is_admin_note boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE air_quality_followup_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_followup_notes IS 'Air Quality: append-only follow-up notes (admin/manager only). No update/delete policies.';


--
-- Name: air_quality_reading_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_reading_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    unit text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    decimals integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE air_quality_reading_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_reading_types IS 'Air Quality: per-facility reading types collected per submission (co, co2, temperature, humidity, etc.). Admin controlled.';


--
-- Name: COLUMN air_quality_reading_types.is_required; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_reading_types.is_required IS 'Hint to the submit form -- when true the UI must require a value for every active location.';


--
-- Name: COLUMN air_quality_reading_types.decimals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_reading_types.decimals IS 'Display precision hint (e.g. 1 = "12.3"). Storage is numeric -- this only affects rendering.';


--
-- Name: air_quality_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    report_id uuid NOT NULL,
    reading_type_id uuid,
    key_snapshot text NOT NULL,
    label_snapshot text NOT NULL,
    unit_snapshot text NOT NULL,
    value_numeric numeric NOT NULL,
    is_exceedance boolean DEFAULT false NOT NULL,
    severity_at_submit text,
    compliance_min_at_submit numeric,
    compliance_max_at_submit numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT air_quality_readings_severity_at_submit_check CHECK ((severity_at_submit = ANY (ARRAY['warn'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: TABLE air_quality_readings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_readings IS 'Air Quality: per-reading-type captured values for a report. Snapshot columns preserve key/label/unit and the matched compliance bounds in case admin later edits or deletes the source rows. is_exceedance / severity_at_submit / threshold_id are populated by the app at submit time using the location-aware threshold-match rule.';


--
-- Name: COLUMN air_quality_readings.severity_at_submit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_readings.severity_at_submit IS 'Severity copied from the matching threshold row when is_exceedance = true; null otherwise. Drives the corresponding communication_alerts severity.';


--
-- Name: air_quality_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid,
    location_id uuid NOT NULL,
    equipment_id uuid,
    notes text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    has_exceedance boolean DEFAULT false NOT NULL,
    max_severity text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    form_data jsonb,
    CONSTRAINT air_quality_reports_max_severity_check CHECK ((max_severity = ANY (ARRAY['warn'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: TABLE air_quality_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_reports IS 'Air Quality: a single submission for one location. Original is immutable -- only super_admin may UPDATE/DELETE. Staff append context via air_quality_followup_notes (admins/managers only).';


--
-- Name: COLUMN air_quality_reports.location_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_reports.location_id IS 'Facility space the readings were taken in. References facility_spaces(id) (shared list) as of migration 143.';


--
-- Name: COLUMN air_quality_reports.has_exceedance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_reports.has_exceedance IS 'Denormalized: true if any associated air_quality_readings row has is_exceedance = true. Server sets at submit time.';


--
-- Name: COLUMN air_quality_reports.max_severity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_reports.max_severity IS 'Denormalized: max severity across all readings on this report using ordering warn < high < critical. Null when has_exceedance = false. Server sets at submit time.';


--
-- Name: COLUMN air_quality_reports.form_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.air_quality_reports.form_data IS 'Optional extended monitoring-log payload (tester/equipment details, Section 1 general info, Section 2 routine/post-edging measurements, Section 4 recommendations). All fields optional; supplementary to air_quality_readings. Written by the staff submit action.';


--
-- Name: air_quality_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.air_quality_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    testing_frequency text,
    default_jurisdiction text,
    alerts_enabled boolean DEFAULT true NOT NULL,
    default_alert_severity text DEFAULT 'high'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT air_quality_settings_default_alert_severity_check CHECK ((default_alert_severity = ANY (ARRAY['warn'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: TABLE air_quality_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.air_quality_settings IS 'Air Quality: per-facility module config. When alerts_enabled = true the app evaluates thresholds at submit time and inserts communication_alerts (source_module = ''air_quality'') for exceedances. default_jurisdiction selects which air_quality_compliance_rules rows to render to staff.';


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    actor_user_id uuid,
    actor_employee_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    before jsonb,
    after jsonb,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS 'Append-only audit trail. No UPDATE/DELETE allowed by RLS.';


--
-- Name: COLUMN audit_logs.action; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_logs.action IS 'Verb (e.g. ''create'', ''update'', ''delete'', ''login'').';


--
-- Name: COLUMN audit_logs.entity_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_logs.entity_type IS 'Logical type (table or domain object) being acted upon.';


--
-- Name: certification_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certification_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT certification_types_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200)))
);


--
-- Name: TABLE certification_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.certification_types IS 'Per-facility certification catalog (CPR, refrigeration operator, ...). Job-area requirements and employee certifications link here by id, so renaming a certification cannot break scheduling enforcement (which previously matched free-text names).';


--
-- Name: communication_acknowledgements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_acknowledgements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    alert_id uuid,
    message_id uuid,
    employee_id uuid NOT NULL,
    acknowledged_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT communication_acknowledgements_one_target_chk CHECK ((((alert_id IS NOT NULL) AND (message_id IS NULL)) OR ((alert_id IS NULL) AND (message_id IS NOT NULL))))
);


--
-- Name: TABLE communication_acknowledgements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_acknowledgements IS 'Communications: append-only acknowledgements for an alert OR a message (exactly one). No UPDATE/DELETE policies.';


--
-- Name: communication_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    source_module text NOT NULL,
    source_record_id uuid,
    severity text NOT NULL,
    title text NOT NULL,
    body text,
    area_id uuid,
    created_by_employee_id uuid,
    requires_acknowledgement boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT communication_alerts_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: TABLE communication_alerts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_alerts IS 'Communications: alerts generated by source modules (ice_operations, refrigeration, accident_reports, air_quality, incident_reports, scheduling). source_record_id and area_id are soft references (no FK) because target table varies by source_module.';


--
-- Name: COLUMN communication_alerts.source_module; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_alerts.source_module IS 'Originating module key, e.g. ice_operations, refrigeration, accident_reports, air_quality, incident_reports, scheduling.';


--
-- Name: COLUMN communication_alerts.source_record_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_alerts.source_record_id IS 'Soft reference to source record; no FK -- target table varies by source_module.';


--
-- Name: COLUMN communication_alerts.area_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_alerts.area_id IS 'Soft reference to module-specific area row; no FK because area tables vary by module.';


--
-- Name: communication_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    action text NOT NULL,
    actor_employee_id uuid,
    before jsonb,
    after jsonb,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE communication_audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_audit_log IS 'Communications: append-only audit log. entity_type values e.g. message, alert, template, rule. No UPDATE/DELETE.';


--
-- Name: communication_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    group_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE communication_group_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_group_members IS 'Communications: employee membership in communication_groups.';


--
-- Name: communication_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    staff_can_message boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE communication_groups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_groups IS 'Communications: per-facility messaging groups (departments, roles, ad-hoc).';


--
-- Name: COLUMN communication_groups.staff_can_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_groups.staff_can_message IS 'When true, non-admin staff with communications.can_submit may target this group from /reports/communications/compose. Admins are not gated by this flag. Default false so existing groups must be opted in explicitly.';


--
-- Name: communication_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    sender_employee_id uuid,
    template_id uuid,
    subject text,
    body text NOT NULL,
    requires_acknowledgement boolean DEFAULT false NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    pdf_url text,
    parent_message_id uuid
);


--
-- Name: TABLE communication_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_messages IS 'Communications: a sent in-app message. Recipients tracked in communication_recipients.';


--
-- Name: COLUMN communication_messages.pdf_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_messages.pdf_url IS 'Storage object path (within the notification-pdfs bucket) for the rendered PDF. The inbox server-component signs this on read; never publicly exposed.';


--
-- Name: COLUMN communication_messages.parent_message_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_messages.parent_message_id IS 'Message this one replies to; null for top-level messages. Set-null on parent delete.';


--
-- Name: communication_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    message_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email_status text DEFAULT 'pending'::text NOT NULL,
    email_sent_at timestamp with time zone,
    email_error text,
    email_attempts integer DEFAULT 0 NOT NULL,
    email_next_attempt_at timestamp with time zone,
    email_claim_token uuid,
    CONSTRAINT communication_recipients_email_status_check CHECK ((email_status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: TABLE communication_recipients; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_recipients IS 'Communications: per-employee delivery / read / ack timestamps for a message.';


--
-- Name: COLUMN communication_recipients.email_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_recipients.email_status IS 'External email delivery state. pending = ready or waiting for retry; sending = claimed by a cron worker until email_next_attempt_at; sent/failed/skipped are terminal.';


--
-- Name: COLUMN communication_recipients.email_attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_recipients.email_attempts IS 'How many send attempts have been made. Resets implicitly when a row is re-inserted (we never UPDATE this back to 0).';


--
-- Name: COLUMN communication_recipients.email_next_attempt_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_recipients.email_next_attempt_at IS 'Earliest UTC time at which the send-communications cron may retry this row. NULL means "ready now". Set by the cron worker after a transient failure; cleared implicitly on success/terminal failure since the row leaves email_status=pending.';


--
-- Name: COLUMN communication_recipients.email_claim_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_recipients.email_claim_token IS 'Random UUID written by the cron worker when claiming a row for email delivery. Settlement updates must match this token so stale workers cannot overwrite newer claims.';


--
-- Name: communication_recurring_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_recurring_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    schedule_cron text NOT NULL,
    template_id uuid NOT NULL,
    target_group_id uuid,
    target_role_key text,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE communication_recurring_reminders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_recurring_reminders IS 'Communications: recurring reminders. schedule_cron is a cron-like string interpreted by the app worker (not pg_cron).';


--
-- Name: communication_routing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_routing_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text,
    source_module text NOT NULL,
    severity text,
    area_id uuid,
    target_group_id uuid,
    target_role_key text,
    target_employee_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    target_department_id uuid,
    timing text DEFAULT 'immediate'::text NOT NULL,
    attach_pdf boolean DEFAULT false NOT NULL,
    last_run_at timestamp with time zone,
    last_run_status text,
    requires_acknowledgement boolean DEFAULT false NOT NULL,
    CONSTRAINT communication_routing_rules_target_chk CHECK (((target_group_id IS NOT NULL) OR (target_role_key IS NOT NULL) OR (target_employee_id IS NOT NULL) OR (target_department_id IS NOT NULL))),
    CONSTRAINT communication_routing_rules_timing_check CHECK ((timing = ANY (ARRAY['immediate'::text, 'end_of_day'::text, 'weekly'::text, 'manual'::text])))
);


--
-- Name: TABLE communication_routing_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_routing_rules IS 'Communications: rules that route incoming alerts (by source_module / severity / area_id) to a group, role, or specific employee.';


--
-- Name: COLUMN communication_routing_rules.requires_acknowledgement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communication_routing_rules.requires_acknowledgement IS 'When true, communication_messages produced by this rule are stamped requires_acknowledgement=true so recipients must explicitly acknowledge them in the inbox.';


--
-- Name: communication_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    category text,
    subject text,
    body text NOT NULL,
    requires_acknowledgement boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE communication_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communication_templates IS 'Communications: reusable message templates. category examples: shift_change, safety_briefing, general.';


--
-- Name: daily_report_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_report_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE daily_report_areas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_report_areas IS 'Daily Reports: per-facility checklist areas (max 30 active per facility).';


--
-- Name: daily_report_checklist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_report_checklist_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    template_id uuid NOT NULL,
    label text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE daily_report_checklist_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_report_checklist_items IS 'Daily Reports: individual checkbox rows belonging to a template.';


--
-- Name: daily_report_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_report_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    employee_id uuid,
    body text NOT NULL,
    is_admin_note boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE daily_report_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_report_notes IS 'Daily Reports: free-text notes attached to a submission. is_admin_note differentiates staff-authored vs. admin-authored notes.';


--
-- Name: daily_report_submission_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_report_submission_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    checklist_item_id uuid,
    label_snapshot text NOT NULL,
    is_checked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE daily_report_submission_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_report_submission_items IS 'Daily Reports: per-item check state for a submission. label_snapshot preserves history if the underlying checklist item is later edited or removed.';


--
-- Name: daily_report_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_report_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    area_id uuid NOT NULL,
    template_id uuid NOT NULL,
    employee_id uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    business_date date
);


--
-- Name: TABLE daily_report_submissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_report_submissions IS 'Daily Reports: a single submission against a template by an employee.';


--
-- Name: COLUMN daily_report_submissions.business_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.daily_report_submissions.business_date IS 'Facility-local date of the submission (set server-side at submit time). A grouping key for a day''s submissions; NOT unique -- daily reports are append-only, so a same-day correction is a new row.';


--
-- Name: daily_report_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_report_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    area_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE daily_report_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_report_templates IS 'Daily Reports: templates within an area; group of checklist items.';


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE departments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.departments IS 'Operational departments within a facility (Ice Ops, Concessions, Front Desk, etc.).';


--
-- Name: COLUMN departments.color; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.departments.color IS 'Optional hex color for UI badges (e.g. ''#1e88e5'').';


--
-- Name: employee_certifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_certifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    name text NOT NULL,
    issuer text,
    issued_at date,
    expires_at date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    certification_type_id uuid,
    CONSTRAINT employee_certifications_issuer_check CHECK (((issuer IS NULL) OR (length(issuer) <= 200))),
    CONSTRAINT employee_certifications_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200)))
);


--
-- Name: TABLE employee_certifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_certifications IS 'Per-employee certifications and training records with optional issuance and expiration dates. Facility-scoped via RLS.';


--
-- Name: COLUMN employee_certifications.certification_type_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_certifications.certification_type_id IS 'Optional catalog link. NULL = legacy/unlinked row; enforcement then falls back to matching the normalized name against the type''s current name.';


--
-- Name: employee_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    accepted_at timestamp with time zone,
    expires_at timestamp with time zone,
    invited_by uuid,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])))
);


--
-- Name: TABLE employee_invites; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_invites IS 'Pending and historical magic-link invitations sent to employees. One active (pending|sent) invite per employee at a time.';


--
-- Name: employee_job_area_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_job_area_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    job_area_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE employee_job_area_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_job_area_assignments IS 'Scheduling: many-to-many cross-training link of an employee to job areas. Hard cap of 4 job areas per employee (DB-enforced via constraint trigger). is_primary flags the employee''s main area.';


--
-- Name: employee_job_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_job_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE employee_job_areas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_job_areas IS 'Scheduling: per-facility, admin-configurable list of employee job areas (Front Desk, Pro Shop, etc.). Separate from Daily Report areas (daily_report_areas).';


--
-- Name: employee_wages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_wages (
    employee_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    hourly_rate numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT employee_wages_hourly_rate_check CHECK (((hourly_rate >= (0)::numeric) AND (hourly_rate <= (10000)::numeric)))
);


--
-- Name: TABLE employee_wages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_wages IS 'Optional hourly wage per employee, powering scheduling labor-cost estimates. Kept separate from public.employees because that table is facility-wide readable by ALL staff; this one is admin-only (no staff RLS branch).';


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    user_id uuid,
    role_id uuid NOT NULL,
    employee_code text,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email public.citext,
    phone text,
    is_minor boolean DEFAULT false NOT NULL,
    emergency_contact_name text,
    emergency_contact_phone text,
    hire_date date,
    is_active boolean DEFAULT true NOT NULL,
    deactivated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    created_by uuid,
    hidden_modules text[] DEFAULT '{}'::text[] NOT NULL,
    max_weekly_hours integer,
    CONSTRAINT employees_max_weekly_hours_check CHECK (((max_weekly_hours IS NULL) OR ((max_weekly_hours > 0) AND (max_weekly_hours <= 168))))
);


--
-- Name: TABLE employees; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employees IS 'Operational staff identity. Single-valued role_id (no multi-level membership). Inactive employees are retained for historical FK integrity.';


--
-- Name: COLUMN employees.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employees.user_id IS 'Optional link to an auth user. NULL means employee has no login.';


--
-- Name: COLUMN employees.is_minor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employees.is_minor IS 'True if employee is under 18 (drives labor law UI / scheduling restrictions).';


--
-- Name: COLUMN employees.hidden_modules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employees.hidden_modules IS 'Module keys (e.g. daily_reports, scheduling) the employee has chosen to hide from their dashboard grid. Personal UI preference; does not affect access control.';


--
-- Name: COLUMN employees.max_weekly_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employees.max_weekly_hours IS 'Scheduling: per-employee weekly scheduled-hours cap (whole hours). NULL = no individual cap; the weekly-hours tally then falls back to facility-level schedule_settings (e.g. minor_max_weekly_hours / overtime_weekly_hours). Range 1..168.';


--
-- Name: export_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.export_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    logo_url text,
    header_text text,
    footer_text text,
    paper_size text DEFAULT 'letter'::text NOT NULL,
    include_facility_name boolean DEFAULT true NOT NULL,
    include_date boolean DEFAULT true NOT NULL,
    include_submitted_by boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    date_format text DEFAULT 'MM/DD/YYYY'::text NOT NULL,
    csv_delimiter text DEFAULT 'comma'::text NOT NULL,
    module_column_visibility jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT export_settings_csv_delimiter_check CHECK ((csv_delimiter = ANY (ARRAY['comma'::text, 'tab'::text, 'semicolon'::text]))),
    CONSTRAINT export_settings_date_format_check CHECK ((date_format = ANY (ARRAY['MM/DD/YYYY'::text, 'DD/MM/YYYY'::text, 'YYYY-MM-DD'::text]))),
    CONSTRAINT export_settings_paper_size_check CHECK ((paper_size = ANY (ARRAY['letter'::text, 'a4'::text])))
);


--
-- Name: TABLE export_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.export_settings IS 'Per-facility PDF/export branding and layout preferences.';


--
-- Name: COLUMN export_settings.date_format; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.export_settings.date_format IS 'Date format used on PDF exports and CSVs (e.g. MM/DD/YYYY).';


--
-- Name: COLUMN export_settings.csv_delimiter; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.export_settings.csv_delimiter IS 'Field delimiter for CSV exports: comma, tab, or semicolon.';


--
-- Name: COLUMN export_settings.module_column_visibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.export_settings.module_column_visibility IS 'Per-module map of visible columns for exports. Key = module_key, value = array of column identifiers to include.';


--
-- Name: facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    address text,
    zip_code text,
    phone text,
    city text,
    state text,
    email text
);


--
-- Name: TABLE facilities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.facilities IS 'Tenant root. Each facility is an isolated multi-tenant boundary.';


--
-- Name: COLUMN facilities.slug; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facilities.slug IS 'URL-safe unique identifier for the facility (e.g. ''max-ice-center'').';


--
-- Name: COLUMN facilities.settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facilities.settings IS 'Per-facility feature flags / configuration blob.';


--
-- Name: facility_air_quality_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_air_quality_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    compliance_profile_id uuid,
    active_metrics jsonb DEFAULT '["co", "no2"]'::jsonb NOT NULL,
    threshold_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
    frequency_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    escalation_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    submit_roles text[] DEFAULT '{}'::text[] NOT NULL,
    view_roles text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE facility_air_quality_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.facility_air_quality_config IS 'Per-facility Air Quality compliance config: which global compliance profile applies plus active_metrics, stricter-only threshold_overrides, frequency_config, escalation_config, and optional submit/view role gates. One row per facility.';


--
-- Name: COLUMN facility_air_quality_config.threshold_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facility_air_quality_config.threshold_overrides IS 'Per-metric/per-tier ceilings that TIGHTEN the profile (never loosen). Shape mirrors profile tiers: { <metric>: { corrective?: {max}, notification?: {max}, evacuation?: {max} } }. Stricter-only is enforced in the admin server action.';


--
-- Name: facility_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    category text NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT facility_documents_category_check CHECK ((category = ANY (ARRAY['emergency_action_plan'::text, 'employee_handbook'::text, 'staff_manual'::text, 'policy_document'::text, 'safety_document'::text, 'other'::text])))
);


--
-- Name: TABLE facility_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.facility_documents IS 'Per-facility library of uploaded documents (policies, manuals, emergency action plans). The file bytes live in the facility-documents storage bucket; this table holds the browsable metadata.';


--
-- Name: facility_dropdown_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_dropdown_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    domain text NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT facility_dropdown_options_domain_check CHECK ((domain = 'facility_timezone'::text))
);


--
-- Name: TABLE facility_dropdown_options; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.facility_dropdown_options IS 'Generic per-facility admin-customizable picker lists, partitioned by `domain` (CHECK-whitelisted). Generalizes accident_dropdowns. Only lists whose new values actually function are valid domains; code-bound enums are excluded by design.';


--
-- Name: facility_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    module_key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: facility_spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_spaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE facility_spaces; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.facility_spaces IS 'Shared per-facility list of physical spaces/areas. Read by submission forms (incident reports, etc.); managed by facility admins.';


--
-- Name: ice_depth_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_depth_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    session_id uuid NOT NULL,
    changed_by uuid NOT NULL,
    reason text NOT NULL,
    before jsonb DEFAULT '{}'::jsonb NOT NULL,
    after jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ice_depth_change_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_depth_change_log IS 'Append-only correction log for ice depth sessions. Original session and cell value rows are immutable; corrections are logged here.';


--
-- Name: ice_depth_followup_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_depth_followup_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    session_id uuid NOT NULL,
    employee_id uuid,
    body text NOT NULL,
    is_admin_note boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ice_depth_followup_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_depth_followup_notes IS 'Ice Depth: append-only follow-up notes (admin/manager only). Original session stays immutable. No UPDATE/DELETE policies.';


--
-- Name: ice_depth_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_depth_layouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    diagram_aspect_ratio numeric DEFAULT 0.425 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    logo_url text,
    rink_id uuid,
    is_default boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE ice_depth_layouts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_depth_layouts IS 'Ice Depth: per-facility custom rink-diagram layouts. Hard cap of 8 active per facility (DB-enforced). diagram_aspect_ratio is width / height of the rendered diagram; default 0.425 approximates an 85x200 NHL rink shown vertically.';


--
-- Name: COLUMN ice_depth_layouts.diagram_aspect_ratio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_layouts.diagram_aspect_ratio IS 'width / height of the rendered diagram. Used by the UI to size the canvas. Default 0.425 = 85/200 (vertical NHL rink).';


--
-- Name: COLUMN ice_depth_layouts.rink_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_layouts.rink_id IS 'The rink (sheet of ice) this diagram belongs to. Null only transiently before assignment; the app requires a rink at create time.';


--
-- Name: COLUMN ice_depth_layouts.is_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_layouts.is_default IS 'At most one per rink (partial unique index). The default diagram opened when staff select this rink; falls back to the first active diagram when unset.';


--
-- Name: ice_depth_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_depth_measurements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    session_id uuid NOT NULL,
    point_id uuid,
    point_number_snapshot integer NOT NULL,
    label_snapshot text,
    x_snapshot numeric NOT NULL,
    y_snapshot numeric NOT NULL,
    depth_value numeric NOT NULL,
    severity text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ice_depth_measurements_depth_nonneg CHECK ((depth_value >= (0)::numeric)),
    CONSTRAINT ice_depth_measurements_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'ok'::text, 'high'::text])))
);


--
-- Name: TABLE ice_depth_measurements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_depth_measurements IS 'Ice Depth: per-point depth reading captured during a session. Snapshots point identity (number, label, x/y) so historical heat-maps and trend-by-point queries remain valid even if the parent point is later moved or deleted. severity is computed server-side at submit using the session''s threshold snapshots: ''low'' if depth_value <= low_threshold_snapshot, ''high'' if depth_value > high_threshold_snapshot, else ''ok''.';


--
-- Name: COLUMN ice_depth_measurements.depth_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_measurements.depth_value IS 'Depth in the session''s measurement_unit_snapshot (inches or mm).';


--
-- Name: COLUMN ice_depth_measurements.severity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_measurements.severity IS 'Server-computed at submit time from depth_value vs the session threshold snapshots. Persisted (not derived in queries) so admin threshold changes do not retroactively reclassify history.';


--
-- Name: CONSTRAINT ice_depth_measurements_depth_nonneg ON ice_depth_measurements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ice_depth_measurements_depth_nonneg ON public.ice_depth_measurements IS 'Depth is a physical measurement; reject negative values at the DB as well as in parseMeasurements().';


--
-- Name: ice_depth_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_depth_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    layout_id uuid NOT NULL,
    point_number integer NOT NULL,
    label text,
    x_position numeric NOT NULL,
    y_position numeric NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT ice_depth_points_x_position_check CHECK (((x_position >= (0)::numeric) AND (x_position <= (1)::numeric))),
    CONSTRAINT ice_depth_points_y_position_check CHECK (((y_position >= (0)::numeric) AND (y_position <= (1)::numeric)))
);


--
-- Name: TABLE ice_depth_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_depth_points IS 'Ice Depth: numbered measurement points placed on a layout diagram. Hard cap of 60 active points per layout (DB-enforced). x_position / y_position are fractional [0,1] coordinates relative to the diagram. point_number is sequential and unique within a layout (admin/UI assigns at place time; admin may reorder via sort_order without renumbering).';


--
-- Name: COLUMN ice_depth_points.point_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_points.point_number IS 'Sequential identifier within a layout. UI auto-assigns next available integer when admin places a new point. Uniqueness enforced via (layout_id, point_number). Note: deleting a point leaves a gap -- the UI must either renumber subsequent points or accept gaps. point_number is the staff-visible label on the diagram.';


--
-- Name: COLUMN ice_depth_points.sort_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_points.sort_order IS 'Drives the order in which staff are walked through points by the UI (Enter advances to next sort_order). Defaults to 0; UI typically initializes to point_number.';


--
-- Name: ice_depth_rinks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_depth_rinks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE ice_depth_rinks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_depth_rinks IS 'Ice Depth: physical sheets of ice within a facility. Staff pick a rink, then a diagram (ice_depth_layouts.rink_id) on that rink. At most one rink per facility may be is_default (partial unique index).';


--
-- Name: COLUMN ice_depth_rinks.is_default; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_rinks.is_default IS 'At most one per facility (partial unique index). The staff module auto-opens this rink''s default diagram; falls back to the first active rink when unset.';


--
-- Name: ice_depth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_depth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    layout_id uuid NOT NULL,
    employee_id uuid,
    notes text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    measurement_unit_snapshot text NOT NULL,
    low_threshold_snapshot numeric NOT NULL,
    high_threshold_snapshot numeric NOT NULL,
    has_low_reading boolean DEFAULT false NOT NULL,
    has_high_reading boolean DEFAULT false NOT NULL,
    low_count integer DEFAULT 0 NOT NULL,
    high_count integer DEFAULT 0 NOT NULL,
    total_measurements integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT ice_depth_sessions_measurement_unit_snapshot_check CHECK ((measurement_unit_snapshot = ANY (ARRAY['inches'::text, 'mm'::text])))
);


--
-- Name: TABLE ice_depth_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_depth_sessions IS 'Ice Depth: one row per staff submission against a layout. Snapshots measurement_unit / low_threshold / high_threshold from ice_depth_settings at submit time so historical sessions stay interpretable across later admin changes. Original is immutable; only super_admin may UPDATE/DELETE.';


--
-- Name: COLUMN ice_depth_sessions.measurement_unit_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_sessions.measurement_unit_snapshot IS 'Snapshot of ice_depth_settings.measurement_unit at submit time. depth_value rows belong to this unit.';


--
-- Name: COLUMN ice_depth_sessions.has_low_reading; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_sessions.has_low_reading IS 'Denormalized: true if any child ice_depth_measurements row has severity=''low''. Server sets at submit. Drives alert decision and fast filtering.';


--
-- Name: COLUMN ice_depth_sessions.has_high_reading; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_sessions.has_high_reading IS 'Denormalized: true if any child ice_depth_measurements row has severity=''high''.';


--
-- Name: COLUMN ice_depth_sessions.total_measurements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_sessions.total_measurements IS 'Count of recorded child measurements. May be less than the layout''s active point count -- incomplete submissions are allowed.';


--
-- Name: ice_depth_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_depth_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    measurement_unit text DEFAULT 'inches'::text NOT NULL,
    low_threshold numeric DEFAULT 0.99 NOT NULL,
    high_threshold numeric DEFAULT 1.75 NOT NULL,
    low_color text DEFAULT '#ef4444'::text NOT NULL,
    ok_color text DEFAULT '#22c55e'::text NOT NULL,
    high_color text DEFAULT '#eab308'::text NOT NULL,
    alerts_enabled boolean DEFAULT false NOT NULL,
    alert_on text DEFAULT 'low'::text NOT NULL,
    default_alert_severity text DEFAULT 'high'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT ice_depth_settings_alert_on_check CHECK ((alert_on = ANY (ARRAY['low'::text, 'high'::text, 'any'::text]))),
    CONSTRAINT ice_depth_settings_default_alert_severity_check CHECK ((default_alert_severity = ANY (ARRAY['warn'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT ice_depth_settings_low_below_high CHECK ((low_threshold < high_threshold)),
    CONSTRAINT ice_depth_settings_measurement_unit_check CHECK ((measurement_unit = ANY (ARRAY['inches'::text, 'mm'::text])))
);


--
-- Name: TABLE ice_depth_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_depth_settings IS 'Ice Depth: per-facility module config. Thresholds are stored in the configured measurement_unit (inches or mm). Default thresholds: low <= 0.99, high > 1.75 (inches). Colors are CSS hex. When alerts_enabled=true the app inserts one communication_alerts row per session whose readings match alert_on (''low'' | ''high'' | ''any'') with severity = default_alert_severity.';


--
-- Name: COLUMN ice_depth_settings.low_threshold; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_settings.low_threshold IS 'Inclusive low threshold; depth_value <= low_threshold => severity ''low''. Stored in measurement_unit.';


--
-- Name: COLUMN ice_depth_settings.high_threshold; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_settings.high_threshold IS 'Exclusive high threshold; depth_value > high_threshold => severity ''high''. Stored in measurement_unit.';


--
-- Name: COLUMN ice_depth_settings.alert_on; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_depth_settings.alert_on IS 'Which severity triggers a communication_alerts insert: ''low'', ''high'', or ''any''. Only consulted when alerts_enabled = true.';


--
-- Name: CONSTRAINT ice_depth_settings_low_below_high ON ice_depth_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT ice_depth_settings_low_below_high ON public.ice_depth_settings IS 'low_threshold must be strictly below high_threshold; otherwise severityFor() can never return ''ok'' and every session is misclassified.';


--
-- Name: ice_operations_circle_check_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_circle_check_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    label text NOT NULL,
    description text,
    applies_to_equipment_type text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    response_type text DEFAULT 'pass_fail'::text NOT NULL,
    is_response_required boolean DEFAULT true NOT NULL,
    CONSTRAINT ice_operations_circle_check_ite_applies_to_equipment_type_check CHECK ((applies_to_equipment_type = ANY (ARRAY['zamboni'::text, 'edger'::text, 'blade_set'::text, 'other'::text]))),
    CONSTRAINT ice_operations_circle_check_items_applies_to_equipment_type_che CHECK ((applies_to_equipment_type = ANY (ARRAY['ice_resurfacer'::text, 'edger'::text, 'blade_set'::text, 'hand_edger'::text, 'other'::text]))),
    CONSTRAINT ice_operations_circle_check_items_response_type_chk CHECK ((response_type = ANY (ARRAY['pass_fail'::text, 'text'::text])))
);


--
-- Name: TABLE ice_operations_circle_check_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_circle_check_items IS 'Ice Operations: per-facility circle-check checklist (up to 50 active rows; enforced in app). applies_to_equipment_type filters which items show for the selected equipment; null = applies to all equipment types.';


--
-- Name: COLUMN ice_operations_circle_check_items.response_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_circle_check_items.response_type IS 'How staff answer this circle-check item: pass_fail (default) or text (free-text response).';


--
-- Name: COLUMN ice_operations_circle_check_items.is_response_required; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_circle_check_items.is_response_required IS 'For text response_type only: whether the free-text answer is mandatory. Ignored for pass_fail items.';


--
-- Name: ice_operations_circle_check_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_circle_check_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    checklist_item_id uuid,
    label_snapshot text NOT NULL,
    passed boolean NOT NULL,
    failed_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ice_operations_circle_check_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_circle_check_results IS 'Ice Operations: per-checklist-item result for a circle_check submission. label_snapshot is captured at submit time so deleting a checklist item does not lose historical context. failed_notes is required (UI-enforced) when passed=false.';


--
-- Name: ice_operations_circle_check_template_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_circle_check_template_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    template_id uuid NOT NULL,
    label text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE ice_operations_circle_check_template_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_circle_check_template_items IS 'Ice Operations: per-template checklist fields. Filled in by the operator during a circle check. Results land in ice_operations_circle_check_results with checklist_item_id=null and label_snapshot preserved.';


--
-- Name: ice_operations_circle_check_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_circle_check_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    fuel_type_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE ice_operations_circle_check_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_circle_check_templates IS 'Ice Operations: circle-check templates keyed by fuel type. At most one template per (facility, fuel_type). Application caps total templates at 4 per facility.';


--
-- Name: ice_operations_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    equipment_type text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    model text,
    serial_number text,
    hours_count numeric,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    fuel_type_id uuid,
    tank_capacity_gal numeric,
    CONSTRAINT ice_operations_equipment_equipment_type_check CHECK ((equipment_type = ANY (ARRAY['ice_resurfacer'::text, 'edger'::text, 'blade_set'::text, 'hand_edger'::text, 'other'::text])))
);


--
-- Name: TABLE ice_operations_equipment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_equipment IS 'Ice Operations: equipment dropdown. equipment_type drives which submissions can pick this row (ice_resurfacer=>ice_make/circle_check, edger=>edging, blade_set=>blade_change, hand_edger / other=>any). hours_count is admin-maintained cumulative hours; staff-side forms display the latest value.';


--
-- Name: COLUMN ice_operations_equipment.hours_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_equipment.hours_count IS 'Admin-maintained cumulative hours counter. Not auto-updated from submissions; admins update manually after maintenance events.';


--
-- Name: COLUMN ice_operations_equipment.tank_capacity_gal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_equipment.tank_capacity_gal IS 'Admin-maintained water tank capacity in gallons. Enables the ice_make water-usage unit toggle to convert a "% of tank" entry to/from gallons. Null means the percentage option is unavailable for this machine.';


--
-- Name: ice_operations_followup_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_followup_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    employee_id uuid,
    body text NOT NULL,
    is_admin_note boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ice_operations_followup_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_followup_notes IS 'Ice Operations: append-only follow-up notes (admin/manager only). Original submission stays immutable. No UPDATE/DELETE policies.';


--
-- Name: ice_operations_fuel_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_fuel_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE ice_operations_fuel_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_fuel_types IS 'Ice Operations: per-facility ice-resurfacer fuel types (e.g. Electric, Gas). Admin-controlled. Each row may anchor at most one circle-check template (ice_operations_circle_check_templates).';


--
-- Name: ice_operations_rinks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_rinks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE ice_operations_rinks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_rinks IS 'Ice Operations: per-facility rinks (e.g. Rink A, Rink B). Admin controlled. Required selection on ice_make and circle_check submissions (UI-enforced).';


--
-- Name: ice_operations_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    temperature_unit text DEFAULT 'F'::text NOT NULL,
    alerts_enabled boolean DEFAULT true NOT NULL,
    default_alert_severity text DEFAULT 'high'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    enabled_operation_types text[],
    CONSTRAINT ice_operations_settings_default_alert_severity_check CHECK ((default_alert_severity = ANY (ARRAY['warn'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT ice_operations_settings_temperature_unit_check CHECK ((temperature_unit = ANY (ARRAY['F'::text, 'C'::text])))
);


--
-- Name: TABLE ice_operations_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_settings IS 'Ice Operations: per-facility module config. temperature_unit applies to ice_make payload (F/C). When alerts_enabled = true the app inserts one communication_alerts row per circle_check submission that has any failed item, using default_alert_severity.';


--
-- Name: COLUMN ice_operations_settings.enabled_operation_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_settings.enabled_operation_types IS 'Subset of operation types visible to staff (ice_make/circle_check/edging/blade_change). NULL/empty = all enabled. The types themselves are code-defined; this only gates visibility.';


--
-- Name: ice_operations_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ice_operations_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid,
    operation_type text NOT NULL,
    rink_id uuid,
    equipment_id uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    has_failed_check boolean DEFAULT false NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT ice_operations_submissions_operation_type_check CHECK ((operation_type = ANY (ARRAY['ice_make'::text, 'circle_check'::text, 'edging'::text, 'blade_change'::text])))
);


--
-- Name: TABLE ice_operations_submissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ice_operations_submissions IS 'Ice Operations: one row per submitted operation. operation_type is fixed to the four canonical values. payload jsonb shape varies per operation_type (ice_make: water/ice temps, time_in/out, water_used_gal, surface_pass_count; edging: hours_run; blade_change: blade_serial, hours_at_change, replaced_by_employee_id; circle_check: empty -- results live in ice_operations_circle_check_results). Original is immutable; only super_admin may UPDATE/DELETE.';


--
-- Name: COLUMN ice_operations_submissions.rink_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_submissions.rink_id IS 'Required by app for operation_type in (ice_make, circle_check); optional for edging / blade_change. DB does not enforce.';


--
-- Name: COLUMN ice_operations_submissions.equipment_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_submissions.equipment_id IS 'Relevance varies by operation_type: zamboni for ice_make/circle_check, edger for edging, blade_set for blade_change. Nullable in DB.';


--
-- Name: COLUMN ice_operations_submissions.occurred_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_submissions.occurred_at IS 'When the operation happened — a real UTC instant. Converted from the operator''s wall clock using facilities.timezone at persist time (migration 174; earlier rows were reinterpreted from the legacy wall-clock-as-UTC encoding).';


--
-- Name: COLUMN ice_operations_submissions.has_failed_check; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_submissions.has_failed_check IS 'Denormalized: true if any associated ice_operations_circle_check_results row has passed = false. Server sets at submit time. Always false for non-circle_check operations.';


--
-- Name: COLUMN ice_operations_submissions.failed_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ice_operations_submissions.failed_count IS 'Denormalized count of failed circle-check items. Drives the alert body. Always 0 for non-circle_check operations.';


--
-- Name: incident_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE incident_activities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_activities IS 'Incident Reports: per-facility customizable "activity at the time" options.';


--
-- Name: incident_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    employee_id uuid,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE incident_change_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_change_log IS 'Incident Reports: append-only audit log. action e.g. create, update, add_witness, remove_witness. Visible to admins only. No update/delete policies.';


--
-- Name: incident_followup_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_followup_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    employee_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE incident_followup_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_followup_notes IS 'Incident Reports: append-only follow-up notes by managers/admins. No update/delete policies — permanent history.';


--
-- Name: incident_report_spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_report_spaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    space_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE incident_report_spaces; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_report_spaces IS 'Incident Reports: many-to-many link of a report to the facility spaces it applies to. "Other" free text lives on incident_reports.location_other.';


--
-- Name: incident_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid,
    incident_type_id uuid,
    severity_level_id uuid,
    location text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    reporter_name text NOT NULL,
    reporter_phone text,
    description text NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    resolved_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    edit_window_ends_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    activity_id uuid,
    activity_other text,
    location_other text,
    immediate_actions text,
    ambulance_flag boolean DEFAULT false NOT NULL,
    persons_involved integer,
    follow_up_required boolean DEFAULT false NOT NULL,
    CONSTRAINT incident_reports_persons_involved_nonneg CHECK (((persons_involved IS NULL) OR (persons_involved >= 0))),
    CONSTRAINT incident_reports_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'in_review'::text, 'resolved'::text, 'archived'::text])))
);


--
-- Name: TABLE incident_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_reports IS 'Incident Reports: per-facility incident submissions. Original content not overwritten in normal flow; admins transition status. Reporter contact (name + phone) is required by spec.';


--
-- Name: COLUMN incident_reports.occurred_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.occurred_at IS 'When the incident happened — a real UTC instant. Converted from the reporter''s wall clock using facilities.timezone at persist time (migration 174; earlier rows were reinterpreted from the legacy wall-clock-as-UTC encoding).';


--
-- Name: COLUMN incident_reports.reporter_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.reporter_phone IS 'Legacy/optional. No longer collected by the redesigned form (reporter is the logged-in user). Retained nullable for historical rows.';


--
-- Name: COLUMN incident_reports.edit_window_ends_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.edit_window_ends_at IS 'Submitter may edit their own report while now() <= edit_window_ends_at (24h default). Outside the window only admins may update; changes are logged in incident_change_log.';


--
-- Name: COLUMN incident_reports.activity_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.activity_id IS 'FK to incident_activities (admin-managed). Optional. "Other" is captured in activity_other.';


--
-- Name: COLUMN incident_reports.activity_other; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.activity_other IS 'Free text when the reporter chose "Other" for activity.';


--
-- Name: COLUMN incident_reports.location_other; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.location_other IS 'Free text when the reporter chose "Other" among facility spaces. Selected spaces live in incident_report_spaces.';


--
-- Name: COLUMN incident_reports.immediate_actions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.immediate_actions IS 'Optional: immediate actions taken right after the incident.';


--
-- Name: COLUMN incident_reports.ambulance_flag; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.ambulance_flag IS 'Whether an ambulance was called/needed. When true the submit flow escalates via communication_routing_rules.';


--
-- Name: COLUMN incident_reports.persons_involved; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.persons_involved IS 'Count of people involved in the incident (>= 0).';


--
-- Name: COLUMN incident_reports.follow_up_required; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.incident_reports.follow_up_required IS 'Whether the incident is flagged as needing follow-up.';


--
-- Name: incident_severity_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_severity_levels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE incident_severity_levels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_severity_levels IS 'Incident Reports: per-facility customizable severity levels (e.g. low/medium/high/critical).';


--
-- Name: incident_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE incident_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_types IS 'Incident Reports: per-facility customizable incident categories.';


--
-- Name: incident_witnesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_witnesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    statement text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT incident_witnesses_contact_present CHECK ((((phone IS NOT NULL) AND (length(btrim(phone)) > 0)) OR ((email IS NOT NULL) AND (length(btrim(email)) > 0)))),
    CONSTRAINT incident_witnesses_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT incident_witnesses_sort_order_check CHECK (((sort_order >= 0) AND (sort_order <= 2)))
);


--
-- Name: TABLE incident_witnesses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.incident_witnesses IS 'Incident Reports: up to 3 witnesses per report. Name + at least one of phone/email required. Editable while the parent report is within its 24h edit window.';


--
-- Name: information_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.information_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    company text NOT NULL,
    address_line1 text DEFAULT ''::text NOT NULL,
    address_line2 text DEFAULT ''::text NOT NULL,
    address_city text DEFAULT ''::text NOT NULL,
    address_region text DEFAULT ''::text NOT NULL,
    address_postal text DEFAULT ''::text NOT NULL,
    address_country text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT information_requests_email_format_check CHECK ((email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text)),
    CONSTRAINT information_requests_lengths_check CHECK (((char_length(name) <= 200) AND (char_length(email) <= 320) AND (char_length(company) <= 200) AND (char_length(address_line1) <= 200) AND (char_length(address_line2) <= 200) AND (char_length(address_city) <= 120) AND (char_length(address_region) <= 120) AND (char_length(address_postal) <= 40) AND (char_length(address_country) <= 120) AND (char_length(note) <= 5000)))
);


--
-- Name: job_area_certification_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_area_certification_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    job_area_id uuid NOT NULL,
    cert_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    certification_type_id uuid NOT NULL,
    CONSTRAINT job_area_certification_requirements_cert_name_check CHECK (((length(btrim(cert_name)) >= 1) AND (length(btrim(cert_name)) <= 200)))
);


--
-- Name: TABLE job_area_certification_requirements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.job_area_certification_requirements IS 'Scheduling: certifications required to work a given job area. cert_name is matched case-insensitively against employee_certifications.name (non-expired) by scheduling_assignment_violations().';


--
-- Name: COLUMN job_area_certification_requirements.certification_type_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.job_area_certification_requirements.certification_type_id IS 'The required certification (catalog id) — the enforcement key. cert_name remains as a display copy, synced by trigger when the type is renamed.';


--
-- Name: module_area_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.module_area_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    module_key text NOT NULL,
    area_id uuid NOT NULL,
    can_view boolean DEFAULT false NOT NULL,
    can_submit boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE module_area_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.module_area_permissions IS 'Per-area access within a module. area_id is a soft reference into module-specific tables (e.g. daily_report_areas.id); no FK is enforced here because the target table varies by module. Facility isolation is enforced via the facility_id column; callers must validate that area_id belongs to the same facility before inserting.';


--
-- Name: notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    rule_id uuid,
    source_module text NOT NULL,
    source_record_id uuid,
    recipient_employee_id uuid NOT NULL,
    subject text,
    body text,
    attach_pdf boolean DEFAULT false NOT NULL,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    pdf_url text,
    requires_acknowledgement boolean DEFAULT false NOT NULL,
    CONSTRAINT notification_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE notification_outbox; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_outbox IS 'Queue for non-immediate communication sends. Immediate routing skips this table and writes directly to communication_messages / communication_recipients.';


--
-- Name: COLUMN notification_outbox.pdf_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_outbox.pdf_url IS 'Storage object path (within the notification-pdfs bucket) for the rendered PDF, populated by the cron route before drain. NULL means no PDF attached.';


--
-- Name: COLUMN notification_outbox.requires_acknowledgement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_outbox.requires_acknowledgement IS 'Carried from the routing rule into the outbox so the drain can stamp communication_messages without re-joining the rule.';


--
-- Name: offline_sync_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offline_sync_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    local_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    module_key text NOT NULL,
    action text DEFAULT 'submit'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    sync_status text DEFAULT 'pending'::text NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error_message text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT offline_sync_queue_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'failed'::text])))
);


--
-- Name: TABLE offline_sync_queue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.offline_sync_queue IS 'FIFO queue for submissions captured offline. Rows are inserted by the SW sync handler and marked synced/failed after server-side processing. local_id prevents duplicate inserts on replay.';


--
-- Name: COLUMN offline_sync_queue.local_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.offline_sync_queue.local_id IS 'Client-generated UUID. The service worker sets this before going offline. ON CONFLICT(local_id) DO NOTHING prevents double-submission on replay.';


--
-- Name: COLUMN offline_sync_queue.started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.offline_sync_queue.started_at IS 'Timestamp set on the client when the form was submitted. Used for FIFO ordering during sync replay.';


--
-- Name: profile_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid,
    edited_by uuid NOT NULL,
    target_user_id uuid NOT NULL,
    changed_fields jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE profile_audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profile_audit_log IS 'Append-only record of supervisor+ edits to other users profiles: who edited, whose profile, and which fields changed.';


--
-- Name: rate_limit_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_counters (
    bucket text NOT NULL,
    identifier text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    hits integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE rate_limit_counters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rate_limit_counters IS 'Fixed-window rate-limit counters keyed by (bucket, identifier, window_start). Reachable ONLY through public.check_rate_limit(); RLS is enabled with no policies so direct anon/authenticated access is denied. Old rows (window_start in the past) are inert and may be purged by the retention sweep at any time (see purge_old_rate_limit_counters() below) — they do not affect correctness.';


--
-- Name: refrigeration_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    report_id uuid NOT NULL,
    changed_by uuid NOT NULL,
    reason text NOT NULL,
    before jsonb DEFAULT '{}'::jsonb NOT NULL,
    after jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE refrigeration_change_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_change_log IS 'Append-only correction log for refrigeration reports. Original report rows are immutable; all changes are recorded here.';


--
-- Name: refrigeration_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    section_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE refrigeration_equipment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_equipment IS 'Refrigeration: equipment instances within a section (e.g. Compressor #1, Compressor #2). Admin controlled.';


--
-- Name: refrigeration_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    section_id uuid NOT NULL,
    equipment_id uuid,
    key text NOT NULL,
    label text NOT NULL,
    field_type text NOT NULL,
    unit text,
    options jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    is_required boolean DEFAULT false NOT NULL,
    CONSTRAINT refrigeration_fields_field_type_check CHECK ((field_type = ANY (ARRAY['numeric'::text, 'text'::text, 'boolean'::text, 'select'::text, 'computed'::text])))
);


--
-- Name: TABLE refrigeration_fields; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_fields IS 'Refrigeration: fields collected per section/equipment. equipment_id null = section-level field.';


--
-- Name: COLUMN refrigeration_fields.unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_fields.unit IS 'Display unit for numeric fields (e.g. ''psi'', ''F'', ''hours''). Null for non-numeric.';


--
-- Name: COLUMN refrigeration_fields.options; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_fields.options IS 'Used only when field_type = ''select''. Array of {key, label}.';


--
-- Name: COLUMN refrigeration_fields.is_required; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_fields.is_required IS 'When true, the field is marked as required in the staff submission form (visible asterisk + native HTML required + aria-required). Default false preserves the pre-migration behaviour for existing rows.';


--
-- Name: refrigeration_followup_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_followup_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    report_id uuid NOT NULL,
    employee_id uuid,
    body text NOT NULL,
    is_admin_note boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    report_value_id uuid,
    field_id uuid
);


--
-- Name: TABLE refrigeration_followup_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_followup_notes IS 'Refrigeration: append-only follow-up notes (admin/manager only). No update/delete policies.';


--
-- Name: COLUMN refrigeration_followup_notes.report_value_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_followup_notes.report_value_id IS 'The specific out-of-range report value this corrective-action note addresses. NULL for report-level notes. CASCADE: the note is removed if its value row is.';


--
-- Name: COLUMN refrigeration_followup_notes.field_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_followup_notes.field_id IS 'The config field the note is about, for cross-report trend/grouping. Nullable; not CASCADE so history survives field deletion.';


--
-- Name: refrigeration_report_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_report_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    report_id uuid NOT NULL,
    field_id uuid,
    equipment_id uuid,
    label_snapshot text NOT NULL,
    equipment_name_snapshot text,
    field_type_snapshot text NOT NULL,
    unit_snapshot text,
    value_text text,
    value_numeric numeric,
    value_boolean boolean,
    is_out_of_range boolean DEFAULT false NOT NULL,
    threshold_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE refrigeration_report_values; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_report_values IS 'Refrigeration: per-field captured values for a report. Snapshot columns preserve label/type/unit/equipment_name in case admin later renames or deletes the source field/equipment. is_out_of_range/threshold_id are populated by the app when the matching threshold flagged the reading.';


--
-- Name: COLUMN refrigeration_report_values.equipment_name_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_report_values.equipment_name_snapshot IS 'Equipment name at submit time. If the field was section-level, app may write the section name here instead.';


--
-- Name: refrigeration_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid,
    notes text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    reading_at timestamp with time zone DEFAULT now() NOT NULL,
    shift text,
    round_no smallint
);


--
-- Name: TABLE refrigeration_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_reports IS 'Refrigeration: a single submission. Original values are immutable -- only super_admin may UPDATE/DELETE. Staff may submit incomplete reports.';


--
-- Name: COLUMN refrigeration_reports.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_reports.notes IS 'Optional free-form staff notes captured at submit time. Distinct from refrigeration_followup_notes (admin append-only).';


--
-- Name: COLUMN refrigeration_reports.reading_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_reports.reading_at IS 'When the reading round was physically taken. Distinct from submitted_at (when the report was saved) and created_at (row insert). Defaults to now() when the client does not supply it.';


--
-- Name: COLUMN refrigeration_reports.shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_reports.shift IS 'Optional shift label for cadence reporting (e.g. AM/PM/Overnight). Free-form, nullable.';


--
-- Name: COLUMN refrigeration_reports.round_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_reports.round_no IS 'Optional sequential round number within a shift/day for cadence reporting. Nullable.';


--
-- Name: refrigeration_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE refrigeration_sections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_sections IS 'Refrigeration: per-facility togglable sections (Compressors, Pumps, etc.). Admin controlled.';


--
-- Name: refrigeration_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    out_of_range_alerts_enabled boolean DEFAULT false NOT NULL,
    default_alert_severity text DEFAULT 'warn'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    readings_per_shift smallint,
    CONSTRAINT refrigeration_settings_default_alert_severity_check CHECK ((default_alert_severity = ANY (ARRAY['warn'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT refrigeration_settings_readings_per_shift_check CHECK (((readings_per_shift IS NULL) OR ((readings_per_shift >= 1) AND (readings_per_shift <= 99))))
);


--
-- Name: TABLE refrigeration_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_settings IS 'Refrigeration: per-facility module config. When out_of_range_alerts_enabled = true the app evaluates thresholds and inserts communication_alerts (source_module = ''refrigeration'') for OOR readings.';


--
-- Name: COLUMN refrigeration_settings.readings_per_shift; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refrigeration_settings.readings_per_shift IS 'Max reading rounds per shift (admin-configured). NULL = unlimited. Enforced app-side: round_no must be between 1 and this value.';


--
-- Name: refrigeration_thresholds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refrigeration_thresholds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    field_id uuid NOT NULL,
    equipment_id uuid,
    min_value numeric,
    max_value numeric,
    severity text DEFAULT 'warn'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT refrigeration_thresholds_min_or_max_present CHECK (((min_value IS NOT NULL) OR (max_value IS NOT NULL))),
    CONSTRAINT refrigeration_thresholds_severity_check CHECK ((severity = ANY (ARRAY['warn'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: TABLE refrigeration_thresholds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refrigeration_thresholds IS 'Refrigeration: numeric out-of-range thresholds. equipment_id null = field-wide. severity passes through to communication_alerts when an OOR reading is captured.';


--
-- Name: retention_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    module_key text NOT NULL,
    keep_days integer DEFAULT 365 NOT NULL,
    auto_purge boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    last_purged_at timestamp with time zone,
    last_purge_count integer,
    CONSTRAINT retention_settings_keep_days_min CHECK ((keep_days >= 30))
);


--
-- Name: TABLE retention_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.retention_settings IS 'Per-facility, per-module retention rules. keep_days=0 means keep forever (disabled).';


--
-- Name: COLUMN retention_settings.last_purged_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.retention_settings.last_purged_at IS 'Timestamp of the most recent purge run for this module.';


--
-- Name: COLUMN retention_settings.last_purge_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.retention_settings.last_purge_count IS 'Number of records deleted during the most recent purge run.';


--
-- Name: role_module_permission_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_module_permission_defaults (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    role_id uuid NOT NULL,
    module_key text NOT NULL,
    permission_level public.module_permission_level DEFAULT 'none'::public.module_permission_level NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE role_module_permission_defaults; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_module_permission_defaults IS 'DEPRECATED as of migration 77. Source of truth is now public.user_permissions. Resolver functions no longer read this table. Drop after admin/roles page is migrated.';


--
-- Name: role_permission_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permission_defaults (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    role_id uuid NOT NULL,
    module_name text NOT NULL,
    action public.user_action NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE role_permission_defaults; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_permission_defaults IS 'Editable per-role default permission matrix. apply_role_permission_defaults() seeds public.user_permissions from this. Replaces deprecated role_module_permission_defaults (migration 77).';


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    hierarchy_level integer NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    deactivated_at timestamp with time zone,
    description text,
    CONSTRAINT roles_hierarchy_nonneg CHECK ((hierarchy_level >= 0))
);


--
-- Name: TABLE roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.roles IS 'Per-facility role definitions (super_admin, admin, gm, manager, supervisor, staff).';


--
-- Name: COLUMN roles.key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.key IS 'Stable machine key for the role (e.g. ''gm'').';


--
-- Name: COLUMN roles.hierarchy_level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.hierarchy_level IS 'Lower = more powerful. 0 = super_admin, 5 = staff.';


--
-- Name: COLUMN roles.is_system; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.is_system IS 'True for roles seeded by the system; protects against accidental edits.';


--
-- Name: schedule_assignment_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_assignment_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    shift_id uuid,
    employee_id uuid NOT NULL,
    job_area_id uuid,
    override_type text DEFAULT 'cert_missing'::text NOT NULL,
    violation_codes text[] DEFAULT '{}'::text[] NOT NULL,
    missing_certs text[] DEFAULT '{}'::text[] NOT NULL,
    reason text,
    overridden_by_employee_id uuid,
    overridden_by_user_id uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schedule_assignment_overrides_override_type_check CHECK ((override_type = 'cert_missing'::text)),
    CONSTRAINT schedule_assignment_overrides_reason_check CHECK (((reason IS NULL) OR (length(reason) <= 1000)))
);


--
-- Name: TABLE schedule_assignment_overrides; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_assignment_overrides IS 'Audit log of cert-gate overrides: a facility_manager+ deliberately assigned an employee to a job area despite a missing/expired required certification. Immutable; written only by scheduling_log_cert_override().';


--
-- Name: schedule_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    availability_type text DEFAULT 'available'::text NOT NULL,
    effective_from date,
    effective_to date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    job_area_id uuid,
    CONSTRAINT schedule_availability_availability_type_check CHECK ((availability_type = ANY (ARRAY['available'::text, 'unavailable'::text, 'preferred'::text]))),
    CONSTRAINT schedule_availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT schedule_availability_time_order_chk CHECK ((end_time > start_time))
);


--
-- Name: TABLE schedule_availability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_availability IS 'Scheduling: employee-submitted weekly availability blocks. Multiple rows per employee/day are allowed (e.g. available 09:00-12:00 and 16:00-20:00). availability_type distinguishes hard "unavailable", default "available", and "preferred" (soft preference). effective_from / effective_to bound a temporary block; NULLs mean indefinite.';


--
-- Name: COLUMN schedule_availability.job_area_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_availability.job_area_id IS 'Optional preferred job area / department for this availability block. NULL = no preference. References the admin-managed employee_job_areas list; the UI restricts choices to the areas the employee is assigned to.';


--
-- Name: schedule_compliance_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_compliance_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    rule_type text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT schedule_compliance_rules_rule_type_check CHECK ((rule_type = ANY (ARRAY['minor_max_hours'::text, 'overtime'::text, 'break_required'::text, 'certification_required'::text, 'min_rest_between_shifts'::text, 'custom'::text])))
);


--
-- Name: TABLE schedule_compliance_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_compliance_rules IS 'Scheduling: per-facility compliance rules. Rules are evaluated by the app/server when shifts are saved or published; matched codes are written to schedule_shifts.compliance_warnings. rule_type is the discriminator the UI uses to render a typed editor. params is the rule''s parameters; see column comment for known shapes.';


--
-- Name: COLUMN schedule_compliance_rules.params; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_compliance_rules.params IS 'JSON object whose shape depends on rule_type. Known shapes:
    minor_max_hours        -> { "max_weekly_hours": number, "applies_to_minors": boolean }
    overtime               -> { "weekly_threshold": number }
    break_required         -> { "after_hours": number, "min_minutes": number }
    certification_required -> { "certification_keys": string[] }
    min_rest_between_shifts-> { "min_hours": number }
    custom                 -> arbitrary; UI shows raw JSON editor.
The UI should treat rule_type as the dispatcher. Unknown keys must be preserved on save (read-modify-write) so future shapes are forward-compatible.';


--
-- Name: schedule_ics_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_ics_tokens (
    employee_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT schedule_ics_tokens_token_check CHECK ((length(token) >= 32))
);


--
-- Name: TABLE schedule_ics_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_ics_tokens IS 'One secret per employee for the public ICS calendar-feed route. The unguessable token is the credential (calendar apps cannot authenticate). Owner-only RLS; the feed route reads via service role. Rotating (rotate = delete + insert or update) invalidates old subscription URLs.';


--
-- Name: schedule_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    notification_type text NOT NULL,
    shift_id uuid,
    swap_id uuid,
    time_off_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    publish_event_id uuid,
    CONSTRAINT schedule_notifications_notification_type_check CHECK ((notification_type = ANY (ARRAY['schedule_published'::text, 'shift_changed'::text, 'open_shift_available'::text, 'swap_request_received'::text, 'swap_approved'::text, 'swap_denied'::text, 'time_off_decided'::text, 'overtime_warning'::text, 'shift_reminder'::text, 'swap_expired'::text, 'claim_expired'::text])))
);


--
-- Name: TABLE schedule_notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_notifications IS 'Scheduling: in-app notification inbox per employee. Optional FK columns (shift_id, swap_id, time_off_id) link the notification to the originating row when applicable. payload carries any extra context the UI needs to render without joining (e.g. snapshotted shift times). read_at NULL = unread.';


--
-- Name: COLUMN schedule_notifications.acknowledged_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_notifications.acknowledged_at IS 'Set when the employee explicitly acknowledges the notification (currently used for schedule_published). Stronger than read_at; powers the admin "who has seen the posted week" view.';


--
-- Name: COLUMN schedule_notifications.publish_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_notifications.publish_event_id IS 'For schedule_published notifications: the schedule_publish_events row this notification belongs to. Stamped by scheduling_approve_publish_request.';


--
-- Name: schedule_open_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_open_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    shift_id uuid NOT NULL,
    claimed_by_employee_id uuid,
    claimed_at timestamp with time zone,
    claim_status text DEFAULT 'open'::text NOT NULL,
    expires_at timestamp with time zone,
    approval_required boolean DEFAULT false NOT NULL,
    approved_by_employee_id uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT schedule_open_shifts_claim_status_check CHECK ((claim_status = ANY (ARRAY['open'::text, 'claimed'::text, 'filled'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: TABLE schedule_open_shifts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_open_shifts IS 'Scheduling: surfaces a schedule_shifts row whose employee_id IS NULL into the staff-facing claim queue.
claim_status lifecycle:
  open       -- not yet claimed
  claimed    -- a staff member has claimed; if approval_required=false the parent shift is also assigned (final state then transitions to ''filled'')
  filled     -- claim accepted; parent schedule_shifts.employee_id now set
  expired    -- expires_at passed without a claim
  cancelled  -- admin cancelled the listing
approval_required is snapshotted at creation from schedule_settings.open_shift_first_come (false there => approval_required true here).';


--
-- Name: COLUMN schedule_open_shifts.approval_required; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_open_shifts.approval_required IS 'Snapshot of (NOT settings.open_shift_first_come) at creation time. true = staff claim records intent but admin must approve before parent shift is reassigned.';


--
-- Name: schedule_publish_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_publish_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    published_by_employee_id uuid,
    range_starts_at timestamp with time zone NOT NULL,
    range_ends_at timestamp with time zone NOT NULL,
    shift_count integer NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE schedule_publish_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_publish_events IS 'Scheduling: append-only audit row each time a schedule range is published. shift_count is the number of schedule_shifts moved from draft to published in that batch. No UPDATE/DELETE policies.';


--
-- Name: schedule_publish_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_publish_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    requested_by_employee_id uuid NOT NULL,
    range_starts_at timestamp with time zone NOT NULL,
    range_ends_at timestamp with time zone NOT NULL,
    notes text,
    status public.schedule_publish_request_status DEFAULT 'pending'::public.schedule_publish_request_status NOT NULL,
    decided_by_employee_id uuid,
    decided_at timestamp with time zone,
    rejection_reason text,
    published_event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT schedule_publish_requests_decision_chk CHECK ((((status = 'pending'::public.schedule_publish_request_status) AND (decided_by_employee_id IS NULL) AND (decided_at IS NULL)) OR ((status <> 'pending'::public.schedule_publish_request_status) AND (decided_by_employee_id IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT schedule_publish_requests_no_self_approve CHECK (((status = 'pending'::public.schedule_publish_request_status) OR (decided_by_employee_id <> requested_by_employee_id))),
    CONSTRAINT schedule_publish_requests_range_chk CHECK ((range_ends_at > range_starts_at))
);


--
-- Name: TABLE schedule_publish_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_publish_requests IS 'Two-person rule gate for scheduling publish. A request is created by someone with scheduling >= submit; approval (which triggers the publish) or rejection must be performed by a different employee with scheduling >= publish.';


--
-- Name: schedule_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    week_start_day integer DEFAULT 0 NOT NULL,
    default_shift_minutes integer DEFAULT 480 NOT NULL,
    minor_max_weekly_hours numeric DEFAULT 30,
    overtime_weekly_hours numeric DEFAULT 40,
    minimum_break_minutes integer DEFAULT 30,
    minimum_break_after_hours numeric DEFAULT 5,
    swap_requires_manager_approval boolean DEFAULT true NOT NULL,
    open_shift_first_come boolean DEFAULT true NOT NULL,
    notify_on_publish boolean DEFAULT true NOT NULL,
    notify_on_overtime boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    availability_submission_enabled boolean DEFAULT true NOT NULL,
    require_job_area_qualification boolean DEFAULT false NOT NULL,
    block_on_violations boolean DEFAULT false NOT NULL,
    swap_expiry_hours integer DEFAULT 72 NOT NULL,
    default_hourly_rate numeric,
    CONSTRAINT schedule_settings_default_hourly_rate_check CHECK (((default_hourly_rate IS NULL) OR ((default_hourly_rate >= (0)::numeric) AND (default_hourly_rate <= (10000)::numeric)))),
    CONSTRAINT schedule_settings_swap_expiry_hours_check CHECK ((swap_expiry_hours > 0)),
    CONSTRAINT schedule_settings_week_start_day_check CHECK (((week_start_day >= 0) AND (week_start_day <= 6)))
);


--
-- Name: TABLE schedule_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_settings IS 'Scheduling: per-facility module config. week_start_day uses 0=Sunday..6=Saturday. open_shift_first_come=true means staff may self-claim without admin approval (claim helper updates the parent shift directly); false means claim records a request that admin must approve before the parent shift gets the employee_id.';


--
-- Name: COLUMN schedule_settings.minor_max_weekly_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_settings.minor_max_weekly_hours IS 'Default weekly hour cap for minors. Per-rule overrides live in schedule_compliance_rules.params.';


--
-- Name: COLUMN schedule_settings.overtime_weekly_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_settings.overtime_weekly_hours IS 'Weekly hours threshold above which a shift is considered overtime. Used to populate compliance_warnings and (optionally) trigger notify_on_overtime.';


--
-- Name: COLUMN schedule_settings.availability_submission_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_settings.availability_submission_enabled IS 'When false, staff cannot submit/edit weekly availability (the self-service availability form is gated server- and client-side).';


--
-- Name: COLUMN schedule_settings.require_job_area_qualification; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_settings.require_job_area_qualification IS 'When true, an employee may only be assigned to a shift whose job_area_id is one of their employee_job_area_assignments (enforced as a hard block).';


--
-- Name: COLUMN schedule_settings.block_on_violations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_settings.block_on_violations IS 'Scheduling grid: when true, assignment warnings (weekly-hours cap, overlap, required-cert gaps, time-off, overtime) become hard blocks in the grid create/update actions. Default false = advisory only.';


--
-- Name: COLUMN schedule_settings.default_hourly_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_settings.default_hourly_rate IS 'Optional facility-wide hourly rate used for labor-cost estimates when an employee has no employee_wages row. NULL = no default; unrated shifts are excluded from cost totals.';


--
-- Name: schedule_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    department_id uuid,
    employee_id uuid,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    break_minutes integer DEFAULT 0,
    role_label text,
    notes text,
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp with time zone,
    published_by_employee_id uuid,
    recurring_parent_id uuid,
    template_origin_id uuid,
    compliance_warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    job_area_id uuid,
    CONSTRAINT schedule_shifts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'cancelled'::text]))),
    CONSTRAINT schedule_shifts_time_order_chk CHECK ((ends_at > starts_at))
);


--
-- Name: TABLE schedule_shifts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_shifts IS 'Scheduling: one row per scheduled shift. employee_id IS NULL signals an "open" shift; the paired schedule_open_shifts row drives the claim flow. status lifecycle: draft -> published -> (optionally) cancelled. Only module admins write here directly; staff effects flow through claim/swap helpers. compliance_warnings is a jsonb array of short string codes (e.g. ["minor_overtime","missing_certification"]) computed server-side.';


--
-- Name: COLUMN schedule_shifts.department_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_shifts.department_id IS 'Legacy department grouping (FK -> departments). NULLABLE as of the drag-to-create grid: shifts are keyed on job_area_id (employee_job_areas). Retained for backward compatibility with existing rows and the departments view.';


--
-- Name: COLUMN schedule_shifts.employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_shifts.employee_id IS 'NULL = unassigned ("open shift"). Pair with a schedule_open_shifts row to surface in the claim UI.';


--
-- Name: COLUMN schedule_shifts.recurring_parent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_shifts.recurring_parent_id IS 'Optional link from a generated occurrence to a parent shift -- v1 use is light; included for forward-compatibility with native recurring rules.';


--
-- Name: COLUMN schedule_shifts.template_origin_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_shifts.template_origin_id IS 'Set when the shift was produced by applying a schedule_templates row. Lets the UI distinguish ad-hoc edits from template-derived rows.';


--
-- Name: COLUMN schedule_shifts.compliance_warnings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_shifts.compliance_warnings IS 'JSON array of short string codes. Examples: "minor_overtime", "minor_weekly_cap", "missing_certification", "no_break", "back_to_back". UI renders chips and tooltips. App-computed (not DB-enforced).';


--
-- Name: COLUMN schedule_shifts.job_area_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_shifts.job_area_id IS 'Scheduling: the job area (role) this shift is for, from public.employee_job_areas. NULL = unspecified. Drives the not_qualified / certification compliance checks in scheduling_assignment_violations().';


--
-- Name: schedule_swap_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_swap_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    requester_employee_id uuid NOT NULL,
    requester_shift_id uuid NOT NULL,
    target_employee_id uuid,
    target_shift_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    manager_approver_employee_id uuid,
    accepted_at timestamp with time zone,
    approved_at timestamp with time zone,
    decided_at timestamp with time zone,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    expires_at timestamp with time zone,
    CONSTRAINT schedule_swap_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'manager_approved'::text, 'denied'::text, 'cancelled'::text, 'expired'::text])))
);


--
-- Name: TABLE schedule_swap_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_swap_requests IS 'Scheduling: shift-swap and shift-coverage requests.
State machine:
  pending           -- created by requester
  accepted          -- target employee accepted (or any-qualified picked it up); awaits manager if settings.swap_requires_manager_approval = true
  manager_approved  -- manager approved; the app then mutates the parent schedule_shifts.employee_id assignments
  denied            -- denied by target or manager
  cancelled         -- cancelled by requester before resolution
target_employee_id NULL = "any qualified" (one-way coverage). target_shift_id NULL = coverage rather than two-way swap.';


--
-- Name: schedule_template_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_template_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    template_id uuid NOT NULL,
    department_id uuid,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    break_minutes integer DEFAULT 0,
    role_label text,
    staff_count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    job_area_id uuid,
    CONSTRAINT schedule_template_shifts_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT schedule_template_shifts_staff_count_check CHECK ((staff_count >= 1)),
    CONSTRAINT schedule_template_shifts_time_order_chk CHECK ((end_time > start_time))
);


--
-- Name: TABLE schedule_template_shifts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_template_shifts IS 'Scheduling: one row per recurring slot inside a template. day_of_week 0=Sunday..6=Saturday. staff_count expands to N schedule_shifts when the template is applied to a week.';


--
-- Name: COLUMN schedule_template_shifts.department_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_template_shifts.department_id IS 'Legacy department grouping (FK -> departments). NULLABLE as of the grid template flow: template slots are keyed on job_area_id (employee_job_areas). Retained for backward compatibility.';


--
-- Name: COLUMN schedule_template_shifts.job_area_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schedule_template_shifts.job_area_id IS 'Scheduling: job area (role) carried by this template slot; copied onto the generated schedule_shifts.job_area_id when the template is applied.';


--
-- Name: schedule_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE schedule_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_templates IS 'Scheduling: named recurring schedule templates owned by a facility. Apply-to-week generates schedule_shifts rows whose template_origin_id points back here. Slug is unique per facility.';


--
-- Name: schedule_time_off_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_time_off_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by_employee_id uuid,
    decided_at timestamp with time zone,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT schedule_time_off_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'cancelled'::text]))),
    CONSTRAINT schedule_time_off_time_order_chk CHECK ((ends_at > starts_at))
);


--
-- Name: TABLE schedule_time_off_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schedule_time_off_requests IS 'Scheduling: employee-submitted time-off requests. Lifecycle: pending -> approved | denied | cancelled. Self-cancel is permitted via UPDATE policy; admins decide approve/deny. The schedule_notifications row of type ''time_off_decided'' is fired by the app on decision.';


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    module_name text NOT NULL,
    action public.user_action NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'role_default'::text NOT NULL,
    CONSTRAINT user_permissions_module_name_check CHECK ((module_name = ANY (ARRAY['daily_reports'::text, 'ice_depth'::text, 'ice_operations'::text, 'incident_reports'::text, 'accident_reports'::text, 'refrigeration'::text, 'air_quality'::text, 'scheduling'::text, 'communications'::text, 'facility_paperwork'::text, 'admin'::text]))),
    CONSTRAINT user_permissions_source_check CHECK ((source = ANY (ARRAY['role_default'::text, 'manual_override'::text])))
);


--
-- Name: COLUMN user_permissions.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_permissions.source IS 'role_default = written by apply_role_permission_defaults() and safe to re-seed; manual_override = hand-set by an admin and never clobbered by role re-seeding.';


--
-- Name: accident_body_part_selections accident_body_part_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_body_part_selections
    ADD CONSTRAINT accident_body_part_selections_pkey PRIMARY KEY (id);


--
-- Name: accident_body_part_selections accident_body_part_selections_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_body_part_selections
    ADD CONSTRAINT accident_body_part_selections_uniq UNIQUE NULLS NOT DISTINCT (accident_id, body_part_dropdown_id, side, laterality);


--
-- Name: accident_change_log accident_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_change_log
    ADD CONSTRAINT accident_change_log_pkey PRIMARY KEY (id);


--
-- Name: accident_dropdowns accident_dropdowns_facility_category_key_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_dropdowns
    ADD CONSTRAINT accident_dropdowns_facility_category_key_uniq UNIQUE (facility_id, category, key);


--
-- Name: accident_dropdowns accident_dropdowns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_dropdowns
    ADD CONSTRAINT accident_dropdowns_pkey PRIMARY KEY (id);


--
-- Name: accident_followup_notes accident_followup_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_followup_notes
    ADD CONSTRAINT accident_followup_notes_pkey PRIMARY KEY (id);


--
-- Name: accident_reports accident_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_reports
    ADD CONSTRAINT accident_reports_pkey PRIMARY KEY (id);


--
-- Name: accident_witnesses accident_witnesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_witnesses
    ADD CONSTRAINT accident_witnesses_pkey PRIMARY KEY (id);


--
-- Name: accident_witnesses accident_witnesses_uniq_per_accident; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_witnesses
    ADD CONSTRAINT accident_witnesses_uniq_per_accident UNIQUE (accident_id, sort_order);


--
-- Name: accident_workers_comp_settings accident_workers_comp_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_workers_comp_settings
    ADD CONSTRAINT accident_workers_comp_settings_pkey PRIMARY KEY (id);


--
-- Name: air_quality_change_log air_quality_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_change_log
    ADD CONSTRAINT air_quality_change_log_pkey PRIMARY KEY (id);


--
-- Name: air_quality_compliance_profiles air_quality_compliance_profiles_jurisdiction_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_compliance_profiles
    ADD CONSTRAINT air_quality_compliance_profiles_jurisdiction_key UNIQUE (jurisdiction);


--
-- Name: air_quality_compliance_profiles air_quality_compliance_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_compliance_profiles
    ADD CONSTRAINT air_quality_compliance_profiles_pkey PRIMARY KEY (id);


--
-- Name: air_quality_compliance_rules air_quality_compliance_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_compliance_rules
    ADD CONSTRAINT air_quality_compliance_rules_pkey PRIMARY KEY (id);


--
-- Name: air_quality_equipment air_quality_equipment_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_equipment
    ADD CONSTRAINT air_quality_equipment_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: air_quality_equipment air_quality_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_equipment
    ADD CONSTRAINT air_quality_equipment_pkey PRIMARY KEY (id);


--
-- Name: air_quality_followup_notes air_quality_followup_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_followup_notes
    ADD CONSTRAINT air_quality_followup_notes_pkey PRIMARY KEY (id);


--
-- Name: air_quality_reading_types air_quality_reading_types_facility_key_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_reading_types
    ADD CONSTRAINT air_quality_reading_types_facility_key_uniq UNIQUE (facility_id, key);


--
-- Name: air_quality_reading_types air_quality_reading_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_reading_types
    ADD CONSTRAINT air_quality_reading_types_pkey PRIMARY KEY (id);


--
-- Name: air_quality_readings air_quality_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_readings
    ADD CONSTRAINT air_quality_readings_pkey PRIMARY KEY (id);


--
-- Name: air_quality_reports air_quality_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_reports
    ADD CONSTRAINT air_quality_reports_pkey PRIMARY KEY (id);


--
-- Name: air_quality_settings air_quality_settings_facility_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_settings
    ADD CONSTRAINT air_quality_settings_facility_uniq UNIQUE (facility_id);


--
-- Name: air_quality_settings air_quality_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_settings
    ADD CONSTRAINT air_quality_settings_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: certification_types certification_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification_types
    ADD CONSTRAINT certification_types_pkey PRIMARY KEY (id);


--
-- Name: communication_acknowledgements communication_acknowledgements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_acknowledgements
    ADD CONSTRAINT communication_acknowledgements_pkey PRIMARY KEY (id);


--
-- Name: communication_alerts communication_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_alerts
    ADD CONSTRAINT communication_alerts_pkey PRIMARY KEY (id);


--
-- Name: communication_audit_log communication_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_audit_log
    ADD CONSTRAINT communication_audit_log_pkey PRIMARY KEY (id);


--
-- Name: communication_group_members communication_group_members_group_employee_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_group_members
    ADD CONSTRAINT communication_group_members_group_employee_uniq UNIQUE (group_id, employee_id);


--
-- Name: communication_group_members communication_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_group_members
    ADD CONSTRAINT communication_group_members_pkey PRIMARY KEY (id);


--
-- Name: communication_groups communication_groups_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_groups
    ADD CONSTRAINT communication_groups_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: communication_groups communication_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_groups
    ADD CONSTRAINT communication_groups_pkey PRIMARY KEY (id);


--
-- Name: communication_messages communication_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_messages
    ADD CONSTRAINT communication_messages_pkey PRIMARY KEY (id);


--
-- Name: communication_recipients communication_recipients_message_employee_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recipients
    ADD CONSTRAINT communication_recipients_message_employee_uniq UNIQUE (message_id, employee_id);


--
-- Name: communication_recipients communication_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recipients
    ADD CONSTRAINT communication_recipients_pkey PRIMARY KEY (id);


--
-- Name: communication_recurring_reminders communication_recurring_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recurring_reminders
    ADD CONSTRAINT communication_recurring_reminders_pkey PRIMARY KEY (id);


--
-- Name: communication_routing_rules communication_routing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_routing_rules
    ADD CONSTRAINT communication_routing_rules_pkey PRIMARY KEY (id);


--
-- Name: communication_templates communication_templates_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_templates
    ADD CONSTRAINT communication_templates_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: communication_templates communication_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_templates
    ADD CONSTRAINT communication_templates_pkey PRIMARY KEY (id);


--
-- Name: daily_report_areas daily_report_areas_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_areas
    ADD CONSTRAINT daily_report_areas_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: daily_report_areas daily_report_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_areas
    ADD CONSTRAINT daily_report_areas_pkey PRIMARY KEY (id);


--
-- Name: daily_report_checklist_items daily_report_checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_checklist_items
    ADD CONSTRAINT daily_report_checklist_items_pkey PRIMARY KEY (id);


--
-- Name: daily_report_notes daily_report_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_notes
    ADD CONSTRAINT daily_report_notes_pkey PRIMARY KEY (id);


--
-- Name: daily_report_submission_items daily_report_submission_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submission_items
    ADD CONSTRAINT daily_report_submission_items_pkey PRIMARY KEY (id);


--
-- Name: daily_report_submissions daily_report_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submissions
    ADD CONSTRAINT daily_report_submissions_pkey PRIMARY KEY (id);


--
-- Name: daily_report_templates daily_report_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_templates
    ADD CONSTRAINT daily_report_templates_pkey PRIMARY KEY (id);


--
-- Name: departments departments_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: employee_certifications employee_certifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_certifications
    ADD CONSTRAINT employee_certifications_pkey PRIMARY KEY (id);


--
-- Name: employee_invites employee_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_invites
    ADD CONSTRAINT employee_invites_pkey PRIMARY KEY (id);


--
-- Name: employee_job_area_assignments employee_job_area_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_job_area_assignments
    ADD CONSTRAINT employee_job_area_assignments_pkey PRIMARY KEY (id);


--
-- Name: employee_job_area_assignments employee_job_area_assignments_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_job_area_assignments
    ADD CONSTRAINT employee_job_area_assignments_uniq UNIQUE (employee_id, job_area_id);


--
-- Name: employee_job_areas employee_job_areas_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_job_areas
    ADD CONSTRAINT employee_job_areas_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: employee_job_areas employee_job_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_job_areas
    ADD CONSTRAINT employee_job_areas_pkey PRIMARY KEY (id);


--
-- Name: employee_wages employee_wages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_wages
    ADD CONSTRAINT employee_wages_pkey PRIMARY KEY (employee_id);


--
-- Name: employees employees_facility_code_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_facility_code_uniq UNIQUE (facility_id, employee_code);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: export_settings export_settings_facility_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_settings
    ADD CONSTRAINT export_settings_facility_id_key UNIQUE (facility_id);


--
-- Name: export_settings export_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_settings
    ADD CONSTRAINT export_settings_pkey PRIMARY KEY (id);


--
-- Name: facilities facilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);


--
-- Name: facilities facilities_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_slug_key UNIQUE (slug);


--
-- Name: facility_air_quality_config facility_air_quality_config_facility_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_air_quality_config
    ADD CONSTRAINT facility_air_quality_config_facility_uniq UNIQUE (facility_id);


--
-- Name: facility_air_quality_config facility_air_quality_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_air_quality_config
    ADD CONSTRAINT facility_air_quality_config_pkey PRIMARY KEY (id);


--
-- Name: facility_documents facility_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_documents
    ADD CONSTRAINT facility_documents_pkey PRIMARY KEY (id);


--
-- Name: facility_documents facility_documents_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_documents
    ADD CONSTRAINT facility_documents_storage_path_key UNIQUE (storage_path);


--
-- Name: facility_dropdown_options facility_dropdown_options_facility_domain_key_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_dropdown_options
    ADD CONSTRAINT facility_dropdown_options_facility_domain_key_uniq UNIQUE (facility_id, domain, key);


--
-- Name: facility_dropdown_options facility_dropdown_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_dropdown_options
    ADD CONSTRAINT facility_dropdown_options_pkey PRIMARY KEY (id);


--
-- Name: facility_modules facility_modules_facility_id_module_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_modules
    ADD CONSTRAINT facility_modules_facility_id_module_key_key UNIQUE (facility_id, module_key);


--
-- Name: facility_modules facility_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_modules
    ADD CONSTRAINT facility_modules_pkey PRIMARY KEY (id);


--
-- Name: facility_spaces facility_spaces_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_spaces
    ADD CONSTRAINT facility_spaces_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: facility_spaces facility_spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_spaces
    ADD CONSTRAINT facility_spaces_pkey PRIMARY KEY (id);


--
-- Name: ice_depth_change_log ice_depth_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_change_log
    ADD CONSTRAINT ice_depth_change_log_pkey PRIMARY KEY (id);


--
-- Name: ice_depth_followup_notes ice_depth_followup_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_followup_notes
    ADD CONSTRAINT ice_depth_followup_notes_pkey PRIMARY KEY (id);


--
-- Name: ice_depth_layouts ice_depth_layouts_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_layouts
    ADD CONSTRAINT ice_depth_layouts_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: ice_depth_layouts ice_depth_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_layouts
    ADD CONSTRAINT ice_depth_layouts_pkey PRIMARY KEY (id);


--
-- Name: ice_depth_measurements ice_depth_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_measurements
    ADD CONSTRAINT ice_depth_measurements_pkey PRIMARY KEY (id);


--
-- Name: ice_depth_points ice_depth_points_layout_number_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_points
    ADD CONSTRAINT ice_depth_points_layout_number_uniq UNIQUE (layout_id, point_number);


--
-- Name: ice_depth_points ice_depth_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_points
    ADD CONSTRAINT ice_depth_points_pkey PRIMARY KEY (id);


--
-- Name: ice_depth_rinks ice_depth_rinks_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_rinks
    ADD CONSTRAINT ice_depth_rinks_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: ice_depth_rinks ice_depth_rinks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_rinks
    ADD CONSTRAINT ice_depth_rinks_pkey PRIMARY KEY (id);


--
-- Name: ice_depth_sessions ice_depth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_sessions
    ADD CONSTRAINT ice_depth_sessions_pkey PRIMARY KEY (id);


--
-- Name: ice_depth_settings ice_depth_settings_facility_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_settings
    ADD CONSTRAINT ice_depth_settings_facility_uniq UNIQUE (facility_id);


--
-- Name: ice_depth_settings ice_depth_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_settings
    ADD CONSTRAINT ice_depth_settings_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_circle_check_items ice_operations_circle_check_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_items
    ADD CONSTRAINT ice_operations_circle_check_items_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_circle_check_results ice_operations_circle_check_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_results
    ADD CONSTRAINT ice_operations_circle_check_results_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_circle_check_template_items ice_operations_circle_check_template_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_template_items
    ADD CONSTRAINT ice_operations_circle_check_template_items_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_circle_check_templates ice_operations_circle_check_templates_facility_fuel_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_templates
    ADD CONSTRAINT ice_operations_circle_check_templates_facility_fuel_uniq UNIQUE (facility_id, fuel_type_id);


--
-- Name: ice_operations_circle_check_templates ice_operations_circle_check_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_templates
    ADD CONSTRAINT ice_operations_circle_check_templates_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_equipment ice_operations_equipment_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_equipment
    ADD CONSTRAINT ice_operations_equipment_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: ice_operations_equipment ice_operations_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_equipment
    ADD CONSTRAINT ice_operations_equipment_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_followup_notes ice_operations_followup_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_followup_notes
    ADD CONSTRAINT ice_operations_followup_notes_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_fuel_types ice_operations_fuel_types_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_fuel_types
    ADD CONSTRAINT ice_operations_fuel_types_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: ice_operations_fuel_types ice_operations_fuel_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_fuel_types
    ADD CONSTRAINT ice_operations_fuel_types_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_rinks ice_operations_rinks_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_rinks
    ADD CONSTRAINT ice_operations_rinks_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: ice_operations_rinks ice_operations_rinks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_rinks
    ADD CONSTRAINT ice_operations_rinks_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_settings ice_operations_settings_facility_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_settings
    ADD CONSTRAINT ice_operations_settings_facility_uniq UNIQUE (facility_id);


--
-- Name: ice_operations_settings ice_operations_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_settings
    ADD CONSTRAINT ice_operations_settings_pkey PRIMARY KEY (id);


--
-- Name: ice_operations_submissions ice_operations_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_submissions
    ADD CONSTRAINT ice_operations_submissions_pkey PRIMARY KEY (id);


--
-- Name: incident_activities incident_activities_facility_key_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_activities
    ADD CONSTRAINT incident_activities_facility_key_uniq UNIQUE (facility_id, key);


--
-- Name: incident_activities incident_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_activities
    ADD CONSTRAINT incident_activities_pkey PRIMARY KEY (id);


--
-- Name: incident_change_log incident_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_change_log
    ADD CONSTRAINT incident_change_log_pkey PRIMARY KEY (id);


--
-- Name: incident_followup_notes incident_followup_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_followup_notes
    ADD CONSTRAINT incident_followup_notes_pkey PRIMARY KEY (id);


--
-- Name: incident_report_spaces incident_report_spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_report_spaces
    ADD CONSTRAINT incident_report_spaces_pkey PRIMARY KEY (id);


--
-- Name: incident_report_spaces incident_report_spaces_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_report_spaces
    ADD CONSTRAINT incident_report_spaces_uniq UNIQUE (incident_id, space_id);


--
-- Name: incident_reports incident_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_pkey PRIMARY KEY (id);


--
-- Name: incident_severity_levels incident_severity_levels_facility_key_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_severity_levels
    ADD CONSTRAINT incident_severity_levels_facility_key_uniq UNIQUE (facility_id, key);


--
-- Name: incident_severity_levels incident_severity_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_severity_levels
    ADD CONSTRAINT incident_severity_levels_pkey PRIMARY KEY (id);


--
-- Name: incident_types incident_types_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_types
    ADD CONSTRAINT incident_types_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: incident_types incident_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_types
    ADD CONSTRAINT incident_types_pkey PRIMARY KEY (id);


--
-- Name: incident_witnesses incident_witnesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_witnesses
    ADD CONSTRAINT incident_witnesses_pkey PRIMARY KEY (id);


--
-- Name: incident_witnesses incident_witnesses_uniq_per_report; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_witnesses
    ADD CONSTRAINT incident_witnesses_uniq_per_report UNIQUE (incident_id, sort_order);


--
-- Name: information_requests information_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.information_requests
    ADD CONSTRAINT information_requests_pkey PRIMARY KEY (id);


--
-- Name: job_area_certification_requirements job_area_cert_requirements_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_area_certification_requirements
    ADD CONSTRAINT job_area_cert_requirements_uniq UNIQUE (facility_id, job_area_id, cert_name);


--
-- Name: job_area_certification_requirements job_area_certification_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_area_certification_requirements
    ADD CONSTRAINT job_area_certification_requirements_pkey PRIMARY KEY (id);


--
-- Name: module_area_permissions module_area_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_area_permissions
    ADD CONSTRAINT module_area_permissions_pkey PRIMARY KEY (id);


--
-- Name: module_area_permissions module_area_permissions_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_area_permissions
    ADD CONSTRAINT module_area_permissions_uniq UNIQUE (employee_id, module_key, area_id);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: offline_sync_queue offline_sync_queue_local_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_sync_queue
    ADD CONSTRAINT offline_sync_queue_local_id_key UNIQUE (local_id);


--
-- Name: offline_sync_queue offline_sync_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_sync_queue
    ADD CONSTRAINT offline_sync_queue_pkey PRIMARY KEY (id);


--
-- Name: profile_audit_log profile_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_audit_log
    ADD CONSTRAINT profile_audit_log_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_counters rate_limit_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_counters
    ADD CONSTRAINT rate_limit_counters_pkey PRIMARY KEY (bucket, identifier, window_start);


--
-- Name: refrigeration_change_log refrigeration_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_change_log
    ADD CONSTRAINT refrigeration_change_log_pkey PRIMARY KEY (id);


--
-- Name: refrigeration_equipment refrigeration_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_equipment
    ADD CONSTRAINT refrigeration_equipment_pkey PRIMARY KEY (id);


--
-- Name: refrigeration_equipment refrigeration_equipment_section_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_equipment
    ADD CONSTRAINT refrigeration_equipment_section_slug_uniq UNIQUE (section_id, slug);


--
-- Name: refrigeration_fields refrigeration_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_fields
    ADD CONSTRAINT refrigeration_fields_pkey PRIMARY KEY (id);


--
-- Name: refrigeration_followup_notes refrigeration_followup_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_followup_notes
    ADD CONSTRAINT refrigeration_followup_notes_pkey PRIMARY KEY (id);


--
-- Name: refrigeration_report_values refrigeration_report_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_report_values
    ADD CONSTRAINT refrigeration_report_values_pkey PRIMARY KEY (id);


--
-- Name: refrigeration_reports refrigeration_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_reports
    ADD CONSTRAINT refrigeration_reports_pkey PRIMARY KEY (id);


--
-- Name: refrigeration_sections refrigeration_sections_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_sections
    ADD CONSTRAINT refrigeration_sections_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: refrigeration_sections refrigeration_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_sections
    ADD CONSTRAINT refrigeration_sections_pkey PRIMARY KEY (id);


--
-- Name: refrigeration_settings refrigeration_settings_facility_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_settings
    ADD CONSTRAINT refrigeration_settings_facility_uniq UNIQUE (facility_id);


--
-- Name: refrigeration_settings refrigeration_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_settings
    ADD CONSTRAINT refrigeration_settings_pkey PRIMARY KEY (id);


--
-- Name: refrigeration_thresholds refrigeration_thresholds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_thresholds
    ADD CONSTRAINT refrigeration_thresholds_pkey PRIMARY KEY (id);


--
-- Name: retention_settings retention_settings_facility_module_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_settings
    ADD CONSTRAINT retention_settings_facility_module_uniq UNIQUE (facility_id, module_key);


--
-- Name: retention_settings retention_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_settings
    ADD CONSTRAINT retention_settings_pkey PRIMARY KEY (id);


--
-- Name: role_module_permission_defaults role_module_permission_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_module_permission_defaults
    ADD CONSTRAINT role_module_permission_defaults_pkey PRIMARY KEY (id);


--
-- Name: role_module_permission_defaults role_module_permission_defaults_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_module_permission_defaults
    ADD CONSTRAINT role_module_permission_defaults_uniq UNIQUE (role_id, module_key);


--
-- Name: role_permission_defaults role_permission_defaults_facility_id_role_id_module_name_ac_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_defaults
    ADD CONSTRAINT role_permission_defaults_facility_id_role_id_module_name_ac_key UNIQUE (facility_id, role_id, module_name, action);


--
-- Name: role_permission_defaults role_permission_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_defaults
    ADD CONSTRAINT role_permission_defaults_pkey PRIMARY KEY (id);


--
-- Name: roles roles_facility_key_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_facility_key_uniq UNIQUE (facility_id, key);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: schedule_assignment_overrides schedule_assignment_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_assignment_overrides
    ADD CONSTRAINT schedule_assignment_overrides_pkey PRIMARY KEY (id);


--
-- Name: schedule_availability schedule_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_availability
    ADD CONSTRAINT schedule_availability_pkey PRIMARY KEY (id);


--
-- Name: schedule_compliance_rules schedule_compliance_rules_facility_name_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_compliance_rules
    ADD CONSTRAINT schedule_compliance_rules_facility_name_uniq UNIQUE (facility_id, name);


--
-- Name: schedule_compliance_rules schedule_compliance_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_compliance_rules
    ADD CONSTRAINT schedule_compliance_rules_pkey PRIMARY KEY (id);


--
-- Name: schedule_ics_tokens schedule_ics_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_ics_tokens
    ADD CONSTRAINT schedule_ics_tokens_pkey PRIMARY KEY (employee_id);


--
-- Name: schedule_ics_tokens schedule_ics_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_ics_tokens
    ADD CONSTRAINT schedule_ics_tokens_token_key UNIQUE (token);


--
-- Name: schedule_notifications schedule_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_notifications
    ADD CONSTRAINT schedule_notifications_pkey PRIMARY KEY (id);


--
-- Name: schedule_open_shifts schedule_open_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_open_shifts
    ADD CONSTRAINT schedule_open_shifts_pkey PRIMARY KEY (id);


--
-- Name: schedule_open_shifts schedule_open_shifts_shift_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_open_shifts
    ADD CONSTRAINT schedule_open_shifts_shift_uniq UNIQUE (shift_id);


--
-- Name: schedule_publish_events schedule_publish_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_publish_events
    ADD CONSTRAINT schedule_publish_events_pkey PRIMARY KEY (id);


--
-- Name: schedule_publish_requests schedule_publish_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_publish_requests
    ADD CONSTRAINT schedule_publish_requests_pkey PRIMARY KEY (id);


--
-- Name: schedule_settings schedule_settings_facility_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_settings
    ADD CONSTRAINT schedule_settings_facility_uniq UNIQUE (facility_id);


--
-- Name: schedule_settings schedule_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_settings
    ADD CONSTRAINT schedule_settings_pkey PRIMARY KEY (id);


--
-- Name: schedule_shifts schedule_shifts_no_double_booking; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_no_double_booking EXCLUDE USING gist (employee_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE (((employee_id IS NOT NULL) AND (status = ANY (ARRAY['draft'::text, 'published'::text]))));


--
-- Name: schedule_shifts schedule_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_pkey PRIMARY KEY (id);


--
-- Name: schedule_swap_requests schedule_swap_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_swap_requests
    ADD CONSTRAINT schedule_swap_requests_pkey PRIMARY KEY (id);


--
-- Name: schedule_template_shifts schedule_template_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_shifts
    ADD CONSTRAINT schedule_template_shifts_pkey PRIMARY KEY (id);


--
-- Name: schedule_templates schedule_templates_facility_slug_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_templates
    ADD CONSTRAINT schedule_templates_facility_slug_uniq UNIQUE (facility_id, slug);


--
-- Name: schedule_templates schedule_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_templates
    ADD CONSTRAINT schedule_templates_pkey PRIMARY KEY (id);


--
-- Name: schedule_time_off_requests schedule_time_off_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_time_off_requests
    ADD CONSTRAINT schedule_time_off_requests_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_unique UNIQUE (user_id, facility_id, module_name, action);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: certification_types_ci_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX certification_types_ci_uniq ON public.certification_types USING btree (facility_id, lower(btrim(name)));


--
-- Name: employee_certifications_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_certifications_employee_idx ON public.employee_certifications USING btree (employee_id);


--
-- Name: employee_certifications_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_certifications_expires_idx ON public.employee_certifications USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: employee_certifications_facility_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_certifications_facility_idx ON public.employee_certifications USING btree (facility_id);


--
-- Name: employee_invites_active_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_invites_active_uniq ON public.employee_invites USING btree (employee_id) WHERE (status = ANY (ARRAY['pending'::text, 'sent'::text]));


--
-- Name: employee_invites_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_invites_employee_idx ON public.employee_invites USING btree (employee_id);


--
-- Name: employee_invites_facility_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_invites_facility_idx ON public.employee_invites USING btree (facility_id);


--
-- Name: facility_modules_facility_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_modules_facility_id_idx ON public.facility_modules USING btree (facility_id);


--
-- Name: idx_accident_body_part_selections_accident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_body_part_selections_accident ON public.accident_body_part_selections USING btree (accident_id);


--
-- Name: idx_accident_body_part_selections_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_body_part_selections_facility_id ON public.accident_body_part_selections USING btree (facility_id);


--
-- Name: idx_accident_change_log_accident_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_change_log_accident_created ON public.accident_change_log USING btree (accident_id, created_at);


--
-- Name: idx_accident_change_log_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_change_log_facility_id ON public.accident_change_log USING btree (facility_id);


--
-- Name: idx_accident_dropdowns_facility_category_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_dropdowns_facility_category_active_sort ON public.accident_dropdowns USING btree (facility_id, category, is_active, sort_order);


--
-- Name: idx_accident_followup_notes_accident_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_followup_notes_accident_created ON public.accident_followup_notes USING btree (accident_id, created_at);


--
-- Name: idx_accident_followup_notes_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_followup_notes_facility_id ON public.accident_followup_notes USING btree (facility_id);


--
-- Name: idx_accident_reports_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_reports_employee ON public.accident_reports USING btree (employee_id);


--
-- Name: idx_accident_reports_facility_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_reports_facility_submitted ON public.accident_reports USING btree (facility_id, submitted_at DESC);


--
-- Name: idx_accident_reports_medical_attention; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_reports_medical_attention ON public.accident_reports USING btree (medical_attention_dropdown_id);


--
-- Name: idx_accident_reports_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_reports_severity ON public.accident_reports USING btree (severity_dropdown_id);


--
-- Name: idx_accident_witnesses_accident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_witnesses_accident ON public.accident_witnesses USING btree (accident_id);


--
-- Name: idx_accident_witnesses_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accident_witnesses_facility_id ON public.accident_witnesses USING btree (facility_id);


--
-- Name: idx_air_quality_change_log_changed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_change_log_changed_by ON public.air_quality_change_log USING btree (changed_by);


--
-- Name: idx_air_quality_change_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_change_log_created_at ON public.air_quality_change_log USING btree (created_at DESC);


--
-- Name: idx_air_quality_change_log_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_change_log_facility_id ON public.air_quality_change_log USING btree (facility_id);


--
-- Name: idx_air_quality_change_log_submission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_change_log_submission_id ON public.air_quality_change_log USING btree (submission_id);


--
-- Name: idx_air_quality_compliance_profiles_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_compliance_profiles_jurisdiction ON public.air_quality_compliance_profiles USING btree (jurisdiction);


--
-- Name: idx_air_quality_compliance_rules_facility_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_compliance_rules_facility_active ON public.air_quality_compliance_rules USING btree (facility_id, is_active);


--
-- Name: idx_air_quality_equipment_facility_location_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_equipment_facility_location_active ON public.air_quality_equipment USING btree (facility_id, location_id, is_active);


--
-- Name: idx_air_quality_followup_notes_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_followup_notes_facility_id ON public.air_quality_followup_notes USING btree (facility_id);


--
-- Name: idx_air_quality_followup_notes_report_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_followup_notes_report_created ON public.air_quality_followup_notes USING btree (report_id, created_at);


--
-- Name: idx_air_quality_reading_types_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_reading_types_facility_active_sort ON public.air_quality_reading_types USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_air_quality_readings_exceedance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_readings_exceedance ON public.air_quality_readings USING btree (report_id) WHERE (is_exceedance = true);


--
-- Name: idx_air_quality_readings_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_readings_facility_id ON public.air_quality_readings USING btree (facility_id);


--
-- Name: idx_air_quality_readings_reading_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_readings_reading_type ON public.air_quality_readings USING btree (reading_type_id);


--
-- Name: idx_air_quality_readings_report; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_readings_report ON public.air_quality_readings USING btree (report_id);


--
-- Name: idx_air_quality_reports_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_reports_employee ON public.air_quality_reports USING btree (employee_id);


--
-- Name: idx_air_quality_reports_exceedance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_reports_exceedance ON public.air_quality_reports USING btree (facility_id, submitted_at DESC) WHERE (has_exceedance = true);


--
-- Name: idx_air_quality_reports_facility_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_reports_facility_submitted ON public.air_quality_reports USING btree (facility_id, submitted_at DESC);


--
-- Name: idx_air_quality_reports_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_air_quality_reports_location ON public.air_quality_reports USING btree (location_id);


--
-- Name: idx_audit_logs_actor_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_actor_user_id ON public.audit_logs USING btree (actor_user_id);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_audit_logs_facility_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_facility_created ON public.audit_logs USING btree (facility_id, created_at DESC);


--
-- Name: idx_audit_logs_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_facility_id ON public.audit_logs USING btree (facility_id);


--
-- Name: idx_certification_types_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certification_types_facility ON public.certification_types USING btree (facility_id);


--
-- Name: idx_communication_acknowledgements_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_acknowledgements_employee ON public.communication_acknowledgements USING btree (employee_id);


--
-- Name: idx_communication_acknowledgements_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_acknowledgements_facility ON public.communication_acknowledgements USING btree (facility_id);


--
-- Name: idx_communication_alerts_facility_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_alerts_facility_created ON public.communication_alerts USING btree (facility_id, created_at DESC);


--
-- Name: idx_communication_alerts_resolved_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_alerts_resolved_at ON public.communication_alerts USING btree (resolved_at);


--
-- Name: idx_communication_alerts_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_alerts_severity ON public.communication_alerts USING btree (severity);


--
-- Name: idx_communication_alerts_source_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_alerts_source_module ON public.communication_alerts USING btree (source_module);


--
-- Name: idx_communication_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_audit_log_entity ON public.communication_audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_communication_audit_log_facility_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_audit_log_facility_created ON public.communication_audit_log USING btree (facility_id, created_at DESC);


--
-- Name: idx_communication_group_members_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_group_members_employee ON public.communication_group_members USING btree (employee_id);


--
-- Name: idx_communication_group_members_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_group_members_facility_id ON public.communication_group_members USING btree (facility_id);


--
-- Name: idx_communication_groups_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_groups_facility ON public.communication_groups USING btree (facility_id);


--
-- Name: idx_communication_groups_staff_can_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_groups_staff_can_message ON public.communication_groups USING btree (facility_id, staff_can_message) WHERE (staff_can_message = true);


--
-- Name: idx_communication_messages_facility_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_messages_facility_sent_at ON public.communication_messages USING btree (facility_id, sent_at DESC);


--
-- Name: idx_communication_messages_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_messages_parent ON public.communication_messages USING btree (parent_message_id) WHERE (parent_message_id IS NOT NULL);


--
-- Name: idx_communication_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_messages_sender ON public.communication_messages USING btree (sender_employee_id);


--
-- Name: idx_communication_recipients_email_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_recipients_email_ready ON public.communication_recipients USING btree (email_status, email_next_attempt_at NULLS FIRST, created_at) WHERE (email_status = ANY (ARRAY['pending'::text, 'sending'::text]));


--
-- Name: idx_communication_recipients_employee_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_recipients_employee_read ON public.communication_recipients USING btree (employee_id, read_at);


--
-- Name: idx_communication_recipients_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_recipients_facility ON public.communication_recipients USING btree (facility_id);


--
-- Name: idx_communication_recipients_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_recipients_message ON public.communication_recipients USING btree (message_id);


--
-- Name: idx_communication_recurring_reminders_facility_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_recurring_reminders_facility_due ON public.communication_recurring_reminders USING btree (facility_id, is_active, next_run_at);


--
-- Name: idx_communication_routing_rules_facility_module_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_routing_rules_facility_module_active ON public.communication_routing_rules USING btree (facility_id, source_module, is_active);


--
-- Name: idx_communication_routing_rules_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_routing_rules_priority ON public.communication_routing_rules USING btree (priority DESC);


--
-- Name: idx_communication_routing_rules_timing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_routing_rules_timing ON public.communication_routing_rules USING btree (timing, is_active);


--
-- Name: idx_communication_templates_facility_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_templates_facility_category ON public.communication_templates USING btree (facility_id, category);


--
-- Name: idx_daily_report_areas_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_areas_facility ON public.daily_report_areas USING btree (facility_id);


--
-- Name: idx_daily_report_areas_facility_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_areas_facility_active ON public.daily_report_areas USING btree (facility_id, is_active);


--
-- Name: idx_daily_report_checklist_items_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_checklist_items_facility ON public.daily_report_checklist_items USING btree (facility_id);


--
-- Name: idx_daily_report_checklist_items_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_checklist_items_template ON public.daily_report_checklist_items USING btree (template_id);


--
-- Name: idx_daily_report_notes_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_notes_facility ON public.daily_report_notes USING btree (facility_id);


--
-- Name: idx_daily_report_notes_submission_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_notes_submission_created ON public.daily_report_notes USING btree (submission_id, created_at);


--
-- Name: idx_daily_report_submission_items_checklist_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_submission_items_checklist_item ON public.daily_report_submission_items USING btree (checklist_item_id);


--
-- Name: idx_daily_report_submission_items_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_submission_items_facility_id ON public.daily_report_submission_items USING btree (facility_id);


--
-- Name: idx_daily_report_submission_items_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_submission_items_submission ON public.daily_report_submission_items USING btree (submission_id);


--
-- Name: idx_daily_report_submissions_area_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_submissions_area_submitted ON public.daily_report_submissions USING btree (area_id, submitted_at DESC);


--
-- Name: idx_daily_report_submissions_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_submissions_employee ON public.daily_report_submissions USING btree (employee_id);


--
-- Name: idx_daily_report_submissions_facility_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_submissions_facility_created ON public.daily_report_submissions USING btree (facility_id, created_at DESC);


--
-- Name: idx_daily_report_submissions_facility_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_submissions_facility_submitted ON public.daily_report_submissions USING btree (facility_id, submitted_at DESC);


--
-- Name: idx_daily_report_submissions_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_submissions_template ON public.daily_report_submissions USING btree (template_id);


--
-- Name: idx_daily_report_templates_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_templates_area ON public.daily_report_templates USING btree (area_id);


--
-- Name: idx_daily_report_templates_facility_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_report_templates_facility_area ON public.daily_report_templates USING btree (facility_id, area_id);


--
-- Name: idx_departments_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_departments_facility_id ON public.departments USING btree (facility_id);


--
-- Name: idx_employee_certifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_certifications_type ON public.employee_certifications USING btree (certification_type_id);


--
-- Name: idx_employee_job_area_assignments_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_job_area_assignments_employee ON public.employee_job_area_assignments USING btree (employee_id);


--
-- Name: idx_employee_job_area_assignments_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_job_area_assignments_facility ON public.employee_job_area_assignments USING btree (facility_id);


--
-- Name: idx_employee_job_area_assignments_job_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_job_area_assignments_job_area ON public.employee_job_area_assignments USING btree (job_area_id);


--
-- Name: idx_employee_job_areas_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_job_areas_facility ON public.employee_job_areas USING btree (facility_id);


--
-- Name: idx_employee_job_areas_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_job_areas_facility_active_sort ON public.employee_job_areas USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_employee_wages_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_wages_facility ON public.employee_wages USING btree (facility_id);


--
-- Name: idx_employees_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_facility_id ON public.employees USING btree (facility_id);


--
-- Name: idx_employees_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_is_active ON public.employees USING btree (is_active);


--
-- Name: idx_employees_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_role_id ON public.employees USING btree (role_id);


--
-- Name: idx_employees_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_user_id ON public.employees USING btree (user_id);


--
-- Name: idx_facilities_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facilities_is_active ON public.facilities USING btree (is_active);


--
-- Name: idx_facility_air_quality_config_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facility_air_quality_config_facility ON public.facility_air_quality_config USING btree (facility_id);


--
-- Name: idx_facility_air_quality_config_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facility_air_quality_config_profile ON public.facility_air_quality_config USING btree (compliance_profile_id);


--
-- Name: idx_facility_documents_facility_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facility_documents_facility_active ON public.facility_documents USING btree (facility_id, is_active, category, sort_order);


--
-- Name: idx_facility_dropdown_options_facility_domain_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facility_dropdown_options_facility_domain_active_sort ON public.facility_dropdown_options USING btree (facility_id, domain, is_active, sort_order);


--
-- Name: idx_facility_spaces_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facility_spaces_facility ON public.facility_spaces USING btree (facility_id);


--
-- Name: idx_facility_spaces_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facility_spaces_facility_active_sort ON public.facility_spaces USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_ice_depth_change_log_changed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_change_log_changed_by ON public.ice_depth_change_log USING btree (changed_by);


--
-- Name: idx_ice_depth_change_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_change_log_created_at ON public.ice_depth_change_log USING btree (created_at DESC);


--
-- Name: idx_ice_depth_change_log_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_change_log_facility_id ON public.ice_depth_change_log USING btree (facility_id);


--
-- Name: idx_ice_depth_change_log_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_change_log_session_id ON public.ice_depth_change_log USING btree (session_id);


--
-- Name: idx_ice_depth_followup_notes_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_followup_notes_facility_id ON public.ice_depth_followup_notes USING btree (facility_id);


--
-- Name: idx_ice_depth_followup_notes_session_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_followup_notes_session_created ON public.ice_depth_followup_notes USING btree (session_id, created_at);


--
-- Name: idx_ice_depth_layouts_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_layouts_facility_active_sort ON public.ice_depth_layouts USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_ice_depth_layouts_one_default_per_rink; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ice_depth_layouts_one_default_per_rink ON public.ice_depth_layouts USING btree (rink_id) WHERE is_default;


--
-- Name: idx_ice_depth_layouts_rink; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_layouts_rink ON public.ice_depth_layouts USING btree (rink_id);


--
-- Name: idx_ice_depth_measurements_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_measurements_facility_id ON public.ice_depth_measurements USING btree (facility_id);


--
-- Name: idx_ice_depth_measurements_point; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_measurements_point ON public.ice_depth_measurements USING btree (point_id);


--
-- Name: idx_ice_depth_measurements_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_measurements_session ON public.ice_depth_measurements USING btree (session_id);


--
-- Name: idx_ice_depth_measurements_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_measurements_severity ON public.ice_depth_measurements USING btree (severity);


--
-- Name: idx_ice_depth_points_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_points_facility_id ON public.ice_depth_points USING btree (facility_id);


--
-- Name: idx_ice_depth_points_layout_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_points_layout_active ON public.ice_depth_points USING btree (layout_id, is_active);


--
-- Name: idx_ice_depth_points_layout_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_points_layout_sort ON public.ice_depth_points USING btree (layout_id, sort_order);


--
-- Name: idx_ice_depth_rinks_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_rinks_facility_active_sort ON public.ice_depth_rinks USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_ice_depth_rinks_one_default_per_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ice_depth_rinks_one_default_per_facility ON public.ice_depth_rinks USING btree (facility_id) WHERE is_default;


--
-- Name: idx_ice_depth_sessions_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_sessions_employee ON public.ice_depth_sessions USING btree (employee_id);


--
-- Name: idx_ice_depth_sessions_facility_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_sessions_facility_submitted ON public.ice_depth_sessions USING btree (facility_id, submitted_at DESC);


--
-- Name: idx_ice_depth_sessions_has_low; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_sessions_has_low ON public.ice_depth_sessions USING btree (facility_id, submitted_at DESC) WHERE (has_low_reading = true);


--
-- Name: idx_ice_depth_sessions_layout_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_depth_sessions_layout_submitted ON public.ice_depth_sessions USING btree (layout_id, submitted_at DESC);


--
-- Name: idx_ice_operations_circle_check_items_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_circle_check_items_facility_active_sort ON public.ice_operations_circle_check_items USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_ice_operations_circle_check_results_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_circle_check_results_facility_id ON public.ice_operations_circle_check_results USING btree (facility_id);


--
-- Name: idx_ice_operations_circle_check_results_failed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_circle_check_results_failed ON public.ice_operations_circle_check_results USING btree (submission_id) WHERE (passed = false);


--
-- Name: idx_ice_operations_circle_check_results_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_circle_check_results_submission ON public.ice_operations_circle_check_results USING btree (submission_id);


--
-- Name: idx_ice_operations_circle_check_template_items_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_circle_check_template_items_facility_id ON public.ice_operations_circle_check_template_items USING btree (facility_id);


--
-- Name: idx_ice_operations_circle_check_template_items_template_active_; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_circle_check_template_items_template_active_ ON public.ice_operations_circle_check_template_items USING btree (template_id, is_active, sort_order);


--
-- Name: idx_ice_operations_circle_check_templates_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_circle_check_templates_facility_active_sort ON public.ice_operations_circle_check_templates USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_ice_operations_equipment_facility_type_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_equipment_facility_type_active ON public.ice_operations_equipment USING btree (facility_id, equipment_type, is_active);


--
-- Name: idx_ice_operations_equipment_fuel_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_equipment_fuel_type ON public.ice_operations_equipment USING btree (fuel_type_id);


--
-- Name: idx_ice_operations_followup_notes_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_followup_notes_facility_id ON public.ice_operations_followup_notes USING btree (facility_id);


--
-- Name: idx_ice_operations_followup_notes_submission_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_followup_notes_submission_created ON public.ice_operations_followup_notes USING btree (submission_id, created_at);


--
-- Name: idx_ice_operations_fuel_types_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_fuel_types_facility_active_sort ON public.ice_operations_fuel_types USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_ice_operations_rinks_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_rinks_facility_active_sort ON public.ice_operations_rinks USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_ice_operations_submissions_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_submissions_employee ON public.ice_operations_submissions USING btree (employee_id);


--
-- Name: idx_ice_operations_submissions_equipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_submissions_equipment ON public.ice_operations_submissions USING btree (equipment_id);


--
-- Name: idx_ice_operations_submissions_facility_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_submissions_facility_submitted ON public.ice_operations_submissions USING btree (facility_id, submitted_at DESC);


--
-- Name: idx_ice_operations_submissions_failed_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_submissions_failed_check ON public.ice_operations_submissions USING btree (facility_id, submitted_at DESC) WHERE (has_failed_check = true);


--
-- Name: idx_ice_operations_submissions_operation_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_submissions_operation_type ON public.ice_operations_submissions USING btree (operation_type);


--
-- Name: idx_ice_operations_submissions_rink; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ice_operations_submissions_rink ON public.ice_operations_submissions USING btree (rink_id);


--
-- Name: idx_incident_activities_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_activities_facility ON public.incident_activities USING btree (facility_id);


--
-- Name: idx_incident_activities_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_activities_facility_active_sort ON public.incident_activities USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_incident_change_log_incident_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_change_log_incident_created ON public.incident_change_log USING btree (incident_id, created_at);


--
-- Name: idx_incident_followup_notes_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_followup_notes_facility ON public.incident_followup_notes USING btree (facility_id);


--
-- Name: idx_incident_followup_notes_incident_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_followup_notes_incident_created ON public.incident_followup_notes USING btree (incident_id, created_at);


--
-- Name: idx_incident_report_spaces_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_report_spaces_facility ON public.incident_report_spaces USING btree (facility_id);


--
-- Name: idx_incident_report_spaces_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_report_spaces_incident ON public.incident_report_spaces USING btree (incident_id);


--
-- Name: idx_incident_report_spaces_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_report_spaces_space ON public.incident_report_spaces USING btree (space_id);


--
-- Name: idx_incident_reports_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_activity ON public.incident_reports USING btree (activity_id);


--
-- Name: idx_incident_reports_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_employee ON public.incident_reports USING btree (employee_id);


--
-- Name: idx_incident_reports_facility_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_facility_status_created ON public.incident_reports USING btree (facility_id, status, created_at DESC);


--
-- Name: idx_incident_reports_facility_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_facility_submitted ON public.incident_reports USING btree (facility_id, submitted_at DESC);


--
-- Name: idx_incident_reports_incident_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_incident_type ON public.incident_reports USING btree (incident_type_id);


--
-- Name: idx_incident_reports_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_location ON public.incident_reports USING btree (location text_pattern_ops);


--
-- Name: idx_incident_reports_severity_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_severity_level ON public.incident_reports USING btree (severity_level_id);


--
-- Name: idx_incident_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_reports_status ON public.incident_reports USING btree (status);


--
-- Name: idx_incident_severity_levels_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_severity_levels_facility ON public.incident_severity_levels USING btree (facility_id);


--
-- Name: idx_incident_severity_levels_facility_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_severity_levels_facility_active ON public.incident_severity_levels USING btree (facility_id, is_active);


--
-- Name: idx_incident_types_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_types_facility ON public.incident_types USING btree (facility_id);


--
-- Name: idx_incident_types_facility_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_types_facility_active ON public.incident_types USING btree (facility_id, is_active);


--
-- Name: idx_incident_witnesses_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_witnesses_facility ON public.incident_witnesses USING btree (facility_id);


--
-- Name: idx_incident_witnesses_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incident_witnesses_incident ON public.incident_witnesses USING btree (incident_id);


--
-- Name: idx_job_area_cert_requirements_facility_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_area_cert_requirements_facility_area ON public.job_area_certification_requirements USING btree (facility_id, job_area_id);


--
-- Name: idx_job_area_cert_requirements_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_area_cert_requirements_type ON public.job_area_certification_requirements USING btree (certification_type_id);


--
-- Name: idx_module_area_permissions_area_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_module_area_permissions_area_id ON public.module_area_permissions USING btree (area_id);


--
-- Name: idx_module_area_permissions_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_module_area_permissions_employee_id ON public.module_area_permissions USING btree (employee_id);


--
-- Name: idx_module_area_permissions_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_module_area_permissions_facility_id ON public.module_area_permissions USING btree (facility_id);


--
-- Name: idx_module_area_permissions_module_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_module_area_permissions_module_key ON public.module_area_permissions USING btree (module_key);


--
-- Name: idx_notification_outbox_facility_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_facility_status_due ON public.notification_outbox USING btree (facility_id, status, scheduled_for);


--
-- Name: idx_notification_outbox_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_outbox_recipient ON public.notification_outbox USING btree (recipient_employee_id);


--
-- Name: idx_offline_sync_queue_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_sync_queue_employee_id ON public.offline_sync_queue USING btree (employee_id);


--
-- Name: idx_offline_sync_queue_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_sync_queue_facility_id ON public.offline_sync_queue USING btree (facility_id);


--
-- Name: idx_offline_sync_queue_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_sync_queue_started_at ON public.offline_sync_queue USING btree (started_at);


--
-- Name: idx_offline_sync_queue_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_sync_queue_sync_status ON public.offline_sync_queue USING btree (sync_status);


--
-- Name: idx_refrigeration_change_log_changed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_change_log_changed_by ON public.refrigeration_change_log USING btree (changed_by);


--
-- Name: idx_refrigeration_change_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_change_log_created_at ON public.refrigeration_change_log USING btree (created_at DESC);


--
-- Name: idx_refrigeration_change_log_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_change_log_facility_id ON public.refrigeration_change_log USING btree (facility_id);


--
-- Name: idx_refrigeration_change_log_report_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_change_log_report_id ON public.refrigeration_change_log USING btree (report_id);


--
-- Name: idx_refrigeration_equipment_facility_section_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_equipment_facility_section_active ON public.refrigeration_equipment USING btree (facility_id, section_id, is_active);


--
-- Name: idx_refrigeration_fields_equipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_fields_equipment ON public.refrigeration_fields USING btree (equipment_id);


--
-- Name: idx_refrigeration_fields_facility_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_fields_facility_section ON public.refrigeration_fields USING btree (facility_id, section_id);


--
-- Name: idx_refrigeration_followup_notes_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_followup_notes_facility_id ON public.refrigeration_followup_notes USING btree (facility_id);


--
-- Name: idx_refrigeration_followup_notes_report_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_followup_notes_report_created ON public.refrigeration_followup_notes USING btree (report_id, created_at);


--
-- Name: idx_refrigeration_followup_notes_report_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_followup_notes_report_value ON public.refrigeration_followup_notes USING btree (report_value_id);


--
-- Name: idx_refrigeration_report_values_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_report_values_facility_id ON public.refrigeration_report_values USING btree (facility_id);


--
-- Name: idx_refrigeration_report_values_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_report_values_field ON public.refrigeration_report_values USING btree (field_id);


--
-- Name: idx_refrigeration_report_values_field_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_report_values_field_created ON public.refrigeration_report_values USING btree (field_id, created_at);


--
-- Name: idx_refrigeration_report_values_oor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_report_values_oor ON public.refrigeration_report_values USING btree (report_id) WHERE (is_out_of_range = true);


--
-- Name: idx_refrigeration_report_values_report; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_report_values_report ON public.refrigeration_report_values USING btree (report_id);


--
-- Name: idx_refrigeration_reports_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_reports_employee ON public.refrigeration_reports USING btree (employee_id);


--
-- Name: idx_refrigeration_reports_facility_reading; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_reports_facility_reading ON public.refrigeration_reports USING btree (facility_id, reading_at DESC);


--
-- Name: idx_refrigeration_reports_facility_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_reports_facility_submitted ON public.refrigeration_reports USING btree (facility_id, submitted_at DESC);


--
-- Name: idx_refrigeration_sections_facility_active_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_sections_facility_active_sort ON public.refrigeration_sections USING btree (facility_id, is_active, sort_order);


--
-- Name: idx_refrigeration_thresholds_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refrigeration_thresholds_facility ON public.refrigeration_thresholds USING btree (facility_id);


--
-- Name: idx_retention_settings_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retention_settings_facility_id ON public.retention_settings USING btree (facility_id);


--
-- Name: idx_role_mp_defaults_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_mp_defaults_facility_id ON public.role_module_permission_defaults USING btree (facility_id);


--
-- Name: idx_role_mp_defaults_module_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_mp_defaults_module_key ON public.role_module_permission_defaults USING btree (module_key);


--
-- Name: idx_role_mp_defaults_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_mp_defaults_role_id ON public.role_module_permission_defaults USING btree (role_id);


--
-- Name: idx_roles_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_facility_id ON public.roles USING btree (facility_id);


--
-- Name: idx_roles_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_is_active ON public.roles USING btree (facility_id, is_active);


--
-- Name: idx_schedule_assignment_overrides_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_assignment_overrides_employee ON public.schedule_assignment_overrides USING btree (employee_id);


--
-- Name: idx_schedule_assignment_overrides_facility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_assignment_overrides_facility ON public.schedule_assignment_overrides USING btree (facility_id, created_at DESC);


--
-- Name: idx_schedule_availability_employee_dow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_availability_employee_dow ON public.schedule_availability USING btree (employee_id, day_of_week);


--
-- Name: idx_schedule_availability_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_availability_facility_id ON public.schedule_availability USING btree (facility_id);


--
-- Name: idx_schedule_availability_job_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_availability_job_area ON public.schedule_availability USING btree (job_area_id);


--
-- Name: idx_schedule_compliance_rules_facility_type_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_compliance_rules_facility_type_active ON public.schedule_compliance_rules USING btree (facility_id, rule_type, is_active);


--
-- Name: idx_schedule_notifications_employee_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_notifications_employee_unread ON public.schedule_notifications USING btree (employee_id, read_at NULLS FIRST, created_at DESC);


--
-- Name: idx_schedule_notifications_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_notifications_facility_id ON public.schedule_notifications USING btree (facility_id);


--
-- Name: idx_schedule_notifications_publish_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_notifications_publish_event ON public.schedule_notifications USING btree (publish_event_id) WHERE (publish_event_id IS NOT NULL);


--
-- Name: idx_schedule_open_shifts_claimed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_open_shifts_claimed_by ON public.schedule_open_shifts USING btree (claimed_by_employee_id);


--
-- Name: idx_schedule_open_shifts_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_open_shifts_facility_id ON public.schedule_open_shifts USING btree (facility_id);


--
-- Name: idx_schedule_open_shifts_status_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_open_shifts_status_expires ON public.schedule_open_shifts USING btree (claim_status, expires_at);


--
-- Name: idx_schedule_publish_events_facility_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_publish_events_facility_created ON public.schedule_publish_events USING btree (facility_id, created_at DESC);


--
-- Name: idx_schedule_publish_requests_facility_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_publish_requests_facility_status ON public.schedule_publish_requests USING btree (facility_id, status, created_at DESC);


--
-- Name: idx_schedule_publish_requests_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_publish_requests_requester ON public.schedule_publish_requests USING btree (requested_by_employee_id);


--
-- Name: idx_schedule_shifts_department_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_shifts_department_starts ON public.schedule_shifts USING btree (department_id, starts_at);


--
-- Name: idx_schedule_shifts_employee_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_shifts_employee_published ON public.schedule_shifts USING btree (employee_id, status) WHERE (status = 'published'::text);


--
-- Name: idx_schedule_shifts_employee_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_shifts_employee_starts ON public.schedule_shifts USING btree (employee_id, starts_at);


--
-- Name: idx_schedule_shifts_facility_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_shifts_facility_starts ON public.schedule_shifts USING btree (facility_id, starts_at);


--
-- Name: idx_schedule_shifts_facility_status_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_shifts_facility_status_start ON public.schedule_shifts USING btree (facility_id, status, starts_at);


--
-- Name: idx_schedule_shifts_job_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_shifts_job_area ON public.schedule_shifts USING btree (job_area_id);


--
-- Name: idx_schedule_shifts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_shifts_status ON public.schedule_shifts USING btree (status);


--
-- Name: idx_schedule_swap_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_swap_expires ON public.schedule_swap_requests USING btree (status, expires_at) WHERE (status = ANY (ARRAY['pending'::text, 'accepted'::text]));


--
-- Name: idx_schedule_swap_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_swap_requester ON public.schedule_swap_requests USING btree (requester_employee_id);


--
-- Name: idx_schedule_swap_requester_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_swap_requester_shift ON public.schedule_swap_requests USING btree (requester_shift_id);


--
-- Name: idx_schedule_swap_requests_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_swap_requests_facility_id ON public.schedule_swap_requests USING btree (facility_id);


--
-- Name: idx_schedule_swap_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_swap_status ON public.schedule_swap_requests USING btree (status);


--
-- Name: idx_schedule_swap_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_swap_target ON public.schedule_swap_requests USING btree (target_employee_id);


--
-- Name: idx_schedule_template_shifts_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_template_shifts_facility_id ON public.schedule_template_shifts USING btree (facility_id);


--
-- Name: idx_schedule_template_shifts_job_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_template_shifts_job_area ON public.schedule_template_shifts USING btree (job_area_id);


--
-- Name: idx_schedule_template_shifts_template_dow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_template_shifts_template_dow ON public.schedule_template_shifts USING btree (template_id, day_of_week);


--
-- Name: idx_schedule_time_off_employee_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_time_off_employee_starts ON public.schedule_time_off_requests USING btree (employee_id, starts_at);


--
-- Name: idx_schedule_time_off_facility_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_time_off_facility_status ON public.schedule_time_off_requests USING btree (facility_id, status);


--
-- Name: idx_schedule_time_off_status_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_time_off_status_starts ON public.schedule_time_off_requests USING btree (status, starts_at);


--
-- Name: idx_users_facility_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_facility_id ON public.users USING btree (facility_id);


--
-- Name: idx_users_is_super_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_is_super_admin ON public.users USING btree (is_super_admin) WHERE (is_super_admin = true);


--
-- Name: information_requests_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX information_requests_created_at_idx ON public.information_requests USING btree (created_at DESC);


--
-- Name: job_area_cert_requirements_ci_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX job_area_cert_requirements_ci_uniq ON public.job_area_certification_requirements USING btree (facility_id, job_area_id, lower(cert_name));


--
-- Name: profile_audit_log_facility_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_audit_log_facility_idx ON public.profile_audit_log USING btree (facility_id, created_at DESC);


--
-- Name: profile_audit_log_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_audit_log_target_idx ON public.profile_audit_log USING btree (target_user_id, created_at DESC);


--
-- Name: rate_limit_counters_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_limit_counters_window_start_idx ON public.rate_limit_counters USING btree (window_start);


--
-- Name: role_permission_defaults_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_permission_defaults_role_idx ON public.role_permission_defaults USING btree (facility_id, role_id);


--
-- Name: uniq_accident_workers_comp_settings_facility_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_accident_workers_comp_settings_facility_active ON public.accident_workers_comp_settings USING btree (facility_id) WHERE (is_active = true);


--
-- Name: uniq_communication_ack_alert_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_communication_ack_alert_employee ON public.communication_acknowledgements USING btree (alert_id, employee_id) WHERE (alert_id IS NOT NULL);


--
-- Name: uniq_communication_ack_message_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_communication_ack_message_employee ON public.communication_acknowledgements USING btree (message_id, employee_id) WHERE (message_id IS NOT NULL);


--
-- Name: uniq_daily_report_submission_items_sub_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_daily_report_submission_items_sub_item ON public.daily_report_submission_items USING btree (submission_id, checklist_item_id) WHERE (checklist_item_id IS NOT NULL);


--
-- Name: uniq_ice_operations_circle_check_results_submission_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_ice_operations_circle_check_results_submission_item ON public.ice_operations_circle_check_results USING btree (submission_id, checklist_item_id) WHERE (checklist_item_id IS NOT NULL);


--
-- Name: uniq_refrigeration_fields_section_equipment_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_refrigeration_fields_section_equipment_key ON public.refrigeration_fields USING btree (section_id, equipment_id, key) WHERE (equipment_id IS NOT NULL);


--
-- Name: uniq_refrigeration_fields_section_key_no_equipment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_refrigeration_fields_section_key_no_equipment ON public.refrigeration_fields USING btree (section_id, key) WHERE (equipment_id IS NULL);


--
-- Name: uniq_refrigeration_thresholds_field_active_no_equipment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_refrigeration_thresholds_field_active_no_equipment ON public.refrigeration_thresholds USING btree (field_id) WHERE ((equipment_id IS NULL) AND (is_active = true));


--
-- Name: uniq_refrigeration_thresholds_field_equipment_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_refrigeration_thresholds_field_equipment_active ON public.refrigeration_thresholds USING btree (field_id, equipment_id) WHERE ((equipment_id IS NOT NULL) AND (is_active = true));


--
-- Name: user_permissions_facility_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_permissions_facility_module_idx ON public.user_permissions USING btree (facility_id, module_name);


--
-- Name: user_permissions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_permissions_lookup_idx ON public.user_permissions USING btree (user_id, facility_id, module_name) WHERE (enabled = true);


--
-- Name: facilities facilities_seed_air_quality_config; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facilities_seed_air_quality_config AFTER INSERT ON public.facilities FOR EACH ROW EXECUTE FUNCTION public.tg_seed_facility_air_quality_config();


--
-- Name: facilities facilities_seed_modules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facilities_seed_modules AFTER INSERT ON public.facilities FOR EACH ROW EXECUTE FUNCTION public.tg_seed_facility_modules();


--
-- Name: facility_modules facility_modules_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_modules_set_updated_at BEFORE UPDATE ON public.facility_modules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: roles seed_role_permission_defaults_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER seed_role_permission_defaults_after_insert AFTER INSERT ON public.roles FOR EACH ROW EXECUTE FUNCTION public.trg_seed_role_permission_defaults();


--
-- Name: accident_body_part_selections trg_accident_body_part_selections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accident_body_part_selections_updated_at BEFORE UPDATE ON public.accident_body_part_selections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accident_dropdowns trg_accident_dropdowns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accident_dropdowns_updated_at BEFORE UPDATE ON public.accident_dropdowns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accident_reports trg_accident_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accident_reports_updated_at BEFORE UPDATE ON public.accident_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accident_witnesses trg_accident_witnesses_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accident_witnesses_cap BEFORE INSERT ON public.accident_witnesses FOR EACH ROW EXECUTE FUNCTION public.enforce_accident_witnesses_cap();


--
-- Name: accident_witnesses trg_accident_witnesses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accident_witnesses_updated_at BEFORE UPDATE ON public.accident_witnesses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accident_workers_comp_settings trg_accident_workers_comp_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accident_workers_comp_settings_updated_at BEFORE UPDATE ON public.accident_workers_comp_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: air_quality_compliance_profiles trg_air_quality_compliance_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_air_quality_compliance_profiles_updated_at BEFORE UPDATE ON public.air_quality_compliance_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: air_quality_compliance_rules trg_air_quality_compliance_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_air_quality_compliance_rules_updated_at BEFORE UPDATE ON public.air_quality_compliance_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: air_quality_equipment trg_air_quality_equipment_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_air_quality_equipment_updated_at BEFORE UPDATE ON public.air_quality_equipment FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: air_quality_reading_types trg_air_quality_reading_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_air_quality_reading_types_updated_at BEFORE UPDATE ON public.air_quality_reading_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: air_quality_reports trg_air_quality_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_air_quality_reports_updated_at BEFORE UPDATE ON public.air_quality_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: air_quality_settings trg_air_quality_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_air_quality_settings_updated_at BEFORE UPDATE ON public.air_quality_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accident_reports trg_audit_accident_reports; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_accident_reports AFTER INSERT OR DELETE OR UPDATE ON public.accident_reports FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: air_quality_reports trg_audit_air_quality_reports; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_air_quality_reports AFTER INSERT OR DELETE OR UPDATE ON public.air_quality_reports FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: communication_group_members trg_audit_communication_group_members; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_communication_group_members AFTER INSERT OR DELETE OR UPDATE ON public.communication_group_members FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: communication_groups trg_audit_communication_groups; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_communication_groups AFTER INSERT OR DELETE OR UPDATE ON public.communication_groups FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: communication_recurring_reminders trg_audit_communication_recurring_reminders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_communication_recurring_reminders AFTER INSERT OR DELETE OR UPDATE ON public.communication_recurring_reminders FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: communication_routing_rules trg_audit_communication_routing_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_communication_routing_rules AFTER INSERT OR DELETE OR UPDATE ON public.communication_routing_rules FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: communication_templates trg_audit_communication_templates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_communication_templates AFTER INSERT OR DELETE OR UPDATE ON public.communication_templates FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: daily_report_submissions trg_audit_daily_report_submissions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_daily_report_submissions AFTER INSERT OR DELETE OR UPDATE ON public.daily_report_submissions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: departments trg_audit_departments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_departments AFTER INSERT OR DELETE OR UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: employees trg_audit_employees; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_employees AFTER INSERT OR DELETE OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: facilities trg_audit_facilities; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_facilities AFTER INSERT OR DELETE OR UPDATE ON public.facilities FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('id');


--
-- Name: ice_depth_sessions trg_audit_ice_depth_sessions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_ice_depth_sessions AFTER INSERT OR DELETE OR UPDATE ON public.ice_depth_sessions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: incident_reports trg_audit_incident_reports; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_incident_reports AFTER INSERT OR DELETE OR UPDATE ON public.incident_reports FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: notification_outbox trg_audit_notification_outbox; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_notification_outbox AFTER INSERT OR DELETE OR UPDATE ON public.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: refrigeration_reports trg_audit_refrigeration_reports; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_refrigeration_reports AFTER INSERT OR DELETE OR UPDATE ON public.refrigeration_reports FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: role_module_permission_defaults trg_audit_role_module_permission_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_role_module_permission_defaults AFTER INSERT OR DELETE OR UPDATE ON public.role_module_permission_defaults FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: role_permission_defaults trg_audit_role_permission_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_role_permission_defaults AFTER INSERT OR DELETE OR UPDATE ON public.role_permission_defaults FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: roles trg_audit_roles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_roles AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: schedule_publish_events trg_audit_schedule_publish_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_schedule_publish_events AFTER INSERT ON public.schedule_publish_events FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: schedule_publish_requests trg_audit_schedule_publish_requests; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_schedule_publish_requests AFTER INSERT OR DELETE OR UPDATE ON public.schedule_publish_requests FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: user_permissions trg_audit_user_permissions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_user_permissions AFTER INSERT OR DELETE OR UPDATE ON public.user_permissions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: users trg_audit_users; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_users AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


--
-- Name: certification_types trg_certification_types_sync_names; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_certification_types_sync_names AFTER UPDATE OF name ON public.certification_types FOR EACH ROW EXECUTE FUNCTION public.certification_types_sync_names();


--
-- Name: certification_types trg_certification_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_certification_types_updated_at BEFORE UPDATE ON public.certification_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: daily_report_areas trg_cleanup_daily_report_area_permissions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cleanup_daily_report_area_permissions AFTER DELETE ON public.daily_report_areas FOR EACH ROW EXECUTE FUNCTION public.cleanup_daily_report_area_permissions();


--
-- Name: communication_alerts trg_communication_alerts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_communication_alerts_updated_at BEFORE UPDATE ON public.communication_alerts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: communication_groups trg_communication_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_communication_groups_updated_at BEFORE UPDATE ON public.communication_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: communication_messages trg_communication_messages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_communication_messages_updated_at BEFORE UPDATE ON public.communication_messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: communication_recurring_reminders trg_communication_recurring_reminders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_communication_recurring_reminders_updated_at BEFORE UPDATE ON public.communication_recurring_reminders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: communication_routing_rules trg_communication_routing_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_communication_routing_rules_updated_at BEFORE UPDATE ON public.communication_routing_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: communication_templates trg_communication_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_communication_templates_updated_at BEFORE UPDATE ON public.communication_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: daily_report_areas trg_daily_report_areas_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_daily_report_areas_cap BEFORE INSERT OR UPDATE ON public.daily_report_areas FOR EACH ROW EXECUTE FUNCTION public.enforce_daily_report_areas_cap();


--
-- Name: daily_report_areas trg_daily_report_areas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_daily_report_areas_updated_at BEFORE UPDATE ON public.daily_report_areas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: daily_report_checklist_items trg_daily_report_checklist_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_daily_report_checklist_items_updated_at BEFORE UPDATE ON public.daily_report_checklist_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: daily_report_notes trg_daily_report_notes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_daily_report_notes_updated_at BEFORE UPDATE ON public.daily_report_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: daily_report_submissions trg_daily_report_submissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_daily_report_submissions_updated_at BEFORE UPDATE ON public.daily_report_submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: daily_report_templates trg_daily_report_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_daily_report_templates_updated_at BEFORE UPDATE ON public.daily_report_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: departments trg_departments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employee_certifications trg_employee_certifications_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employee_certifications_touch BEFORE UPDATE ON public.employee_certifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employee_invites trg_employee_invites_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employee_invites_touch BEFORE UPDATE ON public.employee_invites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employee_job_area_assignments trg_employee_job_area_assignments_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_employee_job_area_assignments_cap AFTER INSERT OR UPDATE ON public.employee_job_area_assignments NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.enforce_employee_job_area_cap();


--
-- Name: employee_job_area_assignments trg_employee_job_area_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employee_job_area_assignments_updated_at BEFORE UPDATE ON public.employee_job_area_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employee_job_areas trg_employee_job_areas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employee_job_areas_updated_at BEFORE UPDATE ON public.employee_job_areas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employee_wages trg_employee_wages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employee_wages_updated_at BEFORE UPDATE ON public.employee_wages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employees trg_employees_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: export_settings trg_export_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_export_settings_updated_at BEFORE UPDATE ON public.export_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facilities trg_facilities_seed_dropdown_options; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_facilities_seed_dropdown_options AFTER INSERT ON public.facilities FOR EACH ROW EXECUTE FUNCTION public.trg_seed_facility_dropdown_options();


--
-- Name: facilities trg_facilities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_facilities_updated_at BEFORE UPDATE ON public.facilities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_air_quality_config trg_facility_air_quality_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_facility_air_quality_config_updated_at BEFORE UPDATE ON public.facility_air_quality_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_documents trg_facility_documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_facility_documents_updated_at BEFORE UPDATE ON public.facility_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_dropdown_options trg_facility_dropdown_options_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_facility_dropdown_options_updated_at BEFORE UPDATE ON public.facility_dropdown_options FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_spaces trg_facility_spaces_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_facility_spaces_updated_at BEFORE UPDATE ON public.facility_spaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: communication_group_members trg_group_member_facility_match; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_group_member_facility_match BEFORE INSERT OR UPDATE ON public.communication_group_members FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_facility_match();


--
-- Name: ice_depth_layouts trg_ice_depth_layouts_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_depth_layouts_cap BEFORE INSERT OR UPDATE OF is_active, facility_id ON public.ice_depth_layouts FOR EACH ROW EXECUTE FUNCTION public.enforce_ice_depth_layouts_cap();


--
-- Name: ice_depth_layouts trg_ice_depth_layouts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_depth_layouts_updated_at BEFORE UPDATE ON public.ice_depth_layouts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_depth_points trg_ice_depth_points_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_depth_points_cap BEFORE INSERT OR UPDATE OF is_active, layout_id ON public.ice_depth_points FOR EACH ROW EXECUTE FUNCTION public.enforce_ice_depth_points_cap();


--
-- Name: ice_depth_points trg_ice_depth_points_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_depth_points_updated_at BEFORE UPDATE ON public.ice_depth_points FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_depth_rinks trg_ice_depth_rinks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_depth_rinks_updated_at BEFORE UPDATE ON public.ice_depth_rinks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_depth_sessions trg_ice_depth_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_depth_sessions_updated_at BEFORE UPDATE ON public.ice_depth_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_depth_settings trg_ice_depth_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_depth_settings_updated_at BEFORE UPDATE ON public.ice_depth_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_operations_circle_check_items trg_ice_operations_circle_check_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_operations_circle_check_items_updated_at BEFORE UPDATE ON public.ice_operations_circle_check_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_operations_circle_check_template_items trg_ice_operations_circle_check_template_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_operations_circle_check_template_items_updated_at BEFORE UPDATE ON public.ice_operations_circle_check_template_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_operations_circle_check_templates trg_ice_operations_circle_check_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_operations_circle_check_templates_updated_at BEFORE UPDATE ON public.ice_operations_circle_check_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_operations_equipment trg_ice_operations_equipment_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_operations_equipment_updated_at BEFORE UPDATE ON public.ice_operations_equipment FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_operations_fuel_types trg_ice_operations_fuel_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_operations_fuel_types_updated_at BEFORE UPDATE ON public.ice_operations_fuel_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_operations_rinks trg_ice_operations_rinks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_operations_rinks_updated_at BEFORE UPDATE ON public.ice_operations_rinks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_operations_settings trg_ice_operations_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_operations_settings_updated_at BEFORE UPDATE ON public.ice_operations_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ice_operations_submissions trg_ice_operations_submissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ice_operations_submissions_updated_at BEFORE UPDATE ON public.ice_operations_submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: incident_activities trg_incident_activities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incident_activities_updated_at BEFORE UPDATE ON public.incident_activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: incident_reports trg_incident_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incident_reports_updated_at BEFORE UPDATE ON public.incident_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: incident_severity_levels trg_incident_severity_levels_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incident_severity_levels_updated_at BEFORE UPDATE ON public.incident_severity_levels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: incident_types trg_incident_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incident_types_updated_at BEFORE UPDATE ON public.incident_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: incident_witnesses trg_incident_witnesses_cap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incident_witnesses_cap BEFORE INSERT ON public.incident_witnesses FOR EACH ROW EXECUTE FUNCTION public.enforce_incident_witnesses_cap();


--
-- Name: incident_witnesses trg_incident_witnesses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_incident_witnesses_updated_at BEFORE UPDATE ON public.incident_witnesses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: job_area_certification_requirements trg_job_area_cert_requirements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_job_area_cert_requirements_updated_at BEFORE UPDATE ON public.job_area_certification_requirements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notification_outbox trg_notification_outbox_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notification_outbox_updated_at BEFORE UPDATE ON public.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: information_requests trg_rate_limit_information_requests; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rate_limit_information_requests BEFORE INSERT ON public.information_requests FOR EACH ROW EXECUTE FUNCTION public.rate_limit_information_requests();


--
-- Name: communication_recipients trg_recipient_delivery_column_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recipient_delivery_column_guard BEFORE UPDATE ON public.communication_recipients FOR EACH ROW EXECUTE FUNCTION public.enforce_recipient_delivery_column_guard();


--
-- Name: refrigeration_equipment trg_refrigeration_equipment_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refrigeration_equipment_updated_at BEFORE UPDATE ON public.refrigeration_equipment FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: refrigeration_fields trg_refrigeration_fields_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refrigeration_fields_updated_at BEFORE UPDATE ON public.refrigeration_fields FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: refrigeration_reports trg_refrigeration_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refrigeration_reports_updated_at BEFORE UPDATE ON public.refrigeration_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: refrigeration_sections trg_refrigeration_sections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refrigeration_sections_updated_at BEFORE UPDATE ON public.refrigeration_sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: refrigeration_settings trg_refrigeration_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refrigeration_settings_updated_at BEFORE UPDATE ON public.refrigeration_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: refrigeration_thresholds trg_refrigeration_thresholds_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_refrigeration_thresholds_updated_at BEFORE UPDATE ON public.refrigeration_thresholds FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: retention_settings trg_retention_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_retention_settings_updated_at BEFORE UPDATE ON public.retention_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: role_module_permission_defaults trg_role_mp_defaults_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_role_mp_defaults_updated_at BEFORE UPDATE ON public.role_module_permission_defaults FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: roles trg_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_availability trg_schedule_availability_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_availability_updated_at BEFORE UPDATE ON public.schedule_availability FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_compliance_rules trg_schedule_compliance_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_compliance_rules_updated_at BEFORE UPDATE ON public.schedule_compliance_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_ics_tokens trg_schedule_ics_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_ics_tokens_updated_at BEFORE UPDATE ON public.schedule_ics_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_notifications trg_schedule_notifications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_notifications_updated_at BEFORE UPDATE ON public.schedule_notifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_open_shifts trg_schedule_open_shifts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_open_shifts_updated_at BEFORE UPDATE ON public.schedule_open_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_publish_requests trg_schedule_publish_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_publish_requests_updated_at BEFORE UPDATE ON public.schedule_publish_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_settings trg_schedule_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_settings_updated_at BEFORE UPDATE ON public.schedule_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_shifts trg_schedule_shifts_publish_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_shifts_publish_lock BEFORE INSERT OR DELETE OR UPDATE ON public.schedule_shifts FOR EACH ROW EXECUTE FUNCTION public.schedule_shifts_publish_lock();


--
-- Name: schedule_shifts trg_schedule_shifts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_shifts_updated_at BEFORE UPDATE ON public.schedule_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_swap_requests trg_schedule_swap_set_expiry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_swap_set_expiry BEFORE INSERT ON public.schedule_swap_requests FOR EACH ROW EXECUTE FUNCTION public.schedule_swap_set_expiry();


--
-- Name: schedule_swap_requests trg_schedule_swap_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_swap_updated_at BEFORE UPDATE ON public.schedule_swap_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_template_shifts trg_schedule_template_shifts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_template_shifts_updated_at BEFORE UPDATE ON public.schedule_template_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_templates trg_schedule_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_templates_updated_at BEFORE UPDATE ON public.schedule_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schedule_time_off_requests trg_schedule_time_off_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_time_off_updated_at BEFORE UPDATE ON public.schedule_time_off_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: role_permission_defaults trg_touch_role_permission_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_role_permission_defaults BEFORE UPDATE ON public.role_permission_defaults FOR EACH ROW EXECUTE FUNCTION public.touch_role_permission_defaults();


--
-- Name: user_permissions trg_user_permissions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_permissions_set_updated_at BEFORE UPDATE ON public.user_permissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: module_area_permissions trg_validate_module_area_permission; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_module_area_permission BEFORE INSERT OR UPDATE OF area_id, module_key, facility_id ON public.module_area_permissions FOR EACH ROW EXECUTE FUNCTION public.validate_module_area_permission();


--
-- Name: users users_profile_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_profile_update_guard BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_users_profile_update();


--
-- Name: accident_body_part_selections accident_body_part_selections_accident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_body_part_selections
    ADD CONSTRAINT accident_body_part_selections_accident_id_fkey FOREIGN KEY (accident_id) REFERENCES public.accident_reports(id) ON DELETE CASCADE;


--
-- Name: accident_body_part_selections accident_body_part_selections_body_part_dropdown_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_body_part_selections
    ADD CONSTRAINT accident_body_part_selections_body_part_dropdown_id_fkey FOREIGN KEY (body_part_dropdown_id) REFERENCES public.accident_dropdowns(id) ON DELETE RESTRICT;


--
-- Name: accident_body_part_selections accident_body_part_selections_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_body_part_selections
    ADD CONSTRAINT accident_body_part_selections_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: accident_change_log accident_change_log_accident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_change_log
    ADD CONSTRAINT accident_change_log_accident_id_fkey FOREIGN KEY (accident_id) REFERENCES public.accident_reports(id) ON DELETE CASCADE;


--
-- Name: accident_change_log accident_change_log_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_change_log
    ADD CONSTRAINT accident_change_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: accident_change_log accident_change_log_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_change_log
    ADD CONSTRAINT accident_change_log_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: accident_dropdowns accident_dropdowns_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_dropdowns
    ADD CONSTRAINT accident_dropdowns_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: accident_followup_notes accident_followup_notes_accident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_followup_notes
    ADD CONSTRAINT accident_followup_notes_accident_id_fkey FOREIGN KEY (accident_id) REFERENCES public.accident_reports(id) ON DELETE CASCADE;


--
-- Name: accident_followup_notes accident_followup_notes_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_followup_notes
    ADD CONSTRAINT accident_followup_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: accident_followup_notes accident_followup_notes_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_followup_notes
    ADD CONSTRAINT accident_followup_notes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: accident_reports accident_reports_activity_dropdown_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_reports
    ADD CONSTRAINT accident_reports_activity_dropdown_id_fkey FOREIGN KEY (activity_dropdown_id) REFERENCES public.accident_dropdowns(id) ON DELETE SET NULL;


--
-- Name: accident_reports accident_reports_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_reports
    ADD CONSTRAINT accident_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: accident_reports accident_reports_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_reports
    ADD CONSTRAINT accident_reports_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: accident_reports accident_reports_location_dropdown_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_reports
    ADD CONSTRAINT accident_reports_location_dropdown_id_fkey FOREIGN KEY (location_dropdown_id) REFERENCES public.facility_spaces(id) ON DELETE SET NULL;


--
-- Name: accident_reports accident_reports_medical_attention_dropdown_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_reports
    ADD CONSTRAINT accident_reports_medical_attention_dropdown_id_fkey FOREIGN KEY (medical_attention_dropdown_id) REFERENCES public.accident_dropdowns(id) ON DELETE SET NULL;


--
-- Name: accident_reports accident_reports_primary_injury_type_dropdown_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_reports
    ADD CONSTRAINT accident_reports_primary_injury_type_dropdown_id_fkey FOREIGN KEY (primary_injury_type_dropdown_id) REFERENCES public.accident_dropdowns(id) ON DELETE SET NULL;


--
-- Name: accident_reports accident_reports_severity_dropdown_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_reports
    ADD CONSTRAINT accident_reports_severity_dropdown_id_fkey FOREIGN KEY (severity_dropdown_id) REFERENCES public.accident_dropdowns(id) ON DELETE SET NULL;


--
-- Name: accident_witnesses accident_witnesses_accident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_witnesses
    ADD CONSTRAINT accident_witnesses_accident_id_fkey FOREIGN KEY (accident_id) REFERENCES public.accident_reports(id) ON DELETE CASCADE;


--
-- Name: accident_witnesses accident_witnesses_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_witnesses
    ADD CONSTRAINT accident_witnesses_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: accident_workers_comp_settings accident_workers_comp_settings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accident_workers_comp_settings
    ADD CONSTRAINT accident_workers_comp_settings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: air_quality_change_log air_quality_change_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_change_log
    ADD CONSTRAINT air_quality_change_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: air_quality_change_log air_quality_change_log_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_change_log
    ADD CONSTRAINT air_quality_change_log_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: air_quality_change_log air_quality_change_log_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_change_log
    ADD CONSTRAINT air_quality_change_log_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.air_quality_reports(id) ON DELETE CASCADE;


--
-- Name: air_quality_compliance_rules air_quality_compliance_rules_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_compliance_rules
    ADD CONSTRAINT air_quality_compliance_rules_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: air_quality_equipment air_quality_equipment_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_equipment
    ADD CONSTRAINT air_quality_equipment_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: air_quality_equipment air_quality_equipment_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_equipment
    ADD CONSTRAINT air_quality_equipment_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.facility_spaces(id) ON DELETE CASCADE;


--
-- Name: air_quality_followup_notes air_quality_followup_notes_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_followup_notes
    ADD CONSTRAINT air_quality_followup_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: air_quality_followup_notes air_quality_followup_notes_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_followup_notes
    ADD CONSTRAINT air_quality_followup_notes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: air_quality_followup_notes air_quality_followup_notes_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_followup_notes
    ADD CONSTRAINT air_quality_followup_notes_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.air_quality_reports(id) ON DELETE CASCADE;


--
-- Name: air_quality_reading_types air_quality_reading_types_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_reading_types
    ADD CONSTRAINT air_quality_reading_types_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: air_quality_readings air_quality_readings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_readings
    ADD CONSTRAINT air_quality_readings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: air_quality_readings air_quality_readings_reading_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_readings
    ADD CONSTRAINT air_quality_readings_reading_type_id_fkey FOREIGN KEY (reading_type_id) REFERENCES public.air_quality_reading_types(id) ON DELETE SET NULL;


--
-- Name: air_quality_readings air_quality_readings_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_readings
    ADD CONSTRAINT air_quality_readings_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.air_quality_reports(id) ON DELETE CASCADE;


--
-- Name: air_quality_reports air_quality_reports_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_reports
    ADD CONSTRAINT air_quality_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: air_quality_reports air_quality_reports_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_reports
    ADD CONSTRAINT air_quality_reports_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.air_quality_equipment(id) ON DELETE SET NULL;


--
-- Name: air_quality_reports air_quality_reports_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_reports
    ADD CONSTRAINT air_quality_reports_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: air_quality_reports air_quality_reports_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_reports
    ADD CONSTRAINT air_quality_reports_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.facility_spaces(id) ON DELETE RESTRICT;


--
-- Name: air_quality_settings air_quality_settings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.air_quality_settings
    ADD CONSTRAINT air_quality_settings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: audit_logs audit_logs_actor_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_employee_id_fkey FOREIGN KEY (actor_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: certification_types certification_types_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification_types
    ADD CONSTRAINT certification_types_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: communication_acknowledgements communication_acknowledgements_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_acknowledgements
    ADD CONSTRAINT communication_acknowledgements_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.communication_alerts(id) ON DELETE CASCADE;


--
-- Name: communication_acknowledgements communication_acknowledgements_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_acknowledgements
    ADD CONSTRAINT communication_acknowledgements_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: communication_acknowledgements communication_acknowledgements_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_acknowledgements
    ADD CONSTRAINT communication_acknowledgements_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_acknowledgements communication_acknowledgements_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_acknowledgements
    ADD CONSTRAINT communication_acknowledgements_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.communication_messages(id) ON DELETE CASCADE;


--
-- Name: communication_alerts communication_alerts_created_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_alerts
    ADD CONSTRAINT communication_alerts_created_by_employee_id_fkey FOREIGN KEY (created_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: communication_alerts communication_alerts_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_alerts
    ADD CONSTRAINT communication_alerts_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_alerts communication_alerts_resolved_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_alerts
    ADD CONSTRAINT communication_alerts_resolved_by_employee_id_fkey FOREIGN KEY (resolved_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: communication_audit_log communication_audit_log_actor_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_audit_log
    ADD CONSTRAINT communication_audit_log_actor_employee_id_fkey FOREIGN KEY (actor_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: communication_audit_log communication_audit_log_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_audit_log
    ADD CONSTRAINT communication_audit_log_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_group_members communication_group_members_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_group_members
    ADD CONSTRAINT communication_group_members_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: communication_group_members communication_group_members_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_group_members
    ADD CONSTRAINT communication_group_members_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_group_members communication_group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_group_members
    ADD CONSTRAINT communication_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.communication_groups(id) ON DELETE CASCADE;


--
-- Name: communication_groups communication_groups_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_groups
    ADD CONSTRAINT communication_groups_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_messages communication_messages_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_messages
    ADD CONSTRAINT communication_messages_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_messages communication_messages_parent_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_messages
    ADD CONSTRAINT communication_messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES public.communication_messages(id) ON DELETE SET NULL;


--
-- Name: communication_messages communication_messages_sender_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_messages
    ADD CONSTRAINT communication_messages_sender_employee_id_fkey FOREIGN KEY (sender_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: communication_messages communication_messages_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_messages
    ADD CONSTRAINT communication_messages_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.communication_templates(id) ON DELETE SET NULL;


--
-- Name: communication_recipients communication_recipients_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recipients
    ADD CONSTRAINT communication_recipients_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: communication_recipients communication_recipients_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recipients
    ADD CONSTRAINT communication_recipients_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_recipients communication_recipients_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recipients
    ADD CONSTRAINT communication_recipients_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.communication_messages(id) ON DELETE CASCADE;


--
-- Name: communication_recurring_reminders communication_recurring_reminders_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recurring_reminders
    ADD CONSTRAINT communication_recurring_reminders_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_recurring_reminders communication_recurring_reminders_target_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recurring_reminders
    ADD CONSTRAINT communication_recurring_reminders_target_group_id_fkey FOREIGN KEY (target_group_id) REFERENCES public.communication_groups(id) ON DELETE CASCADE;


--
-- Name: communication_recurring_reminders communication_recurring_reminders_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_recurring_reminders
    ADD CONSTRAINT communication_recurring_reminders_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.communication_templates(id) ON DELETE RESTRICT;


--
-- Name: communication_routing_rules communication_routing_rules_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_routing_rules
    ADD CONSTRAINT communication_routing_rules_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: communication_routing_rules communication_routing_rules_target_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_routing_rules
    ADD CONSTRAINT communication_routing_rules_target_department_id_fkey FOREIGN KEY (target_department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: communication_routing_rules communication_routing_rules_target_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_routing_rules
    ADD CONSTRAINT communication_routing_rules_target_employee_id_fkey FOREIGN KEY (target_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: communication_routing_rules communication_routing_rules_target_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_routing_rules
    ADD CONSTRAINT communication_routing_rules_target_group_id_fkey FOREIGN KEY (target_group_id) REFERENCES public.communication_groups(id) ON DELETE CASCADE;


--
-- Name: communication_templates communication_templates_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_templates
    ADD CONSTRAINT communication_templates_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: daily_report_areas daily_report_areas_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_areas
    ADD CONSTRAINT daily_report_areas_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: daily_report_checklist_items daily_report_checklist_items_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_checklist_items
    ADD CONSTRAINT daily_report_checklist_items_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: daily_report_checklist_items daily_report_checklist_items_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_checklist_items
    ADD CONSTRAINT daily_report_checklist_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.daily_report_templates(id) ON DELETE CASCADE;


--
-- Name: daily_report_notes daily_report_notes_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_notes
    ADD CONSTRAINT daily_report_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: daily_report_notes daily_report_notes_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_notes
    ADD CONSTRAINT daily_report_notes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: daily_report_notes daily_report_notes_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_notes
    ADD CONSTRAINT daily_report_notes_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.daily_report_submissions(id) ON DELETE CASCADE;


--
-- Name: daily_report_submission_items daily_report_submission_items_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submission_items
    ADD CONSTRAINT daily_report_submission_items_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.daily_report_checklist_items(id) ON DELETE SET NULL;


--
-- Name: daily_report_submission_items daily_report_submission_items_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submission_items
    ADD CONSTRAINT daily_report_submission_items_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: daily_report_submission_items daily_report_submission_items_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submission_items
    ADD CONSTRAINT daily_report_submission_items_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.daily_report_submissions(id) ON DELETE CASCADE;


--
-- Name: daily_report_submissions daily_report_submissions_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submissions
    ADD CONSTRAINT daily_report_submissions_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.daily_report_areas(id) ON DELETE RESTRICT;


--
-- Name: daily_report_submissions daily_report_submissions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submissions
    ADD CONSTRAINT daily_report_submissions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: daily_report_submissions daily_report_submissions_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submissions
    ADD CONSTRAINT daily_report_submissions_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: daily_report_submissions daily_report_submissions_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_submissions
    ADD CONSTRAINT daily_report_submissions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.daily_report_templates(id) ON DELETE RESTRICT;


--
-- Name: daily_report_templates daily_report_templates_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_templates
    ADD CONSTRAINT daily_report_templates_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.daily_report_areas(id) ON DELETE CASCADE;


--
-- Name: daily_report_templates daily_report_templates_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_report_templates
    ADD CONSTRAINT daily_report_templates_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: departments departments_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: employee_certifications employee_certifications_certification_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_certifications
    ADD CONSTRAINT employee_certifications_certification_type_id_fkey FOREIGN KEY (certification_type_id) REFERENCES public.certification_types(id) ON DELETE SET NULL;


--
-- Name: employee_certifications employee_certifications_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_certifications
    ADD CONSTRAINT employee_certifications_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_certifications employee_certifications_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_certifications
    ADD CONSTRAINT employee_certifications_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: employee_invites employee_invites_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_invites
    ADD CONSTRAINT employee_invites_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_invites employee_invites_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_invites
    ADD CONSTRAINT employee_invites_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: employee_invites employee_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_invites
    ADD CONSTRAINT employee_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: employee_job_area_assignments employee_job_area_assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_job_area_assignments
    ADD CONSTRAINT employee_job_area_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_job_area_assignments employee_job_area_assignments_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_job_area_assignments
    ADD CONSTRAINT employee_job_area_assignments_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: employee_job_area_assignments employee_job_area_assignments_job_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_job_area_assignments
    ADD CONSTRAINT employee_job_area_assignments_job_area_id_fkey FOREIGN KEY (job_area_id) REFERENCES public.employee_job_areas(id) ON DELETE RESTRICT;


--
-- Name: employee_job_areas employee_job_areas_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_job_areas
    ADD CONSTRAINT employee_job_areas_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: employee_wages employee_wages_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_wages
    ADD CONSTRAINT employee_wages_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_wages employee_wages_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_wages
    ADD CONSTRAINT employee_wages_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: employees employees_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: employees employees_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: employees employees_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT;


--
-- Name: employees employees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: export_settings export_settings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_settings
    ADD CONSTRAINT export_settings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: facility_air_quality_config facility_air_quality_config_compliance_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_air_quality_config
    ADD CONSTRAINT facility_air_quality_config_compliance_profile_id_fkey FOREIGN KEY (compliance_profile_id) REFERENCES public.air_quality_compliance_profiles(id) ON DELETE RESTRICT;


--
-- Name: facility_air_quality_config facility_air_quality_config_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_air_quality_config
    ADD CONSTRAINT facility_air_quality_config_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: facility_documents facility_documents_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_documents
    ADD CONSTRAINT facility_documents_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: facility_documents facility_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_documents
    ADD CONSTRAINT facility_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: facility_dropdown_options facility_dropdown_options_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_dropdown_options
    ADD CONSTRAINT facility_dropdown_options_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: facility_modules facility_modules_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_modules
    ADD CONSTRAINT facility_modules_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: facility_spaces facility_spaces_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_spaces
    ADD CONSTRAINT facility_spaces_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_change_log ice_depth_change_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_change_log
    ADD CONSTRAINT ice_depth_change_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_change_log ice_depth_change_log_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_change_log
    ADD CONSTRAINT ice_depth_change_log_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_change_log ice_depth_change_log_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_change_log
    ADD CONSTRAINT ice_depth_change_log_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ice_depth_sessions(id) ON DELETE CASCADE;


--
-- Name: ice_depth_followup_notes ice_depth_followup_notes_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_followup_notes
    ADD CONSTRAINT ice_depth_followup_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: ice_depth_followup_notes ice_depth_followup_notes_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_followup_notes
    ADD CONSTRAINT ice_depth_followup_notes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_followup_notes ice_depth_followup_notes_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_followup_notes
    ADD CONSTRAINT ice_depth_followup_notes_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ice_depth_sessions(id) ON DELETE CASCADE;


--
-- Name: ice_depth_layouts ice_depth_layouts_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_layouts
    ADD CONSTRAINT ice_depth_layouts_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_layouts ice_depth_layouts_rink_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_layouts
    ADD CONSTRAINT ice_depth_layouts_rink_id_fkey FOREIGN KEY (rink_id) REFERENCES public.ice_depth_rinks(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_measurements ice_depth_measurements_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_measurements
    ADD CONSTRAINT ice_depth_measurements_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_measurements ice_depth_measurements_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_measurements
    ADD CONSTRAINT ice_depth_measurements_point_id_fkey FOREIGN KEY (point_id) REFERENCES public.ice_depth_points(id) ON DELETE SET NULL;


--
-- Name: ice_depth_measurements ice_depth_measurements_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_measurements
    ADD CONSTRAINT ice_depth_measurements_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ice_depth_sessions(id) ON DELETE CASCADE;


--
-- Name: ice_depth_points ice_depth_points_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_points
    ADD CONSTRAINT ice_depth_points_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_points ice_depth_points_layout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_points
    ADD CONSTRAINT ice_depth_points_layout_id_fkey FOREIGN KEY (layout_id) REFERENCES public.ice_depth_layouts(id) ON DELETE CASCADE;


--
-- Name: ice_depth_rinks ice_depth_rinks_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_rinks
    ADD CONSTRAINT ice_depth_rinks_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_sessions ice_depth_sessions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_sessions
    ADD CONSTRAINT ice_depth_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: ice_depth_sessions ice_depth_sessions_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_sessions
    ADD CONSTRAINT ice_depth_sessions_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_sessions ice_depth_sessions_layout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_sessions
    ADD CONSTRAINT ice_depth_sessions_layout_id_fkey FOREIGN KEY (layout_id) REFERENCES public.ice_depth_layouts(id) ON DELETE RESTRICT;


--
-- Name: ice_depth_settings ice_depth_settings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_depth_settings
    ADD CONSTRAINT ice_depth_settings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_circle_check_items ice_operations_circle_check_items_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_items
    ADD CONSTRAINT ice_operations_circle_check_items_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_circle_check_results ice_operations_circle_check_results_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_results
    ADD CONSTRAINT ice_operations_circle_check_results_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.ice_operations_circle_check_items(id) ON DELETE SET NULL;


--
-- Name: ice_operations_circle_check_results ice_operations_circle_check_results_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_results
    ADD CONSTRAINT ice_operations_circle_check_results_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_circle_check_results ice_operations_circle_check_results_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_results
    ADD CONSTRAINT ice_operations_circle_check_results_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.ice_operations_submissions(id) ON DELETE CASCADE;


--
-- Name: ice_operations_circle_check_template_items ice_operations_circle_check_template_items_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_template_items
    ADD CONSTRAINT ice_operations_circle_check_template_items_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_circle_check_template_items ice_operations_circle_check_template_items_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_template_items
    ADD CONSTRAINT ice_operations_circle_check_template_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.ice_operations_circle_check_templates(id) ON DELETE CASCADE;


--
-- Name: ice_operations_circle_check_templates ice_operations_circle_check_templates_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_templates
    ADD CONSTRAINT ice_operations_circle_check_templates_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_circle_check_templates ice_operations_circle_check_templates_fuel_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_circle_check_templates
    ADD CONSTRAINT ice_operations_circle_check_templates_fuel_type_id_fkey FOREIGN KEY (fuel_type_id) REFERENCES public.ice_operations_fuel_types(id) ON DELETE CASCADE;


--
-- Name: ice_operations_equipment ice_operations_equipment_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_equipment
    ADD CONSTRAINT ice_operations_equipment_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_equipment ice_operations_equipment_fuel_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_equipment
    ADD CONSTRAINT ice_operations_equipment_fuel_type_id_fkey FOREIGN KEY (fuel_type_id) REFERENCES public.ice_operations_fuel_types(id) ON DELETE SET NULL;


--
-- Name: ice_operations_followup_notes ice_operations_followup_notes_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_followup_notes
    ADD CONSTRAINT ice_operations_followup_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: ice_operations_followup_notes ice_operations_followup_notes_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_followup_notes
    ADD CONSTRAINT ice_operations_followup_notes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_followup_notes ice_operations_followup_notes_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_followup_notes
    ADD CONSTRAINT ice_operations_followup_notes_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.ice_operations_submissions(id) ON DELETE CASCADE;


--
-- Name: ice_operations_fuel_types ice_operations_fuel_types_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_fuel_types
    ADD CONSTRAINT ice_operations_fuel_types_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_rinks ice_operations_rinks_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_rinks
    ADD CONSTRAINT ice_operations_rinks_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_settings ice_operations_settings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_settings
    ADD CONSTRAINT ice_operations_settings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_submissions ice_operations_submissions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_submissions
    ADD CONSTRAINT ice_operations_submissions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: ice_operations_submissions ice_operations_submissions_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_submissions
    ADD CONSTRAINT ice_operations_submissions_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.ice_operations_equipment(id) ON DELETE SET NULL;


--
-- Name: ice_operations_submissions ice_operations_submissions_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_submissions
    ADD CONSTRAINT ice_operations_submissions_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: ice_operations_submissions ice_operations_submissions_rink_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ice_operations_submissions
    ADD CONSTRAINT ice_operations_submissions_rink_id_fkey FOREIGN KEY (rink_id) REFERENCES public.ice_operations_rinks(id) ON DELETE SET NULL;


--
-- Name: incident_activities incident_activities_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_activities
    ADD CONSTRAINT incident_activities_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: incident_change_log incident_change_log_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_change_log
    ADD CONSTRAINT incident_change_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: incident_change_log incident_change_log_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_change_log
    ADD CONSTRAINT incident_change_log_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: incident_change_log incident_change_log_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_change_log
    ADD CONSTRAINT incident_change_log_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incident_reports(id) ON DELETE CASCADE;


--
-- Name: incident_followup_notes incident_followup_notes_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_followup_notes
    ADD CONSTRAINT incident_followup_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: incident_followup_notes incident_followup_notes_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_followup_notes
    ADD CONSTRAINT incident_followup_notes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: incident_followup_notes incident_followup_notes_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_followup_notes
    ADD CONSTRAINT incident_followup_notes_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incident_reports(id) ON DELETE CASCADE;


--
-- Name: incident_report_spaces incident_report_spaces_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_report_spaces
    ADD CONSTRAINT incident_report_spaces_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: incident_report_spaces incident_report_spaces_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_report_spaces
    ADD CONSTRAINT incident_report_spaces_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incident_reports(id) ON DELETE CASCADE;


--
-- Name: incident_report_spaces incident_report_spaces_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_report_spaces
    ADD CONSTRAINT incident_report_spaces_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.facility_spaces(id) ON DELETE RESTRICT;


--
-- Name: incident_reports incident_reports_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.incident_activities(id) ON DELETE SET NULL;


--
-- Name: incident_reports incident_reports_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: incident_reports incident_reports_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: incident_reports incident_reports_incident_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_incident_type_id_fkey FOREIGN KEY (incident_type_id) REFERENCES public.incident_types(id) ON DELETE SET NULL;


--
-- Name: incident_reports incident_reports_severity_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_reports
    ADD CONSTRAINT incident_reports_severity_level_id_fkey FOREIGN KEY (severity_level_id) REFERENCES public.incident_severity_levels(id) ON DELETE SET NULL;


--
-- Name: incident_severity_levels incident_severity_levels_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_severity_levels
    ADD CONSTRAINT incident_severity_levels_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: incident_types incident_types_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_types
    ADD CONSTRAINT incident_types_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: incident_witnesses incident_witnesses_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_witnesses
    ADD CONSTRAINT incident_witnesses_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: incident_witnesses incident_witnesses_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_witnesses
    ADD CONSTRAINT incident_witnesses_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incident_reports(id) ON DELETE CASCADE;


--
-- Name: job_area_certification_requirements job_area_certification_requirements_certification_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_area_certification_requirements
    ADD CONSTRAINT job_area_certification_requirements_certification_type_id_fkey FOREIGN KEY (certification_type_id) REFERENCES public.certification_types(id) ON DELETE RESTRICT;


--
-- Name: job_area_certification_requirements job_area_certification_requirements_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_area_certification_requirements
    ADD CONSTRAINT job_area_certification_requirements_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: job_area_certification_requirements job_area_certification_requirements_job_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_area_certification_requirements
    ADD CONSTRAINT job_area_certification_requirements_job_area_id_fkey FOREIGN KEY (job_area_id) REFERENCES public.employee_job_areas(id) ON DELETE CASCADE;


--
-- Name: module_area_permissions module_area_permissions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_area_permissions
    ADD CONSTRAINT module_area_permissions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: module_area_permissions module_area_permissions_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_area_permissions
    ADD CONSTRAINT module_area_permissions_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: notification_outbox notification_outbox_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: notification_outbox notification_outbox_recipient_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_recipient_employee_id_fkey FOREIGN KEY (recipient_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: notification_outbox notification_outbox_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.communication_routing_rules(id) ON DELETE SET NULL;


--
-- Name: offline_sync_queue offline_sync_queue_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_sync_queue
    ADD CONSTRAINT offline_sync_queue_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: offline_sync_queue offline_sync_queue_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_sync_queue
    ADD CONSTRAINT offline_sync_queue_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: profile_audit_log profile_audit_log_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_audit_log
    ADD CONSTRAINT profile_audit_log_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: profile_audit_log profile_audit_log_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_audit_log
    ADD CONSTRAINT profile_audit_log_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE SET NULL;


--
-- Name: profile_audit_log profile_audit_log_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_audit_log
    ADD CONSTRAINT profile_audit_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refrigeration_change_log refrigeration_change_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_change_log
    ADD CONSTRAINT refrigeration_change_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_change_log refrigeration_change_log_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_change_log
    ADD CONSTRAINT refrigeration_change_log_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_change_log refrigeration_change_log_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_change_log
    ADD CONSTRAINT refrigeration_change_log_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.refrigeration_reports(id) ON DELETE CASCADE;


--
-- Name: refrigeration_equipment refrigeration_equipment_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_equipment
    ADD CONSTRAINT refrigeration_equipment_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_equipment refrigeration_equipment_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_equipment
    ADD CONSTRAINT refrigeration_equipment_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.refrigeration_sections(id) ON DELETE CASCADE;


--
-- Name: refrigeration_fields refrigeration_fields_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_fields
    ADD CONSTRAINT refrigeration_fields_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.refrigeration_equipment(id) ON DELETE CASCADE;


--
-- Name: refrigeration_fields refrigeration_fields_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_fields
    ADD CONSTRAINT refrigeration_fields_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_fields refrigeration_fields_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_fields
    ADD CONSTRAINT refrigeration_fields_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.refrigeration_sections(id) ON DELETE CASCADE;


--
-- Name: refrigeration_followup_notes refrigeration_followup_notes_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_followup_notes
    ADD CONSTRAINT refrigeration_followup_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: refrigeration_followup_notes refrigeration_followup_notes_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_followup_notes
    ADD CONSTRAINT refrigeration_followup_notes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_followup_notes refrigeration_followup_notes_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_followup_notes
    ADD CONSTRAINT refrigeration_followup_notes_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.refrigeration_fields(id);


--
-- Name: refrigeration_followup_notes refrigeration_followup_notes_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_followup_notes
    ADD CONSTRAINT refrigeration_followup_notes_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.refrigeration_reports(id) ON DELETE CASCADE;


--
-- Name: refrigeration_followup_notes refrigeration_followup_notes_report_value_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_followup_notes
    ADD CONSTRAINT refrigeration_followup_notes_report_value_id_fkey FOREIGN KEY (report_value_id) REFERENCES public.refrigeration_report_values(id) ON DELETE CASCADE;


--
-- Name: refrigeration_report_values refrigeration_report_values_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_report_values
    ADD CONSTRAINT refrigeration_report_values_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.refrigeration_equipment(id) ON DELETE SET NULL;


--
-- Name: refrigeration_report_values refrigeration_report_values_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_report_values
    ADD CONSTRAINT refrigeration_report_values_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_report_values refrigeration_report_values_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_report_values
    ADD CONSTRAINT refrigeration_report_values_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.refrigeration_fields(id) ON DELETE SET NULL;


--
-- Name: refrigeration_report_values refrigeration_report_values_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_report_values
    ADD CONSTRAINT refrigeration_report_values_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.refrigeration_reports(id) ON DELETE CASCADE;


--
-- Name: refrigeration_report_values refrigeration_report_values_threshold_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_report_values
    ADD CONSTRAINT refrigeration_report_values_threshold_id_fkey FOREIGN KEY (threshold_id) REFERENCES public.refrigeration_thresholds(id) ON DELETE SET NULL;


--
-- Name: refrigeration_reports refrigeration_reports_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_reports
    ADD CONSTRAINT refrigeration_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: refrigeration_reports refrigeration_reports_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_reports
    ADD CONSTRAINT refrigeration_reports_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_sections refrigeration_sections_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_sections
    ADD CONSTRAINT refrigeration_sections_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_settings refrigeration_settings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_settings
    ADD CONSTRAINT refrigeration_settings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_thresholds refrigeration_thresholds_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_thresholds
    ADD CONSTRAINT refrigeration_thresholds_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.refrigeration_equipment(id) ON DELETE CASCADE;


--
-- Name: refrigeration_thresholds refrigeration_thresholds_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_thresholds
    ADD CONSTRAINT refrigeration_thresholds_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: refrigeration_thresholds refrigeration_thresholds_field_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refrigeration_thresholds
    ADD CONSTRAINT refrigeration_thresholds_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.refrigeration_fields(id) ON DELETE CASCADE;


--
-- Name: retention_settings retention_settings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_settings
    ADD CONSTRAINT retention_settings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: role_module_permission_defaults role_module_permission_defaults_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_module_permission_defaults
    ADD CONSTRAINT role_module_permission_defaults_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: role_module_permission_defaults role_module_permission_defaults_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_module_permission_defaults
    ADD CONSTRAINT role_module_permission_defaults_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_permission_defaults role_permission_defaults_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_defaults
    ADD CONSTRAINT role_permission_defaults_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: role_permission_defaults role_permission_defaults_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission_defaults
    ADD CONSTRAINT role_permission_defaults_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_assignment_overrides schedule_assignment_overrides_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_assignment_overrides
    ADD CONSTRAINT schedule_assignment_overrides_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: schedule_assignment_overrides schedule_assignment_overrides_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_assignment_overrides
    ADD CONSTRAINT schedule_assignment_overrides_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: schedule_assignment_overrides schedule_assignment_overrides_job_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_assignment_overrides
    ADD CONSTRAINT schedule_assignment_overrides_job_area_id_fkey FOREIGN KEY (job_area_id) REFERENCES public.employee_job_areas(id) ON DELETE SET NULL;


--
-- Name: schedule_assignment_overrides schedule_assignment_overrides_overridden_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_assignment_overrides
    ADD CONSTRAINT schedule_assignment_overrides_overridden_by_employee_id_fkey FOREIGN KEY (overridden_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_assignment_overrides schedule_assignment_overrides_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_assignment_overrides
    ADD CONSTRAINT schedule_assignment_overrides_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.schedule_shifts(id) ON DELETE SET NULL;


--
-- Name: schedule_availability schedule_availability_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_availability
    ADD CONSTRAINT schedule_availability_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: schedule_availability schedule_availability_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_availability
    ADD CONSTRAINT schedule_availability_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_availability schedule_availability_job_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_availability
    ADD CONSTRAINT schedule_availability_job_area_id_fkey FOREIGN KEY (job_area_id) REFERENCES public.employee_job_areas(id) ON DELETE SET NULL;


--
-- Name: schedule_compliance_rules schedule_compliance_rules_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_compliance_rules
    ADD CONSTRAINT schedule_compliance_rules_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_ics_tokens schedule_ics_tokens_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_ics_tokens
    ADD CONSTRAINT schedule_ics_tokens_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: schedule_ics_tokens schedule_ics_tokens_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_ics_tokens
    ADD CONSTRAINT schedule_ics_tokens_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: schedule_notifications schedule_notifications_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_notifications
    ADD CONSTRAINT schedule_notifications_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: schedule_notifications schedule_notifications_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_notifications
    ADD CONSTRAINT schedule_notifications_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_notifications schedule_notifications_publish_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_notifications
    ADD CONSTRAINT schedule_notifications_publish_event_id_fkey FOREIGN KEY (publish_event_id) REFERENCES public.schedule_publish_events(id) ON DELETE SET NULL;


--
-- Name: schedule_notifications schedule_notifications_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_notifications
    ADD CONSTRAINT schedule_notifications_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.schedule_shifts(id) ON DELETE CASCADE;


--
-- Name: schedule_notifications schedule_notifications_swap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_notifications
    ADD CONSTRAINT schedule_notifications_swap_id_fkey FOREIGN KEY (swap_id) REFERENCES public.schedule_swap_requests(id) ON DELETE CASCADE;


--
-- Name: schedule_notifications schedule_notifications_time_off_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_notifications
    ADD CONSTRAINT schedule_notifications_time_off_id_fkey FOREIGN KEY (time_off_id) REFERENCES public.schedule_time_off_requests(id) ON DELETE CASCADE;


--
-- Name: schedule_open_shifts schedule_open_shifts_approved_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_open_shifts
    ADD CONSTRAINT schedule_open_shifts_approved_by_employee_id_fkey FOREIGN KEY (approved_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_open_shifts schedule_open_shifts_claimed_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_open_shifts
    ADD CONSTRAINT schedule_open_shifts_claimed_by_employee_id_fkey FOREIGN KEY (claimed_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_open_shifts schedule_open_shifts_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_open_shifts
    ADD CONSTRAINT schedule_open_shifts_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_open_shifts schedule_open_shifts_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_open_shifts
    ADD CONSTRAINT schedule_open_shifts_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.schedule_shifts(id) ON DELETE CASCADE;


--
-- Name: schedule_publish_events schedule_publish_events_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_publish_events
    ADD CONSTRAINT schedule_publish_events_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_publish_events schedule_publish_events_published_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_publish_events
    ADD CONSTRAINT schedule_publish_events_published_by_employee_id_fkey FOREIGN KEY (published_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_publish_requests schedule_publish_requests_decided_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_publish_requests
    ADD CONSTRAINT schedule_publish_requests_decided_by_employee_id_fkey FOREIGN KEY (decided_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_publish_requests schedule_publish_requests_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_publish_requests
    ADD CONSTRAINT schedule_publish_requests_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_publish_requests schedule_publish_requests_published_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_publish_requests
    ADD CONSTRAINT schedule_publish_requests_published_event_id_fkey FOREIGN KEY (published_event_id) REFERENCES public.schedule_publish_events(id) ON DELETE SET NULL;


--
-- Name: schedule_publish_requests schedule_publish_requests_requested_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_publish_requests
    ADD CONSTRAINT schedule_publish_requests_requested_by_employee_id_fkey FOREIGN KEY (requested_by_employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: schedule_settings schedule_settings_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_settings
    ADD CONSTRAINT schedule_settings_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_shifts schedule_shifts_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT;


--
-- Name: schedule_shifts schedule_shifts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_shifts schedule_shifts_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_shifts schedule_shifts_job_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_job_area_id_fkey FOREIGN KEY (job_area_id) REFERENCES public.employee_job_areas(id) ON DELETE RESTRICT;


--
-- Name: schedule_shifts schedule_shifts_published_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_published_by_employee_id_fkey FOREIGN KEY (published_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_shifts schedule_shifts_recurring_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_recurring_parent_id_fkey FOREIGN KEY (recurring_parent_id) REFERENCES public.schedule_shifts(id) ON DELETE SET NULL;


--
-- Name: schedule_shifts schedule_shifts_template_origin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_shifts
    ADD CONSTRAINT schedule_shifts_template_origin_id_fkey FOREIGN KEY (template_origin_id) REFERENCES public.schedule_templates(id) ON DELETE SET NULL;


--
-- Name: schedule_swap_requests schedule_swap_requests_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_swap_requests
    ADD CONSTRAINT schedule_swap_requests_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_swap_requests schedule_swap_requests_manager_approver_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_swap_requests
    ADD CONSTRAINT schedule_swap_requests_manager_approver_employee_id_fkey FOREIGN KEY (manager_approver_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_swap_requests schedule_swap_requests_requester_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_swap_requests
    ADD CONSTRAINT schedule_swap_requests_requester_employee_id_fkey FOREIGN KEY (requester_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: schedule_swap_requests schedule_swap_requests_requester_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_swap_requests
    ADD CONSTRAINT schedule_swap_requests_requester_shift_id_fkey FOREIGN KEY (requester_shift_id) REFERENCES public.schedule_shifts(id) ON DELETE CASCADE;


--
-- Name: schedule_swap_requests schedule_swap_requests_target_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_swap_requests
    ADD CONSTRAINT schedule_swap_requests_target_employee_id_fkey FOREIGN KEY (target_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_swap_requests schedule_swap_requests_target_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_swap_requests
    ADD CONSTRAINT schedule_swap_requests_target_shift_id_fkey FOREIGN KEY (target_shift_id) REFERENCES public.schedule_shifts(id) ON DELETE SET NULL;


--
-- Name: schedule_template_shifts schedule_template_shifts_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_shifts
    ADD CONSTRAINT schedule_template_shifts_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT;


--
-- Name: schedule_template_shifts schedule_template_shifts_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_shifts
    ADD CONSTRAINT schedule_template_shifts_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_template_shifts schedule_template_shifts_job_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_shifts
    ADD CONSTRAINT schedule_template_shifts_job_area_id_fkey FOREIGN KEY (job_area_id) REFERENCES public.employee_job_areas(id) ON DELETE RESTRICT;


--
-- Name: schedule_template_shifts schedule_template_shifts_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_shifts
    ADD CONSTRAINT schedule_template_shifts_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.schedule_templates(id) ON DELETE CASCADE;


--
-- Name: schedule_templates schedule_templates_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_templates
    ADD CONSTRAINT schedule_templates_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: schedule_time_off_requests schedule_time_off_requests_approved_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_time_off_requests
    ADD CONSTRAINT schedule_time_off_requests_approved_by_employee_id_fkey FOREIGN KEY (approved_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: schedule_time_off_requests schedule_time_off_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_time_off_requests
    ADD CONSTRAINT schedule_time_off_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: schedule_time_off_requests schedule_time_off_requests_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_time_off_requests
    ADD CONSTRAINT schedule_time_off_requests_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: user_permissions user_permissions_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: accident_body_part_selections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accident_body_part_selections ENABLE ROW LEVEL SECURITY;

--
-- Name: accident_body_part_selections accident_body_part_selections_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_body_part_selections_delete ON public.accident_body_part_selections FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_body_part_selections.accident_id) AND (public.has_module_admin_access('accident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: accident_body_part_selections accident_body_part_selections_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_body_part_selections_insert ON public.accident_body_part_selections FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_body_part_selections.accident_id) AND (public.has_module_admin_access('accident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: accident_body_part_selections accident_body_part_selections_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_body_part_selections_select ON public.accident_body_part_selections FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('accident_reports'::text) OR (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_body_part_selections.accident_id) AND (r.employee_id = public.current_employee_id()))))))));


--
-- Name: accident_body_part_selections accident_body_part_selections_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_body_part_selections_update ON public.accident_body_part_selections FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_body_part_selections.accident_id) AND (public.has_module_admin_access('accident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at))))))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_body_part_selections.accident_id) AND (public.has_module_admin_access('accident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: accident_change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accident_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: accident_change_log accident_change_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_change_log_insert ON public.accident_change_log FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: accident_change_log accident_change_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_change_log_select ON public.accident_change_log FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text))));


--
-- Name: accident_dropdowns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accident_dropdowns ENABLE ROW LEVEL SECURITY;

--
-- Name: accident_dropdowns accident_dropdowns_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_dropdowns_delete ON public.accident_dropdowns FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text))));


--
-- Name: accident_dropdowns accident_dropdowns_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_dropdowns_insert ON public.accident_dropdowns FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text))));


--
-- Name: accident_dropdowns accident_dropdowns_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_dropdowns_select ON public.accident_dropdowns FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('accident_reports'::text))));


--
-- Name: accident_dropdowns accident_dropdowns_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_dropdowns_update ON public.accident_dropdowns FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text))));


--
-- Name: accident_followup_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accident_followup_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: accident_followup_notes accident_followup_notes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_followup_notes_insert ON public.accident_followup_notes FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text))));


--
-- Name: accident_followup_notes accident_followup_notes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_followup_notes_select ON public.accident_followup_notes FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('accident_reports'::text) OR (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_followup_notes.accident_id) AND (r.employee_id = public.current_employee_id()))))))));


--
-- Name: accident_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accident_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: accident_reports accident_reports_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_reports_delete ON public.accident_reports FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: accident_reports accident_reports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_reports_insert ON public.accident_reports FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('accident_reports'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: accident_reports accident_reports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_reports_select ON public.accident_reports FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('accident_reports'::text) OR (public.has_module_access('accident_reports'::text) AND (employee_id = public.current_employee_id()))))));


--
-- Name: accident_reports accident_reports_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_reports_update ON public.accident_reports FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('accident_reports'::text) OR ((employee_id = public.current_employee_id()) AND (now() <= edit_window_ends_at)))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('accident_reports'::text) OR ((employee_id = public.current_employee_id()) AND (now() <= edit_window_ends_at))))));


--
-- Name: accident_witnesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accident_witnesses ENABLE ROW LEVEL SECURITY;

--
-- Name: accident_witnesses accident_witnesses_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_witnesses_delete ON public.accident_witnesses FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_witnesses.accident_id) AND (public.has_module_admin_access('accident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: accident_witnesses accident_witnesses_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_witnesses_insert ON public.accident_witnesses FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_witnesses.accident_id) AND (public.has_module_admin_access('accident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: accident_witnesses accident_witnesses_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_witnesses_select ON public.accident_witnesses FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('accident_reports'::text) OR (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_witnesses.accident_id) AND (r.employee_id = public.current_employee_id()))))))));


--
-- Name: accident_witnesses accident_witnesses_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_witnesses_update ON public.accident_witnesses FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_witnesses.accident_id) AND (public.has_module_admin_access('accident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at))))))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.accident_reports r
  WHERE ((r.id = accident_witnesses.accident_id) AND (public.has_module_admin_access('accident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: accident_workers_comp_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accident_workers_comp_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: accident_workers_comp_settings accident_workers_comp_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_workers_comp_settings_delete ON public.accident_workers_comp_settings FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text))));


--
-- Name: accident_workers_comp_settings accident_workers_comp_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_workers_comp_settings_insert ON public.accident_workers_comp_settings FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text))));


--
-- Name: accident_workers_comp_settings accident_workers_comp_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_workers_comp_settings_select ON public.accident_workers_comp_settings FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('accident_reports'::text))));


--
-- Name: accident_workers_comp_settings accident_workers_comp_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accident_workers_comp_settings_update ON public.accident_workers_comp_settings FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('accident_reports'::text))));


--
-- Name: air_quality_change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_change_log air_quality_change_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_change_log_insert ON public.air_quality_change_log FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('air_quality'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: air_quality_change_log air_quality_change_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_change_log_select ON public.air_quality_change_log FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: air_quality_compliance_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_compliance_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_compliance_profiles air_quality_compliance_profiles_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_compliance_profiles_delete ON public.air_quality_compliance_profiles FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: air_quality_compliance_profiles air_quality_compliance_profiles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_compliance_profiles_insert ON public.air_quality_compliance_profiles FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());


--
-- Name: air_quality_compliance_profiles air_quality_compliance_profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_compliance_profiles_select ON public.air_quality_compliance_profiles FOR SELECT TO authenticated USING (true);


--
-- Name: air_quality_compliance_profiles air_quality_compliance_profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_compliance_profiles_update ON public.air_quality_compliance_profiles FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: air_quality_compliance_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_compliance_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_compliance_rules air_quality_compliance_rules_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_compliance_rules_delete ON public.air_quality_compliance_rules FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_compliance_rules air_quality_compliance_rules_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_compliance_rules_insert ON public.air_quality_compliance_rules FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_compliance_rules air_quality_compliance_rules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_compliance_rules_select ON public.air_quality_compliance_rules FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: air_quality_compliance_rules air_quality_compliance_rules_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_compliance_rules_update ON public.air_quality_compliance_rules FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_equipment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_equipment ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_equipment air_quality_equipment_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_equipment_delete ON public.air_quality_equipment FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_equipment air_quality_equipment_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_equipment_insert ON public.air_quality_equipment FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_equipment air_quality_equipment_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_equipment_select ON public.air_quality_equipment FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: air_quality_equipment air_quality_equipment_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_equipment_update ON public.air_quality_equipment FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_followup_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_followup_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_followup_notes air_quality_followup_notes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_followup_notes_insert ON public.air_quality_followup_notes FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_followup_notes air_quality_followup_notes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_followup_notes_select ON public.air_quality_followup_notes FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: air_quality_reading_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_reading_types ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_reading_types air_quality_reading_types_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_reading_types_delete ON public.air_quality_reading_types FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_reading_types air_quality_reading_types_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_reading_types_insert ON public.air_quality_reading_types FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_reading_types air_quality_reading_types_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_reading_types_select ON public.air_quality_reading_types FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: air_quality_reading_types air_quality_reading_types_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_reading_types_update ON public.air_quality_reading_types FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_readings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_readings ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_readings air_quality_readings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_readings_delete ON public.air_quality_readings FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: air_quality_readings air_quality_readings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_readings_insert ON public.air_quality_readings FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: air_quality_readings air_quality_readings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_readings_select ON public.air_quality_readings FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: air_quality_readings air_quality_readings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_readings_update ON public.air_quality_readings FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: air_quality_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_reports air_quality_reports_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_reports_delete ON public.air_quality_reports FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: air_quality_reports air_quality_reports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_reports_insert ON public.air_quality_reports FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('air_quality'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: air_quality_reports air_quality_reports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_reports_select ON public.air_quality_reports FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: air_quality_reports air_quality_reports_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_reports_update ON public.air_quality_reports FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: air_quality_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.air_quality_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: air_quality_settings air_quality_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_settings_delete ON public.air_quality_settings FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_settings air_quality_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_settings_insert ON public.air_quality_settings FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: air_quality_settings air_quality_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_settings_select ON public.air_quality_settings FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: air_quality_settings air_quality_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY air_quality_settings_update ON public.air_quality_settings FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('air_quality'::text))));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_logs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: audit_logs audit_logs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: certification_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.certification_types ENABLE ROW LEVEL SECURITY;

--
-- Name: certification_types certification_types_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY certification_types_delete ON public.certification_types FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));


--
-- Name: certification_types certification_types_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY certification_types_insert ON public.certification_types FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));


--
-- Name: certification_types certification_types_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY certification_types_select ON public.certification_types FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: certification_types certification_types_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY certification_types_update ON public.certification_types FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));


--
-- Name: communication_acknowledgements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_acknowledgements ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_acknowledgements communication_acknowledgements_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_acknowledgements_insert ON public.communication_acknowledgements FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('communications'::text) OR (public.has_module_access('communications'::text) AND (employee_id = public.current_employee_id()))))));


--
-- Name: communication_acknowledgements communication_acknowledgements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_acknowledgements_select ON public.communication_acknowledgements FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text))));


--
-- Name: communication_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_alerts communication_alerts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_alerts_delete ON public.communication_alerts FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_alerts communication_alerts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_alerts_insert ON public.communication_alerts FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND ((public.current_employee_module_permission(source_module) >= 'submit'::public.module_permission_level) OR public.has_module_admin_access('communications'::text)))));


--
-- Name: communication_alerts communication_alerts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_alerts_select ON public.communication_alerts FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text))));


--
-- Name: communication_alerts communication_alerts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_alerts_update ON public.communication_alerts FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_audit_log communication_audit_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_audit_log_insert ON public.communication_audit_log FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text) AND (NOT (actor_employee_id IS DISTINCT FROM public.current_employee_id())))));


--
-- Name: communication_audit_log communication_audit_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_audit_log_select ON public.communication_audit_log FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_group_members communication_group_members_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_group_members_delete ON public.communication_group_members FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_group_members communication_group_members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_group_members_insert ON public.communication_group_members FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_group_members communication_group_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_group_members_select ON public.communication_group_members FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text))));


--
-- Name: communication_group_members communication_group_members_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_group_members_update ON public.communication_group_members FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_groups communication_groups_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_groups_delete ON public.communication_groups FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_groups communication_groups_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_groups_insert ON public.communication_groups FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_groups communication_groups_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_groups_select ON public.communication_groups FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text))));


--
-- Name: communication_groups communication_groups_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_groups_update ON public.communication_groups FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_messages communication_messages_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_messages_delete ON public.communication_messages FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_messages communication_messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_messages_insert ON public.communication_messages FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('communications'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: communication_messages communication_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_messages_select ON public.communication_messages FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text))));


--
-- Name: communication_messages communication_messages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_messages_update ON public.communication_messages FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_recipients communication_recipients_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_recipients_delete ON public.communication_recipients FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_recipients communication_recipients_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_recipients_insert ON public.communication_recipients FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('communications'::text) OR (EXISTS ( SELECT 1
   FROM public.communication_messages m
  WHERE ((m.id = communication_recipients.message_id) AND (m.sender_employee_id = public.current_employee_id()))))))));


--
-- Name: communication_recipients communication_recipients_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_recipients_select ON public.communication_recipients FOR SELECT TO authenticated USING ((public.is_super_admin() OR public.has_module_admin_access('communications'::text) OR ((facility_id = public.current_facility_id()) AND ((employee_id = public.current_employee_id()) OR (EXISTS ( SELECT 1
   FROM public.communication_messages m
  WHERE ((m.id = communication_recipients.message_id) AND (m.sender_employee_id = public.current_employee_id()))))))));


--
-- Name: communication_recipients communication_recipients_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_recipients_update ON public.communication_recipients FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('communications'::text) OR (employee_id = public.current_employee_id()))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('communications'::text) OR (employee_id = public.current_employee_id())))));


--
-- Name: communication_recurring_reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_recurring_reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_recurring_reminders communication_recurring_reminders_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_recurring_reminders_delete ON public.communication_recurring_reminders FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_recurring_reminders communication_recurring_reminders_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_recurring_reminders_insert ON public.communication_recurring_reminders FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_recurring_reminders communication_recurring_reminders_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_recurring_reminders_select ON public.communication_recurring_reminders FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text))));


--
-- Name: communication_recurring_reminders communication_recurring_reminders_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_recurring_reminders_update ON public.communication_recurring_reminders FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_routing_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_routing_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_routing_rules communication_routing_rules_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_routing_rules_delete ON public.communication_routing_rules FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_routing_rules communication_routing_rules_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_routing_rules_insert ON public.communication_routing_rules FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_routing_rules communication_routing_rules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_routing_rules_select ON public.communication_routing_rules FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text))));


--
-- Name: communication_routing_rules communication_routing_rules_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_routing_rules_update ON public.communication_routing_rules FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_templates communication_templates_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_templates_delete ON public.communication_templates FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_templates communication_templates_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_templates_insert ON public.communication_templates FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: communication_templates communication_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_templates_select ON public.communication_templates FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('communications'::text))));


--
-- Name: communication_templates communication_templates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_templates_update ON public.communication_templates FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: daily_report_areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_report_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_report_areas daily_report_areas_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_areas_delete ON public.daily_report_areas FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_areas daily_report_areas_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_areas_insert ON public.daily_report_areas FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_areas daily_report_areas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_areas_select ON public.daily_report_areas FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('daily_reports'::text))));


--
-- Name: daily_report_areas daily_report_areas_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_areas_update ON public.daily_report_areas FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_checklist_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_report_checklist_items ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_report_checklist_items daily_report_checklist_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_checklist_items_delete ON public.daily_report_checklist_items FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_checklist_items daily_report_checklist_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_checklist_items_insert ON public.daily_report_checklist_items FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_checklist_items daily_report_checklist_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_checklist_items_select ON public.daily_report_checklist_items FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('daily_reports'::text))));


--
-- Name: daily_report_checklist_items daily_report_checklist_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_checklist_items_update ON public.daily_report_checklist_items FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_report_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_report_notes daily_report_notes_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_notes_delete ON public.daily_report_notes FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_notes daily_report_notes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_notes_insert ON public.daily_report_notes FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('daily_reports'::text) AND (EXISTS ( SELECT 1
   FROM public.daily_report_submissions s
  WHERE (s.id = daily_report_notes.submission_id))))));


--
-- Name: daily_report_notes daily_report_notes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_notes_select ON public.daily_report_notes FOR SELECT TO authenticated USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.daily_report_submissions s
  WHERE (s.id = daily_report_notes.submission_id)))));


--
-- Name: daily_report_notes daily_report_notes_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_notes_update ON public.daily_report_notes FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_submission_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_report_submission_items ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_report_submission_items daily_report_submission_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_submission_items_delete ON public.daily_report_submission_items FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_submission_items daily_report_submission_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_submission_items_insert ON public.daily_report_submission_items FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('daily_reports'::text) >= 'view'::public.module_permission_level))));


--
-- Name: daily_report_submission_items daily_report_submission_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_submission_items_select ON public.daily_report_submission_items FOR SELECT TO authenticated USING ((public.is_super_admin() OR (EXISTS ( SELECT 1
   FROM public.daily_report_submissions s
  WHERE (s.id = daily_report_submission_items.submission_id)))));


--
-- Name: daily_report_submission_items daily_report_submission_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_submission_items_update ON public.daily_report_submission_items FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_report_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_report_submissions daily_report_submissions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_submissions_delete ON public.daily_report_submissions FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_submissions daily_report_submissions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_submissions_insert ON public.daily_report_submissions FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('daily_reports'::text) >= 'submit'::public.module_permission_level) AND public.has_area_submit_access('daily_reports'::text, area_id))));


--
-- Name: daily_report_submissions daily_report_submissions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_submissions_select ON public.daily_report_submissions FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('daily_reports'::text) OR ((public.current_employee_module_permission('daily_reports'::text) >= 'view'::public.module_permission_level) AND public.has_area_access('daily_reports'::text, area_id))))));


--
-- Name: daily_report_submissions daily_report_submissions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_submissions_update ON public.daily_report_submissions FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_report_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_report_templates daily_report_templates_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_templates_delete ON public.daily_report_templates FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_templates daily_report_templates_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_templates_insert ON public.daily_report_templates FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: daily_report_templates daily_report_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_templates_select ON public.daily_report_templates FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('daily_reports'::text))));


--
-- Name: daily_report_templates daily_report_templates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_report_templates_update ON public.daily_report_templates FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('daily_reports'::text))));


--
-- Name: departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

--
-- Name: departments departments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_delete ON public.departments FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: departments departments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_insert ON public.departments FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: departments departments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_select ON public.departments FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: departments departments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY departments_update ON public.departments FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: employee_certifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_certifications ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_certifications employee_certifications_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_certifications_delete ON public.employee_certifications FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'gm'::text, 'super_admin'::text])))));


--
-- Name: employee_certifications employee_certifications_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_certifications_insert ON public.employee_certifications FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'gm'::text, 'super_admin'::text])))));


--
-- Name: employee_certifications employee_certifications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_certifications_select ON public.employee_certifications FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: employee_certifications employee_certifications_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_certifications_update ON public.employee_certifications FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'gm'::text, 'super_admin'::text]))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'gm'::text, 'super_admin'::text])))));


--
-- Name: employee_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_invites employee_invites_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_invites_delete ON public.employee_invites FOR DELETE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM (public.employees me
     JOIN public.roles r ON ((r.id = me.role_id)))
  WHERE ((me.user_id = ( SELECT auth.uid() AS uid)) AND me.is_active AND (r.key = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))));


--
-- Name: employee_invites employee_invites_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_invites_insert ON public.employee_invites FOR INSERT WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM (public.employees me
     JOIN public.roles r ON ((r.id = me.role_id)))
  WHERE ((me.user_id = ( SELECT auth.uid() AS uid)) AND me.is_active AND (r.key = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))));


--
-- Name: employee_invites employee_invites_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_invites_select ON public.employee_invites FOR SELECT USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: employee_invites employee_invites_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_invites_update ON public.employee_invites FOR UPDATE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM (public.employees me
     JOIN public.roles r ON ((r.id = me.role_id)))
  WHERE ((me.user_id = ( SELECT auth.uid() AS uid)) AND me.is_active AND (r.key = ANY (ARRAY['admin'::text, 'super_admin'::text])))))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM (public.employees me
     JOIN public.roles r ON ((r.id = me.role_id)))
  WHERE ((me.user_id = ( SELECT auth.uid() AS uid)) AND me.is_active AND (r.key = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))));


--
-- Name: employee_job_area_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_job_area_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_job_area_assignments employee_job_area_assignments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_job_area_assignments_delete ON public.employee_job_area_assignments FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: employee_job_area_assignments employee_job_area_assignments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_job_area_assignments_insert ON public.employee_job_area_assignments FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: employee_job_area_assignments employee_job_area_assignments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_job_area_assignments_select ON public.employee_job_area_assignments FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text))));


--
-- Name: employee_job_area_assignments employee_job_area_assignments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_job_area_assignments_update ON public.employee_job_area_assignments FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: employee_job_areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_job_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_job_areas employee_job_areas_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_job_areas_delete ON public.employee_job_areas FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: employee_job_areas employee_job_areas_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_job_areas_insert ON public.employee_job_areas FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: employee_job_areas employee_job_areas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_job_areas_select ON public.employee_job_areas FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text))));


--
-- Name: employee_job_areas employee_job_areas_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_job_areas_update ON public.employee_job_areas FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: employee_wages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_wages ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_wages employee_wages_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_wages_delete ON public.employee_wages FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));


--
-- Name: employee_wages employee_wages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_wages_insert ON public.employee_wages FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));


--
-- Name: employee_wages employee_wages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_wages_select ON public.employee_wages FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));


--
-- Name: employee_wages employee_wages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_wages_update ON public.employee_wages FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));


--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: employees employees_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_delete ON public.employees FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: employees employees_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_insert ON public.employees FOR INSERT WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: employees employees_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_select ON public.employees FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: employees employees_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_update ON public.employees FOR UPDATE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: export_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.export_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: export_settings export_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY export_settings_delete ON public.export_settings FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: export_settings export_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY export_settings_insert ON public.export_settings FOR INSERT WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: export_settings export_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY export_settings_select ON public.export_settings FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: export_settings export_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY export_settings_update ON public.export_settings FOR UPDATE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: facilities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

--
-- Name: facilities facilities_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facilities_delete ON public.facilities FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: facilities facilities_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facilities_insert ON public.facilities FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());


--
-- Name: facilities facilities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facilities_select ON public.facilities FOR SELECT TO authenticated USING ((public.is_super_admin() OR (id = public.current_facility_id())));


--
-- Name: facilities facilities_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facilities_update ON public.facilities FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: facility_air_quality_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_air_quality_config ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_air_quality_config facility_air_quality_config_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_air_quality_config_delete ON public.facility_air_quality_config FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.is_facility_admin(facility_id) OR public.has_module_admin_access('air_quality'::text)))));


--
-- Name: facility_air_quality_config facility_air_quality_config_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_air_quality_config_insert ON public.facility_air_quality_config FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.is_facility_admin(facility_id) OR public.has_module_admin_access('air_quality'::text)))));


--
-- Name: facility_air_quality_config facility_air_quality_config_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_air_quality_config_select ON public.facility_air_quality_config FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('air_quality'::text))));


--
-- Name: facility_air_quality_config facility_air_quality_config_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_air_quality_config_update ON public.facility_air_quality_config FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.is_facility_admin(facility_id) OR public.has_module_admin_access('air_quality'::text))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.is_facility_admin(facility_id) OR public.has_module_admin_access('air_quality'::text)))));


--
-- Name: facility_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_documents facility_documents_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_documents_delete ON public.facility_documents FOR DELETE TO authenticated USING ((public.is_super_admin() OR public.is_facility_admin(facility_id)));


--
-- Name: facility_documents facility_documents_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_documents_insert ON public.facility_documents FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR public.is_facility_admin(facility_id)));


--
-- Name: facility_documents facility_documents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_documents_select ON public.facility_documents FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: facility_documents facility_documents_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_documents_update ON public.facility_documents FOR UPDATE TO authenticated USING ((public.is_super_admin() OR public.is_facility_admin(facility_id))) WITH CHECK ((public.is_super_admin() OR public.is_facility_admin(facility_id)));


--
-- Name: facility_dropdown_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_dropdown_options ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_dropdown_options facility_dropdown_options_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_dropdown_options_delete ON public.facility_dropdown_options FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.is_facility_admin(facility_id))));


--
-- Name: facility_dropdown_options facility_dropdown_options_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_dropdown_options_insert ON public.facility_dropdown_options FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.is_facility_admin(facility_id))));


--
-- Name: facility_dropdown_options facility_dropdown_options_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_dropdown_options_select ON public.facility_dropdown_options FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: facility_dropdown_options facility_dropdown_options_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_dropdown_options_update ON public.facility_dropdown_options FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.is_facility_admin(facility_id)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.is_facility_admin(facility_id))));


--
-- Name: facility_modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_modules ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_modules facility_modules_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_modules_delete ON public.facility_modules FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.is_facility_admin(facility_id))));


--
-- Name: facility_modules facility_modules_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_modules_insert ON public.facility_modules FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.is_facility_admin(facility_id))));


--
-- Name: facility_modules facility_modules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_modules_select ON public.facility_modules FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: facility_modules facility_modules_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_modules_update ON public.facility_modules FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.is_facility_admin(facility_id)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.is_facility_admin(facility_id))));


--
-- Name: facility_spaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_spaces ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_spaces facility_spaces_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_spaces_delete ON public.facility_spaces FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.is_facility_admin(facility_id) OR public.has_module_admin_access('incident_reports'::text) OR public.has_module_admin_access('accident_reports'::text) OR public.has_module_admin_access('air_quality'::text)))));


--
-- Name: facility_spaces facility_spaces_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_spaces_insert ON public.facility_spaces FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.is_facility_admin(facility_id) OR public.has_module_admin_access('incident_reports'::text) OR public.has_module_admin_access('accident_reports'::text) OR public.has_module_admin_access('air_quality'::text)))));


--
-- Name: facility_spaces facility_spaces_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_spaces_select ON public.facility_spaces FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: facility_spaces facility_spaces_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facility_spaces_update ON public.facility_spaces FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.is_facility_admin(facility_id) OR public.has_module_admin_access('incident_reports'::text) OR public.has_module_admin_access('accident_reports'::text) OR public.has_module_admin_access('air_quality'::text))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.is_facility_admin(facility_id) OR public.has_module_admin_access('incident_reports'::text) OR public.has_module_admin_access('accident_reports'::text) OR public.has_module_admin_access('air_quality'::text)))));


--
-- Name: ice_depth_change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_depth_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_depth_change_log ice_depth_change_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_change_log_insert ON public.ice_depth_change_log FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('ice_depth'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: ice_depth_change_log ice_depth_change_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_change_log_select ON public.ice_depth_change_log FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: ice_depth_followup_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_depth_followup_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_depth_followup_notes ice_depth_followup_notes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_followup_notes_insert ON public.ice_depth_followup_notes FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_followup_notes ice_depth_followup_notes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_followup_notes_select ON public.ice_depth_followup_notes FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_depth'::text))));


--
-- Name: ice_depth_layouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_depth_layouts ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_depth_layouts ice_depth_layouts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_layouts_delete ON public.ice_depth_layouts FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_layouts ice_depth_layouts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_layouts_insert ON public.ice_depth_layouts FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_layouts ice_depth_layouts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_layouts_select ON public.ice_depth_layouts FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_depth'::text))));


--
-- Name: ice_depth_layouts ice_depth_layouts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_layouts_update ON public.ice_depth_layouts FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_measurements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_depth_measurements ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_depth_measurements ice_depth_measurements_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_measurements_delete ON public.ice_depth_measurements FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: ice_depth_measurements ice_depth_measurements_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_measurements_insert ON public.ice_depth_measurements FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_depth'::text))));


--
-- Name: ice_depth_measurements ice_depth_measurements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_measurements_select ON public.ice_depth_measurements FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_depth'::text))));


--
-- Name: ice_depth_measurements ice_depth_measurements_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_measurements_update ON public.ice_depth_measurements FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: ice_depth_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_depth_points ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_depth_points ice_depth_points_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_points_delete ON public.ice_depth_points FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_points ice_depth_points_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_points_insert ON public.ice_depth_points FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_points ice_depth_points_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_points_select ON public.ice_depth_points FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_depth'::text))));


--
-- Name: ice_depth_points ice_depth_points_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_points_update ON public.ice_depth_points FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_rinks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_depth_rinks ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_depth_rinks ice_depth_rinks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_rinks_delete ON public.ice_depth_rinks FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_rinks ice_depth_rinks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_rinks_insert ON public.ice_depth_rinks FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_rinks ice_depth_rinks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_rinks_select ON public.ice_depth_rinks FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_depth'::text))));


--
-- Name: ice_depth_rinks ice_depth_rinks_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_rinks_update ON public.ice_depth_rinks FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_depth_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_depth_sessions ice_depth_sessions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_sessions_delete ON public.ice_depth_sessions FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: ice_depth_sessions ice_depth_sessions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_sessions_insert ON public.ice_depth_sessions FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('ice_depth'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: ice_depth_sessions ice_depth_sessions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_sessions_select ON public.ice_depth_sessions FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_depth'::text))));


--
-- Name: ice_depth_sessions ice_depth_sessions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_sessions_update ON public.ice_depth_sessions FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: ice_depth_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_depth_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_depth_settings ice_depth_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_settings_delete ON public.ice_depth_settings FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_settings ice_depth_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_settings_insert ON public.ice_depth_settings FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_depth_settings ice_depth_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_settings_select ON public.ice_depth_settings FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_depth'::text))));


--
-- Name: ice_depth_settings ice_depth_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_depth_settings_update ON public.ice_depth_settings FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_depth'::text))));


--
-- Name: ice_operations_circle_check_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_circle_check_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_circle_check_items ice_operations_circle_check_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_items_delete ON public.ice_operations_circle_check_items FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_items ice_operations_circle_check_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_items_insert ON public.ice_operations_circle_check_items FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_items ice_operations_circle_check_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_items_select ON public.ice_operations_circle_check_items FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_items ice_operations_circle_check_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_items_update ON public.ice_operations_circle_check_items FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_circle_check_results ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_circle_check_results ice_operations_circle_check_results_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_results_delete ON public.ice_operations_circle_check_results FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: ice_operations_circle_check_results ice_operations_circle_check_results_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_results_insert ON public.ice_operations_circle_check_results FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_results ice_operations_circle_check_results_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_results_select ON public.ice_operations_circle_check_results FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_results ice_operations_circle_check_results_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_results_update ON public.ice_operations_circle_check_results FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: ice_operations_circle_check_template_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_circle_check_template_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_circle_check_template_items ice_operations_circle_check_template_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_template_items_delete ON public.ice_operations_circle_check_template_items FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_template_items ice_operations_circle_check_template_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_template_items_insert ON public.ice_operations_circle_check_template_items FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_template_items ice_operations_circle_check_template_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_template_items_select ON public.ice_operations_circle_check_template_items FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_template_items ice_operations_circle_check_template_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_template_items_update ON public.ice_operations_circle_check_template_items FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_circle_check_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_circle_check_templates ice_operations_circle_check_templates_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_templates_delete ON public.ice_operations_circle_check_templates FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_templates ice_operations_circle_check_templates_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_templates_insert ON public.ice_operations_circle_check_templates FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_templates ice_operations_circle_check_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_templates_select ON public.ice_operations_circle_check_templates FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_circle_check_templates ice_operations_circle_check_templates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_circle_check_templates_update ON public.ice_operations_circle_check_templates FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_equipment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_equipment ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_equipment ice_operations_equipment_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_equipment_delete ON public.ice_operations_equipment FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_equipment ice_operations_equipment_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_equipment_insert ON public.ice_operations_equipment FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_equipment ice_operations_equipment_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_equipment_select ON public.ice_operations_equipment FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_equipment ice_operations_equipment_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_equipment_update ON public.ice_operations_equipment FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_followup_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_followup_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_followup_notes ice_operations_followup_notes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_followup_notes_insert ON public.ice_operations_followup_notes FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_followup_notes ice_operations_followup_notes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_followup_notes_select ON public.ice_operations_followup_notes FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_fuel_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_fuel_types ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_fuel_types ice_operations_fuel_types_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_fuel_types_delete ON public.ice_operations_fuel_types FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_fuel_types ice_operations_fuel_types_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_fuel_types_insert ON public.ice_operations_fuel_types FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_fuel_types ice_operations_fuel_types_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_fuel_types_select ON public.ice_operations_fuel_types FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_fuel_types ice_operations_fuel_types_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_fuel_types_update ON public.ice_operations_fuel_types FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_rinks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_rinks ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_rinks ice_operations_rinks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_rinks_delete ON public.ice_operations_rinks FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_rinks ice_operations_rinks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_rinks_insert ON public.ice_operations_rinks FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_rinks ice_operations_rinks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_rinks_select ON public.ice_operations_rinks FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_rinks ice_operations_rinks_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_rinks_update ON public.ice_operations_rinks FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_settings ice_operations_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_settings_delete ON public.ice_operations_settings FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_settings ice_operations_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_settings_insert ON public.ice_operations_settings FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_settings ice_operations_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_settings_select ON public.ice_operations_settings FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_settings ice_operations_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_settings_update ON public.ice_operations_settings FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('ice_operations'::text))));


--
-- Name: ice_operations_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ice_operations_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: ice_operations_submissions ice_operations_submissions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_submissions_delete ON public.ice_operations_submissions FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: ice_operations_submissions ice_operations_submissions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_submissions_insert ON public.ice_operations_submissions FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('ice_operations'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: ice_operations_submissions ice_operations_submissions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_submissions_select ON public.ice_operations_submissions FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('ice_operations'::text))));


--
-- Name: ice_operations_submissions ice_operations_submissions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ice_operations_submissions_update ON public.ice_operations_submissions FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: incident_activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_activities ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_activities incident_activities_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_activities_delete ON public.incident_activities FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_activities incident_activities_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_activities_insert ON public.incident_activities FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_activities incident_activities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_activities_select ON public.incident_activities FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('incident_reports'::text))));


--
-- Name: incident_activities incident_activities_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_activities_update ON public.incident_activities FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_change_log incident_change_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_change_log_insert ON public.incident_change_log FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: incident_change_log incident_change_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_change_log_select ON public.incident_change_log FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_followup_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_followup_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_followup_notes incident_followup_notes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_followup_notes_insert ON public.incident_followup_notes FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_followup_notes incident_followup_notes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_followup_notes_select ON public.incident_followup_notes FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('incident_reports'::text) OR (public.has_module_access('incident_reports'::text) AND (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_followup_notes.incident_id) AND (r.employee_id = public.current_employee_id())))))))));


--
-- Name: incident_report_spaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_report_spaces ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_report_spaces incident_report_spaces_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_report_spaces_delete ON public.incident_report_spaces FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_report_spaces.incident_id) AND (public.has_module_admin_access('incident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: incident_report_spaces incident_report_spaces_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_report_spaces_insert ON public.incident_report_spaces FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_report_spaces.incident_id) AND (public.has_module_admin_access('incident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: incident_report_spaces incident_report_spaces_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_report_spaces_select ON public.incident_report_spaces FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('incident_reports'::text) OR (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_report_spaces.incident_id) AND (r.employee_id = public.current_employee_id()))))))));


--
-- Name: incident_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_reports incident_reports_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_reports_delete ON public.incident_reports FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: incident_reports incident_reports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_reports_insert ON public.incident_reports FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('incident_reports'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: incident_reports incident_reports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_reports_select ON public.incident_reports FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('incident_reports'::text) OR (public.has_module_access('incident_reports'::text) AND (employee_id = public.current_employee_id()))))));


--
-- Name: incident_reports incident_reports_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_reports_update ON public.incident_reports FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('incident_reports'::text) OR ((employee_id = public.current_employee_id()) AND (now() <= edit_window_ends_at)))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('incident_reports'::text) OR ((employee_id = public.current_employee_id()) AND (now() <= edit_window_ends_at))))));


--
-- Name: incident_severity_levels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_severity_levels ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_severity_levels incident_severity_levels_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_severity_levels_delete ON public.incident_severity_levels FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_severity_levels incident_severity_levels_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_severity_levels_insert ON public.incident_severity_levels FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_severity_levels incident_severity_levels_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_severity_levels_select ON public.incident_severity_levels FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('incident_reports'::text))));


--
-- Name: incident_severity_levels incident_severity_levels_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_severity_levels_update ON public.incident_severity_levels FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_types ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_types incident_types_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_types_delete ON public.incident_types FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_types incident_types_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_types_insert ON public.incident_types FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_types incident_types_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_types_select ON public.incident_types FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('incident_reports'::text))));


--
-- Name: incident_types incident_types_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_types_update ON public.incident_types FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('incident_reports'::text))));


--
-- Name: incident_witnesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_witnesses ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_witnesses incident_witnesses_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_witnesses_delete ON public.incident_witnesses FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_witnesses.incident_id) AND (public.has_module_admin_access('incident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: incident_witnesses incident_witnesses_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_witnesses_insert ON public.incident_witnesses FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_witnesses.incident_id) AND (public.has_module_admin_access('incident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: incident_witnesses incident_witnesses_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_witnesses_select ON public.incident_witnesses FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('incident_reports'::text) OR (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_witnesses.incident_id) AND (r.employee_id = public.current_employee_id()))))))));


--
-- Name: incident_witnesses incident_witnesses_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_witnesses_update ON public.incident_witnesses FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_witnesses.incident_id) AND (public.has_module_admin_access('incident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at))))))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (EXISTS ( SELECT 1
   FROM public.incident_reports r
  WHERE ((r.id = incident_witnesses.incident_id) AND (public.has_module_admin_access('incident_reports'::text) OR ((r.employee_id = public.current_employee_id()) AND (now() <= r.edit_window_ends_at)))))))));


--
-- Name: information_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.information_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: information_requests information_requests_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY information_requests_delete ON public.information_requests FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: information_requests information_requests_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY information_requests_insert ON public.information_requests FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: information_requests information_requests_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY information_requests_select ON public.information_requests FOR SELECT TO authenticated USING (public.is_super_admin());


--
-- Name: information_requests information_requests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY information_requests_update ON public.information_requests FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: job_area_certification_requirements job_area_cert_requirements_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_area_cert_requirements_delete ON public.job_area_certification_requirements FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: job_area_certification_requirements job_area_cert_requirements_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_area_cert_requirements_insert ON public.job_area_certification_requirements FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: job_area_certification_requirements job_area_cert_requirements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_area_cert_requirements_select ON public.job_area_certification_requirements FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text))));


--
-- Name: job_area_certification_requirements job_area_cert_requirements_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_area_cert_requirements_update ON public.job_area_certification_requirements FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: job_area_certification_requirements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_area_certification_requirements ENABLE ROW LEVEL SECURITY;

--
-- Name: module_area_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.module_area_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: module_area_permissions module_area_permissions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY module_area_permissions_delete ON public.module_area_permissions FOR DELETE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: module_area_permissions module_area_permissions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY module_area_permissions_insert ON public.module_area_permissions FOR INSERT WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: module_area_permissions module_area_permissions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY module_area_permissions_select ON public.module_area_permissions FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: module_area_permissions module_area_permissions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY module_area_permissions_update ON public.module_area_permissions FOR UPDATE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: notification_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_outbox notification_outbox_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_outbox_delete ON public.notification_outbox FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: notification_outbox notification_outbox_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_outbox_insert ON public.notification_outbox FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: notification_outbox notification_outbox_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_outbox_select ON public.notification_outbox FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: notification_outbox notification_outbox_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_outbox_update ON public.notification_outbox FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('communications'::text))));


--
-- Name: offline_sync_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offline_sync_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: offline_sync_queue offline_sync_queue_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY offline_sync_queue_delete ON public.offline_sync_queue FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: offline_sync_queue offline_sync_queue_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY offline_sync_queue_insert ON public.offline_sync_queue FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (employee_id IN ( SELECT employees.id
   FROM public.employees
  WHERE ((employees.user_id = ( SELECT auth.uid() AS uid)) AND (employees.is_active = true)))))));


--
-- Name: offline_sync_queue offline_sync_queue_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY offline_sync_queue_select ON public.offline_sync_queue FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND ((employee_id IN ( SELECT employees.id
   FROM public.employees
  WHERE ((employees.user_id = ( SELECT auth.uid() AS uid)) AND (employees.is_active = true)))) OR (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));


--
-- Name: offline_sync_queue offline_sync_queue_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY offline_sync_queue_update ON public.offline_sync_queue FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (employee_id IN ( SELECT employees.id
   FROM public.employees
  WHERE ((employees.user_id = ( SELECT auth.uid() AS uid)) AND (employees.is_active = true))))))) WITH CHECK ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: profile_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_audit_log profile_audit_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_audit_log_insert ON public.profile_audit_log FOR INSERT TO authenticated WITH CHECK (((edited_by = ( SELECT auth.uid() AS uid)) AND public.can_edit_user_profile(target_user_id)));


--
-- Name: profile_audit_log profile_audit_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profile_audit_log_select ON public.profile_audit_log FOR SELECT TO authenticated USING ((public.is_super_admin() OR public.is_facility_admin(facility_id) OR (target_user_id = ( SELECT auth.uid() AS uid)) OR (edited_by = ( SELECT auth.uid() AS uid))));


--
-- Name: rate_limit_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_change_log refrigeration_change_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_change_log_insert ON public.refrigeration_change_log FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('refrigeration'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: refrigeration_change_log refrigeration_change_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_change_log_select ON public.refrigeration_change_log FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: refrigeration_equipment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_equipment ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_equipment refrigeration_equipment_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_equipment_delete ON public.refrigeration_equipment FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_equipment refrigeration_equipment_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_equipment_insert ON public.refrigeration_equipment FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_equipment refrigeration_equipment_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_equipment_select ON public.refrigeration_equipment FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('refrigeration'::text))));


--
-- Name: refrigeration_equipment refrigeration_equipment_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_equipment_update ON public.refrigeration_equipment FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_fields; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_fields refrigeration_fields_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_fields_delete ON public.refrigeration_fields FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_fields refrigeration_fields_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_fields_insert ON public.refrigeration_fields FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_fields refrigeration_fields_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_fields_select ON public.refrigeration_fields FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('refrigeration'::text))));


--
-- Name: refrigeration_fields refrigeration_fields_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_fields_update ON public.refrigeration_fields FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_followup_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_followup_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_followup_notes refrigeration_followup_notes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_followup_notes_insert ON public.refrigeration_followup_notes FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('refrigeration'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: refrigeration_followup_notes refrigeration_followup_notes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_followup_notes_select ON public.refrigeration_followup_notes FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('refrigeration'::text))));


--
-- Name: refrigeration_report_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_report_values ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_report_values refrigeration_report_values_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_report_values_delete ON public.refrigeration_report_values FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: refrigeration_report_values refrigeration_report_values_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_report_values_insert ON public.refrigeration_report_values FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('refrigeration'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: refrigeration_report_values refrigeration_report_values_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_report_values_select ON public.refrigeration_report_values FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('refrigeration'::text))));


--
-- Name: refrigeration_report_values refrigeration_report_values_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_report_values_update ON public.refrigeration_report_values FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: refrigeration_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_reports refrigeration_reports_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_reports_delete ON public.refrigeration_reports FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: refrigeration_reports refrigeration_reports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_reports_insert ON public.refrigeration_reports FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('refrigeration'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: refrigeration_reports refrigeration_reports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_reports_select ON public.refrigeration_reports FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('refrigeration'::text))));


--
-- Name: refrigeration_reports refrigeration_reports_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_reports_update ON public.refrigeration_reports FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: refrigeration_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_sections refrigeration_sections_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_sections_delete ON public.refrigeration_sections FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_sections refrigeration_sections_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_sections_insert ON public.refrigeration_sections FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_sections refrigeration_sections_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_sections_select ON public.refrigeration_sections FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('refrigeration'::text))));


--
-- Name: refrigeration_sections refrigeration_sections_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_sections_update ON public.refrigeration_sections FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_settings refrigeration_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_settings_delete ON public.refrigeration_settings FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_settings refrigeration_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_settings_insert ON public.refrigeration_settings FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_settings refrigeration_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_settings_select ON public.refrigeration_settings FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('refrigeration'::text))));


--
-- Name: refrigeration_settings refrigeration_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_settings_update ON public.refrigeration_settings FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_thresholds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refrigeration_thresholds ENABLE ROW LEVEL SECURITY;

--
-- Name: refrigeration_thresholds refrigeration_thresholds_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_thresholds_delete ON public.refrigeration_thresholds FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_thresholds refrigeration_thresholds_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_thresholds_insert ON public.refrigeration_thresholds FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: refrigeration_thresholds refrigeration_thresholds_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_thresholds_select ON public.refrigeration_thresholds FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('refrigeration'::text))));


--
-- Name: refrigeration_thresholds refrigeration_thresholds_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refrigeration_thresholds_update ON public.refrigeration_thresholds FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('refrigeration'::text))));


--
-- Name: retention_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.retention_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: retention_settings retention_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY retention_settings_delete ON public.retention_settings FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: retention_settings retention_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY retention_settings_insert ON public.retention_settings FOR INSERT WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: retention_settings retention_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY retention_settings_select ON public.retention_settings FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: retention_settings retention_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY retention_settings_update ON public.retention_settings FOR UPDATE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: role_module_permission_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_module_permission_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: role_module_permission_defaults role_mp_defaults_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_mp_defaults_delete ON public.role_module_permission_defaults FOR DELETE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: role_module_permission_defaults role_mp_defaults_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_mp_defaults_insert ON public.role_module_permission_defaults FOR INSERT WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: role_module_permission_defaults role_mp_defaults_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_mp_defaults_select ON public.role_module_permission_defaults FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: role_module_permission_defaults role_mp_defaults_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_mp_defaults_update ON public.role_module_permission_defaults FOR UPDATE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: role_permission_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_permission_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permission_defaults role_permission_defaults_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_permission_defaults_delete ON public.role_permission_defaults FOR DELETE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'gm'::text, 'super_admin'::text])))));


--
-- Name: role_permission_defaults role_permission_defaults_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_permission_defaults_insert ON public.role_permission_defaults FOR INSERT WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'gm'::text, 'super_admin'::text])))));


--
-- Name: role_permission_defaults role_permission_defaults_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_permission_defaults_select ON public.role_permission_defaults FOR SELECT USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: role_permission_defaults role_permission_defaults_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_permission_defaults_update ON public.role_permission_defaults FOR UPDATE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'gm'::text, 'super_admin'::text]))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'gm'::text, 'super_admin'::text])))));


--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: roles roles_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_delete ON public.roles FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: roles roles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_insert ON public.roles FOR INSERT WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: roles roles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_select ON public.roles FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id())));


--
-- Name: roles roles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_update ON public.roles FOR UPDATE USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text])))));


--
-- Name: schedule_assignment_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_assignment_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_assignment_overrides schedule_assignment_overrides_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_assignment_overrides_select ON public.schedule_assignment_overrides FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_availability schedule_availability_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_availability_delete ON public.schedule_availability FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR ((employee_id = public.current_employee_id()) AND (facility_id = public.current_facility_id()))));


--
-- Name: schedule_availability schedule_availability_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_availability_insert ON public.schedule_availability FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR ((employee_id = public.current_employee_id()) AND (facility_id = public.current_facility_id()))));


--
-- Name: schedule_availability schedule_availability_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_availability_select ON public.schedule_availability FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR (employee_id = public.current_employee_id())));


--
-- Name: schedule_availability schedule_availability_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_availability_update ON public.schedule_availability FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR ((employee_id = public.current_employee_id()) AND (facility_id = public.current_facility_id())))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR ((employee_id = public.current_employee_id()) AND (facility_id = public.current_facility_id()))));


--
-- Name: schedule_compliance_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_compliance_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_compliance_rules schedule_compliance_rules_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_compliance_rules_delete ON public.schedule_compliance_rules FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_compliance_rules schedule_compliance_rules_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_compliance_rules_insert ON public.schedule_compliance_rules FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_compliance_rules schedule_compliance_rules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_compliance_rules_select ON public.schedule_compliance_rules FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text))));


--
-- Name: schedule_compliance_rules schedule_compliance_rules_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_compliance_rules_update ON public.schedule_compliance_rules FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_ics_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_ics_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_ics_tokens schedule_ics_tokens_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_ics_tokens_delete ON public.schedule_ics_tokens FOR DELETE TO authenticated USING ((employee_id = public.current_employee_id()));


--
-- Name: schedule_ics_tokens schedule_ics_tokens_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_ics_tokens_insert ON public.schedule_ics_tokens FOR INSERT TO authenticated WITH CHECK (((employee_id = public.current_employee_id()) AND (facility_id = public.current_facility_id())));


--
-- Name: schedule_ics_tokens schedule_ics_tokens_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_ics_tokens_select ON public.schedule_ics_tokens FOR SELECT TO authenticated USING ((employee_id = public.current_employee_id()));


--
-- Name: schedule_ics_tokens schedule_ics_tokens_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_ics_tokens_update ON public.schedule_ics_tokens FOR UPDATE TO authenticated USING ((employee_id = public.current_employee_id())) WITH CHECK (((employee_id = public.current_employee_id()) AND (facility_id = public.current_facility_id())));


--
-- Name: schedule_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_notifications schedule_notifications_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_notifications_delete ON public.schedule_notifications FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_notifications schedule_notifications_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_notifications_insert ON public.schedule_notifications FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_notifications schedule_notifications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_notifications_select ON public.schedule_notifications FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR (employee_id = public.current_employee_id())));


--
-- Name: schedule_notifications schedule_notifications_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_notifications_update ON public.schedule_notifications FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR (employee_id = public.current_employee_id()))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR (employee_id = public.current_employee_id())));


--
-- Name: schedule_open_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_open_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_open_shifts schedule_open_shifts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_open_shifts_delete ON public.schedule_open_shifts FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_open_shifts schedule_open_shifts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_open_shifts_insert ON public.schedule_open_shifts FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('scheduling'::text) >= 'submit'::public.module_permission_level))));


--
-- Name: schedule_open_shifts schedule_open_shifts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_open_shifts_select ON public.schedule_open_shifts FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text))));


--
-- Name: schedule_open_shifts schedule_open_shifts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_open_shifts_update ON public.schedule_open_shifts FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_publish_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_publish_events ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_publish_events schedule_publish_events_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_publish_events_insert ON public.schedule_publish_events FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_publish_events schedule_publish_events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_publish_events_select ON public.schedule_publish_events FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_publish_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_publish_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_publish_requests schedule_publish_requests_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_publish_requests_insert ON public.schedule_publish_requests FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('scheduling'::text) >= 'submit'::public.module_permission_level) AND (requested_by_employee_id = public.current_employee_id()) AND (status = 'pending'::public.schedule_publish_request_status) AND (decided_by_employee_id IS NULL) AND (decided_at IS NULL))));


--
-- Name: schedule_publish_requests schedule_publish_requests_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_publish_requests_select ON public.schedule_publish_requests FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('scheduling'::text) >= 'view'::public.module_permission_level))));


--
-- Name: schedule_publish_requests schedule_publish_requests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_publish_requests_update ON public.schedule_publish_requests FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('scheduling'::text) >= 'publish'::public.module_permission_level) AND (requested_by_employee_id <> public.current_employee_id()) AND (status = 'pending'::public.schedule_publish_request_status)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_employee_module_permission('scheduling'::text) >= 'publish'::public.module_permission_level) AND (requested_by_employee_id <> public.current_employee_id()) AND (status = ANY (ARRAY['published'::public.schedule_publish_request_status, 'rejected'::public.schedule_publish_request_status])) AND (decided_by_employee_id = public.current_employee_id()))));


--
-- Name: schedule_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_settings schedule_settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_settings_delete ON public.schedule_settings FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_settings schedule_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_settings_insert ON public.schedule_settings FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_settings schedule_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_settings_select ON public.schedule_settings FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text))));


--
-- Name: schedule_settings schedule_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_settings_update ON public.schedule_settings FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_shifts schedule_shifts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_shifts_delete ON public.schedule_shifts FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_shifts schedule_shifts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_shifts_insert ON public.schedule_shifts FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_shifts schedule_shifts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_shifts_select ON public.schedule_shifts FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text) AND (status <> 'draft'::text))));


--
-- Name: schedule_shifts schedule_shifts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_shifts_update ON public.schedule_shifts FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_swap_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_swap_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_swap_requests schedule_swap_requests_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_swap_requests_delete ON public.schedule_swap_requests FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_swap_requests schedule_swap_requests_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_swap_requests_insert ON public.schedule_swap_requests FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND ((requester_employee_id = public.current_employee_id()) OR (public.current_employee_module_permission('scheduling'::text) >= 'submit'::public.module_permission_level)))));


--
-- Name: schedule_swap_requests schedule_swap_requests_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_swap_requests_select ON public.schedule_swap_requests FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text) AND ((requester_employee_id = public.current_employee_id()) OR (target_employee_id = public.current_employee_id()))) OR ((facility_id = public.current_facility_id()) AND ((requester_employee_id = public.current_employee_id()) OR (target_employee_id = public.current_employee_id())))));


--
-- Name: schedule_swap_requests schedule_swap_requests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_swap_requests_update ON public.schedule_swap_requests FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR ((requester_employee_id = public.current_employee_id()) AND (status = ANY (ARRAY['pending'::text, 'accepted'::text]))) OR ((target_employee_id = public.current_employee_id()) AND (status = 'pending'::text)))))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.has_module_admin_access('scheduling'::text) OR ((requester_employee_id = public.current_employee_id()) AND (status = 'cancelled'::text)) OR ((target_employee_id = public.current_employee_id()) AND (status = ANY (ARRAY['accepted'::text, 'denied'::text])))))));


--
-- Name: schedule_template_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_template_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_template_shifts schedule_template_shifts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_template_shifts_delete ON public.schedule_template_shifts FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_template_shifts schedule_template_shifts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_template_shifts_insert ON public.schedule_template_shifts FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_template_shifts schedule_template_shifts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_template_shifts_select ON public.schedule_template_shifts FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text))));


--
-- Name: schedule_template_shifts schedule_template_shifts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_template_shifts_update ON public.schedule_template_shifts FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_templates schedule_templates_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_templates_delete ON public.schedule_templates FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_templates schedule_templates_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_templates_insert ON public.schedule_templates FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_templates schedule_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_templates_select ON public.schedule_templates FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_access('scheduling'::text))));


--
-- Name: schedule_templates schedule_templates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_templates_update ON public.schedule_templates FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_time_off_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_time_off_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_time_off_requests schedule_time_off_requests_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_time_off_requests_delete ON public.schedule_time_off_requests FOR DELETE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text))));


--
-- Name: schedule_time_off_requests schedule_time_off_requests_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_time_off_requests_insert ON public.schedule_time_off_requests FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (((employee_id = public.current_employee_id()) AND (status = 'pending'::text)) OR (public.current_employee_module_permission('scheduling'::text) >= 'submit'::public.module_permission_level)))));


--
-- Name: schedule_time_off_requests schedule_time_off_requests_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_time_off_requests_select ON public.schedule_time_off_requests FOR SELECT TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR (employee_id = public.current_employee_id())));


--
-- Name: schedule_time_off_requests schedule_time_off_requests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_time_off_requests_update ON public.schedule_time_off_requests FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR (employee_id = public.current_employee_id()))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND public.has_module_admin_access('scheduling'::text)) OR (employee_id = public.current_employee_id())));


--
-- Name: user_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions user_permissions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_permissions_delete ON public.user_permissions FOR DELETE TO authenticated USING ((public.is_super_admin() OR public.is_facility_admin(facility_id)));


--
-- Name: user_permissions user_permissions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_permissions_insert ON public.user_permissions FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR public.is_facility_admin(facility_id)));


--
-- Name: user_permissions user_permissions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_permissions_select ON public.user_permissions FOR SELECT TO authenticated USING ((public.is_super_admin() OR (user_id = ( SELECT auth.uid() AS uid)) OR public.is_facility_admin(facility_id)));


--
-- Name: user_permissions user_permissions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_permissions_update ON public.user_permissions FOR UPDATE TO authenticated USING ((public.is_super_admin() OR public.is_facility_admin(facility_id))) WITH CHECK ((public.is_super_admin() OR public.is_facility_admin(facility_id)));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_delete ON public.users FOR DELETE TO authenticated USING (public.is_super_admin());


--
-- Name: users users_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert ON public.users FOR INSERT TO authenticated WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))) OR ((id = ( SELECT auth.uid() AS uid)) AND (facility_id IS NULL) AND (is_super_admin = false))));


--
-- Name: users users_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select ON public.users FOR SELECT TO authenticated USING ((public.is_super_admin() OR (facility_id = public.current_facility_id()) OR (id = ( SELECT auth.uid() AS uid))));


--
-- Name: users users_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated USING ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))) OR (id = ( SELECT auth.uid() AS uid)) OR public.can_edit_user_profile(id))) WITH CHECK ((public.is_super_admin() OR ((facility_id = public.current_facility_id()) AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'super_admin'::text]))) OR (id = ( SELECT auth.uid() AS uid)) OR public.can_edit_user_profile(id)));


--
-- PostgreSQL database dump complete
--


