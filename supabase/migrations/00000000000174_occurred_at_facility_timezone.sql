-- =============================================================================
-- 00000000000174_occurred_at_facility_timezone.sql
--
-- occurred_at on incident_reports / accident_reports /
-- ice_operations_submissions becomes a real UTC instant.
--
-- Until now these submit paths ran `new Date(datetimeLocalString).toISOString()`
-- on a UTC server, storing the reporter's WALL CLOCK with a fake UTC label.
-- Every timezone-aware display (done page, admin detail, read-only views)
-- shifted it, showing a time nobody entered — e.g. a 10:30 AM incident at a
-- Pacific facility rendered as 3:30 AM.
--
-- From this release the app converts wall clock → UTC with the facility's
-- IANA timezone at persist time (wallTimeToUtc) and back for the edit form
-- (utcToWallTime). This migration reinterprets the EXISTING rows' stored wall
-- clock in their facility's timezone so old and new rows mean the same thing.
--
-- Safe because every existing row is a wall-clock value: occurred_at has been
-- a required, client-entered field of all three forms since this repository's
-- first deployable commit (the pre-redesign schema that defaulted occurred_at
-- to now() never shipped without the form field), so there is no
-- real-instant population to corrupt.
--
-- Rows in facilities whose timezone is NULL, invalid, or UTC are left as-is —
-- for them the old and new conventions coincide (the app falls back to the
-- runtime zone, UTC in production).
-- =============================================================================

-- User triggers (audit trail + set_updated_at) stay quiet: this is a
-- representation change, not an edit — stamping updated_at / writing an audit
-- row per report would misrepresent it. System (FK) triggers are unaffected.
alter table public.incident_reports disable trigger user;
update public.incident_reports r
set occurred_at = ((r.occurred_at at time zone 'UTC') at time zone f.timezone)
from public.facilities f
where f.id = r.facility_id
  and f.timezone is not null
  and f.timezone <> 'UTC'
  and exists (select 1 from pg_timezone_names t where t.name = f.timezone);
alter table public.incident_reports enable trigger user;

alter table public.accident_reports disable trigger user;
update public.accident_reports r
set occurred_at = ((r.occurred_at at time zone 'UTC') at time zone f.timezone)
from public.facilities f
where f.id = r.facility_id
  and f.timezone is not null
  and f.timezone <> 'UTC'
  and exists (select 1 from pg_timezone_names t where t.name = f.timezone);
alter table public.accident_reports enable trigger user;

alter table public.ice_operations_submissions disable trigger user;
update public.ice_operations_submissions r
set occurred_at = ((r.occurred_at at time zone 'UTC') at time zone f.timezone)
from public.facilities f
where f.id = r.facility_id
  and f.timezone is not null
  and f.timezone <> 'UTC'
  and exists (select 1 from pg_timezone_names t where t.name = f.timezone);
alter table public.ice_operations_submissions enable trigger user;

comment on column public.incident_reports.occurred_at is
  'When the incident happened — a real UTC instant. Converted from the reporter''s wall clock using facilities.timezone at persist time (migration 174; earlier rows were reinterpreted from the legacy wall-clock-as-UTC encoding).';
comment on column public.accident_reports.occurred_at is
  'When the accident happened — a real UTC instant. Converted from the reporter''s wall clock using facilities.timezone at persist time (migration 174; earlier rows were reinterpreted from the legacy wall-clock-as-UTC encoding).';
comment on column public.ice_operations_submissions.occurred_at is
  'When the operation happened — a real UTC instant. Converted from the operator''s wall clock using facilities.timezone at persist time (migration 174; earlier rows were reinterpreted from the legacy wall-clock-as-UTC encoding).';
