-- =============================================================================
-- 00000000000183_daily_area_assignment_rls.sql
-- Daily Reports: area assignment & routing — Phase 2 (RLS).
--
-- Implements the gate-approved visibility model
-- (docs/daily-area-assignment-discovery.md §10, §12) on top of the Phase 1
-- tables (migration 182):
--
--   * daily_area_assignment_allows(area, date): a staff user may work a daily
--     area on a date iff routing is disabled for the facility, OR the area has
--     no active assignment that date (open area), OR an active assignment
--     names them. Legacy rows with NULL business_date are always open.
--   * has_module_edit_access(module): the `edit` action in user_permissions —
--     the "can route staff without being module admin" tier. The canonical
--     role defaults already grant daily_reports/edit to manager, admin and
--     supervisor-type roles (migrations 82/97/175), so no new seeding is
--     needed.
--   * daily_report_submissions SELECT/INSERT gain the assignment conjunct on
--     their staff branch only; super admins, module admins, and edit holders
--     are unaffected. Child tables (submission_items, notes) inherit through
--     their existing EXISTS-on-parent policies.
--   * A BEFORE INSERT trigger stamps business_date from the facility timezone
--     when the client omits it. Without this, a crafted PostgREST insert with
--     business_date = NULL would ride the legacy-open branch past the
--     assignment gate (the app always sets it; RLS must not trust that).
--     WITH CHECK evaluates the post-trigger row, so the stamped value is what
--     the policy sees.
--   * Policies for the five Phase 1 tables. Assignment rows are
--     supersede-only: no DELETE policy exists for any role. Snapshots accept
--     no client writes at all — the Phase 5 day-close SECURITY DEFINER
--     function is their only writer.
--
-- Adversarial coverage: supabase/tests/rls_isolation.sql section "DAR"
-- (added in the same commit) proves staff-vs-staff blocking, revert-to-open
-- on supersede, multi-assignee, edit/admin bypass, flag-off behavior, legacy
-- NULL-date visibility, snapshot immutability, and cross-facility isolation
-- on all five tables.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. has_module_edit_access(module_key) -> bool
--    Mirrors has_module_admin_access (migration 91) for the `edit` action.
-- ---------------------------------------------------------------------------
create or replace function public.has_module_edit_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
           and up.action      = 'edit'::public.user_action
           and up.enabled     = true
      )
    );
$$;

comment on function public.has_module_edit_access(text) is
  'True if super admin OR the current user has an enabled `edit` grant on the named module '
  'at their current facility (public.user_permissions). The elevated-but-not-admin tier used '
  'by daily-report assignment routing (assign/reassign + visibility bypass).';

revoke execute on function public.has_module_edit_access(text) from public, anon;
grant  execute on function public.has_module_edit_access(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. daily_area_assignment_allows(area_id, date) -> bool
--    SECURITY DEFINER so the submissions policies can consult
--    daily_report_settings / report_area_assignments without recursing into
--    those tables' own RLS (same pattern as has_area_access, migration 91).
-- ---------------------------------------------------------------------------
create or replace function public.daily_area_assignment_allows(
  p_area_id uuid,
  p_date    date
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_area_id is not null
    and (
      -- Legacy / pre-feature rows carry no business_date: always open.
      p_date is null
      -- Routing disabled (no settings row, or flag off): every area is open.
      or not exists (
        select 1
          from public.daily_report_settings s
         where s.facility_id = public.current_facility_id()
           and s.assignment_routing_enabled = true
      )
      -- D4: no ACTIVE assignment for this area+date -> open to all permitted staff.
      or not exists (
        select 1
          from public.report_area_assignments a
         where a.facility_id  = public.current_facility_id()
           and a.area_id      = p_area_id
           and a.report_date  = p_date
           and a.superseded_at is null
      )
      -- An active assignment names the caller.
      or exists (
        select 1
          from public.report_area_assignments a
          join public.employees e on e.id = a.employee_id
         where a.facility_id  = public.current_facility_id()
           and a.area_id      = p_area_id
           and a.report_date  = p_date
           and a.superseded_at is null
           and e.user_id      = auth.uid()
           and e.is_active    = true
      )
    );
$$;

comment on function public.daily_area_assignment_allows(uuid, date) is
  'Daily Reports routing (D10/D4): true iff the caller may work the given area on the given '
  'business date — routing disabled, area open (no active assignment that date), assignment '
  'names the caller, or NULL date (legacy row). Admin/edit bypass lives in the policies, not '
  'here. SECURITY DEFINER to avoid recursing into the routing tables'' own RLS.';

revoke execute on function public.daily_area_assignment_allows(uuid, date) from public, anon;
grant  execute on function public.daily_area_assignment_allows(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stamp business_date server-side when the client omits it. The app
--    (persistDaily) always sends it; this closes the NULL-date bypass of the
--    assignment gate for direct PostgREST writes and backfills data quality.
-- ---------------------------------------------------------------------------
create or replace function public.daily_report_submissions_stamp_business_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.business_date is null then
    select (coalesce(new.submitted_at, now())
              at time zone coalesce(f.timezone, 'UTC'))::date
      into new.business_date
      from public.facilities f
     where f.id = new.facility_id;
  end if;
  return new;
end;
$$;

comment on function public.daily_report_submissions_stamp_business_date() is
  'BEFORE INSERT: fills daily_report_submissions.business_date from the facility timezone when '
  'the client omitted it, so the assignment-routing RLS (which keys on business_date) cannot be '
  'bypassed by a crafted NULL-date insert.';

drop trigger if exists trg_daily_report_submissions_stamp_business_date
  on public.daily_report_submissions;
create trigger trg_daily_report_submissions_stamp_business_date
  before insert on public.daily_report_submissions
  for each row execute function public.daily_report_submissions_stamp_business_date();

-- ---------------------------------------------------------------------------
-- 4. daily_report_submissions: add the assignment conjunct to the staff
--    branch of SELECT (from migration 90) and INSERT (from migration 90).
--    Everything else is byte-identical to the previous policies.
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
          and (
            public.has_module_edit_access('daily_reports')
            or public.daily_area_assignment_allows(area_id, business_date)
          )
        )
      )
    )
  );

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
      and (
        public.has_module_edit_access('daily_reports')
        or public.daily_area_assignment_allows(area_id, business_date)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. report_area_assignments
--    SELECT: module view (staff must see the day's assignment map to render
--            "My Areas" vs "Open areas"; assignment metadata is not tab data).
--    INSERT/UPDATE: module edit or admin, facility-scoped, and the target
--            employee must belong to the same facility (mirrors migration 68's
--            member-facility-match hardening).
--    DELETE: nobody — reassignment supersedes, history is never deleted.
-- ---------------------------------------------------------------------------
drop policy if exists report_area_assignments_select on public.report_area_assignments;
create policy report_area_assignments_select on public.report_area_assignments
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists report_area_assignments_insert on public.report_area_assignments;
create policy report_area_assignments_insert on public.report_area_assignments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or public.has_module_edit_access('daily_reports')
      )
      and exists (
        select 1
          from public.employees e
         where e.id = employee_id
           and e.facility_id = report_area_assignments.facility_id
      )
    )
  );

