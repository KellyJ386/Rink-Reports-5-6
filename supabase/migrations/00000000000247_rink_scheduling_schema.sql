-- =============================================================================
-- 00000000000247_rink_scheduling_schema.sql
-- Module #12 "rink_scheduling" (Rink Scheduling & Billing) — tables.
--
-- Scoping: facility -> facility_rinks / facility_locker_rooms / operating hours
-- (the "Facility Setup" root) -> rink_bookings -> locker room assignments,
-- invoices, payments.
--
-- Two structural notes worth reading before editing this file:
--
-- A. THE CONFLICT GUARANTEE IS A TABLE CONSTRAINT, NOT APPLICATION CODE.
--    rink_bookings_no_overlap is an EXCLUDE USING gist constraint over
--    (rink_id, tstzrange(starts_at, blocks_until, '[)')) for non-cancelled
--    rows. Overlapping bookings on one sheet of ice — including the
--    resurfacing buffer — are impossible regardless of application bugs,
--    concurrency, or direct SQL. Server actions insert and translate the
--    resulting 23P01 into a user-facing conflict resolution flow; they must
--    never pre-check-then-insert as the only guard. btree_gist has been
--    installed since migration 140 (schedule_shifts_no_double_booking uses
--    the same '[)' half-open shape).
--
-- B. WHY blocks_until IS A STORED COLUMN AND NOT ends_at + buffer INLINE.
--    An exclusion constraint's expressions must be IMMUTABLE. In PostgreSQL
--    `timestamptz + interval` is only STABLE (interval arithmetic can depend
--    on the TimeZone setting), so writing
--      tstzrange(starts_at, ends_at + make_interval(mins => buffer), '[)')
--    directly in the constraint is rejected, and a GENERATED column hits the
--    same rule. blocks_until is therefore a real column maintained by the
--    BEFORE INSERT/UPDATE trigger rink_bookings_sync_blocks_until, which
--    overwrites any client-supplied value unconditionally. Never write to it
--    from application code; change buffer_minutes_after instead.
-- =============================================================================

begin;

-- =============================================================================
-- FACILITY SETUP: rinks, locker rooms, operating hours
-- =============================================================================

