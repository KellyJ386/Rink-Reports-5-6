-- =============================================================================
-- 00000000000253_rink_scheduling_coverage_triggers.sql
-- Make coverage detection BIDIRECTIONAL, and stop gap alerts duplicating.
--
-- 1. A trigger on public.schedule_shifts that enqueues a coverage
--    re-evaluation whenever published shift coverage could have changed.
-- 2. A partial unique index on communication_alerts so one unresolved gap
--    alert exists per booking, rather than one per sweep.
--
-- WHY A TRIGGER ON ANOTHER MODULE'S TABLE, AND WHY THAT IS STILL READ-ONLY
-- INTEGRATION. Module 12 must react to Employee Scheduling publishing,
-- editing or deleting shifts. Polling would either lag or hammer the table.
-- The trigger below reads schedule_shifts and writes ONLY
-- rink_coverage_reeval_queue, a Module 12 table — it inserts nothing into
-- scheduling, updates nothing in scheduling, and cannot block a scheduling
-- write (every failure path is swallowed). The "no writes into Employee
-- Scheduling tables" rule is intact.
--
-- WHY IT CANNOT BREAK PUBLISHING. Publishing a week is a SECURITY DEFINER RPC
-- that flips dozens of rows in one statement. If this trigger raised, it would
-- take the publish down with it. So the whole body is wrapped in an exception
-- handler: a coverage sweep that fails to be scheduled is a missed
-- notification, while a publish that fails is a rink with no staff roster.
-- The cron sweep also runs on its own schedule, so a dropped enqueue
-- self-heals within minutes.
--
-- WHY ONE ROW PER FACILITY. rink_coverage_queue_one_pending_per_facility
-- (migration 247) is a partial unique index on (facility_id) WHERE status =
-- 'pending'. A publish touching 60 shifts therefore produces ONE pending row,
-- not 60 — the debounce the module spec asks for, enforced by the database
-- rather than by application bookkeeping.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Coverage re-evaluation trigger on schedule_shifts
-- -----------------------------------------------------------------------------
create or replace function public.rink_scheduling_enqueue_on_shift_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_facility_id uuid;
  v_relevant    boolean := false;
begin
  -- SECURITY DEFINER because the caller is whoever changed the shift — a
  -- scheduling admin who may hold no rink_scheduling grant at all, and whose
  -- INSERT would otherwise be refused by this queue's RLS policy.
  begin
    v_facility_id := coalesce(new.facility_id, old.facility_id);
    if v_facility_id is null then
      return coalesce(new, old);
    end if;

    -- Only PUBLISHED shifts provide coverage, so only transitions that change
    -- published coverage matter. A draft being edited changes nothing.
    if tg_op = 'INSERT' then
      v_relevant := new.status = 'published';
    elsif tg_op = 'DELETE' then
      v_relevant := old.status = 'published';
    else
      v_relevant :=
        old.status = 'published'
        or new.status = 'published';
      -- An edit that moved neither the window nor the published state cannot
      -- change coverage; skip it so a bulk metadata update stays cheap.
      if v_relevant
         and old.status = new.status
         and old.starts_at = new.starts_at
         and old.ends_at = new.ends_at
         and old.employee_id is not distinct from new.employee_id then
        v_relevant := false;
      end if;
    end if;

    if not v_relevant then
      return coalesce(new, old);
    end if;

    -- The partial unique index collapses a whole publish batch into one row.
    insert into public.rink_coverage_reeval_queue (facility_id, reason, status)
    values (v_facility_id, 'shift_change', 'pending')
    on conflict do nothing;

  exception when others then
    -- Never let a coverage bookkeeping failure take down a scheduling write.
    null;
  end;

  return coalesce(new, old);
end;
$$;

comment on function public.rink_scheduling_enqueue_on_shift_change() is
  'Enqueues a Rink Scheduling coverage re-evaluation when published shift coverage changes. Reads schedule_shifts, writes only rink_coverage_reeval_queue — never writes to any scheduling table. All failures are swallowed so a publish can never fail because of coverage bookkeeping.';

revoke execute on function public.rink_scheduling_enqueue_on_shift_change() from public, anon, authenticated;

drop trigger if exists trg_rink_scheduling_shift_coverage on public.schedule_shifts;
create trigger trg_rink_scheduling_shift_coverage
  after insert or update or delete on public.schedule_shifts
  for each row execute function public.rink_scheduling_enqueue_on_shift_change();

-- -----------------------------------------------------------------------------
-- 2. One open gap alert per booking
--
-- Scoped to source_module = 'rink_scheduling' ON PURPOSE. communication_alerts
-- is shared by every module, and several legitimately raise more than one open
-- alert for the same source record. A global unique index would change their
-- behaviour; this one cannot affect any module but this one.
--
-- With it, the sweep can upsert: a booking that is still gapped keeps its
-- existing alert instead of growing a new one every five minutes, and a gap
-- that clears is resolved rather than deleted, so the history survives.
-- -----------------------------------------------------------------------------
create unique index if not exists communication_alerts_rink_scheduling_open_uniq
  on public.communication_alerts (facility_id, source_record_id)
  where source_module = 'rink_scheduling' and resolved_at is null;

comment on index public.communication_alerts_rink_scheduling_open_uniq is
  'At most one UNRESOLVED rink_scheduling alert per booking, so the recurring coverage sweep updates rather than duplicates. Deliberately scoped to this module: other modules may legitimately hold several open alerts for one record.';

commit;
