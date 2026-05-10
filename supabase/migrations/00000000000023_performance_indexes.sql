-- Compound indexes on the three highest-traffic query patterns identified
-- during audit: report listing (facility + date), incident filtering
-- (facility + status + date), and schedule shift queries (facility + status + time).

create index if not exists idx_daily_report_submissions_facility_created
  on public.daily_report_submissions(facility_id, created_at desc);

create index if not exists idx_incident_reports_facility_status_created
  on public.incident_reports(facility_id, status, created_at desc);

create index if not exists idx_schedule_shifts_facility_status_start
  on public.schedule_shifts(facility_id, status, starts_at);
