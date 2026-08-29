-- =============================================================================
-- 00000000000264_fact_table_business_dates.sql
--
-- Every module fact table gains `business_date date NOT NULL` — the
-- FACILITY-LOCAL calendar date of the event — stamped by trigger at write
-- time, so the reporting layer never does timezone math at query time.
--
-- WHY THIS COMES FIRST. A 9 PM ice cut on Aug 31 at a America/New_York rink is
-- 01:00 UTC on Sep 1. Any rollup that buckets on the raw timestamptz puts it in
-- September, and every month and year boundary is silently wrong for the ~20%
-- of a facility's activity that happens after local 8 PM. Persisting the local
-- date once, at the moment the row is written, is the only place that decision
-- can be made with the facility's zone unambiguously in hand.
--
-- SOURCE TIMESTAMP PER TABLE — deliberately the EVENT timestamp, not the
-- submission timestamp: compliance reporting is about when something HAPPENED.
-- An incident that occurred Friday night and was filed Saturday morning belongs
-- to Friday's report. This also makes the offline queue correct for free: a
-- submission drafted Aug 31 and replayed Sep 2 still derives Aug 31, because
-- occurred_at/reading_at carry the event instant, not the replay instant.
--
--   ice_depth_sessions          -> submitted_at
--   ice_operations_submissions  -> occurred_at
--   refrigeration_reports       -> reading_at
--   air_quality_reports         -> submitted_at
--   incident_reports            -> occurred_at
--   accident_reports            -> occurred_at
--   dasher_boards_inspections   -> completed_at, falling back to started_at
--
-- NOT TOUCHED: daily_report_submissions (business_date since migration 156,
-- stamped by the trigger added in migration 183) and daily_report_instances
-- (report_date is already a date). Both work; migrating them onto the generic
-- function below would add risk for no gain. The consequence is that the two
-- stamping paths differ in one respect, noted under DIVERGENCE below.
--
-- DIVERGENCE FROM MIGRATION 183. daily_report_submissions_stamp_business_date()
-- fills the column only `if new.business_date is null` — it was written to close
-- a NULL-date RLS bypass, so a client-supplied value is honored. These seven
-- tables stamp UNCONDITIONALLY. Nothing in the app sends business_date for them
-- (the column has not existed until now), and a client-supplied business date is
-- exactly the input that would let a submission be booked into a closed
-- reporting period. Derived server-side, always.
--
-- SECURITY DEFINER, unlike the migration 183 function, so the stamp cannot be
-- skewed by whether the writer's RLS view happens to include its own
-- facilities row (service-role offline-sync replay and DEFINER submission RPCs
-- both write these tables). TG_ARGV is read as a jsonb key, never interpolated
-- into SQL, so there is no injection surface.
--
-- WHY THE '-infinity' DEFAULT + CHECK PAIR. The application must not send
-- business_date — the trigger is the single authority, and three of the six
-- submit paths do not even load the facility timezone. But a NOT NULL column
-- with no default is generated as a REQUIRED field in src/types/database.ts,
-- which would force every submit helper to compute and pass a value the trigger
-- then discards. Giving the column a default makes it optional in the generated
-- Insert types, so the app can simply omit it.
--
-- The default is a SENTINEL, never a plausible date. The trigger overwrites it
-- on every insert, so it is unobservable in normal operation; it is only
-- reachable if the trigger is ever dropped while the column survives. Pairing it
-- with a CHECK means that situation FAILS LOUDLY at the first insert, naming the
-- constraint, instead of silently recording server-local dates that look real
-- and quietly misfile every late-evening event. A wrong date that looks right is
-- the single most expensive failure this column can have.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. The generic stamping function.
--
--    One function, parameterised by trigger argument, rather than seven
--    near-identical copies: the timezone rule is the thing that must never
--    drift between modules, so it exists exactly once.
--
--    TG_ARGV[0] = source column name.
--    TG_ARGV[1] = optional fallback column, used when the source is NULL
--                 (dasher_boards_inspections.completed_at on an open walk).
-- -----------------------------------------------------------------------------
create or replace function public.stamp_business_date_from()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source   text := tg_argv[0];
  v_fallback text := case when array_length(tg_argv, 1) > 1 then tg_argv[1] end;
  v_row      jsonb := to_jsonb(new);
  v_ts       timestamptz;
  v_tz       text;