-- -----------------------------------------------------------------------------
-- facility_rinks — physical ice surfaces, the calendar's columns.
--
-- Deliberately a NEW shared table rather than a reuse of ice_depth_rinks /
-- ice_operations_rinks / dasher_boards_rinks. Those three are module-scoped by
-- documented house convention (see migration 191's header) and each carries
-- module-specific baggage (diagram layouts, perimeter geometry). Scheduling
-- needs the rink as a bookable resource with a display color and a short code
-- for the TV display, and putting a billing dependency on a measurement
-- module's table would couple invoice history to ice-depth setup.
-- -----------------------------------------------------------------------------
create table if not exists public.facility_rinks (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  name          text not null,
  slug          text not null,
  short_code    text not null,
  display_color text not null default '#4DFF00',
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint facility_rinks_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint facility_rinks_short_code_len check (char_length(btrim(short_code)) between 1 and 8),
  constraint facility_rinks_color_hex check (display_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint facility_rinks_facility_slug_uniq unique (facility_id, slug),
  constraint facility_rinks_facility_short_code_uniq unique (facility_id, short_code),
  -- Target for facility-fenced composite FKs from every child table.
  constraint facility_rinks_id_facility_uniq unique (id, facility_id)
);

comment on table public.facility_rinks is
  'Rink Scheduling: physical ice surfaces per facility. The calendar renders one column per active rink in sort_order. A facility is capped at 10 ACTIVE rinks; that cap is enforced in the server action (see src/app/admin/rink-scheduling) because it is a product rule, not a data invariant — deactivating below the cap must always remain possible.';
comment on column public.facility_rinks.short_code is
  'Compact label for the TV display and dense grid headers (e.g. "MAIN", "OVAL").';
comment on column public.facility_rinks.display_color is
  'Hex color for calendar blocks. Stored as a literal because it is admin-chosen per rink; app chrome still uses semantic tokens.';

create index if not exists idx_facility_rinks_facility_active
  on public.facility_rinks (facility_id, is_active, sort_order);

drop trigger if exists trg_facility_rinks_updated_at on public.facility_rinks;
create trigger trg_facility_rinks_updated_at
  before update on public.facility_rinks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- facility_locker_rooms — bookable locker rooms.
--
-- Greenfield: before this migration locker rooms existed only as Daily Reports
-- checklist content (one daily_report_areas row + item labels) and a single
-- free-text "Locker Room" row in facility_spaces. Neither carries per-room
-- identity or capacity, so a facility with eight rooms could not represent
-- them. Linking the Daily Reports inspection checklists to these rows is
-- deliberately OUT OF SCOPE here and left for a later module.
-- -----------------------------------------------------------------------------
create table if not exists public.facility_locker_rooms (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  name            text not null,
  slug            text not null,
  short_code      text not null,
  capacity        integer,
  default_rink_id uuid,
  notes           text,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  constraint facility_locker_rooms_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint facility_locker_rooms_short_code_len check (char_length(btrim(short_code)) between 1 and 8),
  constraint facility_locker_rooms_capacity_sane check (capacity is null or capacity between 1 and 500),
  constraint facility_locker_rooms_facility_slug_uniq unique (facility_id, slug),
  constraint facility_locker_rooms_facility_short_code_uniq unique (facility_id, short_code),
  constraint facility_locker_rooms_id_facility_uniq unique (id, facility_id),
  -- Facility-fenced: a room cannot default to another tenant's rink.
  constraint facility_locker_rooms_rink_fk
    foreign key (default_rink_id, facility_id)
    references public.facility_rinks (id, facility_id) on delete set null
);

comment on table public.facility_locker_rooms is
  'Rink Scheduling: bookable locker rooms per facility. Assigned to bookings via rink_locker_room_assignments and surfaced on the public TV display by short_code.';
comment on column public.facility_locker_rooms.default_rink_id is
  'Optional rink association — rooms usually sit rink-side. Advisory only; a room may be assigned to a booking on any rink.';

create index if not exists idx_facility_locker_rooms_facility_active
  on public.facility_locker_rooms (facility_id, is_active, sort_order);

drop trigger if exists trg_facility_locker_rooms_updated_at on public.facility_locker_rooms;
create trigger trg_facility_locker_rooms_updated_at
  before update on public.facility_locker_rooms
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- facility_operating_hours — weekly open/close, facility-local wall clock.
--
-- Module 7 already carries schedule_settings.operating_hours_{start,end}_minute
-- (migration 232), but that is ONE window applied to every day and cannot
-- express "closed Sundays" or per-day hours, which the coverage engine needs.
-- This table is authoritative for Module 12; module 7's columns are untouched.
-- The duplication is deliberate and noted for future consolidation.
--
-- open_time/close_time are `time` in the FACILITY's zone (facilities.timezone),
-- never UTC. close_time '24:00' is not representable in `time`; a day that runs
-- to midnight uses '23:59:59'. Days that cross midnight (a 6am-2am rink) are
-- modelled as open_time > close_time and interpreted as wrapping into the next
-- calendar day — resolveOperatingWindow() in the app owns that reading.
-- -----------------------------------------------------------------------------
create table if not exists public.facility_operating_hours (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  day_of_week integer not null,
  open_time   time without time zone,
  close_time  time without time zone,
  is_closed   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint facility_operating_hours_dow check (day_of_week between 0 and 6),
  constraint facility_operating_hours_times_present check (
    (is_closed and open_time is null and close_time is null)
    or (not is_closed and open_time is not null and close_time is not null)
  ),
  constraint facility_operating_hours_facility_dow_uniq unique (facility_id, day_of_week)
);

comment on table public.facility_operating_hours is
  'Rink Scheduling: per-facility weekly operating hours in FACILITY-LOCAL wall clock (facilities.timezone). Authoritative for coverage gap_hours checks and calendar shading. day_of_week: 0=Sunday..6=Saturday, matching schedule_settings.week_start_day.';
comment on column public.facility_operating_hours.open_time is
  'Facility-local. When open_time > close_time the day wraps past midnight into the following calendar day.';

drop trigger if exists trg_facility_operating_hours_updated_at on public.facility_operating_hours;
create trigger trg_facility_operating_hours_updated_at
  before update on public.facility_operating_hours
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- facility_operating_hours_exceptions — holidays and special days.
-- -----------------------------------------------------------------------------
create table if not exists public.facility_operating_hours_exceptions (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  exception_date date not null,
  open_time      time without time zone,
  close_time     time without time zone,
  is_closed      boolean not null default false,
  label          text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  constraint facility_hours_exceptions_label_len check (char_length(btrim(label)) between 1 and 120),
  constraint facility_hours_exceptions_times_present check (
    (is_closed and open_time is null and close_time is null)
    or (not is_closed and open_time is not null and close_time is not null)
  ),
  constraint facility_hours_exceptions_facility_date_uniq unique (facility_id, exception_date)
);

comment on table public.facility_operating_hours_exceptions is
  'Rink Scheduling: holiday / special-day overrides. A row for a date fully REPLACES that date''s facility_operating_hours row for coverage and shading purposes.';

create index if not exists idx_facility_hours_exceptions_facility_date
  on public.facility_operating_hours_exceptions (facility_id, exception_date);

drop trigger if exists trg_facility_hours_exceptions_updated_at on public.facility_operating_hours_exceptions;
create trigger trg_facility_hours_exceptions_updated_at
  before update on public.facility_operating_hours_exceptions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- MODULE SETTINGS & LOOKUPS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- rink_scheduling_settings — one row per facility (schedule_settings pattern).
-- -----------------------------------------------------------------------------
create table if not exists public.rink_scheduling_settings (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  default_buffer_minutes      integer not null default 15,
  slot_increment_minutes      integer not null default 30,
  default_payment_terms_days  integer not null default 30,
  invoice_prefix              text    not null default 'INV-',
  tax_rate                    numeric(6,4),
  coverage_check_enabled      boolean not null default true,
  locker_lead_minutes         integer not null default 45,
  locker_vacate_minutes       integer not null default 30,
  display_refresh_seconds     integer not null default 60,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz,
  constraint rink_scheduling_settings_buffer_chk check (default_buffer_minutes between 0 and 120),
  constraint rink_scheduling_settings_slot_chk check (slot_increment_minutes in (5, 10, 15, 20, 30, 60)),
  constraint rink_scheduling_settings_terms_chk check (default_payment_terms_days between 0 and 365),
  constraint rink_scheduling_settings_prefix_chk check (invoice_prefix ~ '^[A-Za-z0-9-]{0,12}$'),
  constraint rink_scheduling_settings_tax_chk check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1)),
  constraint rink_scheduling_settings_lead_chk check (locker_lead_minutes between 0 and 480),
  constraint rink_scheduling_settings_vacate_chk check (locker_vacate_minutes between 0 and 480),
  constraint rink_scheduling_settings_refresh_chk check (display_refresh_seconds between 15 and 3600),
  constraint rink_scheduling_settings_facility_uniq unique (facility_id)
);

comment on table public.rink_scheduling_settings is
  'Rink Scheduling: per-facility module settings, one row per facility (schedule_settings pattern). Read with maybeSingle() and fall back to these defaults; SELECT * when loading for the settings form so an omitted column cannot silently revert a flag on save.';
comment on column public.rink_scheduling_settings.tax_rate is
  'Tax as a FRACTION, not a percentage: 0.0875 = 8.75%. NULL means no tax line on invoices.';
comment on column public.rink_scheduling_settings.default_buffer_minutes is
  'Resurfacing buffer copied onto each booking at creation (rink_bookings.buffer_minutes_after). Changing it never mutates existing bookings.';

drop trigger if exists trg_rink_scheduling_settings_updated_at on public.rink_scheduling_settings;
create trigger trg_rink_scheduling_settings_updated_at
  before update on public.rink_scheduling_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rink_invoice_counters — invoice sequence, separate from settings ON PURPOSE.
