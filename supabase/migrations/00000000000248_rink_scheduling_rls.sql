-- =============================================================================
-- 00000000000248_rink_scheduling_rls.sql
-- Module #12 "rink_scheduling" — row level security.
--
-- Every policy is `to authenticated` (migration 244's house rule). This is not
-- cosmetic: Supabase's default privileges grant table-level SELECT/INSERT/
-- UPDATE/DELETE to `anon` as well as `authenticated`, so a policy without a
-- role restriction would also admit anonymous callers. RLS is the only gate.
--
-- HOW THE RBAC MATRIX MAPS ONTO THE PERMISSION MODEL
-- The module spec names five tiers (super_admin / org_admin / facility_manager
-- / supervisor / staff). Three of those role KEYS do not exist in this
-- codebase — `gm` and `supervisor` were retired (migrations 58/87) and are
-- forbidden by the roles_key_not_retired CHECK (migration 188), and there is
-- no organisation tier above facility. Authorization here resolves through
-- user_permissions (module x action), so the tiers map onto actions:
--
--   staff            -> has_module_access        (view)
--   supervisor       -> has_module_submit_access (submit)
--   facility_manager -> has_module_edit_access   (edit)
--   org_admin        -> has_module_admin_access  (admin)
--   super_admin      -> is_super_admin()         (cross-facility)
--
-- Capability -> gate, per the spec's §6 matrix:
--   view calendar & bookings ................ module access
--   create TENTATIVE booking ................ submit  (status forced tentative)
--   confirm / edit / cancel bookings ........ edit
--   manage series, customers ................ edit
--   assign locker rooms ..................... submit
--   rinks / locker rooms / hours / types .... edit
--   manage display tokens ................... edit
--   rate cards & module settings ............ admin
--   invoices, payments, AR .................. edit
-- =============================================================================

begin;

-- =============================================================================
-- FACILITY SETUP TABLES — read at module access, write at edit (facility_manager)
-- =============================================================================

alter table public.facility_rinks enable row level security;

drop policy if exists facility_rinks_select on public.facility_rinks;
create policy facility_rinks_select on public.facility_rinks
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists facility_rinks_insert on public.facility_rinks;
create policy facility_rinks_insert on public.facility_rinks
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists facility_rinks_update on public.facility_rinks;
create policy facility_rinks_update on public.facility_rinks
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_rinks_delete on public.facility_rinks;
create policy facility_rinks_delete on public.facility_rinks
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

alter table public.facility_locker_rooms enable row level security;

drop policy if exists facility_locker_rooms_select on public.facility_locker_rooms;
create policy facility_locker_rooms_select on public.facility_locker_rooms
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists facility_locker_rooms_insert on public.facility_locker_rooms;
create policy facility_locker_rooms_insert on public.facility_locker_rooms
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists facility_locker_rooms_update on public.facility_locker_rooms;
create policy facility_locker_rooms_update on public.facility_locker_rooms
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_locker_rooms_delete on public.facility_locker_rooms;
create policy facility_locker_rooms_delete on public.facility_locker_rooms
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

alter table public.facility_operating_hours enable row level security;

drop policy if exists facility_operating_hours_select on public.facility_operating_hours;
create policy facility_operating_hours_select on public.facility_operating_hours
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists facility_operating_hours_insert on public.facility_operating_hours;
create policy facility_operating_hours_insert on public.facility_operating_hours
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists facility_operating_hours_update on public.facility_operating_hours;
create policy facility_operating_hours_update on public.facility_operating_hours
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_operating_hours_delete on public.facility_operating_hours;
create policy facility_operating_hours_delete on public.facility_operating_hours
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

alter table public.facility_operating_hours_exceptions enable row level security;

drop policy if exists facility_hours_exceptions_select on public.facility_operating_hours_exceptions;
create policy facility_hours_exceptions_select on public.facility_operating_hours_exceptions
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists facility_hours_exceptions_insert on public.facility_operating_hours_exceptions;
create policy facility_hours_exceptions_insert on public.facility_operating_hours_exceptions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists facility_hours_exceptions_update on public.facility_operating_hours_exceptions;
create policy facility_hours_exceptions_update on public.facility_operating_hours_exceptions
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_hours_exceptions_delete on public.facility_operating_hours_exceptions;
create policy facility_hours_exceptions_delete on public.facility_operating_hours_exceptions
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

-- =============================================================================
-- MODULE SETTINGS — read at module access, write at ADMIN (org_admin tier)
-- =============================================================================

alter table public.rink_scheduling_settings enable row level security;

drop policy if exists rink_scheduling_settings_select on public.rink_scheduling_settings;
create policy rink_scheduling_settings_select on public.rink_scheduling_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists rink_scheduling_settings_insert on public.rink_scheduling_settings;
create policy rink_scheduling_settings_insert on public.rink_scheduling_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  );

