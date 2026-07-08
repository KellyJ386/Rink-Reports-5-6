-- =============================================================================
-- 00000000000180_advisor_followups_rls_hardening.sql
--
-- Two Supabase database-linter findings from the RR56 pre-launch regression
-- (2026-07-08). Both are advisory (INFO / WARN, not ERROR) and neither changes
-- observable behaviour for end users — they close linter findings and encode
-- the already-intended access model explicitly.
--
-- 1. rls_enabled_no_policy (INFO) on public.rate_limit_counters.
--    The table has RLS enabled with ZERO policies, which is deny-all for
--    anon/authenticated (writes flow only through the SECURITY DEFINER
--    public.check_rate_limit(), which runs as owner and bypasses RLS). That is
--    the correct posture, but the linter cannot tell an intentional deny-all
--    from a table someone forgot to write policies for. Add an explicit
--    service_role policy so intent is legible and the finding clears. service_role
--    already bypasses RLS, so this is documentation-as-policy — anon/authenticated
--    still have NO applicable policy and remain denied (see the RL assertions in
--    supabase/tests/rls_isolation.sql).
--
-- 2. rls_policy_always_true (WARN) on public.information_requests_insert.
--    The public splash-page lead form (src/app/api/information-requests/route.ts)
--    inserts under the anon key, so the INSERT policy has to admit anonymous
--    writes — but `with check (true)` is broader than necessary. The route never
--    sets `status` (the column defaults to 'new'), so constraining the policy to
--    `status = 'new'` admits every legitimate public submission while preventing a
--    forged direct-PostgREST insert from seeding an arbitrary pipeline status
--    (e.g. 'contacted' / 'closed'). This is defence-in-depth on top of the
--    existing length CHECKs (migration 88), email-format CHECK + per-email/global
--    rate-limit trigger (migration 177). SELECT/UPDATE/DELETE remain
--    super-admin-only and are untouched.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Make rate_limit_counters' deny-all intent explicit for the linter.
-- ---------------------------------------------------------------------------
drop policy if exists rate_limit_counters_service_role_all on public.rate_limit_counters;
create policy rate_limit_counters_service_role_all
  on public.rate_limit_counters
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

comment on policy rate_limit_counters_service_role_all on public.rate_limit_counters is
  'Explicit service-role full access. Cosmetic (service_role bypasses RLS) but documents intent and clears the rls_enabled_no_policy linter finding. anon/authenticated intentionally have NO policy and remain deny-all; direct access is only via SECURITY DEFINER check_rate_limit().';

-- ---------------------------------------------------------------------------
-- 2. Tighten the public lead-form INSERT policy off the always-true expression.
-- ---------------------------------------------------------------------------
drop policy if exists information_requests_insert on public.information_requests;
create policy information_requests_insert
  on public.information_requests
  as permissive
  for insert
  to anon, authenticated
  with check (status = 'new');

comment on policy information_requests_insert on public.information_requests is
  'Public sales-lead inbox: anon/authenticated may INSERT, but only with the initial status = ''new'' (the column default the API route relies on). Replaces the previous with-check-true policy (rls_policy_always_true linter finding). Length/email/rate-limit defences live in migrations 88 and 177.';

commit;