--
-- Invoice creation is an `edit`-tier capability (facility_manager), but module
-- settings are `admin`-tier (org_admin). If next_seq lived on the settings row
-- a manager could not increment it without an admin grant, and widening the
-- settings UPDATE policy to edit would hand managers the tax rate and invoice
-- prefix too. A dedicated one-column-per-facility counter lets the number be
-- claimed atomically under plain RLS:
--   update rink_invoice_counters set next_seq = next_seq + 1
--    where facility_id = $1 returning next_seq - 1
-- which is race-free (the UPDATE takes a row lock) and needs no SECURITY
-- DEFINER function — see invariant 3 in the module spec.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_invoice_counters (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  next_seq    integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint rink_invoice_counters_seq_chk check (next_seq >= 1),
  constraint rink_invoice_counters_facility_uniq unique (facility_id)
);

comment on table public.rink_invoice_counters is
  'Rink Scheduling: per-facility invoice number sequence. Claimed with an atomic UPDATE ... RETURNING so no SECURITY DEFINER function is needed. Deliberately separate from rink_scheduling_settings because invoicing is edit-tier while settings are admin-tier.';

drop trigger if exists trg_rink_invoice_counters_updated_at on public.rink_invoice_counters;
create trigger trg_rink_invoice_counters_updated_at
  before update on public.rink_invoice_counters
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rink_customer_types — admin-extendable lookup.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_customer_types (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  name        text not null,
  slug        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint rink_customer_types_name_len check (char_length(btrim(name)) between 1 and 60),
  constraint rink_customer_types_facility_slug_uniq unique (facility_id, slug),
  constraint rink_customer_types_id_facility_uniq unique (id, facility_id)
);

comment on table public.rink_customer_types is
  'Rink Scheduling: admin-extendable customer classification (internal program, university department, team, league, school, individual, other). Deactivate rather than delete once referenced.';

drop trigger if exists trg_rink_customer_types_updated_at on public.rink_customer_types;
create trigger trg_rink_customer_types_updated_at
  before update on public.rink_customer_types
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rink_booking_types — admin-configurable, drives color and billability.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_booking_types (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  name        text not null,
  slug        text not null,
  color       text not null default '#002244',
  is_billable boolean not null default true,
  is_system   boolean not null default false,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint rink_booking_types_name_len check (char_length(btrim(name)) between 1 and 60),
  constraint rink_booking_types_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint rink_booking_types_facility_slug_uniq unique (facility_id, slug),
  constraint rink_booking_types_id_facility_uniq unique (id, facility_id)
);

comment on table public.rink_booking_types is
  'Rink Scheduling: admin-configurable booking types. is_billable = false means the slot occupies ice but never reaches an invoice (Maintenance Block). is_system marks seeded types whose billability the UI protects from edits.';
comment on column public.rink_booking_types.is_system is
  'True for the seeded Maintenance Block type. System types may be renamed and recolored but not made billable and not deleted, because the "customer optional" rule keys off a non-billable type.';

create index if not exists idx_rink_booking_types_facility_active
  on public.rink_booking_types (facility_id, is_active, sort_order);

drop trigger if exists trg_rink_booking_types_updated_at on public.rink_booking_types;
create trigger trg_rink_booking_types_updated_at
  before update on public.rink_booking_types
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rink_payment_methods — admin-configurable lookup.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_payment_methods (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  name        text not null,
  slug        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint rink_payment_methods_name_len check (char_length(btrim(name)) between 1 and 60),
  constraint rink_payment_methods_facility_slug_uniq unique (facility_id, slug),
  constraint rink_payment_methods_id_facility_uniq unique (id, facility_id)
);

comment on table public.rink_payment_methods is
  'Rink Scheduling: admin-configurable payment methods (Check, ACH, Card (recorded), Internal Chargeback, Cash, Other). "Card (recorded)" is a record of a card payment taken elsewhere — this module never touches card data.';

drop trigger if exists trg_rink_payment_methods_updated_at on public.rink_payment_methods;
create trigger trg_rink_payment_methods_updated_at
  before update on public.rink_payment_methods
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RATE CARDS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- rink_rate_cards — dated rate schedules.
--
-- The default-card overlap rule is a second exclusion constraint rather than an
-- application check: two default cards covering the same date would make rate
-- resolution ambiguous, and "which card applies on 2026-11-03" must have exactly
-- one answer at every instant. Non-default cards may overlap freely — they are
-- selected explicitly per customer.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_rate_cards (
  id                   uuid primary key default gen_random_uuid(),
  facility_id          uuid not null references public.facilities(id) on delete restrict,
  name                 text not null,
  effective_start      date not null,
  effective_end        date,
  is_default           boolean not null default false,
  hourly_rate_prime    numeric(10,2) not null default 0,
  hourly_rate_nonprime numeric(10,2) not null default 0,
  currency             text not null default 'USD',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint rink_rate_cards_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint rink_rate_cards_date_order check (effective_end is null or effective_end >= effective_start),
  constraint rink_rate_cards_prime_nonneg check (hourly_rate_prime >= 0),
  constraint rink_rate_cards_nonprime_nonneg check (hourly_rate_nonprime >= 0),
  constraint rink_rate_cards_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint rink_rate_cards_id_facility_uniq unique (id, facility_id),
  -- At most one DEFAULT card in effect on any given date, per facility.
  constraint rink_rate_cards_no_default_overlap exclude using gist (
    facility_id with =,
    daterange(effective_start, coalesce(effective_end, 'infinity'::date), '[]') with &&
  ) where (is_default)
);

comment on table public.rink_rate_cards is
  'Rink Scheduling: dated rate schedules. Anything outside a rink_rate_card_windows prime window is billed at hourly_rate_nonprime. Rates are SNAPSHOTTED onto each booking at save, so editing a card never mutates existing bookings or issued invoices.';
comment on constraint rink_rate_cards_no_default_overlap on public.rink_rate_cards is
  'Guarantees a single unambiguous default card per facility per date. Non-default cards may overlap; they are chosen explicitly per customer.';

create index if not exists idx_rink_rate_cards_facility_dates
  on public.rink_rate_cards (facility_id, effective_start, effective_end);