drop policy if exists rink_scheduling_settings_update on public.rink_scheduling_settings;
create policy rink_scheduling_settings_update on public.rink_scheduling_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_scheduling_settings_delete on public.rink_scheduling_settings;
create policy rink_scheduling_settings_delete on public.rink_scheduling_settings
  for delete to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- rink_invoice_counters — EDIT tier, because claiming an invoice number is part
-- of creating an invoice (a facility_manager capability). Deliberately a
-- separate table from settings so this grant does not also hand managers the
-- tax rate. No DELETE policy: losing the counter would restart numbering.
-- -----------------------------------------------------------------------------
alter table public.rink_invoice_counters enable row level security;

drop policy if exists rink_invoice_counters_select on public.rink_invoice_counters;
create policy rink_invoice_counters_select on public.rink_invoice_counters
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_invoice_counters_insert on public.rink_invoice_counters;
create policy rink_invoice_counters_insert on public.rink_invoice_counters
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_invoice_counters_update on public.rink_invoice_counters;
create policy rink_invoice_counters_update on public.rink_invoice_counters
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- =============================================================================
-- LOOKUPS — read at module access, write at edit (facility_manager config)
-- =============================================================================

alter table public.rink_customer_types enable row level security;

drop policy if exists rink_customer_types_select on public.rink_customer_types;
create policy rink_customer_types_select on public.rink_customer_types
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists rink_customer_types_insert on public.rink_customer_types;
create policy rink_customer_types_insert on public.rink_customer_types
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_customer_types_update on public.rink_customer_types;
create policy rink_customer_types_update on public.rink_customer_types
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_customer_types_delete on public.rink_customer_types;
create policy rink_customer_types_delete on public.rink_customer_types
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

alter table public.rink_booking_types enable row level security;

drop policy if exists rink_booking_types_select on public.rink_booking_types;
create policy rink_booking_types_select on public.rink_booking_types
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists rink_booking_types_insert on public.rink_booking_types;
create policy rink_booking_types_insert on public.rink_booking_types
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_booking_types_update on public.rink_booking_types;
create policy rink_booking_types_update on public.rink_booking_types
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_booking_types_delete on public.rink_booking_types;
create policy rink_booking_types_delete on public.rink_booking_types
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

alter table public.rink_payment_methods enable row level security;

drop policy if exists rink_payment_methods_select on public.rink_payment_methods;
create policy rink_payment_methods_select on public.rink_payment_methods
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists rink_payment_methods_insert on public.rink_payment_methods;
create policy rink_payment_methods_insert on public.rink_payment_methods
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_payment_methods_update on public.rink_payment_methods;
create policy rink_payment_methods_update on public.rink_payment_methods
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_payment_methods_delete on public.rink_payment_methods;
create policy rink_payment_methods_delete on public.rink_payment_methods
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

-- =============================================================================
-- RATE CARDS — read at SUBMIT (the booking sheet's live rate preview needs it),
-- write at ADMIN (org_admin). Staff with only `view` never see rates.
-- =============================================================================

alter table public.rink_rate_cards enable row level security;

drop policy if exists rink_rate_cards_select on public.rink_rate_cards;
create policy rink_rate_cards_select on public.rink_rate_cards
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_submit_access('rink_scheduling'))
  );

drop policy if exists rink_rate_cards_insert on public.rink_rate_cards;
create policy rink_rate_cards_insert on public.rink_rate_cards
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  );

drop policy if exists rink_rate_cards_update on public.rink_rate_cards;
create policy rink_rate_cards_update on public.rink_rate_cards
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_rate_cards_delete on public.rink_rate_cards;
create policy rink_rate_cards_delete on public.rink_rate_cards
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  );

alter table public.rink_rate_card_windows enable row level security;

drop policy if exists rink_rate_card_windows_select on public.rink_rate_card_windows;
create policy rink_rate_card_windows_select on public.rink_rate_card_windows
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_submit_access('rink_scheduling'))
  );

