-- =============================================================================
-- 00000000000218_daily_report_corrections.sql
--
-- Corrections for locked Daily Reports (review project I-3): the paper
-- logbook rule — line through, initial, write the fix. Never tear out the
-- page.
--
-- Daily reports lock implicitly at facility-local day rollover (migrations
-- 156/161/183/185): staff can only INSERT into today, and UPDATE/DELETE are
-- admin-only. That made "I wrote the wrong value yesterday" a dead end. A
-- correction is a NEW submission row that SUPERSEDES the original:
--
--   * the original is never edited or deleted — it gets superseded_at +
--     superseded_by stamps (the line-through);
--   * the correction carries supersedes_id, correction_reason (required),
--     corrected_by, and the ORIGINAL business_date — it belongs to the day
--     it corrects;
--   * who may file: a daily-reports module admin OR the original submitter
--     (user decision), both through ONE audited SECURITY DEFINER RPC —
--     staff UPDATE stays RLS-denied (the migration-161 lesson: a staff
--     UPDATE path that silently matched zero rows is how corrections got
--     lost in the first place).
--
-- Same shape as the report_area_assignments.superseded_at precedent
-- (migrations 182/183).
-- =============================================================================

alter table public.daily_report_submissions
  add column if not exists superseded_at     timestamptz,
  add column if not exists superseded_by     uuid
    references public.daily_report_submissions(id) on delete set null,
  add column if not exists supersedes_id     uuid
    references public.daily_report_submissions(id) on delete set null,
  add column if not exists correction_reason text,
  add column if not exists corrected_by      uuid
    references public.employees(id) on delete set null;

comment on column public.daily_report_submissions.superseded_at is
  'Set when a correction supersedes this submission. The row is never edited '
  'beyond this stamp; superseded_by links to the correction.';
comment on column public.daily_report_submissions.supersedes_id is
  'Set on a correction row: the submission this one supersedes. '
  'correction_reason is required for corrections.';

create index if not exists idx_daily_report_submissions_supersedes
  on public.daily_report_submissions (supersedes_id)
  where supersedes_id is not null;

-- A submission can be superseded by at most one ACTIVE correction.
create unique index if not exists uniq_daily_report_submission_active_correction
  on public.daily_report_submissions (supersedes_id)
  where supersedes_id is not null and superseded_at is null;

-- ---------------------------------------------------------------------------
-- SELECT policy: a submitter can now always see their OWN submissions (the
-- staff correction entry point needs yesterday's rows, which the
-- area-assignment day gate would otherwise hide). Items/notes visibility
-- delegates to this policy via EXISTS, so they follow automatically.
-- Otherwise identical to the migration-183 version.
-- ---------------------------------------------------------------------------
drop policy if exists daily_report_submissions_select on public.daily_report_submissions;
create policy daily_report_submissions_select on public.daily_report_submissions
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_admin_access('daily_reports')
        or (employee_id is not null
            and employee_id = public.current_employee_id())
        or (
          public.current_employee_module_permission('daily_reports')
            >= 'view'::public.module_permission_level
          and public.has_area_access('daily_reports', area_id)
          and (
            public.has_module_edit_access('daily_reports')
            or public.daily_area_assignment_allows(area_id, business_date)
          )
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- The one write path for corrections.
-- p_items: full corrected item state — array of
--   { "checklist_item_id": uuid|null, "label_snapshot": text, "is_checked": bool }
-- ---------------------------------------------------------------------------
create or replace function public.supersede_daily_report_submission(
  p_original_id uuid,
  p_reason      text,
  p_items       jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp      uuid := public.current_employee_id();
  v_original public.daily_report_submissions%rowtype;
  v_new_id   uuid;
  v_item     jsonb;
  v_n        integer := 0;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error',
      'A correction reason is required.');
  end if;

  select * into v_original
    from public.daily_report_submissions
   where id = p_original_id
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Submission not found.');
  end if;

  if not public.is_super_admin()
     and v_original.facility_id is distinct from public.current_facility_id() then
    raise exception 'supersede_daily_report_submission: cross-facility'
      using errcode = '42501';
  end if;

  -- Module admin, or the original submitter (paper-logbook rule: the person
  -- who wrote the entry may line-through-and-correct their own).
  if not (
    public.is_super_admin()
    or public.has_module_admin_access('daily_reports')
    or (v_emp is not null and v_original.employee_id = v_emp)
  ) then
    raise exception 'supersede_daily_report_submission: only a daily-reports admin or the original submitter may file a correction'
      using errcode = '42501';
  end if;

  if v_original.superseded_at is not null then
    return jsonb_build_object('ok', false, 'error',
      'This submission was already corrected. Correct the latest version instead.');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error',
      'Corrected items payload is required.');
  end if;

  insert into public.daily_report_submissions
    (facility_id, area_id, template_id, employee_id, submitted_at,
     business_date, supersedes_id, correction_reason, corrected_by)
  values
    (v_original.facility_id, v_original.area_id, v_original.template_id,
     v_emp, now(),
     v_original.business_date, v_original.id, btrim(p_reason), v_emp)
  returning id into v_new_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(btrim(v_item->>'label_snapshot'), '') = '' then
      raise exception 'supersede_daily_report_submission: every item needs a label_snapshot';
    end if;
    insert into public.daily_report_submission_items
      (facility_id, submission_id, checklist_item_id, label_snapshot, is_checked)
    values
      (v_original.facility_id, v_new_id,
       nullif(v_item->>'checklist_item_id', '')::uuid,
       v_item->>'label_snapshot',
       coalesce((v_item->>'is_checked')::boolean, false));
    v_n := v_n + 1;
  end loop;

  -- The line-through: stamp the original. (Audited by
  -- trg_audit_daily_report_submissions like every other change here.)
  update public.daily_report_submissions
     set superseded_at = now(),
         superseded_by = v_new_id
   where id = v_original.id;

  return jsonb_build_object('ok', true, 'correction_id', v_new_id, 'item_count', v_n);
end;
$$;

revoke execute on function public.supersede_daily_report_submission(uuid, text, jsonb)
  from public, anon;
grant execute on function public.supersede_daily_report_submission(uuid, text, jsonb)
  to authenticated, service_role;

comment on function public.supersede_daily_report_submission(uuid, text, jsonb) is
  'Files a correction for a (possibly day-locked) daily-report submission: '
  'inserts a new submission carrying the ORIGINAL business_date + required '
  'reason, and stamps the original superseded (never edited or deleted). '
  'Allowed for daily-reports module admins and the original submitter.';
