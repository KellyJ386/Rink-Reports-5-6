-- =============================================================================
-- 00000000000117_schedule_settings_remediation.sql
-- Scheduling remediation P3 + P2 config flags.
--
--   * availability_submission_enabled (default true) -- M6: lets an admin turn
--     staff weekly-availability submission on/off.
--   * require_job_area_qualification (default false) -- gates the "not_qualified"
--     hard block in scheduling_assignment_violations(). Default OFF so existing
--     facilities (whose shifts have no job_area_id yet) are not retroactively
--     blocked; admins opt in once job areas are assigned to shifts/employees.
--
-- Also refreshes seed_default_scheduling_config() to populate the new columns
-- for freshly-seeded facilities (idempotent; existing rows untouched).
-- =============================================================================

alter table public.schedule_settings
  add column if not exists availability_submission_enabled boolean not null default true;

alter table public.schedule_settings
  add column if not exists require_job_area_qualification boolean not null default false;

comment on column public.schedule_settings.availability_submission_enabled is
  'When false, staff cannot submit/edit weekly availability (the self-service availability form is gated server- and client-side).';
comment on column public.schedule_settings.require_job_area_qualification is
  'When true, an employee may only be assigned to a shift whose job_area_id is one of their employee_job_area_assignments (enforced as a hard block).';

-- Refresh the seed helper so new facilities get the new defaults.
create or replace function public.seed_default_scheduling_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.schedule_settings
    (facility_id, week_start_day, default_shift_minutes,
     minor_max_weekly_hours, overtime_weekly_hours,
     minimum_break_minutes, minimum_break_after_hours,
     swap_requires_manager_approval, open_shift_first_come,
     notify_on_publish, notify_on_overtime,
     availability_submission_enabled, require_job_area_qualification)
  values
    (p_facility_id, 0, 480,
     30, 40,
     30, 5,
     true, true,
     true, true,
     true, false)
  on conflict (facility_id) do nothing;

  insert into public.schedule_compliance_rules
    (facility_id, name, rule_type, params, description, is_active, sort_order)
  values
    (p_facility_id,
     'Minors limited to 30 hours / week',
     'minor_max_hours',
     '{"max_weekly_hours":30,"applies_to_minors":true}'::jsonb,
     'Block scheduling minors for more than 30 hours in any rolling Sun-Sat week.',
     true, 10)
  on conflict (facility_id, name) do nothing;

  insert into public.schedule_compliance_rules
    (facility_id, name, rule_type, params, description, is_active, sort_order)
  values
    (p_facility_id,
     'Overtime threshold 40h',
     'overtime',
     '{"weekly_threshold":40}'::jsonb,
     'Flag shifts that push an employee over 40 hours in a week.',
     true, 20)
  on conflict (facility_id, name) do nothing;

  insert into public.schedule_compliance_rules
    (facility_id, name, rule_type, params, description, is_active, sort_order)
  values
    (p_facility_id,
     'Required break after 5h',
     'break_required',
     '{"after_hours":5,"min_minutes":30}'::jsonb,
     'Any shift longer than 5 hours must include at least a 30 minute break.',
     true, 30)
  on conflict (facility_id, name) do nothing;
end;
$$;

comment on function public.seed_default_scheduling_config(uuid) is
  'Seeds default schedule_settings and three baseline schedule_compliance_rules rows for a facility. Idempotent.';

revoke execute on function public.seed_default_scheduling_config(uuid) from public;
grant  execute on function public.seed_default_scheduling_config(uuid) to service_role;
