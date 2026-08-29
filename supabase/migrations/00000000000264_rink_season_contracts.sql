-- =============================================================================
-- 00000000000264_rink_season_contracts.sql
-- Season contracts for Rink Scheduling & Billing (roadmap tier 5).
--
-- A season contract is the commercial wrapper around recurring ice: a customer
-- commits to one or more booking series across a season window, optionally at
-- a negotiated flat hourly rate, and the module invoices each calendar month
-- of actual ice automatically (in arrears) instead of a biller remembering to.
--
-- SHAPE. rink_season_contracts is the agreement; rink_booking_series gains a
-- nullable contract_id (composite FK, same idiom as rink_bookings.series_id)
-- so a contract binds whole series, never individual bookings; rink_invoices
-- gains a nullable contract_id so a contract's billing history is queryable
-- and the renewal conversation starts from real numbers.
--
-- PRICING. contract_rate (nullable) is a negotiated hourly rate. When set, the
-- app reprices FUTURE bookings of bound series to hours x contract_rate at
-- bind time and on rate edits — a snapshot write through the same
-- computed_amount column the rate engine uses, so invoicing needs no new path.
-- Null means the rate cards price the ice as usual.
--
-- INVOICING. A daily cron generates one invoice per contract per elapsed
-- calendar month: on/after invoice_day_of_month (1-28 so every month has the
-- day), for the PREVIOUS month's still-uninvoiced bookings from bound series.
-- last_invoiced_period ('YYYY-MM') is the idempotency cursor — a cron that
-- fires twice, or catches up after downtime, cannot double-invoice a month.
-- auto_send: false generates DRAFTS for a biller to review and send; true
-- also issues and emails them.
--
-- RETENTION. Contracts are financial agreements, retained like customers and
-- rate cards ("configuration and history, never purged by age") — they carry
-- no requester-style PII and are the paper trail renewals are priced from.
-- =============================================================================

begin;

create table if not exists public.rink_season_contracts (
  id                    uuid primary key default gen_random_uuid(),
  facility_id           uuid not null references public.facilities(id) on delete restrict,
  customer_id           uuid not null,
  name                  text not null,
  season_start          date not null,
  season_end            date not null,
  contract_rate         numeric(10,2),
  status                text not null default 'draft',
  auto_invoice          boolean not null default true,
  auto_send             boolean not null default false,
  invoice_day_of_month  integer not null default 1,
  last_invoiced_period  text,
  renewal_of            uuid,
  notes                 text,
  cancelled_at          timestamptz,
  cancel_reason         text,
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  constraint rink_season_contracts_id_facility_uniq unique (id, facility_id),
  constraint rink_season_contracts_status_chk
    check (status in ('draft', 'active', 'completed', 'cancelled')),
  constraint rink_season_contracts_dates_chk check (season_end > season_start),
  constraint rink_season_contracts_rate_chk
    check (contract_rate is null or contract_rate >= 0),
  constraint rink_season_contracts_invoice_day_chk
    check (invoice_day_of_month between 1 and 28),
  constraint rink_season_contracts_period_chk
    check (last_invoiced_period is null or last_invoiced_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint rink_season_contracts_name_len
    check (char_length(btrim(name)) between 1 and 160),
  constraint rink_season_contracts_notes_len
    check (notes is null or char_length(notes) <= 4000),
  constraint rink_season_contracts_customer_fk
    foreign key (customer_id, facility_id)
    references public.rink_customers (id, facility_id) on delete restrict,
  constraint rink_season_contracts_renewal_fk
    foreign key (renewal_of, facility_id)
    references public.rink_season_contracts (id, facility_id) on delete set null
);

comment on table public.rink_season_contracts is
  'Rink Scheduling: season agreements. Binds a customer''s booking series to a season window, optionally at a negotiated hourly rate; a daily cron invoices each elapsed calendar month of bound ice (last_invoiced_period is the idempotency cursor). renewal_of chains seasons. Financial history — never purged by age.';
comment on column public.rink_season_contracts.contract_rate is
  'Negotiated flat hourly rate. When set, future bookings of bound series are repriced to hours x this rate; null defers to the rate cards.';
comment on column public.rink_season_contracts.invoice_day_of_month is
  'Facility-local day of month the cron invoices the previous month on (1-28 so it exists in every month).';
comment on column public.rink_season_contracts.auto_send is
  'false: monthly invoices are generated as drafts for a biller to review. true: they are issued and emailed on generation.';

create index if not exists idx_rink_season_contracts_facility_status
  on public.rink_season_contracts (facility_id, status, season_end);

drop trigger if exists trg_rink_season_contracts_updated_at on public.rink_season_contracts;
create trigger trg_rink_season_contracts_updated_at
  before update on public.rink_season_contracts
  for each row execute function public.set_updated_at();

alter table public.rink_season_contracts enable row level security;

-- Contracts are money: edit tier throughout, facility-scoped, no deletes
-- (cancellation is a status, the paper trail stays).
create policy rink_season_contracts_select on public.rink_season_contracts
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

create policy rink_season_contracts_insert on public.rink_season_contracts
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

create policy rink_season_contracts_update on public.rink_season_contracts
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

-- ---------------------------------------------------------------------------
-- A series can belong to a contract; an invoice can be traced to one.
-- Composite FKs so a foreign facility's contract id can never be attached —
-- the same idiom rink_bookings.series_id uses.
-- ---------------------------------------------------------------------------

alter table public.rink_booking_series
  add column if not exists contract_id uuid;

alter table public.rink_booking_series
  add constraint rink_booking_series_contract_fk
    foreign key (contract_id, facility_id)
    references public.rink_season_contracts (id, facility_id) on delete set null;

comment on column public.rink_booking_series.contract_id is
  'Season contract this series is bound to, if any. Composite FK with facility_id so cross-facility binding is impossible.';

create index if not exists idx_rink_booking_series_contract
  on public.rink_booking_series (contract_id) where contract_id is not null;

alter table public.rink_invoices
  add column if not exists contract_id uuid;

alter table public.rink_invoices
  add constraint rink_invoices_contract_fk
    foreign key (contract_id, facility_id)
    references public.rink_season_contracts (id, facility_id) on delete set null;

comment on column public.rink_invoices.contract_id is
  'Season contract this invoice was generated under, if any. Provenance for contract billing history and renewal pricing.';

create index if not exists idx_rink_invoices_contract
  on public.rink_invoices (contract_id) where contract_id is not null;

commit;
