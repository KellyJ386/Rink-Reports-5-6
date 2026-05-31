-- 00000000000089_daily_area_submit_enforcement.sql
--
-- Makes module_area_permissions a real per-area SUBMIT boundary for Daily
-- Reports, enforced server-side via RLS.
--
-- Recon (live DB) found the boundary was only half-enforced:
--   * SELECT already checks per-area via has_area_access() (can_view).
--   * INSERT only checked module-level submit — NO area check. A user with
--     module-level daily submit could insert a submission for ANY area.
-- This migration adds has_area_submit_access() (can_submit) and ANDs it into
-- the daily_report_submissions INSERT policy. Admin / super_admin bypass.
--
-- It also switches the daily policies off the deprecated module_permissions
-- table (has_module_access, frozen by migration 77) to the user_permissions
-- resolver current_employee_module_permission(), preserving the same levels.
--
-- BACKFILL (signed off): grants can_view + can_submit on every active daily
-- area to every active employee who currently holds module-level daily submit,
-- so nobody is locked out the moment enforcement ships. Admins then tighten.

begin;

-- ---------------------------------------------------------------------------
-- 1. Per-area SUBMIT helper (mirrors has_area_access, but checks can_submit).
--    SECURITY DEFINER so it can read module_area_permissions without recursing
--    through that table's own RLS.
-- ---------------------------------------------------------------------------
create or replace function public.has_area_submit_access(
  p_module_key text,
  p_area_id    uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    p_module_key is not null
    and p_area_id is not null
    and (
      public.is_super_admin()
      or public.has_module_admin_access(p_module_key)
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
    );
$$;

comment on function public.has_area_submit_access(text, uuid) is
  'True iff the caller may SUBMIT in the given area for the module (per-area can_submit), or is a module/super admin. SECURITY DEFINER to avoid recursing into module_area_permissions RLS.';

revoke execute on function public.has_area_submit_access(text, uuid) from public, anon;
grant  execute on function public.has_area_submit_access(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. daily_report_submissions INSERT: require module submit AND area submit.
-- ---------------------------------------------------------------------------
drop policy if exists daily_report_submissions_insert on public.daily_report_submissions;
create policy daily_report_submissions_insert on public.daily_report_submissions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('daily_reports')
            >= 'submit'::public.module_permission_level
      and public.has_area_submit_access('daily_reports', area_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. daily_report_submissions SELECT: same shape, but read the view level from
--    user_permissions instead of the deprecated module_permissions table.
-- ---------------------------------------------------------------------------
drop policy if exists daily_report_submissions_select on public.daily_report_submissions;
create policy daily_report_submissions_select on public.daily_report_submissions
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or (
          public.current_employee_module_permission('daily_reports')
            >= 'view'::public.module_permission_level
          and public.has_area_access('daily_reports', area_id)
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. daily_report_submission_items INSERT: switch off the deprecated table
--    (same view level). The parent submission INSERT carries the area gate.
-- ---------------------------------------------------------------------------
drop policy if exists daily_report_submission_items_insert on public.daily_report_submission_items;
create policy daily_report_submission_items_insert on public.daily_report_submission_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.current_employee_module_permission('daily_reports')
            >= 'view'::public.module_permission_level
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Backfill: everyone who can currently submit daily reports keeps view +
--    submit on every active area, so enforcement does not lock anyone out.
-- ---------------------------------------------------------------------------
insert into public.module_area_permissions
  (facility_id, employee_id, module_key, area_id, can_view, can_submit)
select e.facility_id, e.id, 'daily_reports', a.id, true, true
from public.employees e
join public.daily_report_areas a
  on a.facility_id = e.facility_id and a.is_active = true
where e.is_active = true
  and e.user_id is not null
  and exists (
    select 1 from public.user_permissions up
    where up.user_id     = e.user_id
      and up.facility_id = e.facility_id
      and up.module_name = 'daily_reports'
      and up.action      = 'submit'
      and up.enabled     = true
  )
on conflict (employee_id, module_key, area_id) do nothing;

commit;
