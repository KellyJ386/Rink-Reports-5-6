-- =============================================================================
-- 00000000000103_incident_reports_redesign_columns.sql
-- Incident Report redesign: new columns on incident_reports + a 24h submitter
-- edit window (mirrors accident_reports), and an UPDATE policy that lets the
-- submitter edit their own report while inside that window.
--
-- Retained-but-no-longer-populated by the new form: incident_type_id, location.
-- (Kept so existing rows/history remain valid.)
-- =============================================================================

alter table public.incident_reports
  add column if not exists edit_window_ends_at timestamptz not null
    default (now() + interval '24 hours'),
  add column if not exists activity_id uuid
    references public.incident_activities(id) on delete set null,
  add column if not exists activity_other text,
  add column if not exists location_other text,
  add column if not exists immediate_actions text;

comment on column public.incident_reports.edit_window_ends_at is
  'Submitter may edit their own report while now() <= edit_window_ends_at (24h default). Outside the window only admins may update; changes are logged in incident_change_log.';
comment on column public.incident_reports.activity_id is
  'FK to incident_activities (admin-managed). Optional. "Other" is captured in activity_other.';
comment on column public.incident_reports.activity_other is
  'Free text when the reporter chose "Other" for activity.';
comment on column public.incident_reports.location_other is
  'Free text when the reporter chose "Other" among facility spaces. Selected spaces live in incident_report_spaces.';
comment on column public.incident_reports.immediate_actions is
  'Optional: immediate actions taken right after the incident.';

create index if not exists idx_incident_reports_activity
  on public.incident_reports (activity_id);

-- -----------------------------------------------------------------------------
-- Replace the admin-only UPDATE policy with one that also allows the submitter
-- to edit their own report while within the edit window (mirror accidents).
-- -----------------------------------------------------------------------------
drop policy if exists incident_reports_update on public.incident_reports;
create policy incident_reports_update on public.incident_reports
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('incident_reports')
        or (
          employee_id = public.current_employee_id()
          and now() <= edit_window_ends_at
        )
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('incident_reports')
        or (
          employee_id = public.current_employee_id()
          and now() <= edit_window_ends_at
        )
      )
    )
  );