drop trigger if exists trg_rink_rate_cards_updated_at on public.rink_rate_cards;
create trigger trg_rink_rate_cards_updated_at
  before update on public.rink_rate_cards
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rink_rate_card_windows — prime-time windows, facility-local wall clock.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_rate_card_windows (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  rate_card_id uuid not null,
  day_of_week  integer not null,
  start_time   time without time zone not null,
  end_time     time without time zone not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint rink_rate_card_windows_dow check (day_of_week between 0 and 6),
  constraint rink_rate_card_windows_time_order check (end_time > start_time),
  constraint rink_rate_card_windows_card_fk
    foreign key (rate_card_id, facility_id)
    references public.rink_rate_cards (id, facility_id) on delete cascade
);

comment on table public.rink_rate_card_windows is
  'Rink Scheduling: prime-time windows for a rate card, in FACILITY-LOCAL wall clock. Any part of a booking outside every window for its day is non-prime. A booking straddling a boundary is split across both rates by the rate engine.';

create index if not exists idx_rink_rate_card_windows_card
  on public.rink_rate_card_windows (rate_card_id, day_of_week);

drop trigger if exists trg_rink_rate_card_windows_updated_at on public.rink_rate_card_windows;
create trigger trg_rink_rate_card_windows_updated_at
  before update on public.rink_rate_card_windows
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rink_rate_card_type_overrides — per-booking-type rates ($0 internal, etc).
-- -----------------------------------------------------------------------------
create table if not exists public.rink_rate_card_type_overrides (
  id                   uuid primary key default gen_random_uuid(),
  facility_id          uuid not null references public.facilities(id) on delete restrict,
  rate_card_id         uuid not null,
  booking_type_id      uuid not null,
  hourly_rate_prime    numeric(10,2) not null default 0,
  hourly_rate_nonprime numeric(10,2) not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint rink_rate_type_overrides_prime_nonneg check (hourly_rate_prime >= 0),
  constraint rink_rate_type_overrides_nonprime_nonneg check (hourly_rate_nonprime >= 0),
  constraint rink_rate_type_overrides_card_type_uniq unique (rate_card_id, booking_type_id),
  constraint rink_rate_type_overrides_card_fk
    foreign key (rate_card_id, facility_id)
    references public.rink_rate_cards (id, facility_id) on delete cascade,
  constraint rink_rate_type_overrides_type_fk
    foreign key (booking_type_id, facility_id)
    references public.rink_booking_types (id, facility_id) on delete cascade
);

comment on table public.rink_rate_card_type_overrides is
  'Rink Scheduling: per-booking-type rate override on a card. Lets an internal program or chargeback type carry $0 or a reduced rate while the same card prices commercial rentals normally.';

drop trigger if exists trg_rink_rate_type_overrides_updated_at on public.rink_rate_card_type_overrides;
create trigger trg_rink_rate_type_overrides_updated_at
  before update on public.rink_rate_card_type_overrides
  for each row execute function public.set_updated_at();

-- =============================================================================
-- CUSTOMERS
-- =============================================================================