drop policy if exists rink_rate_card_windows_insert on public.rink_rate_card_windows;
create policy rink_rate_card_windows_insert on public.rink_rate_card_windows
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  );

drop policy if exists rink_rate_card_windows_update on public.rink_rate_card_windows;
create policy rink_rate_card_windows_update on public.rink_rate_card_windows
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_rate_card_windows_delete on public.rink_rate_card_windows;
create policy rink_rate_card_windows_delete on public.rink_rate_card_windows
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  );

alter table public.rink_rate_card_type_overrides enable row level security;

drop policy if exists rink_rate_type_overrides_select on public.rink_rate_card_type_overrides;
create policy rink_rate_type_overrides_select on public.rink_rate_card_type_overrides
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_submit_access('rink_scheduling'))
  );

drop policy if exists rink_rate_type_overrides_insert on public.rink_rate_card_type_overrides;
create policy rink_rate_type_overrides_insert on public.rink_rate_card_type_overrides
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  );

drop policy if exists rink_rate_type_overrides_update on public.rink_rate_card_type_overrides;
create policy rink_rate_type_overrides_update on public.rink_rate_card_type_overrides
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_rate_type_overrides_delete on public.rink_rate_card_type_overrides;
create policy rink_rate_type_overrides_delete on public.rink_rate_card_type_overrides
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  );

-- =============================================================================
-- CUSTOMERS — readable at module access (the calendar shows customer names),
-- writable at edit ("Manage customers" is a facility_manager capability).
-- =============================================================================

alter table public.rink_customers enable row level security;

drop policy if exists rink_customers_select on public.rink_customers;
create policy rink_customers_select on public.rink_customers
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists rink_customers_insert on public.rink_customers;
create policy rink_customers_insert on public.rink_customers
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_customers_update on public.rink_customers;
create policy rink_customers_update on public.rink_customers
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_customers_delete on public.rink_customers;
create policy rink_customers_delete on public.rink_customers
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- BOOKINGS
--
-- The INSERT policy is where the supervisor/facility_manager split lives: a
-- submit-grant may create ONLY a tentative booking, while an edit-grant may
-- create any status. Confirming is therefore an edit-tier act whether it
-- happens at creation or later, which is exactly the matrix's intent.
--
-- UPDATE is edit-only: "confirm/edit/cancel bookings" is facility_manager+.
-- DELETE is super-admin-only — bookings are CANCELLED (status + reason), never
-- destroyed, because invoices and AR history reference them.
-- =============================================================================

alter table public.rink_bookings enable row level security;

drop policy if exists rink_bookings_select on public.rink_bookings;
create policy rink_bookings_select on public.rink_bookings
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists rink_bookings_insert on public.rink_bookings;
create policy rink_bookings_insert on public.rink_bookings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_edit_access('rink_scheduling')
        or (
          public.has_module_submit_access('rink_scheduling')
          and status = 'tentative'
        )
      )
    )
  );

drop policy if exists rink_bookings_update on public.rink_bookings;
create policy rink_bookings_update on public.rink_bookings
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_bookings_delete on public.rink_bookings;
create policy rink_bookings_delete on public.rink_bookings
  for delete to authenticated
  using (public.is_super_admin());

alter table public.rink_booking_series enable row level security;

drop policy if exists rink_booking_series_select on public.rink_booking_series;
create policy rink_booking_series_select on public.rink_booking_series
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists rink_booking_series_insert on public.rink_booking_series;
create policy rink_booking_series_insert on public.rink_booking_series
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_booking_series_update on public.rink_booking_series;
create policy rink_booking_series_update on public.rink_booking_series
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_booking_series_delete on public.rink_booking_series;
create policy rink_booking_series_delete on public.rink_booking_series
  for delete to authenticated
  using (public.is_super_admin());

-- =============================================================================
-- LOCKER ROOM ASSIGNMENTS — SUBMIT tier ("Assign locker rooms to bookings" is
-- the one write capability a supervisor holds besides tentative bookings).
-- The child row must belong to a booking in the caller's own facility; the
-- composite FK already fences that, and the EXISTS re-states it so a caller
-- cannot attach a room to a booking they cannot see.
-- =============================================================================

alter table public.rink_locker_room_assignments enable row level security;

