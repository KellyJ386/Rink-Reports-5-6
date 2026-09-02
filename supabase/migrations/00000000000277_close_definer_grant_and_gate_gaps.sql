-- =============================================================================
-- 00000000000277_close_definer_grant_and_gate_gaps.sql
--
-- A live-database audit (2026-09-02, docs/db-security-audit-2026-09-02.md)
-- compared every SECURITY DEFINER function's ACL and body in the production
-- project against what its migration claimed. Three functions were reachable
-- by client roles with no working authorization gate. All share one root
-- cause that migrations 201 and 275 already documented for other functions:
-- the supabase image's DEFAULT PRIVILEGES grant EXECUTE on every new public
-- function to anon, authenticated and service_role at CREATE time, and
-- `revoke ... from public` removes only the PUBLIC pseudo-role entry. A
-- function a migration called "not granted to any client role" was callable
-- by anon and authenticated from the moment it was created.
--
--  1. scheduling_release_shift_to_pool(uuid, uuid) (migration 234). Internal
--     helper with NO in-body gate: it clears employee_id on whatever shift id
--     it is handed and lists it as an open shift, running as the table owner,
--     so the publish lock waves it through. Live ACL: anon=X, authenticated=X.
--     Anyone holding the public anon key could unassign any published shift
--     in any facility. Fix: revoke from public/anon/authenticated (the
--     shift-drop RPCs call it in owner context and need no grant) AND pin the
--     shift to p_facility_id inside the body so a mismatched pair can never
--     release a shift.
--
--  2. seed_default_facility_dropdown_options(uuid) (migration 163). Its guard
--     tests `current_user`, but inside a SECURITY DEFINER function
--     current_user IS the owner ('postgres'), so the
--     `current_user not in (...)` conjunct is always false and the whole AND
--     chain never raises: any authenticated user could seed rows into any
--     facility. Fix: a gate that distinguishes an API request (a JWT is
--     present) from the trusted direct-connection and auto-seed-trigger
--     contexts, then applies the intended admin checks. Not session_user:
--     it is the owner under the rls_isolation harness too (see its M5 note),
--     so a session_user gate can never be asserted in CI. The trigger
--     functions that use `current_user` (publish lock, open-shift lock, swap
--     guard, role-assignment guard) are SECURITY INVOKER, where the test is
--     correct; only this DEFINER body had it wrong.
--
--  3. seed_default_rink_scheduling_config(uuid) (migration 250). No in-body
--     gate at all; 250 revoked public+anon but the default authenticated grant
--     survived. Any authenticated user could seed settings, a rate card and an
--     operating-hours grid into any facility. Fix: same gate shape; the
--     console's "seed defaults" action (rink_scheduling edit) keeps working.
--
--  4. scheduling_blocking_violations(uuid, text[]) (migration 214). Internal
--     to the governed scheduling RPCs and never called from the app, but
--     authenticated could call it directly and read
--     schedule_settings.block_on_violations for any facility id. Revoke
--     (the SCHED-214 helper assertions in the harness now run in owner
--     context, which is the only context that calls it).
--
--  5. Hygiene: anon EXECUTE on the four migration-232/234 client RPCs (their
--     bodies resolve auth.uid(), so anon only gets "not found", but the grant
--     is wrong and the Supabase security advisor flags each one), and client
--     EXECUTE on four trigger functions (inert -- they return trigger -- but
--     restore the migration-163 pattern).
--
--  6. Root cause: drop anon (and the hard-wired PUBLIC EXECUTE) from the
--     postgres role's DEFAULT PRIVILEGES, so a function, table or sequence
--     created by a future migration is never anon-reachable unless that
--     migration grants it. Existing table-level anon grants are left alone
--     (RLS has no anon policy except information_requests_insert, and the
--     harness asserts under anon against them). The authenticated default is
--     deliberately unchanged -- see the audit doc for that decision.
--
-- No signature changes, so src/types/database.ts is unaffected.
-- rls_isolation.sql: new DGG277 block asserts each gate. Run against the
-- pre-277 schema, 21 of its probes fail -- each was an open door, and two of
-- them show the release actually landing (bob's published shift unassigned
-- and listed as open by an anon call).
-- =============================================================================

-- 1. scheduling_release_shift_to_pool ----------------------------------------