begin
  -- Column read by name out of the row's jsonb projection. to_jsonb renders a
  -- timestamptz as ISO-8601 WITH its offset, so the cast back is exact
  -- regardless of the session TimeZone.
  v_ts := nullif(v_row ->> v_source, '')::timestamptz;

  if v_ts is null and v_fallback is not null then
    v_ts := nullif(v_row ->> v_fallback, '')::timestamptz;
  end if;

  -- Last resort. Every source column here is NOT NULL or has a fallback that
  -- is, so this is unreachable in practice; it exists so the trigger can never
  -- be the reason an insert fails.
  v_ts := coalesce(v_ts, now());

  select f.timezone into v_tz
    from public.facilities f
   where f.id = new.facility_id;

  -- coalesce for parity with migration 183. facilities.timezone is NOT NULL
  -- DEFAULT 'America/New_York', so the fallback cannot fire today; it survives
  -- as insurance against a future nullable-timezone change.
  new.business_date := (v_ts at time zone coalesce(v_tz, 'UTC'))::date;

  return new;
end;
$$;

comment on function public.stamp_business_date_from() is
  'BEFORE INSERT/UPDATE trigger: stamps NEW.business_date with the facility-local '
  'calendar date of the timestamptz column named in TG_ARGV[0] (falling back to '
  'TG_ARGV[1] when that column is NULL), resolved through facilities.timezone. '
  'Stamps unconditionally so business_date is always server-derived. Added in '
  'migration 267 for the seven module fact tables.';

revoke execute on function public.stamp_business_date_from() from public, anon;

-- -----------------------------------------------------------------------------
-- 2. Add the column (nullable), backfill, then SET NOT NULL.
--
--    User triggers are disabled around each backfill, following migration 174:
--    this is a representation change, not an edit. Leaving them on would stamp
--    updated_at across every historical row and write one audit_logs row per
--    report — thousands of entries recording a migration as user activity.
--    System (FK) triggers are unaffected.
-- -----------------------------------------------------------------------------

alter table public.ice_depth_sessions          add column if not exists business_date date;
alter table public.ice_operations_submissions  add column if not exists business_date date;
alter table public.refrigeration_reports       add column if not exists business_date date;
alter table public.air_quality_reports         add column if not exists business_date date;
alter table public.incident_reports            add column if not exists business_date date;
alter table public.accident_reports            add column if not exists business_date date;
alter table public.dasher_boards_inspections   add column if not exists business_date date;

alter table public.ice_depth_sessions disable trigger user;
update public.ice_depth_sessions s
   set business_date = (s.submitted_at at time zone coalesce(f.timezone, 'UTC'))::date
  from public.facilities f
 where f.id = s.facility_id and s.business_date is null;
alter table public.ice_depth_sessions enable trigger user;

alter table public.ice_operations_submissions disable trigger user;
update public.ice_operations_submissions s
   set business_date = (s.occurred_at at time zone coalesce(f.timezone, 'UTC'))::date
  from public.facilities f
 where f.id = s.facility_id and s.business_date is null;
alter table public.ice_operations_submissions enable trigger user;

alter table public.refrigeration_reports disable trigger user;
update public.refrigeration_reports s
   set business_date = (s.reading_at at time zone coalesce(f.timezone, 'UTC'))::date
  from public.facilities f
 where f.id = s.facility_id and s.business_date is null;
alter table public.refrigeration_reports enable trigger user;

alter table public.air_quality_reports disable trigger user;
update public.air_quality_reports s
   set business_date = (s.submitted_at at time zone coalesce(f.timezone, 'UTC'))::date
  from public.facilities f
 where f.id = s.facility_id and s.business_date is null;
alter table public.air_quality_reports enable trigger user;

alter table public.incident_reports disable trigger user;
update public.incident_reports s
   set business_date = (s.occurred_at at time zone coalesce(f.timezone, 'UTC'))::date
  from public.facilities f
 where f.id = s.facility_id and s.business_date is null;
alter table public.incident_reports enable trigger user;

alter table public.accident_reports disable trigger user;
update public.accident_reports s
   set business_date = (s.occurred_at at time zone coalesce(f.timezone, 'UTC'))::date
  from public.facilities f
 where f.id = s.facility_id and s.business_date is null;
alter table public.accident_reports enable trigger user;

-- Open walks (completed_at IS NULL) fall back to started_at so an unfinished
-- walk still lands on a date and can be reported as "started, not completed".
alter table public.dasher_boards_inspections disable trigger user;
update public.dasher_boards_inspections s
   set business_date = (coalesce(s.completed_at, s.started_at)
                          at time zone coalesce(f.timezone, 'UTC'))::date
  from public.facilities f
 where f.id = s.facility_id and s.business_date is null;
alter table public.dasher_boards_inspections enable trigger user;

-- Report what the backfill actually touched, so the deploy log carries the
-- per-table row counts rather than leaving them to be reconstructed later.
do $$
declare
  r record;
  v_total bigint := 0;