create table if not exists public.rink_customers (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references public.facilities(id) on delete restrict,
  name                     text not null,
  customer_type_id         uuid,
  contact_name             text,
  contact_email            text,
  contact_phone            text,
  billing_address_line1    text,
  billing_address_line2    text,
  billing_city             text,
  billing_state            text,
  billing_zip              text,
  payment_terms_days       integer,
  default_rate_card_id     uuid,
  internal_chargeback_code text,
  notes                    text,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  constraint rink_customers_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint rink_customers_terms_chk check (payment_terms_days is null or payment_terms_days between 0 and 365),
  constraint rink_customers_email_chk check (contact_email is null or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint rink_customers_id_facility_uniq unique (id, facility_id),
  constraint rink_customers_type_fk
    foreign key (customer_type_id, facility_id)
    references public.rink_customer_types (id, facility_id) on delete set null,
  constraint rink_customers_rate_card_fk
    foreign key (default_rate_card_id, facility_id)
    references public.rink_rate_cards (id, facility_id) on delete set null
);

comment on table public.rink_customers is
  'Rink Scheduling: billing and booking parties. payment_terms_days NULL means inherit rink_scheduling_settings.default_payment_terms_days at invoice time; default_rate_card_id NULL means use the facility default card in effect on the booking date.';
comment on column public.rink_customers.internal_chargeback_code is
  'Internal cost-centre / chargeback code for university departments and internal programs billed by journal transfer rather than invoice payment.';

create index if not exists idx_rink_customers_facility_active
  on public.rink_customers (facility_id, is_active, name);

drop trigger if exists trg_rink_customers_updated_at on public.rink_customers;
create trigger trg_rink_customers_updated_at
  before update on public.rink_customers
  for each row execute function public.set_updated_at();

-- =============================================================================
-- BOOKINGS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- rink_booking_series — recurring contracts.
--
-- The recurrence is stored as STRUCTURED COLUMNS, not an RRULE string, so the
-- edit UI can round-trip it without a parser and so days_of_week is queryable.
-- Occurrences are always real rink_bookings rows: nothing is computed on read,
-- because each occurrence carries its own rate snapshot, coverage status, and
-- invoice linkage.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_booking_series (
  id                   uuid primary key default gen_random_uuid(),
  facility_id          uuid not null references public.facilities(id) on delete restrict,
  customer_id          uuid,
  rink_id              uuid not null,
  booking_type_id      uuid not null,
  title                text,
  frequency            text not null default 'weekly',
  interval_weeks       integer not null default 1,
  days_of_week         integer[] not null,
  start_time           time without time zone not null,
  end_time             time without time zone not null,
  series_start_date    date not null,
  series_end_date      date not null,
  rate_card_id         uuid,
  notes                text,
  status               text not null default 'active',
  created_by           uuid references public.employees(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint rink_booking_series_frequency_chk check (frequency in ('weekly')),
  constraint rink_booking_series_interval_chk check (interval_weeks between 1 and 12),
  constraint rink_booking_series_dow_chk check (
    array_length(days_of_week, 1) between 1 and 7
    and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]
  ),
  constraint rink_booking_series_time_order check (end_time > start_time),
  constraint rink_booking_series_date_order check (series_end_date >= series_start_date),
  constraint rink_booking_series_status_chk check (status in ('active', 'cancelled')),
  constraint rink_booking_series_id_facility_uniq unique (id, facility_id),
  constraint rink_booking_series_rink_fk
    foreign key (rink_id, facility_id)
    references public.facility_rinks (id, facility_id) on delete restrict,
  constraint rink_booking_series_customer_fk
    foreign key (customer_id, facility_id)
    references public.rink_customers (id, facility_id) on delete restrict,
  constraint rink_booking_series_type_fk
    foreign key (booking_type_id, facility_id)
    references public.rink_booking_types (id, facility_id) on delete restrict,
  constraint rink_booking_series_rate_card_fk
    foreign key (rate_card_id, facility_id)
    references public.rink_rate_cards (id, facility_id) on delete set null
);

comment on table public.rink_booking_series is
  'Rink Scheduling: recurring booking contracts. Recurrence is structured (frequency + interval_weeks + days_of_week + times + date range) rather than an RRULE string so the UI can edit it directly. start_time/end_time are FACILITY-LOCAL; each generated occurrence resolves them against facilities.timezone for the occurrence date, so a series spanning a DST boundary keeps its wall-clock time.';
comment on column public.rink_booking_series.days_of_week is
  '0=Sunday..6=Saturday, matching facility_operating_hours.day_of_week.';

create index if not exists idx_rink_booking_series_facility
  on public.rink_booking_series (facility_id, status, series_start_date);

drop trigger if exists trg_rink_booking_series_updated_at on public.rink_booking_series;
create trigger trg_rink_booking_series_updated_at
  before update on public.rink_booking_series
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rink_bookings — one row per ice slot. See header notes A and B.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_bookings (
  id                   uuid primary key default gen_random_uuid(),
  facility_id          uuid not null references public.facilities(id) on delete restrict,
  rink_id              uuid not null,
  customer_id          uuid,
  series_id            uuid,
  booking_type_id      uuid not null,
  title                text,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  buffer_minutes_after integer not null default 0,
  blocks_until         timestamptz not null,
  status               text not null default 'tentative',
  rate_snapshot_hourly numeric(10,2),
  rate_snapshot_prime  boolean,
  computed_amount      numeric(12,2),
  coverage_status      text not null default 'covered',
  coverage_checked_at  timestamptz,
  notes                text,
  created_by           uuid references public.employees(id) on delete set null,
  cancelled_at         timestamptz,
  cancelled_by         uuid references public.employees(id) on delete set null,
  cancellation_reason  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint rink_bookings_time_order check (ends_at > starts_at),
  constraint rink_bookings_buffer_chk check (buffer_minutes_after between 0 and 120),
  constraint rink_bookings_blocks_until_chk check (blocks_until >= ends_at),
  constraint rink_bookings_status_chk check (status in ('tentative', 'confirmed', 'cancelled')),
  constraint rink_bookings_coverage_chk check (
    coverage_status in ('covered', 'gap_hours', 'gap_staffing', 'gap_both')
  ),
  constraint rink_bookings_cancel_coherent check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  ),
  constraint rink_bookings_amount_nonneg check (computed_amount is null or computed_amount >= 0),
  constraint rink_bookings_id_facility_uniq unique (id, facility_id),
  constraint rink_bookings_rink_fk
    foreign key (rink_id, facility_id)
    references public.facility_rinks (id, facility_id) on delete restrict,
  constraint rink_bookings_customer_fk
    foreign key (customer_id, facility_id)
    references public.rink_customers (id, facility_id) on delete restrict,
  constraint rink_bookings_series_fk
    foreign key (series_id, facility_id)
    references public.rink_booking_series (id, facility_id) on delete set null,
  constraint rink_bookings_type_fk
    foreign key (booking_type_id, facility_id)
    references public.rink_booking_types (id, facility_id) on delete restrict,
  -- ===========================================================================
  -- THE conflict guarantee. Non-cancelled bookings on one rink can never
  -- overlap, buffer included. '[)' half-open matches
  -- schedule_shifts_no_double_booking so a slot ending exactly when the next
  -- begins is NOT a conflict.
  -- ===========================================================================
  constraint rink_bookings_no_overlap exclude using gist (
    rink_id with =,
    tstzrange(starts_at, blocks_until, '[)') with &&
  ) where (status <> 'cancelled')
);

comment on table public.rink_bookings is
  'Rink Scheduling: one row per ice slot. Overlap prevention (buffer inclusive) is enforced by the rink_bookings_no_overlap exclusion constraint, which is the source of truth — server actions insert and translate 23P01 into a conflict resolution flow rather than relying on a pre-check.';
comment on column public.rink_bookings.blocks_until is
  'ends_at + buffer_minutes_after, maintained by trg_rink_bookings_blocks_until. Never write this from application code: an exclusion constraint needs an IMMUTABLE expression and timestamptz + interval is only STABLE, so the sum must be materialised. Change buffer_minutes_after instead.';
comment on column public.rink_bookings.rate_snapshot_hourly is
  'Rate captured at save time. Later rate-card edits never mutate an existing booking. NULL for non-billable types.';
comment on column public.rink_bookings.rate_snapshot_prime is
  'True when the whole slot fell in prime time, false when wholly non-prime, NULL when it straddled a boundary and computed_amount is the blended total of both segments.';
comment on column public.rink_bookings.coverage_status is
  'Maintained by the coverage engine, never set by hand. gap_hours = outside facility operating hours; gap_staffing = no published shift spans the window; gap_both = both.';

create index if not exists idx_rink_bookings_facility_rink_start
  on public.rink_bookings (facility_id, rink_id, starts_at);
create index if not exists idx_rink_bookings_facility_start
  on public.rink_bookings (facility_id, starts_at);
create index if not exists idx_rink_bookings_customer
  on public.rink_bookings (customer_id, starts_at);
