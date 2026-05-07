-- Returns one row per facility with the total employee count.
-- Used by loadAllFacilities() in admin/facility/page.tsx to replace the
-- previous N+1 per-facility COUNT pattern with a single aggregation query.
create or replace function get_employee_counts_by_facility()
returns table(facility_id uuid, employee_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select facility_id, count(*)::bigint as employee_count
  from employees
  group by facility_id;
$$;
