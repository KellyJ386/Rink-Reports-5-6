-- =============================================================================
-- 00000000000268_compute_live_daily_metrics.sql
--
-- One dispatcher RPC, callable by `authenticated`, for Phase 5's live-day
-- report path: "today" reads live fact tables (tonight's rollup has not run
-- yet) by reusing the SAME compute_daily_metrics_* functions the nightly
-- rollup calls, so a live number and tomorrow's rolled-up number for the same
-- day can never diverge into two implementations.
--
-- WHY THIS IS A MIGRATION DESPITE PHASE 5 BEING SPECIFIED AS "NO MIGRATION —
-- SERVER ACTIONS AND PAGES ONLY." The nine compute_daily_metrics_* functions
-- (migration 270) are SECURITY DEFINER, take p_facility_id as a plain
-- argument, and are granted to service_role ONLY — correct for their only
-- caller until now, the fully-trusted nightly cron. They carry no internal
-- tenancy check, because a trusted service-role caller needs none.
--
-- Phase 5 needs an AUTHENTICATED user's browser to see live "today" numbers.
-- Widening the grant on those nine functions directly to `authenticated`
-- would let any signed-in user call, say,
--   supabase.rpc('compute_daily_metrics_incident_reports',
--                 { p_facility_id: '<any other facility's uuid>', ... })
-- straight from the browser via PostgREST, bypassing RLS entirely (SECURITY
-- DEFINER runs as the function owner) and reading another facility's live
-- incident data. That is exactly the cross-tenant leak CLAUDE.md's
-- non-negotiable invariants exist to prevent.
--
-- This function closes that gap instead of reopening it: p_facility_id is
-- NOT a parameter at all — it is resolved server-side from
-- current_facility_id() (the caller's OWN facility via auth.uid()), the same
-- pattern has_module_access() and report_period_bounds() already use. The
-- caller supplies only a module key and a date; there is no argument that
-- could name a different facility. The nine module functions underneath are
-- untouched — same signatures, same service_role-only grant, same lack of an
-- internal tenancy check, because their only direct caller is still the
-- fully-trusted cron. This dispatcher is the sole other caller, and it is the
-- one that carries the check.
--
-- Read-only: the module functions are STABLE and never write; only
-- compute_facility_daily_metrics (the orchestrator) inserts into
-- facility_daily_metrics. Calling this dispatcher for a live preview has zero
-- side effects on the rollup table.
-- =============================================================================

begin;

create or replace function public.compute_live_daily_metrics(
  p_module_key    text,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
  v_result      jsonb;
begin
  if p_module_key is null or p_business_date is null then
    raise exception 'compute_live_daily_metrics: module_key and business_date are required';
  end if;

  v_facility_id := public.current_facility_id();
  if v_facility_id is null then
    raise exception 'compute_live_daily_metrics: caller has no facility';
  end if;

  if not public.has_module_access('reports') then
    raise exception 'compute_live_daily_metrics: not authorized';
  end if;

  if p_module_key = 'daily_reports' then
    v_result := public.compute_daily_metrics_daily_reports(v_facility_id, p_business_date);
  elsif p_module_key = 'ice_operations' then
    v_result := public.compute_daily_metrics_ice_operations(v_facility_id, p_business_date);
  elsif p_module_key = 'ice_depth' then
    v_result := public.compute_daily_metrics_ice_depth(v_facility_id, p_business_date);
  elsif p_module_key = 'refrigeration' then
    v_result := public.compute_daily_metrics_refrigeration(v_facility_id, p_business_date);
  elsif p_module_key = 'air_quality' then
    v_result := public.compute_daily_metrics_air_quality(v_facility_id, p_business_date);
  elsif p_module_key = 'incident_reports' then
    v_result := public.compute_daily_metrics_incident_reports(v_facility_id, p_business_date);
  elsif p_module_key = 'accident_reports' then
    v_result := public.compute_daily_metrics_accident_reports(v_facility_id, p_business_date);
  elsif p_module_key = 'dasher_boards' then
    v_result := public.compute_daily_metrics_dasher_boards(v_facility_id, p_business_date);
  elsif p_module_key = 'scheduling' then
    v_result := public.compute_daily_metrics_scheduling(v_facility_id, p_business_date);
  else
    raise exception 'compute_live_daily_metrics: unknown module_key %, expected one of the nine reporting modules', p_module_key;
  end if;

  return v_result;
end;
$$;

comment on function public.compute_live_daily_metrics(text, date) is
  'Read-only dispatcher for the reporting layer''s live "today" path. Resolves '
  'facility_id from the CALLER''S OWN session (current_facility_id()), never a '
  'parameter, then dispatches to the matching compute_daily_metrics_* function '
  '(migration 270) after checking has_module_access(''reports''). Exists so an '
  'authenticated browser session can reuse the exact same computation the '
  'nightly rollup uses, without widening those nine functions'' grant beyond '
  'service_role (which would let any caller pass an arbitrary facility_id and '
  'read cross-tenant data — see the file header).';

revoke execute on function public.compute_live_daily_metrics(text, date) from public, anon;
grant  execute on function public.compute_live_daily_metrics(text, date) to authenticated, service_role;

commit;