create index if not exists idx_rink_bookings_series
  on public.rink_bookings (series_id, starts_at) where series_id is not null;
create index if not exists idx_rink_bookings_coverage_gaps
  on public.rink_bookings (facility_id, starts_at)
  where coverage_status <> 'covered' and status <> 'cancelled';

drop trigger if exists trg_rink_bookings_updated_at on public.rink_bookings;
create trigger trg_rink_bookings_updated_at
  before update on public.rink_bookings
  for each row execute function public.set_updated_at();

-- blocks_until is derived, always, from ends_at + buffer_minutes_after.
create or replace function public.rink_bookings_sync_blocks_until()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.blocks_until := new.ends_at
    + make_interval(mins => coalesce(new.buffer_minutes_after, 0));
  return new;
end;
$$;

comment on function public.rink_bookings_sync_blocks_until() is
  'Materialises rink_bookings.blocks_until so the overlap exclusion constraint has an IMMUTABLE expression to index. Overwrites any client-supplied value unconditionally.';

drop trigger if exists trg_rink_bookings_blocks_until on public.rink_bookings;
create trigger trg_rink_bookings_blocks_until
  before insert or update on public.rink_bookings
  for each row execute function public.rink_bookings_sync_blocks_until();

-- A booking may omit a customer only when its type is non-billable
-- (Maintenance Block). Cross-row rule, so a trigger rather than a CHECK.
create or replace function public.rink_bookings_require_customer()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_billable boolean;
begin
  if new.customer_id is not null then
    return new;
  end if;

  select bt.is_billable into v_billable
  from public.rink_booking_types bt
  where bt.id = new.booking_type_id;

  if coalesce(v_billable, true) then
    raise exception 'rink_scheduling: a billable booking requires a customer'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.rink_bookings_require_customer() is
  'Enforces "customer_id is optional only for non-billable booking types" (Maintenance Block). A cross-row rule, so it cannot be a CHECK constraint.';

drop trigger if exists trg_rink_bookings_require_customer on public.rink_bookings;
create trigger trg_rink_bookings_require_customer
  before insert or update of customer_id, booking_type_id on public.rink_bookings
  for each row execute function public.rink_bookings_require_customer();

