-- =============================================================================
-- 00000000000248_rink_scheduling_seed.sql
-- Rink Scheduling & Billing seeds.
--
-- 1. seed_default_rink_scheduling_config(facility) — settings row, invoice
--    counter, booking types, customer types, payment methods, a Mon–Sun
--    operating-hours grid, and a default rate card. Idempotent; auto-runs for
--    new facilities via an AFTER INSERT trigger on facilities (migration 144
--    pattern); backfilled for every existing facility.
-- 2. Tennity: its two ice surfaces. RINKS ARE NOT SEEDED FOR OTHER FACILITIES —
--    a rink's name, short code and color are facility-specific, so a new
--    facility enters its own in Facility Setup. Everything else above IS
--    seeded, so a brand-new facility is bookable after entering its rinks and
--    confirming its hours, with zero code changes.
--
-- Nothing in the seeder is Tennity-specific. The only facility-targeted insert
-- is section 2, which is matched by slug and is a no-op everywhere else.
-- =============================================================================

begin;

create or replace function public.seed_default_rink_scheduling_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Module settings (one row per facility).
  insert into public.rink_scheduling_settings (facility_id)
  values (p_facility_id)
  on conflict (facility_id) do nothing;

  -- Invoice counter.
  insert into public.rink_invoice_counters (facility_id)
  values (p_facility_id)
  on conflict (facility_id) do nothing;

  -- Booking types. Maintenance Block is is_system + non-billable: it occupies
  -- ice (so it participates in conflict detection) but never reaches an
  -- invoice, and it is the one type that may omit a customer.
  insert into public.rink_booking_types
    (facility_id, name, slug, color, is_billable, is_system, sort_order)
  select p_facility_id, t.name, t.slug, t.color, t.is_billable, t.is_system, t.sort_order
  from (values
    ('Ice Rental',        'ice-rental',        '#002244', true,  false, 0),
    ('Practice',          'practice',          '#1F5C8B', true,  false, 1),
    ('Game',              'game',              '#B3261E', true,  false, 2),
    ('Public Skate',      'public-skate',      '#2F9E00', true,  false, 3),
    ('Learn to Skate',    'learn-to-skate',    '#7A4FBF', true,  false, 4),
    ('Camp/Clinic',       'camp-clinic',       '#9A6700', true,  false, 5),
    ('Maintenance Block', 'maintenance-block', '#56666F', false, true,  6)
  ) as t(name, slug, color, is_billable, is_system, sort_order)
  on conflict (facility_id, slug) do nothing;

  -- Customer types.
  insert into public.rink_customer_types (facility_id, name, slug, sort_order)
  select p_facility_id, c.name, c.slug, c.sort_order
  from (values
    ('Internal Program',      'internal-program', 0),
    ('University Department', 'su-department',    1),
    ('Team',                  'team',             2),
    ('League',                'league',           3),
    ('School',                'school',           4),
    ('Individual',            'individual',       5),
    ('Other',                 'other',            6)
  ) as c(name, slug, sort_order)
  on conflict (facility_id, slug) do nothing;

  -- Payment methods. "Card (recorded)" logs a card payment taken elsewhere —
  -- this module never handles card data.
  insert into public.rink_payment_methods (facility_id, name, slug, sort_order)
  select p_facility_id, m.name, m.slug, m.sort_order
  from (values
    ('Check',               'check',               0),
    ('ACH',                 'ach',                 1),
    ('Card (recorded)',     'card-recorded',       2),
    ('Internal Chargeback', 'internal-chargeback', 3),
    ('Cash',                'cash',                4),
    ('Other',               'other',               5)
  ) as m(name, slug, sort_order)
  on conflict (facility_id, slug) do nothing;

  -- Operating hours: a full Mon–Sun grid so the coverage engine always has a
  -- row to read. 06:00–23:00 mirrors schedule_settings' 360/1380 minute
  -- defaults (migration 232) so the two modules agree out of the box.
  insert into public.facility_operating_hours (facility_id, day_of_week, open_time, close_time, is_closed)
  select p_facility_id, d, time '06:00', time '23:00', false
  from generate_series(0, 6) as d
  on conflict (facility_id, day_of_week) do nothing;

  -- A default rate card so rate resolution always finds exactly one card.
  -- Rates start at 0.00: a real number is a facility business decision, and
  -- seeding a plausible-looking rate risks it being invoiced by accident.
  insert into public.rink_rate_cards
    (facility_id, name, effective_start, effective_end, is_default,
     hourly_rate_prime, hourly_rate_nonprime)
  select p_facility_id, 'Standard Rates', date '2000-01-01', null, true, 0, 0
  where not exists (
    select 1 from public.rink_rate_cards rc
    where rc.facility_id = p_facility_id and rc.is_default
  );
end;
$$;

comment on function public.seed_default_rink_scheduling_config(uuid) is
  'Seeds per-facility Rink Scheduling config: settings, invoice counter, booking types, customer types, payment methods, a Mon-Sun operating-hours grid, and a zero-rate default rate card. Idempotent. Rinks and locker rooms are deliberately NOT seeded — those are facility-specific and entered in Facility Setup.';

revoke execute on function public.seed_default_rink_scheduling_config(uuid) from public, anon;
grant  execute on function public.seed_default_rink_scheduling_config(uuid) to service_role;

-- Auto-seed on facility creation.
create or replace function public.tg_seed_rink_scheduling_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_rink_scheduling_config(new.id);
  return new;
end;
$$;

revoke execute on function public.tg_seed_rink_scheduling_config() from public, anon;

drop trigger if exists facilities_seed_rink_scheduling on public.facilities;
create trigger facilities_seed_rink_scheduling
  after insert on public.facilities
  for each row execute function public.tg_seed_rink_scheduling_config();

-- Backfill every existing facility.
do $$
declare
  f record;
begin
  for f in select id from public.facilities loop
    perform public.seed_default_rink_scheduling_config(f.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Tennity's ice surfaces.
--
-- Confirmed from live data rather than assumed: ice_depth_rinks for the
-- Tennity facility holds exactly two surfaces, "Main Rink" and "Oval Rink".
-- Matched by slug, so this is a no-op at every other facility.
-- -----------------------------------------------------------------------------
insert into public.facility_rinks
  (facility_id, name, slug, short_code, display_color, sort_order, is_active)
select f.id, r.name, r.slug, r.short_code, r.display_color, r.sort_order, true
from public.facilities f
cross join (values
  ('Main Rink', 'main-rink', 'MAIN', '#002244', 0),
  ('Oval Rink', 'oval-rink', 'OVAL', '#4DFF00', 1)
) as r(name, slug, short_code, display_color, sort_order)
where f.slug = 'tennity-ice-skating-pavilion'
on conflict (facility_id, slug) do nothing;

commit;
