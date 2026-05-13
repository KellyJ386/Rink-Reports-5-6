-- =============================================================================
-- 00000000000051_group_member_facility_match.sql
--
-- Second-pass security review found that communication_group_members' RLS
-- policy gates only on the row's own facility_id, not on the facility of the
-- referenced group_id or employee_id. The application-layer guard in
-- addEmployeeToGroup() now verifies both, but a future code path or a direct
-- Supabase JS client call could still insert a row where:
--   - facility_id matches the caller's facility (RLS passes), but
--   - group_id belongs to another facility, OR
--   - employee_id belongs to another facility.
--
-- This trigger raises on any mismatch, BEFORE INSERT / UPDATE. Service-role
-- and SECURITY DEFINER paths are NOT exempt — we want this invariant
-- regardless of who is writing.
-- =============================================================================

create or replace function public.enforce_group_member_facility_match()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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

comment on function public.enforce_group_member_facility_match() is
  'BEFORE INSERT/UPDATE trigger: ensures the group and employee referenced '
  'by a communication_group_members row both live in the same facility as '
  'the row itself. Closes a gap in the RLS policy where only the row''s own '
  'facility_id was checked. Applies to all writers including service-role.';

drop trigger if exists trg_group_member_facility_match
  on public.communication_group_members;
create trigger trg_group_member_facility_match
  before insert or update on public.communication_group_members
  for each row execute function public.enforce_group_member_facility_match();
