-- =============================================================================
-- 00000000000266_facility_daily_metrics.sql
--
-- The reporting data layer: a daily-grain rollup table, the metric registry
-- that says how to combine its values across a period, and the period-boundary
-- helper that decides what "last week" and "this year" actually mean.
--
-- ARCHITECTURE. Everything is rolled up ONCE per facility per day per module,
-- and all four report periods (day / week / month / year) aggregate that same
-- table. Today's report is the one exception — it reads live fact tables,
-- because tonight's rollup has not run yet (Phase 5).
--
-- WHY jsonb AND NOT TYPED COLUMNS. Modules are per-facility admin-configurable:
-- refrigeration fields, daily-report areas and circle-check items all vary by
-- facility, so a fixed column schema breaks on the second customer. Metrics are
-- keyed by name in jsonb, and report_metric_definitions carries the labels,
-- units and — critically — the aggregation mode. Do not "improve" this into
-- typed columns.
--
-- WHY THE AGGREGATION MODE IS A FIRST-CLASS COLUMN. Rolling a daily value up to
-- a month is not one operation. Counts SUM. A mean depth AVERAGES. An
-- open-issue count is a point-in-time SNAPSHOT and must take the LAST day's
-- value — summing it across 365 days is the classic failure that produces an
-- annual report claiming four thousand open issues. Storing the mode next to
-- the metric is what stops that being decided ad hoc at each call site.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. facilities.fiscal_year_start_month
--
--    Annual reports are FISCAL-year reports. Tennity is Syracuse University,
--    whose fiscal year runs July 1 - June 30, so their "annual report" is not a
--    calendar year. Retrofitting this after facilities have archived annual
--    PDFs is expensive, so the column exists before the first report is run.
-- -----------------------------------------------------------------------------
alter table public.facilities
  add column if not exists fiscal_year_start_month smallint not null default 1;

alter table public.facilities
  drop constraint if exists facilities_fiscal_year_start_month_check;
alter table public.facilities
  add constraint facilities_fiscal_year_start_month_check
  check (fiscal_year_start_month between 1 and 12);

