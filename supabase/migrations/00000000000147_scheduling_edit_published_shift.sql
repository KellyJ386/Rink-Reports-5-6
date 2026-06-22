-- =============================================================================
-- 00000000000147_scheduling_edit_published_shift.sql
--
-- Governed "republish" edit for a PUBLISHED shift. Migration 146 froze
-- published shifts at the DB boundary (direct UPDATE/DELETE from an end-user
-- role is rejected). That left cancel as the only governed change; this adds
-- the explicit, audited edit path the spec calls for ("edits require an
-- explicit republish by a facility_manager+, enforced server-side").
--
-- scheduling_admin_edit_published_shift():
--   * scheduling-admin gated + facility-scoped, SECURITY DEFINER (so it can
--     write through the publish-lock),
--   * only touches a shift whose status is 'published',
--   * hard-blocks on a missing/expired required cert unless p_override_cert is
--     passed, in which case it records the override via the same audited writer
--     (scheduling_log_cert_override) — so even a crafted direct RPC call is
--     gated + logged the same way the grid is,
--   * applies the full new field set, re-stamps the publish metadata, and
--     notifies the affected employee(s) that their published shift changed,
--   * the double-booking exclusion constraint (migration 140) remains the
--     backstop for overlaps.
-- =============================================================================

create or replace function public.scheduling_admin_edit_published_shift(
  p_shift_id      uuid,
  p_employee_id   uuid,
  p_job_area_id   uuid,
  p_starts_at     timestamptz,
  p_ends_at       timestamptz,
  p_break_minutes int,
  p_role_label    text,
  p_notes         text,
  p_override_cert boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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

comment on function public.scheduling_admin_edit_published_shift(uuid, uuid, uuid, timestamptz, timestamptz, int, text, text, boolean, text) is
  'Governed republish-edit of a PUBLISHED shift. Scheduling-admin gated + facility-scoped, SECURITY DEFINER (writes through the publish-lock). Hard-blocks a missing/expired required cert unless p_override_cert (then logged via scheduling_log_cert_override). Applies the full field set, re-stamps publish metadata, notifies affected employees. Returns jsonb {ok, error?, violations?}.';

revoke execute on function public.scheduling_admin_edit_published_shift(uuid, uuid, uuid, timestamptz, timestamptz, int, text, text, boolean, text) from public, anon;
grant  execute on function public.scheduling_admin_edit_published_shift(uuid, uuid, uuid, timestamptz, timestamptz, int, text, text, boolean, text) to authenticated, service_role;