create or replace function public.scheduling_release_shift_to_pool(
  p_shift_id uuid,
  p_facility_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_first_come boolean;
begin
  select coalesce(open_shift_first_come, true) into v_first_come
    from public.schedule_settings
   where facility_id = p_facility_id;

  -- Pin the shift to the facility the caller vouched for. The shift-drop RPCs
  -- pass (v_drop.shift_id, v_drop.facility_id) from one row, so this never
  -- fires for them; it exists so a mismatched pair can never release a shift.
  update public.schedule_shifts
     set employee_id = null
   where id = p_shift_id
     and facility_id = p_facility_id;
  if not found then
    raise exception 'scheduling_release_shift_to_pool: shift % does not belong to facility %',
      p_shift_id, p_facility_id
      using errcode = '42501';
  end if;

  -- approval_required snapshots (NOT open_shift_first_come) at creation time,
  -- exactly as scheduling_approve_publish_request does.
  insert into public.schedule_open_shifts (
    facility_id, shift_id, claim_status, approval_required
  )
  values (
    p_facility_id, p_shift_id, 'open', not coalesce(v_first_come, true)
  )
  on conflict (shift_id) do update
    set claim_status           = 'open',
        claimed_by_employee_id = null,
        claimed_at             = null,
        approved_by_employee_id = null,
        approved_at            = null;
end;
$$;

revoke execute on function public.scheduling_release_shift_to_pool(uuid, uuid)
  from public, anon, authenticated;

-- 2. seed_default_facility_dropdown_options ----------------------------------

create or replace function public.seed_default_facility_dropdown_options(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Authorization guard. Reachable as an authenticated PostgREST RPC, so it
  -- must not trust an arbitrary p_facility_id. Callers that pass:
  --   * the facilities AFTER INSERT auto-seed trigger (pg_trigger_depth() > 0):
  --     the INSERT it follows was already gated -- facilities_insert is
  --     super-admin-only under RLS and the bypass roles are trusted;
  --   * a direct-connection context carrying no API JWT at all (migration
  --     replays and backfills, the dashboard, psql), or the service-role key
  --     by JWT claim (cron and provisioning routes). PostgREST sets the
  --     request.jwt.* settings on every API request, anon key included, so
  --     an end user can never present as "no JWT";
  --   * a super admin (public.is_super_admin());
  --   * a facility admin for THIS facility (public.is_facility_admin()).
  -- NOT current_user: inside a SECURITY DEFINER body current_user is always
  -- the owner, which is why the migration-163 form of this guard never fired.
  -- NOT session_user: it is the owner under the rls_isolation harness as well
  -- (its M5 note), so a session_user gate could never be asserted in CI.
  -- Mirrors requireAdmin()'s primary checks; the rare employee-role-only
  -- admin (not in user_permissions) should re-run provisioning rather than
  -- hit this RPC directly.
  if pg_trigger_depth() = 0
     and (nullif(current_setting('request.jwt.claims', true), '') is not null
          or nullif(current_setting('request.jwt.claim.sub', true), '') is not null
          or nullif(current_setting('request.jwt.claim.role', true), '') is not null)
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_super_admin()
     and not public.is_facility_admin(p_facility_id) then
    raise exception 'not authorized to seed dropdown options for this facility'
      using errcode = '42501';
  end if;

  -- facility_timezone: mirrors TIMEZONE_OPTIONS. key = IANA identifier (stored
  -- verbatim in facilities.timezone), display_name = friendly label.
  insert into public.facility_dropdown_options
    (facility_id, domain, key, display_name, sort_order, is_active)
  values
    (p_facility_id, 'facility_timezone', 'America/New_York',    'Eastern — New York',          1,  true),
    (p_facility_id, 'facility_timezone', 'America/Detroit',     'Eastern — Detroit',           2,  true),
    (p_facility_id, 'facility_timezone', 'America/Chicago',     'Central — Chicago',           3,  true),
    (p_facility_id, 'facility_timezone', 'America/Denver',      'Mountain — Denver',           4,  true),
    (p_facility_id, 'facility_timezone', 'America/Phoenix',     'Mountain (no DST) — Phoenix', 5,  true),
    (p_facility_id, 'facility_timezone', 'America/Los_Angeles', 'Pacific — Los Angeles',       6,  true),
    (p_facility_id, 'facility_timezone', 'America/Anchorage',   'Alaska — Anchorage',          7,  true),
    (p_facility_id, 'facility_timezone', 'Pacific/Honolulu',    'Hawaii — Honolulu',           8,  true),
    (p_facility_id, 'facility_timezone', 'America/Toronto',     'Eastern — Toronto',           9,  true),
    (p_facility_id, 'facility_timezone', 'America/Vancouver',   'Pacific — Vancouver',         10, true),
    (p_facility_id, 'facility_timezone', 'UTC',                 'UTC',                         11, true)
  on conflict (facility_id, domain, key) do nothing;
end;
$$;

-- 3. seed_default_rink_scheduling_config -------------------------------------

create or replace function public.seed_default_rink_scheduling_config(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Authorization guard (same shape as seed_default_facility_dropdown_options
  -- above). The console's "seed defaults" action runs as a facility manager
  -- holding rink_scheduling edit, so that grant -- scoped to the caller's OWN
  -- facility -- is the end-user arm.
  if pg_trigger_depth() = 0
     and (nullif(current_setting('request.jwt.claims', true), '') is not null
          or nullif(current_setting('request.jwt.claim.sub', true), '') is not null
          or nullif(current_setting('request.jwt.claim.role', true), '') is not null)
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_super_admin()
     and not coalesce(
       p_facility_id = public.current_facility_id()
       and (public.has_module_admin_access('rink_scheduling')
            or public.has_module_edit_access('rink_scheduling')),
       false) then
    raise exception 'not authorized to seed rink scheduling defaults for this facility'
      using errcode = '42501';
  end if;

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

-- 4. scheduling_blocking_violations: internal to the governed RPCs -----------

revoke execute on function public.scheduling_blocking_violations(uuid, text[])
  from public, anon, authenticated;

-- 5. Hygiene ------------------------------------------------------------------

revoke execute on function public.scheduling_request_shift_drop(uuid, text)          from public, anon;
revoke execute on function public.scheduling_decide_shift_drop(uuid, boolean, text)  from public, anon;
revoke execute on function public.scheduling_cancel_shift_drop(uuid)                 from public, anon;
revoke execute on function public.scheduling_move_compliance_rule(uuid, integer)     from public, anon;

revoke execute on function public.audit_logs_append_only()         from public, anon, authenticated;
revoke execute on function public.audit_logs_hash_chain()          from public, anon, authenticated;
revoke execute on function public.tg_seed_export_settings()        from public, anon, authenticated;
revoke execute on function public.tg_seed_rink_scheduling_config() from public, anon, authenticated;

-- 6. Stop the default anon grant at the source ---------------------------------
--
-- Two layers produce a new function's ACL: Postgres' hard-wired default
-- (EXECUTE to PUBLIC, plus the owner) is UNIONED with the creating role's
-- per-schema default ACL, which on this stack grants anon, authenticated and
-- service_role. Dropping anon from the per-schema entry is therefore not
-- enough -- PUBLIC still carries anon -- so the hard-wired PUBLIC grant is
-- removed at the GLOBAL (no-schema) level too. From here on a function a
-- migration creates is executable by authenticated and service_role only
-- unless the migration says otherwise, and the `revoke ... from public`
-- boilerplate every migration since 163 has carried becomes a no-op instead
-- of a thing to forget.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

-- The global revoke also reaches functions a future `create extension ...
-- with schema extensions` would install (extension scripts run as the
-- creating role and take its defaults). Keep those callable by the API roles,
-- as `grant execute on all functions in schema extensions` already made the
-- existing ones -- extension functions are utilities, not tenant surface.
alter default privileges for role postgres in schema extensions
  grant execute on functions to anon, authenticated, service_role;

-- Two consequences worth knowing: (1) a function created ad hoc as postgres
-- (dashboard, psql, the rls_isolation harness's pg_temp helpers) is no longer
-- callable by other roles without an explicit grant; (2) rls_isolation.sql
-- now asserts, from the catalog, that no SECURITY DEFINER function in public
-- is executable by anon or PUBLIC (DGG277f), so a regression of either kind
-- fails CI whatever the defaults happen to be.