begin
  for r in
    select 'ice_depth_sessions' t, count(*) n from public.ice_depth_sessions
    union all select 'ice_operations_submissions', count(*) from public.ice_operations_submissions
    union all select 'refrigeration_reports', count(*) from public.refrigeration_reports
    union all select 'air_quality_reports', count(*) from public.air_quality_reports
    union all select 'incident_reports', count(*) from public.incident_reports
    union all select 'accident_reports', count(*) from public.accident_reports
    union all select 'dasher_boards_inspections', count(*) from public.dasher_boards_inspections
    order by 1
  loop
    raise notice 'migration 267: business_date backfilled for % row(s) in %', r.n, r.t;
    v_total := v_total + r.n;
  end loop;
  raise notice 'migration 267: % row(s) backfilled across 7 fact tables', v_total;
end $$;

alter table public.ice_depth_sessions          alter column business_date set not null;
alter table public.ice_operations_submissions  alter column business_date set not null;
alter table public.refrigeration_reports       alter column business_date set not null;
alter table public.air_quality_reports         alter column business_date set not null;
alter table public.incident_reports            alter column business_date set not null;
alter table public.accident_reports            alter column business_date set not null;
alter table public.dasher_boards_inspections   alter column business_date set not null;

-- Sentinel default (see header). Set AFTER the backfill so it never touches an
-- existing row — SET DEFAULT applies only to subsequent inserts.
alter table public.ice_depth_sessions          alter column business_date set default '-infinity'::date;
alter table public.ice_operations_submissions  alter column business_date set default '-infinity'::date;
alter table public.refrigeration_reports       alter column business_date set default '-infinity'::date;
alter table public.air_quality_reports         alter column business_date set default '-infinity'::date;
alter table public.incident_reports            alter column business_date set default '-infinity'::date;
alter table public.accident_reports            alter column business_date set default '-infinity'::date;
alter table public.dasher_boards_inspections   alter column business_date set default '-infinity'::date;

-- CHECK constraints are evaluated AFTER BEFORE-row triggers, so a normal insert
-- (trigger stamps a real date) passes and only an unstamped row is rejected.
-- The constraint name is the diagnostic: "violates check constraint
-- <table>_business_date_stamped" says the stamping trigger did not run.
alter table public.ice_depth_sessions
  drop constraint if exists ice_depth_sessions_business_date_stamped;
alter table public.ice_depth_sessions
  add constraint ice_depth_sessions_business_date_stamped
  check (business_date <> '-infinity'::date);
alter table public.ice_operations_submissions
  drop constraint if exists ice_operations_submissions_business_date_stamped;
alter table public.ice_operations_submissions
  add constraint ice_operations_submissions_business_date_stamped
  check (business_date <> '-infinity'::date);
alter table public.refrigeration_reports
  drop constraint if exists refrigeration_reports_business_date_stamped;
alter table public.refrigeration_reports
  add constraint refrigeration_reports_business_date_stamped
  check (business_date <> '-infinity'::date);
alter table public.air_quality_reports
  drop constraint if exists air_quality_reports_business_date_stamped;
alter table public.air_quality_reports
  add constraint air_quality_reports_business_date_stamped
  check (business_date <> '-infinity'::date);
alter table public.incident_reports
  drop constraint if exists incident_reports_business_date_stamped;
alter table public.incident_reports
  add constraint incident_reports_business_date_stamped
  check (business_date <> '-infinity'::date);
alter table public.accident_reports
  drop constraint if exists accident_reports_business_date_stamped;
alter table public.accident_reports
  add constraint accident_reports_business_date_stamped
  check (business_date <> '-infinity'::date);
alter table public.dasher_boards_inspections
  drop constraint if exists dasher_boards_inspections_business_date_stamped;
alter table public.dasher_boards_inspections
  add constraint dasher_boards_inspections_business_date_stamped
  check (business_date <> '-infinity'::date);

-- -----------------------------------------------------------------------------
-- 3. Triggers.
-- -----------------------------------------------------------------------------

drop trigger if exists trg_ice_depth_sessions_stamp_business_date on public.ice_depth_sessions;
create trigger trg_ice_depth_sessions_stamp_business_date
  before insert on public.ice_depth_sessions
  for each row execute function public.stamp_business_date_from('submitted_at');

drop trigger if exists trg_ice_operations_submissions_stamp_business_date on public.ice_operations_submissions;
create trigger trg_ice_operations_submissions_stamp_business_date
  before insert on public.ice_operations_submissions
  for each row execute function public.stamp_business_date_from('occurred_at');

drop trigger if exists trg_refrigeration_reports_stamp_business_date on public.refrigeration_reports;
create trigger trg_refrigeration_reports_stamp_business_date
  before insert on public.refrigeration_reports
  for each row execute function public.stamp_business_date_from('reading_at');

drop trigger if exists trg_air_quality_reports_stamp_business_date on public.air_quality_reports;
create trigger trg_air_quality_reports_stamp_business_date
  before insert on public.air_quality_reports
  for each row execute function public.stamp_business_date_from('submitted_at');

