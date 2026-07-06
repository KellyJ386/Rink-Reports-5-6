-- =============================================================================
-- 00000000000173_incident_transactional_persist.sql
--
-- Incident submissions and submitter edits become atomic.
--
-- Problem: the app persisted an incident as four sequential PostgREST writes
-- (report → spaces → witnesses → change log). A failure after the first left
-- an orphaned partial report, and the app's compensating DELETE is RLS-blocked
-- for staff (incident_reports delete is super-admin-only), so the orphan stuck.
-- The submitter edit path was worse: it full-replaced spaces/witnesses with
-- DELETE-then-INSERT across separate statements, so a failed re-INSERT lost
-- the report's spaces or witnesses permanently.
--
-- Fix: two SECURITY INVOKER functions that do the whole persist in one
-- function call (= one transaction; any failure rolls back every statement).
-- SECURITY INVOKER is deliberate — every statement still runs under the
-- caller's RLS policies (008/103/104), so these functions add NO new write
-- authority: a caller who couldn't make these writes row-by-row can't make
-- them through the function either. Regression assertions live in
-- supabase/tests/rls_isolation.sql ("INC-RPC" section).
--
-- The ambulance escalation + notification fan-out stay app-side (best-effort
-- by design; they must never roll back a persisted report).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. submit_incident_report — insert report + children + change log atomically.
--    Returns the new report id.
-- -----------------------------------------------------------------------------
create or replace function public.submit_incident_report(
  p_facility_id        uuid default null,
  p_employee_id        uuid default null,
  p_severity_level_id  uuid default null,
  p_incident_type_id   uuid default null,
  p_activity_id        uuid default null,
  p_activity_other     text default null,
  p_location_other     text default null,
  p_immediate_actions  text default null,
  p_occurred_at        timestamptz default null,
  p_reporter_name      text default null,
  p_reporter_phone     text default null,
  p_description        text default null,
  p_ambulance_flag     boolean default null,
  p_persons_involved   integer default null,
  p_follow_up_required boolean default null,
  p_space_ids          uuid[] default null,
  p_witnesses          jsonb default null
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_report public.incident_reports%rowtype;
begin
  insert into public.incident_reports (
    facility_id, employee_id, severity_level_id, incident_type_id,
    activity_id, activity_other, location_other, immediate_actions,
    occurred_at, reporter_name, reporter_phone, description,
    ambulance_flag, persons_involved, follow_up_required,
    status, submitted_at
  ) values (
    p_facility_id, p_employee_id, p_severity_level_id, p_incident_type_id,
    p_activity_id, p_activity_other, p_location_other, p_immediate_actions,
    p_occurred_at, p_reporter_name, p_reporter_phone, p_description,
    coalesce(p_ambulance_flag, false), p_persons_involved,
    coalesce(p_follow_up_required, false),
    'submitted', now()
  )
  returning * into v_report;

  insert into public.incident_report_spaces (incident_id, facility_id, space_id)
  select v_report.id, p_facility_id, sid
  from unnest(coalesce(p_space_ids, '{}'::uuid[])) as sid;

  insert into public.incident_witnesses
    (incident_id, facility_id, name, phone, email, statement, sort_order)
  select v_report.id, p_facility_id,
         w ->> 'name',
         nullif(w ->> 'phone', ''),
         nullif(w ->> 'email', ''),
         nullif(w ->> 'statement', ''),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_witnesses, '[]'::jsonb))
         with ordinality as t(w, ord);

  insert into public.incident_change_log
    (incident_id, facility_id, employee_id, action, before, after)
  values (
    v_report.id, p_facility_id, p_employee_id, 'create', null,
    jsonb_build_object(
      'id', v_report.id,
      'severity_level_id', v_report.severity_level_id,
      'incident_type_id', v_report.incident_type_id,
      'activity_id', v_report.activity_id,
      'activity_other', v_report.activity_other,
      'location_other', v_report.location_other,
      'immediate_actions', v_report.immediate_actions,
      'occurred_at', v_report.occurred_at,
      'submitted_at', v_report.submitted_at,
      'edit_window_ends_at', v_report.edit_window_ends_at,
      'reporter_name', v_report.reporter_name,
      'reporter_phone', v_report.reporter_phone,
      'description', v_report.description,
      'ambulance_flag', v_report.ambulance_flag,
      'persons_involved', v_report.persons_involved,
      'follow_up_required', v_report.follow_up_required,
      'space_ids', to_jsonb(coalesce(p_space_ids, '{}'::uuid[])),
      'witnesses', coalesce(p_witnesses, '[]'::jsonb)
    )
  );

  return v_report.id;
end;
$$;

comment on function public.submit_incident_report(uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, boolean, integer, boolean, uuid[], jsonb) is
  'Atomic incident submission: report + spaces + witnesses + change log in one transaction. SECURITY INVOKER — RLS (008/103/104) still gates every write, so this grants no authority beyond the equivalent row-by-row inserts.';

