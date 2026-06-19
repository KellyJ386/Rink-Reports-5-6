-- =============================================================================
-- 00000000000145_incident_emergency_fields.sql
-- Incident Reports gain the three emergency/triage fields the spec calls for
-- (audit finding: ambulance_flag / persons_involved / follow_up_required were
-- absent from schema + UI).
--
--   ambulance_flag      boolean  — was an ambulance called/needed. When true,
--                                  the submit flow escalates an alert through
--                                  the existing communication_routing_rules.
--   persons_involved    integer  — count of people involved (>= 0).
--   follow_up_required  boolean  — admin/staff flagged the incident for
--                                  follow-up.
--
-- All additive and nullable/defaulted, so existing rows and the submit path are
-- unaffected. RLS is inherited from incident_reports (unchanged).
-- =============================================================================

alter table public.incident_reports
  add column if not exists ambulance_flag boolean not null default false,
  add column if not exists persons_involved integer,
  add column if not exists follow_up_required boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'incident_reports_persons_involved_nonneg'
       and conrelid = 'public.incident_reports'::regclass
  ) then
    alter table public.incident_reports
      add constraint incident_reports_persons_involved_nonneg
      check (persons_involved is null or persons_involved >= 0);
  end if;
end$$;

comment on column public.incident_reports.ambulance_flag is
  'Whether an ambulance was called/needed. When true the submit flow escalates via communication_routing_rules.';
comment on column public.incident_reports.persons_involved is
  'Count of people involved in the incident (>= 0).';
comment on column public.incident_reports.follow_up_required is
  'Whether the incident is flagged as needing follow-up.';