drop trigger if exists trg_incident_reports_stamp_business_date on public.incident_reports;
create trigger trg_incident_reports_stamp_business_date
  before insert on public.incident_reports
  for each row execute function public.stamp_business_date_from('occurred_at');

drop trigger if exists trg_accident_reports_stamp_business_date on public.accident_reports;
create trigger trg_accident_reports_stamp_business_date
  before insert on public.accident_reports
  for each row execute function public.stamp_business_date_from('occurred_at');

-- dasher_boards_inspections needs two. A walk is INSERTed open (completed_at
-- NULL) and completed later, so the insert stamps from started_at and the
-- update re-stamps once completed_at first appears.
--
-- Trigger names matter here: same-timing triggers fire in alphabetical order,
-- and `..._guard` sorts before `..._stamp_business_date`, so
-- dasher_boards_inspections_guard() still gets to reject an illegal update
-- before this one touches the row. business_date is not one of the identity
-- columns that guard freezes, so re-stamping is permitted.
drop trigger if exists trg_dasher_boards_inspections_stamp_business_date on public.dasher_boards_inspections;
create trigger trg_dasher_boards_inspections_stamp_business_date
  before insert on public.dasher_boards_inspections
  for each row execute function public.stamp_business_date_from('completed_at', 'started_at');

drop trigger if exists trg_dasher_boards_inspections_stamp_business_date_on_complete on public.dasher_boards_inspections;
create trigger trg_dasher_boards_inspections_stamp_business_date_on_complete
  before update on public.dasher_boards_inspections
  for each row
  when (old.completed_at is null and new.completed_at is not null)
  execute function public.stamp_business_date_from('completed_at', 'started_at');

-- -----------------------------------------------------------------------------
-- 4. Covering indexes for the reporting layer's access pattern
--    (one facility, a date range, newest first).
--
--    The existing (facility_id, submitted_at DESC) indexes are deliberately
--    KEPT — the per-record detail and history views still order by the raw
--    instant, which these cannot serve.
-- -----------------------------------------------------------------------------
create index if not exists idx_ice_depth_sessions_facility_business_date
  on public.ice_depth_sessions (facility_id, business_date desc);
create index if not exists idx_ice_operations_submissions_facility_business_date
  on public.ice_operations_submissions (facility_id, business_date desc);
create index if not exists idx_refrigeration_reports_facility_business_date
  on public.refrigeration_reports (facility_id, business_date desc);
create index if not exists idx_air_quality_reports_facility_business_date
  on public.air_quality_reports (facility_id, business_date desc);
create index if not exists idx_incident_reports_facility_business_date
  on public.incident_reports (facility_id, business_date desc);
create index if not exists idx_accident_reports_facility_business_date
  on public.accident_reports (facility_id, business_date desc);
create index if not exists idx_dasher_boards_inspections_facility_business_date
  on public.dasher_boards_inspections (facility_id, business_date desc);

-- -----------------------------------------------------------------------------
-- 5. Column comments — each names its source timestamp, because "which instant
--    did this date come from" is the first question anyone auditing a report
--    number will ask.
-- -----------------------------------------------------------------------------
comment on column public.ice_depth_sessions.business_date is
  'Facility-local calendar date of the session, derived from submitted_at through '
  'facilities.timezone and stamped server-side (migration 267). The reporting '
  'layer buckets on this, never on the raw timestamptz.';

comment on column public.ice_operations_submissions.business_date is
  'Facility-local calendar date of the operation, derived from occurred_at (when it '
  'happened, not when it was filed) through facilities.timezone and stamped '
  'server-side (migration 267).';

comment on column public.refrigeration_reports.business_date is
  'Facility-local calendar date of the reading, derived from reading_at through '
  'facilities.timezone and stamped server-side (migration 267).';

comment on column public.air_quality_reports.business_date is
  'Facility-local calendar date of the report, derived from submitted_at through '
  'facilities.timezone and stamped server-side (migration 267).';

comment on column public.incident_reports.business_date is
  'Facility-local calendar date of the incident, derived from occurred_at (when it '
  'happened, not when it was filed) through facilities.timezone and stamped '
  'server-side (migration 267).';

comment on column public.accident_reports.business_date is
  'Facility-local calendar date of the accident, derived from occurred_at (when it '
  'happened, not when it was filed) through facilities.timezone and stamped '
  'server-side (migration 267).';

comment on column public.dasher_boards_inspections.business_date is
  'Facility-local calendar date of the walk, derived from completed_at through '
  'facilities.timezone and stamped server-side (migration 267). An OPEN walk is '
  'stamped from started_at instead and re-stamped when it is completed, so a walk '
  'begun 11 PM and signed off after midnight reports on the day it was COMPLETED. '
  'Phase 4 metrics that count walks started must account for that.';

commit;
