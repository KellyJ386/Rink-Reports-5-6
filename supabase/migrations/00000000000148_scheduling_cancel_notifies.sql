-- =============================================================================
-- 00000000000148_scheduling_cancel_notifies.sql
--
-- scheduling_admin_cancel_shift (migration 146) cancelled silently — unlike the
-- edit/claim/decide flows, the affected employee was never told. Re-create it
-- (same signature) so a cancel notifies the assigned employee, matching
-- scheduling_admin_edit_published_shift (migration 147). Uses notification_type
-- 'shift_changed' (an allowed value in the migration-15 check; 'shift_cancelled'
-- is not, so we don't touch the constraint).
-- =============================================================================

create or replace function public.scheduling_admin_cancel_shift(p_shift_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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

comment on function public.scheduling_admin_cancel_shift(uuid) is
  'Admin cancel of a shift (draft or published). SECURITY DEFINER so a published shift can be cancelled through this governed path while the publish-lock trigger still rejects direct edits. Facility-scoped + scheduling-admin gated. Notifies the assigned employee (shift_changed) when the cancelled shift had one.';

revoke execute on function public.scheduling_admin_cancel_shift(uuid) from public, anon;
grant  execute on function public.scheduling_admin_cancel_shift(uuid) to authenticated, service_role;
