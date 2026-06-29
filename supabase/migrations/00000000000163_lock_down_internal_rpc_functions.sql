-- =============================================================================
-- 00000000000163_lock_down_internal_rpc_functions.sql
--
-- Security hardening (Supabase advisor): trigger functions and facility "seed"
-- functions are reachable by anon / authenticated through /rest/v1/rpc/<name>.
-- The seed_* functions accept a facility_id and mutate THAT facility's config,
-- so a direct RPC caller could poke another facility's setup. These are only
-- meant to run from triggers, from create_facility_with_roles, or as the owner
-- in a SECURITY DEFINER context, so removing the public/anon/authenticated
-- EXECUTE grant closes the hole without breaking internal use:
--   * the function OWNER always keeps EXECUTE,
--   * trigger execution ignores EXECUTE grants entirely,
--   * SECURITY DEFINER calls run as the owner, not the caller.
--
-- NOTE ON `revoke ... from public`: a privilege held via the PUBLIC pseudo-role
-- is NOT removed by `revoke ... from anon`. New functions get EXECUTE granted to
-- PUBLIC by default, so the complete lockdown revokes PUBLIC *and* the named
-- roles. Earlier migrations (66/122/144/147/160) revoked subsets; the lines
-- below use the full `public, anon, authenticated` form so any residual PUBLIC
-- path is closed too. (`postgres`/`service_role`/`supabase_admin` retain
-- EXECUTE — they are not in the revoke target list.)
--
-- ADJUSTMENTS vs. the original draft, after verifying the codebase:
--   * seed_default_facility_dropdown_options(uuid) is NOT internal-only — the
--     admin "Re-seed defaults" action (seedDomainDefaults() in
--     src/app/admin/lists/actions.ts) calls it as `authenticated` behind
--     requireAdmin(). Revoking EXECUTE would break that button. Instead we add
--     an in-function authorization guard (below) and KEEP the authenticated
--     grant — closing the cross-facility write while the app keeps working.
--   * seed_default_facility_modules(uuid) and
--     seed_default_facility_air_quality_config(uuid) were already locked down in
--     migration 160 (original defs revoked PUBLIC; 160 added anon/authenticated)
--     — omitted here to avoid implying they were still exposed.
--   * The `alter function ... set search_path` lines for the two schedule
--     trigger fns are omitted: migration 162 already pinned both to
--     `public, pg_temp`. Re-pinning to a different value would revert 162.
--
-- REVERSIBLE: grant execute on function public.<name>(<args>) to authenticated;
-- =============================================================================

-- ---- Facility seed functions: mutate a facility's config -------------------

-- Role-permission defaults: migration 82 revoked from public, anon; close the
-- remaining authenticated RPC surface (no app code calls this directly).
revoke execute on function public.seed_role_permission_defaults_for_facility(uuid)
  from public, anon, authenticated;

-- ---- Dropdown-options seed: KEEP authenticated EXECUTE (admin button uses it)
--      but add an internal authorization guard so an arbitrary p_facility_id
--      from a direct RPC call is rejected. Body below is migration 159's body
--      verbatim with the guard prepended; nothing else changes.
create or replace function public.seed_default_facility_dropdown_options(p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Authorization guard (added in this migration). Reachable as an
  -- authenticated PostgREST RPC, so it must not trust an arbitrary
  -- p_facility_id. Allow:
  --   * trusted backend roles / the owner — under which the AFTER INSERT
  --     auto-seed trigger and create_facility_with_roles run in definer
  --     context (current_user is the owner, not the end user);
  --   * a super admin (public.is_super_admin());
  --   * a facility admin for THIS facility (public.is_facility_admin()).
  -- AND short-circuits, so the helpers (which read auth.uid()) are only called
  -- for an end-user role, never during provisioning. Mirrors requireAdmin()'s
  -- primary checks; the rare employee-role-only admin (not in user_permissions)
  -- should re-run provisioning rather than hit this RPC directly.
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
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

-- ---- Trigger functions: never meant to be RPC-callable. Triggers fire
--      regardless of these grants, so this only removes the REST surface.
revoke execute on function public.tg_seed_facility_modules()            from public, anon, authenticated;
revoke execute on function public.tg_seed_facility_air_quality_config() from public, anon, authenticated;
revoke execute on function public.trg_seed_facility_dropdown_options()  from public, anon, authenticated;
revoke execute on function public.enforce_incident_witnesses_cap()      from public, anon, authenticated;
revoke execute on function public.audit_row_change()                    from public, anon, authenticated;
revoke execute on function public.schedule_swap_set_expiry()            from public, anon, authenticated;
revoke execute on function public.schedule_shifts_publish_lock()        from public, anon, authenticated;

-- =============================================================================
-- DELIBERATELY NOT CHANGED HERE (decide separately):
--
--   * public.check_rate_limit(...) — left as-is. It is invoked pre-auth (anon)
--     by the public information-requests endpoint
--     (src/app/api/information-requests/route.ts) to throttle submissions;
--     revoking from anon would disable that throttle.
--
--   * information_requests INSERT policy = WITH CHECK (true) for anon — the
--     public "request info" form. Confirm anon has NO select on the table and
--     that the endpoint stays rate limited; then leave it.
--
--   * Leaked-password protection — enable in the Auth dashboard (no SQL).
--
--   * citext / pg_trgm installed in `public` — move to an `extensions` schema
--     in a separate, carefully-sequenced migration (objects depend on them).
-- =============================================================================
