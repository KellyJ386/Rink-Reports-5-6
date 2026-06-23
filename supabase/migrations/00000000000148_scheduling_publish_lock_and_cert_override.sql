-- =============================================================================
-- 00000000000148_scheduling_publish_lock_and_cert_override.sql
--
-- Two launch-required Employee-Scheduling guarantees.
--
-- 1. PUBLISH-LOCK (regression-sensitive). A prior audit flagged a publish-lock
--    bypass: once a schedule is published it must be frozen, yet any scheduling
--    admin — or a crafted PostgREST write — could still directly UPDATE/DELETE a
--    `published` schedule_shifts row (the schedule_shifts_update/delete RLS
--    policies gate only on facility + module-admin, never on status). This adds
--    a DB-boundary trigger that REJECTS any mutation of an already-published
--    shift performed by an end-user PostgREST role ('authenticated'/'anon').
--
--    The governed, re-validated flows that legitimately touch published shifts
--    run as SECURITY DEFINER functions owned by the table owner, so they run as
--    'postgres' and are allowed automatically (no edits to them required):
--       scheduling_apply_swap, scheduling_claim_open_shift,
--       scheduling_decide_open_claim, scheduling_approve_publish_request,
--       and the two new admin RPCs below.
--    Publishing a draft (old.status='draft') is unaffected; only an
--    already-published OLD row is locked. INSERTs are unaffected (a brand-new
--    row is created through the normal admin paths, then published via the
--    two-person publish-request RPC).
--
-- 2. CERT-OVERRIDE AUDIT. Missing/expired required certifications hard-block an
--    assignment — scheduling_assignment_violations() already emits
--    'cert_missing:<name>' and treats an expired cert as missing. A
--    facility_manager+ (scheduling admin) may deliberately override the block,
--    but every override is recorded. public.schedule_assignment_overrides is
--    the immutable audit log; public.scheduling_log_cert_override() is its only
--    writer (manager-gated, facility-scoped, SECURITY DEFINER).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Publish-lock trigger.
-- -----------------------------------------------------------------------------
create or replace function public.schedule_shifts_publish_lock()
returns trigger
language plpgsql
as $$
begin
  -- Governed contexts may mutate a published shift:
  --   * SECURITY DEFINER scheduling RPCs run as the table owner ('postgres');
  --   * trusted backend roles (service_role / supabase_admin);
  --   * an explicit transaction-local bypass flag set by a future governed
  --     writer (select set_config('rr.publish_lock_bypass','on',true)).
  -- A direct write from an end-user role — i.e. the grid/edit server actions or
  -- a crafted request — is rejected once the shift is published.
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('rr.publish_lock_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception
        'Schedule is published and locked: a published shift cannot be deleted directly. Cancel it through the scheduling tools or republish.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE: only a row that is ALREADY published is locked. Publishing a draft
  -- (old.status='draft' -> 'published') is how the publish RPC works, so it is
  -- allowed.
  if old.status = 'published' then
    raise exception
      'Schedule is published and locked: edits to a published shift require an explicit republish by a facility manager.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.schedule_shifts_publish_lock() is
  'Publish-lock backstop: rejects direct UPDATE/DELETE of an already-published schedule_shifts row from an end-user PostgREST role. Governed SECURITY DEFINER RPCs (run as the table owner) and trusted backend roles are allowed, so swap/claim/publish/cancel/open-fill keep working. Closes the publish-lock bypass.';

drop trigger if exists trg_schedule_shifts_publish_lock on public.schedule_shifts;
create trigger trg_schedule_shifts_publish_lock
  before update or delete on public.schedule_shifts
  for each row execute function public.schedule_shifts_publish_lock();

-- -----------------------------------------------------------------------------
-- 2a. Admin cancel a shift. Runs as definer so the publish-lock trigger allows
--     cancelling a PUBLISHED shift (a governed status transition, not an edit).
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_admin_cancel_shift(p_shift_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid := public.current_facility_id();
  v_shift       public.schedule_shifts%rowtype;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_cancel_shift: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_shift from public.schedule_shifts where id = p_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Shift not found.');
  end if;
  if not public.is_super_admin() and v_shift.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_cancel_shift: shift belongs to another facility'
      using errcode = '42501';
  end if;
  if v_shift.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;

  update public.schedule_shifts set status = 'cancelled' where id = p_shift_id;
  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.scheduling_admin_cancel_shift(uuid) is
  'Admin cancel of a shift (draft or published). SECURITY DEFINER so a published shift can be cancelled through this governed path while the publish-lock trigger still rejects direct edits. Facility-scoped + scheduling-admin gated.';

revoke execute on function public.scheduling_admin_cancel_shift(uuid) from public, anon;
grant  execute on function public.scheduling_admin_cancel_shift(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2b. Admin assign an employee to an open (published, unassigned) shift.
--     Replaces the direct schedule_shifts UPDATE in admin-core-actions, which
--     the publish-lock now rejects. Re-validates the assignment as a hard block.
-- -----------------------------------------------------------------------------
create or replace function public.scheduling_admin_assign_open_shift(
  p_open_shift_id uuid,
  p_employee_id   uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_employee_id();
  v_facility_id uuid := public.current_facility_id();
  v_open        public.schedule_open_shifts%rowtype;
  v_shift       public.schedule_shifts%rowtype;
  v_codes       text[];
  v_updated     int;
begin
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_admin_assign_open_shift: scheduling admin required'
      using errcode = '42501';
  end if;

  select * into v_open from public.schedule_open_shifts where id = p_open_shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Open shift not found.');
  end if;
  if not public.is_super_admin() and v_open.facility_id is distinct from v_facility_id then
    raise exception 'scheduling_admin_assign_open_shift: listing belongs to another facility'
      using errcode = '42501';
  end if;
  if v_open.claim_status not in ('open', 'claimed') then
    return jsonb_build_object('ok', false, 'error', 'Open shift is no longer available.');
  end if;

  select * into v_shift from public.schedule_shifts where id = v_open.shift_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Parent shift not found.');
  end if;

  if not exists (
    select 1 from public.employees e
     where e.id = p_employee_id and e.facility_id = v_open.facility_id
  ) then
    return jsonb_build_object('ok', false, 'error',
      'That employee isn''t part of your facility.');
  end if;

  -- Hard block: re-validate (cert / overtime / time-off / overlap / ...).
  v_codes := public.scheduling_assignment_violations(
    v_open.facility_id, p_employee_id,
    v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes,
    v_shift.job_area_id, v_shift.id);
  if array_length(v_codes, 1) is not null then
    return jsonb_build_object('ok', false, 'error', 'not_assignable',
      'violations', to_jsonb(v_codes));
  end if;

  update public.schedule_shifts
     set employee_id = p_employee_id
   where id = v_open.shift_id and employee_id is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error',
      'That shift was already assigned to someone else.');
  end if;

  update public.schedule_open_shifts
     set claim_status            = 'filled',
         claimed_by_employee_id  = p_employee_id,
         claimed_at              = now(),
         approved_by_employee_id = v_employee_id,
         approved_at             = now()
   where id = p_open_shift_id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.scheduling_admin_assign_open_shift(uuid, uuid) is
  'Admin direct-assign of an open (published, unassigned) shift to an employee. SECURITY DEFINER (so it works under the publish-lock), facility-scoped, scheduling-admin gated, and hard-block re-validated via scheduling_assignment_violations. Returns jsonb {ok, error?, violations?}.';

revoke execute on function public.scheduling_admin_assign_open_shift(uuid, uuid) from public, anon;
grant  execute on function public.scheduling_admin_assign_open_shift(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Cert-override audit log + its sole writer.
-- -----------------------------------------------------------------------------
create table if not exists public.schedule_assignment_overrides (
  id                        uuid primary key default gen_random_uuid(),
  facility_id               uuid not null references public.facilities(id)          on delete cascade,
  shift_id                  uuid references public.schedule_shifts(id)              on delete set null,
  employee_id               uuid not null references public.employees(id)           on delete cascade,
  job_area_id               uuid references public.employee_job_areas(id)           on delete set null,
  override_type             text not null default 'cert_missing'
                              check (override_type in ('cert_missing')),
  violation_codes           text[] not null default '{}',
  missing_certs             text[] not null default '{}',
  reason                    text check (reason is null or length(reason) <= 1000),
  overridden_by_employee_id uuid references public.employees(id)                    on delete set null,
  overridden_by_user_id     uuid default auth.uid(),
  created_at                timestamptz not null default now()
);

comment on table public.schedule_assignment_overrides is
  'Audit log of cert-gate overrides: a facility_manager+ deliberately assigned an employee to a job area despite a missing/expired required certification. Immutable; written only by scheduling_log_cert_override().';

create index if not exists idx_schedule_assignment_overrides_facility
  on public.schedule_assignment_overrides (facility_id, created_at desc);
create index if not exists idx_schedule_assignment_overrides_employee
  on public.schedule_assignment_overrides (employee_id);

alter table public.schedule_assignment_overrides enable row level security;

-- Read: super admin OR scheduling admin in the row's facility. There is NO
-- write policy: end-user roles cannot INSERT/UPDATE/DELETE audit rows. The
-- SECURITY DEFINER writer below bypasses RLS, keeping the log append-only.
drop policy if exists schedule_assignment_overrides_select on public.schedule_assignment_overrides;
create policy schedule_assignment_overrides_select on public.schedule_assignment_overrides
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_admin_access('scheduling')
    )
  );

create or replace function public.scheduling_log_cert_override(
  p_employee_id     uuid,
  p_job_area_id     uuid,
  p_violation_codes text[],
  p_shift_id        uuid default null,
  p_reason          text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid := public.current_facility_id();
  v_emp_fac     uuid;
  v_missing     text[];
  v_id          uuid;
begin
  -- Override authority: facility_manager or above only.
  if not (public.is_super_admin() or public.has_module_admin_access('scheduling')) then
    raise exception 'scheduling_log_cert_override: facility manager (scheduling admin) required'
      using errcode = '42501';
  end if;
  if p_employee_id is null or p_job_area_id is null then
    raise exception 'scheduling_log_cert_override: employee and job area are required'
      using errcode = '22023';
  end if;

  -- Facility scoping: the employee must belong to the caller's facility.
  select facility_id into v_emp_fac from public.employees where id = p_employee_id;
  if v_emp_fac is null then
    raise exception 'scheduling_log_cert_override: employee not found' using errcode = '22023';
  end if;
  if not public.is_super_admin() and v_emp_fac is distinct from v_facility_id then
    raise exception 'scheduling_log_cert_override: employee belongs to another facility'
      using errcode = '42501';
  end if;

  -- Pull the cert names out of the cert_missing:* codes for a tidy column.
  select coalesce(array_agg(substring(c from 'cert_missing:(.*)')), '{}')
    into v_missing
    from unnest(coalesce(p_violation_codes, '{}')) as c
   where c like 'cert_missing:%';

  insert into public.schedule_assignment_overrides
    (facility_id, shift_id, employee_id, job_area_id, override_type,
     violation_codes, missing_certs, reason, overridden_by_employee_id)
  values
    (v_emp_fac, p_shift_id, p_employee_id, p_job_area_id, 'cert_missing',
     coalesce(p_violation_codes, '{}'),
     v_missing,
     nullif(btrim(coalesce(p_reason, '')), ''),
     public.current_employee_id())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.scheduling_log_cert_override(uuid, uuid, text[], uuid, text) is
  'Records (and authorizes) a cert-gate override. Manager-gated (is_super_admin OR has_module_admin_access(scheduling)) and facility-scoped; the only writer of schedule_assignment_overrides. Returns the new audit row id.';

revoke execute on function public.scheduling_log_cert_override(uuid, uuid, text[], uuid, text) from public, anon;
grant  execute on function public.scheduling_log_cert_override(uuid, uuid, text[], uuid, text) to authenticated, service_role;