drop policy if exists report_area_assignments_update on public.report_area_assignments;
create policy report_area_assignments_update on public.report_area_assignments
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or public.has_module_edit_access('daily_reports')
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or public.has_module_edit_access('daily_reports')
      )
      and exists (
        select 1
          from public.employees e
         where e.id = employee_id
           and e.facility_id = report_area_assignments.facility_id
      )
    )
  );

-- (no DELETE policy: supersede-don't-delete; retention runs as service_role)

-- ---------------------------------------------------------------------------
-- 6. area_default_owners
--    SELECT: module view. Writes: module admin only (Admin Control Center
--    config, per the plan; day-to-day routing uses report_area_assignments).
-- ---------------------------------------------------------------------------
drop policy if exists area_default_owners_select on public.area_default_owners;
create policy area_default_owners_select on public.area_default_owners
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists area_default_owners_insert on public.area_default_owners;
create policy area_default_owners_insert on public.area_default_owners
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
      and exists (
        select 1
          from public.employees e
         where e.id = employee_id
           and e.facility_id = area_default_owners.facility_id
      )
    )
  );

drop policy if exists area_default_owners_delete on public.area_default_owners;
create policy area_default_owners_delete on public.area_default_owners
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- (no UPDATE policy: rows are (area, employee) pairs — config UIs add/remove)

-- ---------------------------------------------------------------------------
-- 7. daily_area_job_area_map
--    SELECT: module view. Writes: daily module admin only. The with-check
--    subqueries intentionally require the writer to SEE both endpoints
--    (daily_report_areas via daily view, employee_job_areas via scheduling
--    view) — configuring the bridge requires visibility into both catalogs,
--    and this blocks cross-facility ids by construction.
-- ---------------------------------------------------------------------------
drop policy if exists daily_area_job_area_map_select on public.daily_area_job_area_map;
create policy daily_area_job_area_map_select on public.daily_area_job_area_map
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('daily_reports')
    )
  );

drop policy if exists daily_area_job_area_map_insert on public.daily_area_job_area_map;
create policy daily_area_job_area_map_insert on public.daily_area_job_area_map
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
      and exists (
        select 1
          from public.daily_report_areas a
         where a.id = area_id
           and a.facility_id = daily_area_job_area_map.facility_id
      )
      and exists (
        select 1
          from public.employee_job_areas j
         where j.id = job_area_id
           and j.facility_id = daily_area_job_area_map.facility_id
      )
    )
  );

drop policy if exists daily_area_job_area_map_delete on public.daily_area_job_area_map;
create policy daily_area_job_area_map_delete on public.daily_area_job_area_map
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- ---------------------------------------------------------------------------
-- 8. daily_area_assignment_snapshots
--    SELECT mirrors the submissions read model (module admin, or module view
--    + standing area access — snapshots are summary metadata for the locked
--    day view, not tab data, so the date-scoped assignment conjunct does not
--    apply). NO client writes: the Phase 5 day-close SECURITY DEFINER
--    function is the only writer.
-- ---------------------------------------------------------------------------
drop policy if exists daily_area_assignment_snapshots_select on public.daily_area_assignment_snapshots;
create policy daily_area_assignment_snapshots_select on public.daily_area_assignment_snapshots
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or (
          public.has_module_access('daily_reports')
          and public.has_area_access('daily_reports', area_id)
        )
      )
    )
  );

-- (deliberately NO insert/update/delete policies)

-- ---------------------------------------------------------------------------
-- 9. daily_report_settings
--    SELECT: any same-facility authenticated user (the flag gates UI just
--    like facility_modules, migration 144). Writes: daily module admin.
-- ---------------------------------------------------------------------------
drop policy if exists daily_report_settings_select on public.daily_report_settings;
create policy daily_report_settings_select on public.daily_report_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists daily_report_settings_insert on public.daily_report_settings;
create policy daily_report_settings_insert on public.daily_report_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

drop policy if exists daily_report_settings_update on public.daily_report_settings;
create policy daily_report_settings_update on public.daily_report_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('daily_reports')
    )
  );

-- (no DELETE policy: turn routing off via the flag, keep the threshold config)

commit;
