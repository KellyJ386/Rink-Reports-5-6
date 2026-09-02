# Live database security audit — 2026-09-02

Project audited: Supabase **Rink Reports 5-6** (`bqbdgwlhbhabsibjgwmk`, Postgres
17.6). This is an audit of the *live* database state — every SECURITY DEFINER
function's ACL and body, every RLS policy, table grants, storage policies,
default privileges, and the Supabase security advisor — read directly through
the Supabase MCP connection, then compared against what the repo's migrations
claim. It is not a source review; `docs/security-review-2026-07-28.md` is.

Remediation ships as migration **277**
(`00000000000277_close_definer_grant_and_gate_gaps.sql`) with a new
`DGG277` block in `supabase/tests/rls_isolation.sql`. Migration 277 has
**not** been applied to production from this audit; it deploys through the
normal path (merge → `deploy-migrations.yml` → `supabase db push`).

## Executive summary

One **critical** gap: `scheduling_release_shift_to_pool(uuid, uuid)` — the
internal helper that unassigns a shift and lists it in the open pool — was
executable by the `anon` role (the public browser key) and by every
authenticated user, and had no authorization check in its body. Any holder
of the anon key who knew a shift id could unassign any published shift in any
facility. Migration 234 intended it to be owner-only ("not granted to any
client role") but used `revoke ... from public`, which does not touch the
explicit `anon`/`authenticated` grants the stack's default privileges add at
CREATE time. Migrations 201 and 275 had already documented and fixed this exact
trap for other functions; this one was missed.

Two **high** gaps of the same family: `seed_default_facility_dropdown_options`
had a guard that could never fire (it tested `current_user`, which inside a
SECURITY DEFINER body is always the owner), and
`seed_default_rink_scheduling_config` had no guard at all. Both let any
authenticated user write default configuration rows into any facility.

Everything else checked out. In particular the **scheduling publish path is
enforced server-side at three independent layers**, all verified live (see
below), and the two-person publish rule holds.

Confidence: the findings are backed by live catalog reads and by a
replay-and-probe harness run described in "Evidence". The only unverified
environment is the CI Postgres image itself (no Docker in the audit sandbox);
the harness was run on a stand-in that reproduced production's function ACLs
exactly.

## What was verified as sound

| Area | Live state |
|---|---|
| Migrations | 276/276 repo migrations recorded as applied; no drift in count or names. |
| SECURITY DEFINER inventory | 142 functions, every one with `search_path = public, pg_temp` pinned. |
| Views | None in `public` (no `security_invoker` concerns). |
| RLS | Enabled on every `public` table (184). The 14 `audit_logs_*` partitions have zero policies by design (migration 241; all access is through the parent, direct grants revoked). |
| Policy roles | Every policy targets `authenticated` (migration 244) except `information_requests_insert` (`anon, authenticated`, `with check (status = 'new')` — the public lead form) and `rate_limit_counters_service_role_all`. |
| Unconditional policies | Only three `SELECT ... using (true)`, all reference tables (`air_quality_compliance_profiles`, `report_metric_definitions`, `retention_module_floors`). No `true` write policy for a client role. |
| Storage | All 12 `storage.objects` policies bucket-scoped and facility-scoped by folder (`current_facility_id()`); inserts/updates closed to clients (service role only). |
| Auth helpers | `current_facility_id()` / `is_super_admin()` / `is_facility_admin()` / `has_module_*` all read `auth.uid()` against `users` / `user_permissions` — no trust in client-supplied ids. |
| Guarded RPCs | Every other `authenticated`-executable DEFINER function that takes a `p_facility_id` was read: `purge_module_data`, `reapply_role_defaults_for_role`, `verify_audit_chain`, `approve/cancel_audit_destruction` gate on `is_super_admin() or is_facility_admin(p_facility_id)`; `create_employee_complete`, `dispatch_rules_for_submission`, `scheduling_assignment_violations`, `report_period_bounds`, `resolve_rule_recipients` gate on `p_facility_id = current_facility_id()` (or super admin); `compute_facility_daily_metrics`, `drain_notification_outbox` are super-admin/service-role only. |

### Scheduling publish path (the pre-onboarding must-have)

Verified live, in order:

1. **Server action** (`admin/scheduling/_lib/publish-request-actions.ts`):
   `resolveAdminContext()` derives `facilityId` from the caller's profile and
   `employeeId` from their active employee row; nothing facility-related is
   accepted from the client. Approval goes through the
   `scheduling_approve_publish_request` RPC only.
2. **RPC** (`scheduling_approve_publish_request`): requires
   `has_module_admin_access('scheduling')` (or super admin), refuses a request
   from another facility (`42501`), refuses `requested_by_employee_id =
   current_employee_id()` (two-person rule), locks the request row and the
   drafts `for update`, re-validates every assigned draft through
   `scheduling_assignment_violations` + `scheduling_blocking_violations`, and
   only then flips `draft → published`.
3. **RLS status fence** (migration 256): `schedule_shifts_insert/update/delete`
   all carry `and status <> 'published'`, so a direct PostgREST write can
   neither create, modify, delete, nor transition a row into `published`.
   `schedule_publish_requests_update` only permits recording a *rejection*.
4. **Trigger** `trg_schedule_shifts_publish_lock` (enabled, `O`): rejects the
   same transitions for any non-owner role; the bypass GUC is honored only
   from owner roles (migration 226).

The one hole in this path was the release helper (finding F1): it ran as the
owner, so layers 3 and 4 waved it through by design, and it was reachable by
everyone.

## Findings

Severity is exploitability-weighted for a multi-tenant pilot.

### F1 — Critical — `scheduling_release_shift_to_pool` callable by anon and authenticated, ungated

Live ACL: `{postgres=X, anon=X, authenticated=X, service_role=X}`. Body: reads
`schedule_settings` for `p_facility_id`, then
`update schedule_shifts set employee_id = null where id = p_shift_id` (no
facility match, no caller check) and upserts a `schedule_open_shifts` row.
Reachable at `POST /rest/v1/rpc/scheduling_release_shift_to_pool` with the
anon key. Precondition: a target shift uuid (every staffer in the target
facility can read non-draft shift ids; uuids also appear in notification
payloads and ICS feeds).

Impact: silently unassign any published shift in any facility and list it as
claimable — a publish-lock bypass and a cross-tenant write on the same path
the product's liability story rests on.

Fix (277 §1): `revoke execute ... from public, anon, authenticated` (the two
shift-drop RPCs call it in owner context and need no grant), and the body now
requires `facility_id = p_facility_id` on the update and raises `42501` on a
mismatch.

### F2 — High — `seed_default_facility_dropdown_options` guard was dead code

Migration 163 gated it with
`if current_user not in ('postgres','supabase_admin','service_role') and not is_super_admin() and not is_facility_admin(p_facility_id)`.
Inside a SECURITY DEFINER function `current_user` *is* the owner
(`postgres`), so the first conjunct is always false and the guard never
raised. Verified live with a throwaway DEFINER function: called as
`authenticated`, it returned `current_user = postgres`. Any authenticated
user could seed timezone options into any facility.

Fix (277 §2): the guard now distinguishes an API request (any
`request.jwt.*` setting present) from trusted contexts — the facilities
auto-seed trigger (`pg_trigger_depth() > 0`, whose INSERT is already
super-admin-only under RLS), a direct connection with no JWT (migrations,
dashboard), or the service-role claim — and then applies the intended
super-admin / `is_facility_admin(p_facility_id)` checks. `session_user` was
deliberately not used: it is also the owner under the CI harness (see the
harness's M5 note), so such a gate could never be asserted.

The same `current_user` test is correct in the SECURITY INVOKER trigger
functions (publish lock, open-shift lock, swap guard, role-assignment guard);
only this DEFINER body had it wrong.

### F3 — High — `seed_default_rink_scheduling_config` had no guard, and kept the default authenticated grant

Migration 250 revoked `public, anon` and granted `service_role`, but the
default-privileges `authenticated` grant survived. The body inserts settings,
an invoice counter, booking/customer/payment types, a Mon–Sun operating-hours
grid and a default rate card for any `p_facility_id`. `on conflict do nothing`
limits it to filling gaps, but that is still an unauthenticated-by-intent
cross-tenant write (and would re-create hours/rate-card rows a facility had
deliberately removed).

Fix (277 §3): same gate shape as F2; the end-user arm is
`p_facility_id = current_facility_id()` plus `rink_scheduling` admin **or**
edit, which is what the console's "seed defaults" action
(`ensureFacilityManager`) already requires.

### F4 — Low — `scheduling_blocking_violations` leaked `block_on_violations` cross-tenant

SECURITY DEFINER, `authenticated`-executable, no gate: passing another
facility's id and a probe code returned whether that facility blocks on
advisory violations. Internal to the governed RPCs; never called from app
code. Fix (277 §4): revoke from client roles. The three SCHED-214 harness
assertions that called it directly now run in owner context.

### F5 — Low — anon EXECUTE on four client RPCs and four trigger functions

`scheduling_request_shift_drop`, `scheduling_decide_shift_drop`,
`scheduling_cancel_shift_drop`, `scheduling_move_compliance_rule` (all resolve
`auth.uid()`, so anon only gets "not found" — not exploitable), and
`audit_logs_append_only`, `audit_logs_hash_chain`, `tg_seed_export_settings`,
`tg_seed_rink_scheduling_config` (return `trigger`, uncallable from
PostgREST). The Supabase advisor reports all eight as
`anon_security_definer_function_executable` WARNs. Fix (277 §5): revoked.

### F6 — Root cause — default privileges

`pg_default_acl` for role `postgres` in `public` grants every new table,
sequence and function to `anon`, `authenticated`, `service_role`. Postgres
then *unions* that with its hard-wired default (functions: EXECUTE to
PUBLIC), so a migration that forgets both `revoke ... from public` **and**
`revoke ... from anon, authenticated` ships a function every browser can call.
Fix (277 §6): the hard-wired PUBLIC EXECUTE is revoked at the global default
level and `anon` is removed from the per-schema defaults for functions,
tables and sequences (with the `extensions` schema carved out so future
extension functions stay callable by the API roles). A future function is
executable by `authenticated` and `service_role` only unless its migration
says otherwise. Because defaults are environment state rather than repo
state, the harness also now asserts from the catalog that **no SECURITY
DEFINER function in `public` is executable by `anon` or PUBLIC**
(`DGG277f`) — that assertion, not the default-privilege change, is the
regression gate.

**Decision left open:** removing `authenticated` from the function default as
well would make "internal helper accidentally client-callable" (F1's shape)
impossible by construction. It was not done here because every migration
since 163 relies on the implicit grant for legitimately client-facing RPCs,
and the failure mode of changing it (a new RPC returning `permission denied`
until its migration adds a grant) is a product change to make deliberately,
not inside a security fix. Recommended as a follow-up with a CLAUDE.md
convention: *every* `create function` gets an explicit grant line.

### F7 — Info — table-level anon grants on ~180 tables

Same default-privilege origin. Not exploitable today: RLS is enabled
everywhere and no policy admits `anon` except the lead-form insert, so every
anon read returns zero rows. Left in place because the isolation harness
asserts under `anon` against these grants (e.g. `rate_limit_counters`) and
because the risk is entirely contingent on a future `disable row level
security`. Revoking them is a reasonable hardening pass on its own PR.

### F8 — Info — Supabase Auth: leaked-password protection is off

Advisor `auth_leaked_password_protection` (WARN). Dashboard toggle
(Authentication → Providers → Email → "Prevent use of leaked passwords");
not expressible as a migration.

### F9 — Hygiene — retired `gm` role still named in three live policies

`employees_insert`, `employees_update`, `roles_insert` still test
`current_user_role() in ('admin','gm','super_admin')`. Migrations 58/87/212
retired `gm` and no role or employee carries it (verified: 0 rows), so this
is dead text, not a grant. Worth restating when those policies are next
touched.

### Advisor noise that is expected

The 67 `authenticated_security_definer_function_executable` WARNs are the
app's RPC surface; each is either an `auth.uid()`-scoped helper or a gated
RPC (read in full for this audit). The 14 `rls_enabled_no_policy` INFOs are
the `audit_logs` partitions (migration 241).

## Evidence

Harness method: all 276 migrations were replayed onto a clean Postgres 16
with a stand-in for the Supabase image (roles, `auth.uid()/role()`,
`storage.*`, and the same default privileges). Fidelity checks: the
regenerated schema snapshot matched the committed one apart from one
role-ordering line, `supabase/tests/rls_isolation.sql` passed unchanged, and
the stand-in reproduced production's function ACLs exactly (same eight
anon-executable DEFINER functions).

Against the **pre-277** schema the new `DGG277` block fails 21 probes,
including the two that show the exploit actually landing rather than merely
being reachable:

```
FAIL: DGG277a: bob's published Facility-B shift is still assigned to bob — expected 1, got 0
FAIL: DGG277a: ...and was never listed in the open pool — expected 0, got 1
```

(the anon-role and other-facility calls earlier in the block had unassigned
the shift and listed it). Against the **post-277** schema the full harness
passes (0 failures), including the positive paths: the facilities auto-seed
trigger with a stale non-admin JWT in session, a facility admin seeding her
own facility, an edit-only manager seeding hers, owner-context calls, and the
shift-drop RPCs' internal use of the release helper.

`pnpm types:check` passes against the migrated database (no signature
changes); `supabase/schema.snapshot.sql` is regenerated in the same change.

## Follow-ups (not in this change)

1. Merge and let `deploy-migrations.yml` push 277 — F1 is live until then.
2. Enable leaked-password protection in the Auth dashboard (F8).
3. Decide on the `authenticated` default-privilege revoke (F6) and, if taken,
   add the "explicit grant per function" convention to CLAUDE.md.
4. Optional hardening PR: revoke the table-level `anon` grants (F7) and
   restate the three `gm` policies (F9).
5. Re-run the Supabase security advisor after 277 deploys; the eight
   anon WARNs should be gone.