drop policy if exists rink_locker_assignments_select on public.rink_locker_room_assignments;
create policy rink_locker_assignments_select on public.rink_locker_room_assignments
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('rink_scheduling'))
  );

drop policy if exists rink_locker_assignments_insert on public.rink_locker_room_assignments;
create policy rink_locker_assignments_insert on public.rink_locker_room_assignments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_submit_access('rink_scheduling')
      and exists (
        select 1 from public.rink_bookings b
        where b.id = booking_id
          and b.facility_id = public.current_facility_id()
          and b.status <> 'cancelled'
      )
    )
  );

drop policy if exists rink_locker_assignments_update on public.rink_locker_room_assignments;
create policy rink_locker_assignments_update on public.rink_locker_room_assignments
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_submit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_locker_assignments_delete on public.rink_locker_room_assignments;
create policy rink_locker_assignments_delete on public.rink_locker_room_assignments
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_submit_access('rink_scheduling'))
  );

-- =============================================================================
-- DISPLAY TOKENS — EDIT tier throughout ("Manage display tokens" is
-- facility_manager+). SELECT is deliberately NOT at module access: these rows
-- carry token hashes and should not be readable by every staff account.
--
-- Nothing here grants `anon` anything. The public display endpoint reads this
-- table with the service-role client inside a Route Handler, which bypasses
-- RLS entirely — that is the ONLY path by which an unauthenticated caller's
-- token is ever resolved, and it returns sanitised rows, never these ones.
-- =============================================================================

alter table public.rink_display_tokens enable row level security;

drop policy if exists rink_display_tokens_select on public.rink_display_tokens;
create policy rink_display_tokens_select on public.rink_display_tokens
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_display_tokens_insert on public.rink_display_tokens;
create policy rink_display_tokens_insert on public.rink_display_tokens
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_display_tokens_update on public.rink_display_tokens;
create policy rink_display_tokens_update on public.rink_display_tokens
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_display_tokens_delete on public.rink_display_tokens;
create policy rink_display_tokens_delete on public.rink_display_tokens
  for delete to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

-- =============================================================================
-- INVOICING AND PAYMENTS — EDIT tier throughout ("Create/send/void invoices,
-- record payments" and "View AR reports" are both facility_manager+). A staff
-- or supervisor account can see the calendar but never the money.
-- =============================================================================

alter table public.rink_invoices enable row level security;

drop policy if exists rink_invoices_select on public.rink_invoices;
create policy rink_invoices_select on public.rink_invoices
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_invoices_insert on public.rink_invoices;
create policy rink_invoices_insert on public.rink_invoices
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_invoices_update on public.rink_invoices;
create policy rink_invoices_update on public.rink_invoices
  for update to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

-- Invoices are VOIDED, never deleted: an issued number must stay accounted for.
drop policy if exists rink_invoices_delete on public.rink_invoices;
create policy rink_invoices_delete on public.rink_invoices
  for delete to authenticated
  using (public.is_super_admin());

alter table public.rink_invoice_line_items enable row level security;

drop policy if exists rink_invoice_line_items_select on public.rink_invoice_line_items;
create policy rink_invoice_line_items_select on public.rink_invoice_line_items
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_invoice_line_items_insert on public.rink_invoice_line_items;
create policy rink_invoice_line_items_insert on public.rink_invoice_line_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_edit_access('rink_scheduling')
      -- Lines may only be added while the invoice is still a draft.
      and exists (
        select 1 from public.rink_invoices i
        where i.id = invoice_id
          and i.facility_id = public.current_facility_id()
          and i.status = 'draft'
      )
    )
  );

drop policy if exists rink_invoice_line_items_update on public.rink_invoice_line_items;
create policy rink_invoice_line_items_update on public.rink_invoice_line_items
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_edit_access('rink_scheduling')
      and exists (
        select 1 from public.rink_invoices i
        where i.id = invoice_id
          and i.facility_id = public.current_facility_id()
          and i.status = 'draft'
      )
    )
  )
  with check (
    public.is_super_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists rink_invoice_line_items_delete on public.rink_invoice_line_items;
create policy rink_invoice_line_items_delete on public.rink_invoice_line_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_edit_access('rink_scheduling')
      and exists (
        select 1 from public.rink_invoices i
        where i.id = invoice_id
          and i.facility_id = public.current_facility_id()
          and i.status = 'draft'
      )
    )
  );