-- =============================================================================
-- LOCKER ROOM ASSIGNMENTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- rink_locker_room_assignments — rooms attached to bookings.
--
-- NOTE THE ABSENCE OF AN EXCLUSION CONSTRAINT. That is deliberate and is the
-- opposite call from rink_bookings. Locker rooms are legitimately shared and
-- turned over fast: a squad clearing out at 18:05 while the next team's window
-- opened at 18:00 is normal operations, not a data error. Overlaps are computed
-- and surfaced as warnings in the assignment picker and the locker room day
-- view (hatched border + icon) — never silently, and never blocked.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_locker_room_assignments (
  id                     uuid primary key default gen_random_uuid(),
  facility_id            uuid not null references public.facilities(id) on delete restrict,
  booking_id             uuid not null,
  locker_room_id         uuid not null,
  occupies_from          timestamptz not null,
  occupies_until         timestamptz not null,
  display_label_override text,
  notes                  text,
  created_by             uuid references public.employees(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz,
  constraint rink_locker_assignments_time_order check (occupies_until > occupies_from),
  constraint rink_locker_assignments_label_len check (
    display_label_override is null
    or char_length(btrim(display_label_override)) between 1 and 40
  ),
  constraint rink_locker_assignments_booking_room_uniq unique (booking_id, locker_room_id),
  constraint rink_locker_assignments_booking_fk
    foreign key (booking_id, facility_id)
    references public.rink_bookings (id, facility_id) on delete cascade,
  constraint rink_locker_assignments_room_fk
    foreign key (locker_room_id, facility_id)
    references public.facility_locker_rooms (id, facility_id) on delete restrict
);

comment on table public.rink_locker_room_assignments is
  'Rink Scheduling: locker rooms attached to a booking. A booking may hold several rooms (home/visitor) and a room may host many bookings. Overlaps are ALLOWED BY DESIGN and surfaced as warnings — fast turnover is normal. Rows cascade away when their booking is deleted; the display drops them as soon as the booking is cancelled.';
comment on column public.rink_locker_room_assignments.occupies_from is
  'Defaults to booking start minus rink_scheduling_settings.locker_lead_minutes, overridable per assignment.';
comment on column public.rink_locker_room_assignments.display_label_override is
  'What the public TV display shows instead of the customer name (e.g. "Home", "Visitors"). Also the privacy lever for bookings whose customer name should not be on a lobby screen.';

create index if not exists idx_rink_locker_assignments_room_window
  on public.rink_locker_room_assignments (facility_id, locker_room_id, occupies_from, occupies_until);
create index if not exists idx_rink_locker_assignments_booking
  on public.rink_locker_room_assignments (booking_id);

drop trigger if exists trg_rink_locker_assignments_updated_at on public.rink_locker_room_assignments;
create trigger trg_rink_locker_assignments_updated_at
  before update on public.rink_locker_room_assignments
  for each row execute function public.set_updated_at();

-- =============================================================================
-- PUBLIC DISPLAY TOKENS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- rink_display_tokens — unauthenticated TV displays.
--
-- Only the SHA-256 hash is stored. The plaintext is generated server-side,
-- shown once at creation, and never recoverable — an improvement on
-- schedule_ics_tokens (migration 168), which stores its token in the clear.
-- Lookup stays O(1) because the Route Handler hashes the presented token and
-- matches on token_hash.
--
-- These rows are NEVER exposed to a browser. The public endpoint reads them
-- with the service-role client inside a Route Handler and returns only
-- sanitised display rows; the RLS policies below exist for the ADMIN
-- management surface, and no policy grants anon anything.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_display_tokens (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references public.facilities(id) on delete restrict,
  token_hash    text not null,
  label         text not null,
  display_type  text not null default 'locker_rooms',
  settings      jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_by    uuid references public.employees(id) on delete set null,
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  constraint rink_display_tokens_hash_chk check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint rink_display_tokens_hash_uniq unique (token_hash),
  constraint rink_display_tokens_label_len check (char_length(btrim(label)) between 1 and 60),
  constraint rink_display_tokens_type_chk check (display_type in ('locker_rooms')),
  constraint rink_display_tokens_settings_object check (jsonb_typeof(settings) = 'object')
);

comment on table public.rink_display_tokens is
  'Rink Scheduling: facility-scoped tokens for unauthenticated TV displays. Stores ONLY a sha256 hash of the token; the plaintext is shown once at creation and is unrecoverable. Validated server-side in a Route Handler with the service-role client — never queried from a browser.';
comment on column public.rink_display_tokens.display_type is
  'Seeded with locker_rooms. The CHECK is widened (drop + add, whole list restated) when a new display type such as ice_schedule ships.';
comment on column public.rink_display_tokens.last_seen_at is
  'Stamped on each successful poll so admins can spot a display that has gone dark. Written by the public endpoint via the service-role client.';
comment on column public.rink_display_tokens.settings is
  'Display configuration: hours_ahead (window), refresh_seconds, and which columns to show. Object-shaped by CHECK.';

create index if not exists idx_rink_display_tokens_facility
  on public.rink_display_tokens (facility_id, is_active);

drop trigger if exists trg_rink_display_tokens_updated_at on public.rink_display_tokens;
create trigger trg_rink_display_tokens_updated_at
  before update on public.rink_display_tokens
  for each row execute function public.set_updated_at();

-- =============================================================================
-- INVOICING AND PAYMENTS (AR)
-- =============================================================================

create table if not exists public.rink_invoices (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  customer_id    uuid not null,
  invoice_number text not null,
  status         text not null default 'draft',
  issue_date     date not null,
  due_date       date not null,
  subtotal       numeric(12,2) not null default 0,
  tax_amount     numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  amount_paid    numeric(12,2) not null default 0,
  tax_rate       numeric(6,4),
  notes          text,
  created_by     uuid references public.employees(id) on delete set null,
  sent_at        timestamptz,
  voided_at      timestamptz,
  voided_by      uuid references public.employees(id) on delete set null,
  void_reason    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  constraint rink_invoices_status_chk check (
    status in ('draft', 'sent', 'partially_paid', 'paid', 'void')
  ),
  constraint rink_invoices_date_order check (due_date >= issue_date),
  constraint rink_invoices_subtotal_nonneg check (subtotal >= 0),
  constraint rink_invoices_tax_nonneg check (tax_amount >= 0),
  constraint rink_invoices_total_nonneg check (total >= 0),
  constraint rink_invoices_void_coherent check (
    (status = 'void' and voided_at is not null)
    or (status <> 'void' and voided_at is null)
  ),
  constraint rink_invoices_number_uniq unique (facility_id, invoice_number),
  constraint rink_invoices_id_facility_uniq unique (id, facility_id),
  constraint rink_invoices_customer_fk
    foreign key (customer_id, facility_id)
    references public.rink_customers (id, facility_id) on delete restrict
);

comment on table public.rink_invoices is
  'Rink Scheduling: accounts receivable. status partially_paid/paid are DERIVED from the payment sum and recomputed server-side on every payment write — never set by hand. Voiding releases the invoice''s bookings back to uninvoiced.';
comment on column public.rink_invoices.amount_paid is
  'Recomputed server-side as the sum of rink_payments (reversals included, they are negative) after every payment write. Chosen over a trigger so the invoice status transition and the sum are decided in one place.';
comment on column public.rink_invoices.tax_rate is
  'Tax rate snapshotted from module settings at generation, so a later settings change never restates an issued invoice.';

create index if not exists idx_rink_invoices_facility_status
  on public.rink_invoices (facility_id, status, due_date);
create index if not exists idx_rink_invoices_customer
  on public.rink_invoices (customer_id, issue_date);

drop trigger if exists trg_rink_invoices_updated_at on public.rink_invoices;
create trigger trg_rink_invoices_updated_at
  before update on public.rink_invoices
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rink_invoice_line_items
--
-- `voided` mirrors the parent invoice's void state. It exists ONLY so the
-- "a booking appears on at most one live invoice" rule can be a partial unique
-- index: a partial index cannot reach into the parent row's status, so the flag
-- is denormalised here and kept in step by triggers on both tables.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_invoice_line_items (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  invoice_id     uuid not null,
  booking_id     uuid,
  description    text not null,
  quantity_hours numeric(8,2) not null,
  unit_rate      numeric(10,2) not null,
  amount         numeric(12,2) not null,
  sort_order     integer not null default 0,
  voided         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  constraint rink_invoice_line_items_desc_len check (char_length(btrim(description)) between 1 and 300),
  constraint rink_invoice_line_items_qty_pos check (quantity_hours > 0),
  constraint rink_invoice_line_items_rate_nonneg check (unit_rate >= 0),
  constraint rink_invoice_line_items_amount_nonneg check (amount >= 0),
  constraint rink_invoice_line_items_invoice_fk
    foreign key (invoice_id, facility_id)
    references public.rink_invoices (id, facility_id) on delete cascade,
  constraint rink_invoice_line_items_booking_fk
    foreign key (booking_id, facility_id)
    references public.rink_bookings (id, facility_id) on delete restrict
);

comment on table public.rink_invoice_line_items is
  'Rink Scheduling: invoice lines. booking_id NULL means a manual line. A booking can appear on at most one non-void invoice, enforced by rink_invoice_line_items_booking_live_uniq.';
comment on column public.rink_invoice_line_items.voided is
  'Mirrors the parent invoice''s void state. Denormalised solely so the one-live-invoice-per-booking rule can be a partial unique index; maintained by triggers, never written by application code.';

-- The one-live-invoice-per-booking guarantee.
create unique index if not exists rink_invoice_line_items_booking_live_uniq
  on public.rink_invoice_line_items (booking_id)
  where booking_id is not null and not voided;

create index if not exists idx_rink_invoice_line_items_invoice
  on public.rink_invoice_line_items (invoice_id, sort_order);

drop trigger if exists trg_rink_invoice_line_items_updated_at on public.rink_invoice_line_items;
create trigger trg_rink_invoice_line_items_updated_at
  before update on public.rink_invoice_line_items
  for each row execute function public.set_updated_at();

-- New lines inherit the parent's void state.
-- SECURITY DEFINER for the same reason as the propagate trigger below: the
-- lookup must see the parent invoice regardless of the caller's visibility,
-- otherwise `voided` silently defaults to false and the
-- one-live-invoice-per-booking index can be defeated.
create or replace function public.rink_invoice_line_items_inherit_void()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select (i.status = 'void') into new.voided
  from public.rink_invoices i
  where i.id = new.invoice_id;

  new.voided := coalesce(new.voided, false);
  return new;
end;
$$;

comment on function public.rink_invoice_line_items_inherit_void() is
  'Keeps rink_invoice_line_items.voided truthful on insert so the one-live-invoice-per-booking partial index cannot be defeated by adding a line to an already-void invoice.';

drop trigger if exists trg_rink_invoice_line_items_inherit_void on public.rink_invoice_line_items;
create trigger trg_rink_invoice_line_items_inherit_void
  before insert on public.rink_invoice_line_items
  for each row execute function public.rink_invoice_line_items_inherit_void();

-- Voiding (or un-voiding) an invoice propagates to its lines, which is what
-- actually releases its bookings back to the uninvoiced pool.
-- SECURITY DEFINER is load-bearing here, not incidental. A trigger function
-- runs with the invoker's rights, so this cascade UPDATE would itself be
-- filtered by rink_invoice_line_items' UPDATE policy — which only admits rows
-- whose parent invoice is still 'draft'. By the time this fires the parent is
-- 'void', so the update would match ZERO rows, `voided` would stay false, and
-- voiding an invoice would silently fail to release its bookings. Running as
-- the table owner fixes that. It is trigger-invoked only and carries no
-- EXECUTE grant to authenticated, so it adds no callable surface.
create or replace function public.rink_invoices_propagate_void()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    update public.rink_invoice_line_items
       set voided = (new.status = 'void')
     where invoice_id = new.id
       and voided is distinct from (new.status = 'void');
  end if;
  return new;
end;
$$;

comment on function public.rink_invoices_propagate_void() is
  'Propagates an invoice''s void state onto its line items. Voiding an invoice is what releases its bookings back to uninvoiced, so this is the mechanism behind that product rule.';

drop trigger if exists trg_rink_invoices_propagate_void on public.rink_invoices;
create trigger trg_rink_invoices_propagate_void
  after update of status on public.rink_invoices
  for each row execute function public.rink_invoices_propagate_void();

-- -----------------------------------------------------------------------------
-- rink_payments — append-only. Money is never edited or deleted; a mistake is
-- corrected with a negative-amount reversal row pointing at the original.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_payments (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references public.facilities(id) on delete restrict,
  invoice_id          uuid not null,
  amount              numeric(12,2) not null,
  payment_method_id   uuid,
  payment_date        date not null,
  reference_number    text,
  reverses_payment_id uuid references public.rink_payments(id) on delete restrict,
  recorded_by         uuid references public.employees(id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  constraint rink_payments_amount_nonzero check (amount <> 0),
  constraint rink_payments_reversal_sign check (
    (reverses_payment_id is null and amount > 0)
    or (reverses_payment_id is not null and amount < 0)
  ),
  constraint rink_payments_reversal_once unique (reverses_payment_id),
  constraint rink_payments_invoice_fk
    foreign key (invoice_id, facility_id)
    references public.rink_invoices (id, facility_id) on delete restrict,
  constraint rink_payments_method_fk
    foreign key (payment_method_id, facility_id)
    references public.rink_payment_methods (id, facility_id) on delete restrict
);

comment on table public.rink_payments is
  'Rink Scheduling: payments against invoices. APPEND-ONLY — there are no UPDATE or DELETE policies. A mistaken payment is corrected by inserting a negative-amount reversal row referencing the original via reverses_payment_id, which keeps the audit trail intact.';
comment on constraint rink_payments_reversal_once on public.rink_payments is
  'A payment can be reversed at most once; a second reversal of the same row would double-credit the invoice.';

create index if not exists idx_rink_payments_invoice
  on public.rink_payments (invoice_id, payment_date);
create index if not exists idx_rink_payments_facility_date
  on public.rink_payments (facility_id, payment_date);

-- =============================================================================
-- COVERAGE RE-EVALUATION QUEUE
-- =============================================================================

-- -----------------------------------------------------------------------------
-- rink_coverage_reeval_queue — the debounce behind "one publish, one pass".
--
-- Publishing a week flips dozens of schedule_shifts rows in a single statement.
-- Without a queue each row would trigger its own re-evaluation of every future
-- booking. The partial unique index collapses a whole publish batch into ONE
-- pending row per facility; the cron sweep drains it.
-- -----------------------------------------------------------------------------
create table if not exists public.rink_coverage_reeval_queue (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete cascade,
  reason       text not null,
  status       text not null default 'pending',
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint rink_coverage_queue_reason_chk check (
    reason in ('booking_change', 'shift_change', 'hours_change', 'settings_change', 'manual')
  ),
  constraint rink_coverage_queue_status_chk check (status in ('pending', 'done'))
);

comment on table public.rink_coverage_reeval_queue is
  'Rink Scheduling: debounce queue for coverage re-evaluation. One pending row per facility (partial unique index), so publishing a full week of shifts produces exactly one evaluation pass rather than one per shift row. Drained by /api/cron/rink-coverage-sweep.';

create unique index if not exists rink_coverage_queue_one_pending_per_facility
  on public.rink_coverage_reeval_queue (facility_id)
  where status = 'pending';

create index if not exists idx_rink_coverage_queue_pending
  on public.rink_coverage_reeval_queue (status, requested_at) where status = 'pending';

commit;

-- These two trigger functions are SECURITY DEFINER; make sure they carry no
-- callable surface for end users (they are invoked only by their triggers).
revoke execute on function public.rink_invoices_propagate_void() from public, anon, authenticated;
revoke execute on function public.rink_invoice_line_items_inherit_void() from public, anon, authenticated;
