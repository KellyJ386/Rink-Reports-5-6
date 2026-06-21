-- Daily Reports: identify a submission by its facility-local "business date" so
-- a re-submission of the same area+template on the same day updates the existing
-- report (a correction) instead of creating a duplicate. A new local day always
-- creates a fresh report; past days are therefore effectively locked because the
-- form only ever targets today's date.
--
-- business_date is computed server-side at submit time from the facility's
-- timezone. The partial unique index enforces one submission per
-- (facility, area, template, day); the app upserts against it.

alter table public.daily_report_submissions
  add column if not exists business_date date;

-- Backfill existing rows from submitted_at in the facility's local timezone.
update public.daily_report_submissions s
set business_date = (s.submitted_at at time zone coalesce(f.timezone, 'UTC'))::date
from public.facilities f
where f.id = s.facility_id
  and s.business_date is null;

create unique index if not exists daily_report_submissions_unique_per_day
  on public.daily_report_submissions (facility_id, area_id, template_id, business_date)
  where business_date is not null;

comment on column public.daily_report_submissions.business_date is
  'Facility-local date of the submission (set server-side at submit time). Unique per (facility, area, template) so same-day re-submission updates the existing report rather than duplicating it.';