-- -----------------------------------------------------------------------------
-- rink_payments — SELECT + INSERT only. No UPDATE or DELETE policy exists, by
-- design: money is append-only. A mistake is corrected with a negative-amount
-- reversal row. The guard trigger below re-states this for direct SQL.
-- -----------------------------------------------------------------------------
alter table public.rink_payments enable row level security;

drop policy if exists rink_payments_select on public.rink_payments;
create policy rink_payments_select on public.rink_payments
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_edit_access('rink_scheduling'))
  );

drop policy if exists rink_payments_insert on public.rink_payments;
create policy rink_payments_insert on public.rink_payments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_edit_access('rink_scheduling')
      -- Never record money against a void invoice.
      and exists (
        select 1 from public.rink_invoices i
        where i.id = invoice_id
          and i.facility_id = public.current_facility_id()
          and i.status <> 'void'
      )
    )
  );

-- No UPDATE/DELETE policies: append-only.

-- =============================================================================
-- COVERAGE QUEUE — enqueued by submit-tier actions (creating a booking can
-- change coverage), inspected by admins, drained by the cron's service-role
-- client which bypasses RLS. No UPDATE/DELETE policies for end users.
-- =============================================================================

alter table public.rink_coverage_reeval_queue enable row level security;

drop policy if exists rink_coverage_queue_select on public.rink_coverage_reeval_queue;
create policy rink_coverage_queue_select on public.rink_coverage_reeval_queue
  for select to authenticated
  using (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_admin_access('rink_scheduling'))
  );

drop policy if exists rink_coverage_queue_insert on public.rink_coverage_reeval_queue;
create policy rink_coverage_queue_insert on public.rink_coverage_reeval_queue
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_submit_access('rink_scheduling'))
  );

-- =============================================================================
-- GUARD TRIGGERS — per-column and immutability rules RLS cannot express.
-- =============================================================================

-- Shared exemption tier, matching the dasher_boards_guard_exempt() shape.
create or replace function public.rink_scheduling_guard_exempt()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select public.is_super_admin()
      or coalesce(auth.role(), '') = 'service_role'
      or current_user = 'service_role'
      -- The GUC escape hatch is honored ONLY for a privileged owner/backend
      -- role (migration 226's D-3 hardening): a client-settable GUC must never
      -- be part of the security boundary. Note `postgres` is deliberately NOT
      -- exempt on its own — direct SQL from an owner session is exactly the
      -- case these guards exist to catch, so the operator must opt out
      -- explicitly by setting the flag.
      or (
        coalesce(current_setting('rr.rink_scheduling_guard_bypass', true), '') = 'on'
        and current_user in ('postgres', 'supabase_admin', 'service_role')
      );
$$;

comment on function public.rink_scheduling_guard_exempt() is
  'Exemption tier for rink_scheduling guard triggers: super admins, the service role (cron sweeps, the public display endpoint), and the migration/owner roles.';

-- Payments are immutable once written.
create or replace function public.rink_payments_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.rink_scheduling_guard_exempt() then
    return coalesce(new, old);
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
  'Re-states the append-only payment rule at the trigger layer, so even direct SQL from a privileged-but-not-exempt session cannot rewrite payment history.';

drop trigger if exists trg_rink_payments_guard on public.rink_payments;
create trigger trg_rink_payments_guard
  before update or delete on public.rink_payments
  for each row execute function public.rink_payments_guard();

-- A sent invoice's line items are frozen; its financial totals are not
-- (payments still move amount_paid and status).
create or replace function public.rink_invoices_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.rink_scheduling_guard_exempt() then
    return new;
  end if;

  -- A void invoice is terminal.
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'rink_scheduling: a void invoice cannot be reopened'
      using errcode = '42501';
  end if;

  -- paid / partially_paid are DERIVED from the payment sum. They may only be
  -- reached from a state the payment recorder controls, never set by hand on a
  -- draft.
  if new.status in ('partially_paid', 'paid')
     and old.status = 'draft' then
    raise exception 'rink_scheduling: payment status is derived — send the invoice before recording payment'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.rink_invoices_guard() is
  'Invoice lifecycle guard: void is terminal, and the derived payment statuses cannot be hand-set on a draft.';

drop trigger if exists trg_rink_invoices_guard on public.rink_invoices;
create trigger trg_rink_invoices_guard
  before update on public.rink_invoices
  for each row execute function public.rink_invoices_guard();

commit;
