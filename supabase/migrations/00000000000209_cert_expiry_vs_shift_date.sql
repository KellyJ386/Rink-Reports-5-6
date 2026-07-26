-- =============================================================================
-- 00000000000209_cert_expiry_vs_shift_date.sql
--
-- Fixes certification expiry being validated against TODAY instead of the shift
-- being assigned (prompt-library Defect 3).
--
-- THE BUG
-- -------
-- public.scheduling_assignment_violations() gates assignment on a set of checks
-- — weekly hours, availability, time-off, minimum rest, double-booking, and
-- required certifications. Every one of those uses the candidate shift's own
-- timestamps EXCEPT the certification check, which compared against
-- current_date (migration 169):
--
--     and (c.expires_at is null or c.expires_at >= current_date)
--
-- So a shift three weeks out validated against a certification expiring next
-- week, and because scheduling_approve_publish_request() re-runs the same
-- function, publish-time re-validation repeated the same mistake. Net effect:
-- an employee could be scheduled — and the schedule published — for a shift
-- they would not be certified to work when it arrived.
--
-- THE FIX AND ITS BOUNDARY
-- ------------------------
-- The predicate now keys off v_end_local, the facility-local wall-clock END of
-- the shift (already declared at 169:236 and assigned at 169:273, so no new
-- variable or lookup is needed):
--
--     and (c.expires_at is null or c.expires_at >= v_end_local::date)
--
-- Using the END rather than the START is a deliberate product decision, and is
-- recorded here because it is invisible from the predicate alone. A
-- certification that is valid when a shift begins but lapses partway through
-- BLOCKS the assignment: someone whose CPR expires at 2pm is uncertified for
-- the back half of a 6pm shift, which is precisely the situation the
-- requirement exists to prevent. Do not "simplify" this to v_start_local — the
-- straddling-shift assertion in supabase/tests/rls_isolation.sql §2Q exists to
-- make that change fail loudly.
--
-- Everything else in this file is migration 169's function body, byte for byte.
-- The signature is unchanged, so all six SQL callers
-- (scheduling_claim_open_shift, scheduling_apply_swap,
-- scheduling_decide_open_claim, scheduling_admin_assign_open_shift,
-- scheduling_admin_edit_published_shift, scheduling_approve_publish_request)
-- and the single TypeScript caller (src/app/admin/scheduling/_lib/enforcement.ts)
-- are unaffected — they already pass the shift's starts_at/ends_at.
-- =============================================================================

create or replace function public.scheduling_assignment_violations(
  p_facility_id       uuid,
  p_employee_id       uuid,
  p_starts            timestamptz,
  p_ends              timestamptz,
  p_break_minutes     int,
  p_job_area_id       uuid,
  p_exclude_shift_id  uuid,
  p_exclude_shift_id2 uuid default null
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
           and (c.expires_at is null or c.expires_at >= v_end_local::date)
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

comment on function public.scheduling_assignment_violations(uuid, uuid, timestamptz, timestamptz, int, uuid, uuid, uuid) is
  'Returns the array of hard-block violation codes for assigning an employee to a shift slot (empty = allowed). Single source of truth used by the admin server actions, the swap-apply / publish-approve / open-claim RPCs, and the staff self-claim RPC. Weekly windows and availability matching are computed on the facility''s local calendar (facilities.timezone, schedule_settings.week_start_day). Certification requirements join the certification_types catalog (id match, legacy name fallback for unlinked employee certs); a certification must be unexpired through the facility-local END of the shift, so one lapsing mid-shift is treated as missing (migration 209).';