-- -----------------------------------------------------------------------------
-- 2. update_incident_report — submitter (in-window) / admin edit, atomic.
--    Snapshots before/after into incident_change_log inside the same
--    transaction; reporter identity is fixed at submission and not updatable.
-- -----------------------------------------------------------------------------
create or replace function public.update_incident_report(
  p_report_id          uuid default null,
  p_severity_level_id  uuid default null,
  p_incident_type_id   uuid default null,
  p_activity_id        uuid default null,
  p_activity_other     text default null,
  p_location_other     text default null,
  p_immediate_actions  text default null,
  p_occurred_at        timestamptz default null,
  p_description        text default null,
  p_ambulance_flag     boolean default null,
  p_persons_involved   integer default null,
  p_follow_up_required boolean default null,
  p_space_ids          uuid[] default null,
  p_witnesses          jsonb default null
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row    public.incident_reports%rowtype;
  v_before jsonb;
begin
  -- RLS select policy scopes visibility; the lock serializes concurrent edits.
  select * into v_row
  from public.incident_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception 'Report not found.';
  end if;

  v_before := jsonb_build_object(
    'severity_level_id', v_row.severity_level_id,
    'incident_type_id', v_row.incident_type_id,
    'activity_id', v_row.activity_id,
    'activity_other', v_row.activity_other,
    'location_other', v_row.location_other,
    'immediate_actions', v_row.immediate_actions,
    'occurred_at', v_row.occurred_at,
    'reporter_name', v_row.reporter_name,
    'reporter_phone', v_row.reporter_phone,
    'description', v_row.description,
    'ambulance_flag', v_row.ambulance_flag,
    'persons_involved', v_row.persons_involved,
    'follow_up_required', v_row.follow_up_required,
    'space_ids', (
      select coalesce(jsonb_agg(s.space_id order by s.space_id), '[]'::jsonb)
      from public.incident_report_spaces s
      where s.incident_id = p_report_id
    ),
    'witnesses', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', w.name, 'phone', w.phone,
            'email', w.email, 'statement', w.statement
          ) order by w.sort_order
        ),
        '[]'::jsonb
      )
      from public.incident_witnesses w
      where w.incident_id = p_report_id
    )
  );

  -- RLS update policy (103) enforces "owner within the edit window, or module
  -- admin". A row filtered out by the policy updates nothing → raise → the
  -- whole transaction (including nothing-yet) rolls back.
  update public.incident_reports set
    severity_level_id  = p_severity_level_id,
    incident_type_id   = p_incident_type_id,
    activity_id        = p_activity_id,
    activity_other     = p_activity_other,
    location_other     = p_location_other,
    immediate_actions  = p_immediate_actions,
    occurred_at        = p_occurred_at,
    description        = p_description,
    ambulance_flag     = coalesce(p_ambulance_flag, false),
    persons_involved   = p_persons_involved,
    follow_up_required = coalesce(p_follow_up_required, false)
  where id = p_report_id;
  if not found then
    raise exception 'You can no longer edit this report.';
  end if;

  -- Full replace of children (small row counts). Atomic here — a failed
  -- re-insert rolls the deletes back too, unlike the previous app-side path.
  delete from public.incident_report_spaces where incident_id = p_report_id;
  insert into public.incident_report_spaces (incident_id, facility_id, space_id)
  select p_report_id, v_row.facility_id, sid
  from unnest(coalesce(p_space_ids, '{}'::uuid[])) as sid;

  delete from public.incident_witnesses where incident_id = p_report_id;
  insert into public.incident_witnesses
    (incident_id, facility_id, name, phone, email, statement, sort_order)
  select p_report_id, v_row.facility_id,
         w ->> 'name',
         nullif(w ->> 'phone', ''),
         nullif(w ->> 'email', ''),
         nullif(w ->> 'statement', ''),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_witnesses, '[]'::jsonb))
         with ordinality as t(w, ord);

  insert into public.incident_change_log
    (incident_id, facility_id, employee_id, action, before, after)
  values (
    p_report_id, v_row.facility_id, public.current_employee_id(), 'update',
    v_before,
    jsonb_build_object(
      'severity_level_id', p_severity_level_id,
      'incident_type_id', p_incident_type_id,
      'activity_id', p_activity_id,
      'activity_other', p_activity_other,
      'location_other', p_location_other,
      'immediate_actions', p_immediate_actions,
      'occurred_at', p_occurred_at,
      'reporter_name', v_row.reporter_name,
      'reporter_phone', v_row.reporter_phone,
      'description', p_description,
      'ambulance_flag', coalesce(p_ambulance_flag, false),
      'persons_involved', p_persons_involved,
      'follow_up_required', coalesce(p_follow_up_required, false),
      'space_ids', to_jsonb(coalesce(p_space_ids, '{}'::uuid[])),
      'witnesses', coalesce(p_witnesses, '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.update_incident_report(uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, boolean, integer, boolean, uuid[], jsonb) is
  'Atomic submitter/admin incident edit: snapshots before/after into incident_change_log and full-replaces spaces/witnesses in one transaction. SECURITY INVOKER — the 24h-window/admin RLS update policy (migration 103) still decides who may edit.';

-- -----------------------------------------------------------------------------
-- Grants. New functions get EXECUTE for PUBLIC by default (see migration 163's
-- note); close that and grant the app role explicitly.
-- -----------------------------------------------------------------------------
revoke execute on function public.submit_incident_report(uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, boolean, integer, boolean, uuid[], jsonb)
  from public, anon;
grant execute on function public.submit_incident_report(uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text, text, boolean, integer, boolean, uuid[], jsonb)
  to authenticated, service_role;

revoke execute on function public.update_incident_report(uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, boolean, integer, boolean, uuid[], jsonb)
  from public, anon;
grant execute on function public.update_incident_report(uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, boolean, integer, boolean, uuid[], jsonb)
  to authenticated, service_role;
