-- =============================================================================
-- 00000000000118_scheduling_assignment_violations.sql
-- Scheduling remediation P2: ONE hard-block validator, enforced everywhere.
--
-- public.scheduling_assignment_violations(...) returns an array of violation
-- codes for assigning a given employee to a shift slot. Empty array = allowed.
-- It is the single source of truth, called by:
--   * the TypeScript admin server actions (createShift / updateShift /
--     assignOpenShift / approveSwap / approveAndPublishRequest) via supabase.rpc
--   * the staff self-claim RPC scheduling_claim_open_shift() (rewritten below)
-- so the rules cannot drift between paths or be bypassed.
--
-- Codes: minor_overtime, overtime, break_required, min_rest_between_shifts,
--        double_booked, unavailable, time_off, not_qualified,
--        cert_missing:<cert name>.
-- Only ACTIVE schedule_compliance_rules drive the rule-based codes, so a facility
-- can disable any one (e.g. overtime) by deactivating its rule. Availability,
-- approved time-off, double-booking and certification checks are intrinsic.
-- =============================================================================

create or replace function public.scheduling_assignment_violations(
  p_facility_id      uuid,
  p_employee_id      uuid,
  p_starts           timestamptz,
  p_ends             timestamptz,
  p_break_minutes    int,
  p_job_area_id      uuid,
  p_exclude_shift_id uuid
)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_codes        text[] := '{}';
  v_settings     public.schedule_settings%rowtype;
  v_is_minor     boolean;
  v_gross_hours  numeric;
  v_this_hours   numeric;
  v_other_hours  numeric;
  v_total_hours  numeric;
  v_starts_utc   timestamp;
  v_dow          int;
  v_week_start   timestamptz;
  v_week_end     timestamptz;
  v_start_t      time;
  v_end_t        time;
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

  v_gross_hours := extract(epoch from (p_ends - p_starts)) / 3600.0;
  v_this_hours  := v_gross_hours - coalesce(p_break_minutes, 0) / 60.0;

  -- Sunday-anchored UTC week containing the shift start.
  v_starts_utc := p_starts at time zone 'UTC';
  v_dow        := extract(dow from v_starts_utc)::int;          -- 0 = Sunday
  v_week_start := ((v_starts_utc::date - v_dow)::timestamp) at time zone 'UTC';
  v_week_end   := v_week_start + interval '7 days';

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
     and (p_exclude_shift_id is null or s.id <> p_exclude_shift_id);

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
           and (p_exclude_shift_id is null or s2.id <> p_exclude_shift_id)
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
       and (p_exclude_shift_id is null or s3.id <> p_exclude_shift_id)
       and s3.starts_at < p_ends
       and s3.ends_at   > p_starts
  ) then
    v_codes := array_append(v_codes, 'double_booked');
  end if;

  -- ---- Intrinsic: unavailable block ---------------------------------------
  v_start_t := (p_starts at time zone 'UTC')::time;
  v_end_t   := (p_ends   at time zone 'UTC')::time;
  if exists (
    select 1 from public.schedule_availability a
     where a.employee_id = p_employee_id
       and a.availability_type = 'unavailable'
       and a.day_of_week = v_dow
       and a.start_time < v_end_t
       and a.end_time   > v_start_t
       and (a.effective_from is null or a.effective_from <= v_starts_utc::date)
       and (a.effective_to   is null or a.effective_to   >= v_starts_utc::date)
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
  if p_job_area_id is not null then
    for v_req in
      select cert_name
        from public.job_area_certification_requirements
       where facility_id = p_facility_id
         and job_area_id = p_job_area_id
         and is_active
    loop
      if not exists (
        select 1 from public.employee_certifications c
         where c.employee_id = p_employee_id
           and lower(btrim(c.name)) = lower(btrim(v_req.cert_name))
           and (c.expires_at is null or c.expires_at >= current_date)
      ) then
        v_codes := array_append(v_codes, 'cert_missing:' || v_req.cert_name);
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

comment on function public.scheduling_assignment_violations(uuid, uuid, timestamptz, timestamptz, int, uuid, uuid) is
  'Returns the array of hard-block violation codes for assigning an employee to a shift slot (empty = allowed). Single source of truth used by the admin server actions and the staff self-claim RPC.';

revoke execute on function public.scheduling_assignment_violations(uuid, uuid, timestamptz, timestamptz, int, uuid, uuid) from public, anon;
grant  execute on function public.scheduling_assignment_violations(uuid, uuid, timestamptz, timestamptz, int, uuid, uuid) to authenticated, service_role;

-- =============================================================================
-- Rewire the staff self-claim RPC to enforce the same hard blocks.
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

comment on function public.scheduling_claim_open_shift(uuid) is
  'Staff claim flow for an open shift. Enforces scheduling_assignment_violations() as a hard block before claiming. Honors schedule_open_shifts.approval_required. Returns true if claimed by this call, false if no longer open.';

revoke execute on function public.scheduling_claim_open_shift(uuid) from public;
grant  execute on function public.scheduling_claim_open_shift(uuid) to authenticated;
