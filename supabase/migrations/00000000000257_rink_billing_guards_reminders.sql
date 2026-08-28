-- =============================================================================
-- 00000000000257_rink_billing_guards_reminders.sql
-- Close the two money gaps deferred from the module-wide review, and add the
-- state + settings for automated overdue-invoice reminders and booking
-- confirmation emails.
--
-- 1. OVERPAYMENT BACKSTOP. recordPayment() checks the balance before inserting,
--    but that check is check-then-insert with no database guard: two
--    concurrent recordings against the same nearly-settled invoice could both
--    pass the app check and together exceed the total — and direct SQL from an
--    owner session was never checked at all. rink_payments_guard() (migration
--    254) now also refuses a positive payment that would push the invoice's
--    payment sum past its total, taking a row lock on the invoice so two
--    concurrent inserts serialize instead of both reading the stale sum.
--    Reversals (negative rows) are exempt: they only ever shrink the sum.
--
-- 2. UNPRICED-BOOKING BACKFILL. quoteBooking() returns totalAmount = 0 with
--    `problem` set when no rate card covers the booking's date, and the create/
--    update actions persisted that 0 into computed_amount — indistinguishable
--    from a genuinely-priced $0. The app now stores NULL for problem quotes;
--    this backfills the rows written before the fix. The guarded shape
--    (amount 0, no hourly snapshot, no prime flag, billable type) matches only
--    problem rows: a real uniform-rate quote always carries its snapshot, and
--    a real blended quote of exactly $0 would require every rate on the card
--    to be $0.
--
-- 3. REMINDER STATE + SETTINGS. Overdue reminders are sent by a cron route
--    (service role), which needs to remember when it last nagged so a daily
--    run doesn't email daily: last_reminder_at / reminder_count on
--    rink_invoices. Cadence and enablement are per-facility settings —
--    admin-configurable, never hardcoded — as is the booking-confirmation
--    toggle (OFF by default: a facility opts in to customer-facing email).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Overpayment backstop inside the existing money guard.
--    Behavior from 254 (void-invoice refusal, append-only) is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.rink_payments_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_total numeric;
  v_paid numeric;
begin
  if public.rink_scheduling_guard_exempt() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    -- FOR UPDATE serializes concurrent payments against the same invoice, so
    -- two inserts cannot both read the sum before either lands.
    select i.status, i.total into v_status, v_total
      from public.rink_invoices i
     where i.id = new.invoice_id
       for update;

    -- A void invoice states that nothing is owed. Money recorded against it
    -- corrupts amount_paid, and every AR report reads that column.
    if v_status = 'void' then
      raise exception 'rink_scheduling: cannot record a payment against a void invoice'
        using errcode = '42501';
    end if;

    -- Overpayment backstop: a positive payment may settle the invoice exactly,
    -- never exceed it. Reversals (negative) only shrink the sum and always
    -- pass. Restated here because the app-side check is check-then-insert.
    if new.amount > 0 then
      select coalesce(sum(p.amount), 0) into v_paid
        from public.rink_payments p
       where p.invoice_id = new.invoice_id;

      if v_paid + new.amount > coalesce(v_total, 0) then
        raise exception 'rink_scheduling: payment exceeds the invoice balance'
          using errcode = '23514';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'rink_scheduling: payments are immutable — record a reversal instead'
      using errcode = '42501';
  elsif tg_op = 'DELETE' then
    raise exception 'rink_scheduling: payments cannot be deleted — record a reversal instead'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.rink_payments_guard() is
  'Money guard for rink_payments: append-only (no edits, no deletes), no payment against a void invoice, and no positive payment past the invoice total (checked under a row lock on the invoice so concurrent inserts serialize). Re-states at the trigger layer what RLS and the server actions already enforce, so direct SQL from a non-exempt owner session cannot corrupt amount_paid.';

-- ---------------------------------------------------------------------------
-- 2. Backfill computed_amount for problem-quote rows written before the app
--    started persisting NULL for them.
-- ---------------------------------------------------------------------------

update public.rink_bookings b
   set computed_amount = null
 where b.computed_amount = 0
   and b.rate_snapshot_hourly is null
   and b.rate_snapshot_prime is null
   and exists (
     select 1
       from public.rink_booking_types t
      where t.id = b.booking_type_id
        and t.is_billable
   );

-- ---------------------------------------------------------------------------
-- 3. Reminder state on invoices (written only by the cron's service role).
-- ---------------------------------------------------------------------------

alter table public.rink_invoices
  add column if not exists last_reminder_at timestamptz,
  add column if not exists reminder_count integer not null default 0;

comment on column public.rink_invoices.last_reminder_at is
  'When the overdue-reminder cron last emailed the customer about this invoice. Null until the first reminder. Written by the service role only.';
comment on column public.rink_invoices.reminder_count is
  'How many overdue reminders have been sent for this invoice.';

-- ---------------------------------------------------------------------------
-- 4. Per-facility settings for reminders and confirmations.
-- ---------------------------------------------------------------------------

alter table public.rink_scheduling_settings
  add column if not exists send_booking_confirmations boolean not null default false,
  add column if not exists overdue_reminders_enabled boolean not null default true,
  add column if not exists reminder_cadence_days integer not null default 7;

alter table public.rink_scheduling_settings
  add constraint rink_scheduling_settings_reminder_cadence_chk
    check (reminder_cadence_days between 1 and 90);

comment on column public.rink_scheduling_settings.send_booking_confirmations is
  'When true, creating a booking emails a confirmation to the customer''s billing contact. Off by default: customer-facing email is opt-in.';
comment on column public.rink_scheduling_settings.overdue_reminders_enabled is
  'When true, the daily cron emails customers about invoices past their due date.';
comment on column public.rink_scheduling_settings.reminder_cadence_days is
  'Minimum days between overdue reminders for the same invoice.';

commit;