comment on column public.facilities.fiscal_year_start_month is
  'Month (1-12) the facility''s FISCAL year begins; 1 = calendar year. Drives the '
  '''year'' period in report_period_bounds(). Tennity = 7 (Syracuse University''s '
  'July-June fiscal year).';

-- Tennity's fiscal year. Matched on slug rather than id so a clean replay onto
-- an empty database is a harmless no-op. User triggers stay ENABLED here: unlike
-- the migration 264 backfill this is a real configuration change and belongs in
-- the audit trail.
update public.facilities
   set fiscal_year_start_month = 7
 where slug = 'tennity-ice-skating-pavilion'
   and fiscal_year_start_month <> 7;

-- -----------------------------------------------------------------------------
-- 2. facility_daily_metrics — the rollup table.
-- -----------------------------------------------------------------------------
create table if not exists public.facility_daily_metrics (
  facility_id   uuid not null references public.facilities(id) on delete cascade,
  business_date date not null,
  module_key    text not null,
  metrics       jsonb not null default '{}'::jsonb,
  computed_at   timestamptz not null default now(),
  primary key (facility_id, business_date, module_key)
);

comment on table public.facility_daily_metrics is
  'Nightly per-facility, per-day, per-module metric rollup. All four report periods '
  '(day/week/month/year) aggregate THIS table; only "today" reads live fact tables. '
  'WRITE PATH: the SECURITY DEFINER rollup functions (migration 267) and the service '
  'role ONLY — there are deliberately no INSERT/UPDATE/DELETE policies for '
  'authenticated, and those privileges are revoked. Recomputation is idempotent via '
  'ON CONFLICT on the primary key.';

comment on column public.facility_daily_metrics.metrics is
  'Metric name -> value for this facility/day/module. Keys are registered in '
  'public.report_metric_definitions, which also carries each key''s label, unit and '
  'aggregation mode (how daily values combine into a weekly/monthly/annual figure).';

comment on column public.facility_daily_metrics.business_date is
  'Facility-local business date (migration 264), NOT a UTC date. This is the grain.';

create index if not exists idx_facility_daily_metrics_facility_module_date
  on public.facility_daily_metrics (facility_id, module_key, business_date desc);

alter table public.facility_daily_metrics enable row level security;

-- Read is gated on BOTH tenancy and the 'reports' module permission from
-- migration 265. Facility scoping alone is not enough: these are facility-wide
-- compliance aggregates, and staff hold no grant on the reports module.
drop policy if exists facility_daily_metrics_select on public.facility_daily_metrics;
create policy facility_daily_metrics_select on public.facility_daily_metrics
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('reports')
    )
  );

-- No write policies by design. RLS already denies writes without one; revoking
-- the privileges too means a future policy added by mistake still cannot be
-- exercised by a role that has no INSERT grant.
revoke insert, update, delete, truncate on public.facility_daily_metrics from anon, authenticated;
grant  select on public.facility_daily_metrics to authenticated;
grant  select, insert, update, delete on public.facility_daily_metrics to service_role;

-- -----------------------------------------------------------------------------
-- 3. report_metric_definitions — the metric registry.
--
--    Global, not facility-scoped: it describes what a metric MEANS, not any
--    facility's data. Seeded per module in migration 267 alongside the rollup
--    functions that emit those keys.
-- -----------------------------------------------------------------------------
create table if not exists public.report_metric_definitions (
  module_key  text not null,
  metric_key  text not null,
  label       text not null,
  unit        text,
  aggregation text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  primary key (module_key, metric_key),
  constraint report_metric_definitions_aggregation_check
    check (aggregation in ('sum', 'avg', 'max', 'min', 'last'))
);

comment on table public.report_metric_definitions is
  'Registry for the keys stored in facility_daily_metrics.metrics: display label, '
  'unit, sort order, and the aggregation mode used to combine DAILY values into a '
  'weekly/monthly/annual figure. Global metadata (no facility_id) — it describes what '
  'a metric means, not any facility''s data. Seeded per module in migration 267.';

comment on column public.report_metric_definitions.aggregation is
  'How daily values combine over a period: sum | avg | max | min | last. '
  'Counts are sum. A mean is avg. A point-in-time snapshot (open issues at end of '
  'day) is LAST and must never be summed — summing it across a year is how a report '
  'ends up claiming thousands of open issues.';

drop trigger if exists trg_report_metric_definitions_set_updated_at on public.report_metric_definitions;
create trigger trg_report_metric_definitions_set_updated_at
  before update on public.report_metric_definitions
  for each row execute function public.set_updated_at();

alter table public.report_metric_definitions enable row level security;

-- Same shape as retention_module_floors: readable by any authenticated user
-- (labels are not tenant data and the UI needs them), super-admin writes only.
drop policy if exists report_metric_definitions_select on public.report_metric_definitions;
create policy report_metric_definitions_select on public.report_metric_definitions
  for select to authenticated
  using (true);

drop policy if exists report_metric_definitions_write on public.report_metric_definitions;
create policy report_metric_definitions_write on public.report_metric_definitions
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select on public.report_metric_definitions to authenticated;
grant select, insert, update, delete on public.report_metric_definitions to service_role;

-- -----------------------------------------------------------------------------
-- 4. report_period_bounds(facility, period, anchor) -> (start_date, end_date)
--
--    The single definition of what a reporting period IS. Both the live "today"
--    path and the rolled-up path resolve their window here, so they cannot
--    disagree about where a week or a fiscal year begins.
--
--    SECURITY DEFINER is required, not decorative. schedule_settings SELECT is
--    gated on has_module_access('scheduling'), so a manager who holds 'reports'
--    but not 'scheduling' would read no settings row and silently fall back to a
--    Sunday week — producing correct-looking weekly reports that start on the
--    wrong day. Reading the config as the definer removes that coupling.
--
--    Because it is DEFINER and takes a facility_id, it carries its own tenancy
--    gate: a caller may only resolve bounds for their OWN facility unless they
--    are a super admin or the service role. The service-role test is
--    auth.role(), per migration 246 — session_user is never 'service_role' under
--    PostgREST and matching on it is this repo's known broken pattern.
-- -----------------------------------------------------------------------------
create or replace function public.report_period_bounds(
  p_facility_id uuid,
  p_period      text,
  p_anchor      date
)
returns table (start_date date, end_date date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_week_start int;
  v_fy_start   int;
  v_offset     int;
  v_year       int;
  v_start      date;
begin
  if p_facility_id is null or p_period is null or p_anchor is null then
    raise exception 'report_period_bounds: facility_id, period and anchor are required';
  end if;

  if not (
    public.is_super_admin()
    or coalesce(auth.role(), '') = 'service_role'
    or p_facility_id = public.current_facility_id()
  ) then
    raise exception 'report_period_bounds: not authorized for that facility';
  end if;

  case p_period
    when 'day' then
      return query select p_anchor, p_anchor;

    when 'week' then
      -- The reporting week MUST start on the same day as the scheduling
      -- module's week, or the same product disagrees with itself about what
      -- "last week" means. date_trunc('week') is ISO Monday and is wrong here.
      select coalesce(s.week_start_day, 0) into v_week_start
        from public.schedule_settings s
       where s.facility_id = p_facility_id;
      v_week_start := coalesce(v_week_start, 0);

      -- Postgres dow and schedule_settings.week_start_day share the same
      -- encoding (0 = Sunday .. 6 = Saturday), so this is a plain rotation.
      v_offset := (extract(dow from p_anchor)::int - v_week_start + 7) % 7;
      v_start  := p_anchor - v_offset;
      return query select v_start, (v_start + 6);

    when 'month' then
      v_start := date_trunc('month', p_anchor)::date;
      return query select v_start, (v_start + interval '1 month' - interval '1 day')::date;

    when 'year' then
      select coalesce(f.fiscal_year_start_month, 1) into v_fy_start
        from public.facilities f
       where f.id = p_facility_id;
      v_fy_start := coalesce(v_fy_start, 1);

      -- A fiscal year is named for the calendar year it STARTS in. With a July
      -- start, 2026-08-28 falls in FY 2026-07-01..2027-06-30, while 2026-03-01
      -- still belongs to the year that began 2025-07-01.
      v_year := extract(year from p_anchor)::int;
      if extract(month from p_anchor)::int < v_fy_start then
        v_year := v_year - 1;
      end if;
      v_start := make_date(v_year, v_fy_start, 1);
      return query select v_start, (v_start + interval '1 year' - interval '1 day')::date;

    else
      raise exception 'report_period_bounds: unknown period %, expected day | week | month | year', p_period;
  end case;
end;
$$;

comment on function public.report_period_bounds(uuid, text, date) is
  'Inclusive [start_date, end_date] of the reporting period containing p_anchor. '
  'week honours schedule_settings.week_start_day (NOT ISO Monday); year honours '
  'facilities.fiscal_year_start_month (a fiscal year is named for the calendar year '
  'it starts in). SECURITY DEFINER so a reports-only manager can resolve bounds '
  'without scheduling-module access; gated to the caller''s own facility unless super '
  'admin or service role.';

revoke execute on function public.report_period_bounds(uuid, text, date) from public, anon;
grant  execute on function public.report_period_bounds(uuid, text, date) to authenticated, service_role;

commit;
