# Authorization Audit — "walk every door" (2026-07)

_Review project I-5. Goal: stop waiting to trip over the fourth auth-at-the-UI-only
defect. Enumerate every mutation surface and record which ones have a real DB-level
lock versus only an app-layer guard._

## Method

Three parallel sweeps, each classifying every mutating surface as **DB-backed**
(a direct PostgREST/RPC call as an ordinary authenticated user in the same
facility is stopped by RLS / a SECURITY DEFINER internal gate / a trigger /
a constraint), **route-/RPC-gated** (service-role or capability-token path where
the server-side check is the only gate, and it is adequate), or a **gap** (the
app guard is stricter than the DB backstop, so bypassing the UI achieves
something the guard prevents). Ground truth was the migrated schema
(`pg_policies`, `pg_proc`, triggers), not the migration text.

1. **Server actions** — every `"use server"` mutator under `src/`.
2. **Route handlers** — everything under `src/app/api/**` plus `src/proxy.ts`.
3. **SECURITY DEFINER functions** — every `prosecdef` function and its EXECUTE grants.

## Headline result

The building is overwhelmingly locked, not just guarded. Every staff-submission,
admin-console, scheduling, permission, and retention surface is DB-backed:
RLS pins writes to `facility_id = current_facility_id()` plus a module-permission
check, and every privileged transition runs through a SECURITY DEFINER RPC with
an internal `is_super_admin` / `is_facility_admin` / ownership gate. The known
hard locks from this review series (scheduling publish-lock + unified violation
policy, append-only + hash-chained audit log, two-person audit destruction,
retention floor CHECK, daily-report correction RPC) all verified.

**Five findings**, all low / low-medium severity, none a cross-tenant data
breach. Four are fixed in this PR; one is documented as by-design.

## Findings

| # | Surface | Severity | Status |
|---|---------|----------|--------|
| F1 | `user_has_permission()` — cross-tenant permission oracle (SECURITY DEFINER, no gate) | Low (info disclosure) | **Fixed** — migration 216 |
| F2 | `check_rate_limit()` — anon/authenticated could forge counters / lock a victim out | Low-Med (DoS) | **Fixed** — migration 216 |
| F3 | 4 child/measurement tables accepted view-level inserts onto another user's report | Low (same-facility integrity) | **Fixed** — migration 217 |
| F4 | `facility_documents` service-role writes gated by broad `requireAdmin` only | Low-Med (defense-in-depth) | **Fixed** — app guard |
| F5 | Scheduling self-service inserts (time-off / availability / swap) not permission-gated in RLS | Low | **By design** — documented |

### F1 — `user_has_permission(user, facility, module, action)` gated (migration 216)

SECURITY DEFINER, granted to `authenticated`, no internal gate, all four
arguments attacker-controlled — any user could probe whether **any** user held
**any** permission (or was a super-admin) in **any** facility. Read-only, but a
cross-tenant enumeration oracle. No RLS policy or function calls it (facility
policies use the `auth.uid()`-keyed helpers), so it was safe to gate: the caller
may now only query themselves, their own facility (as its admin), or — as a
super-admin — anyone. Harness: `AUTHZ-216`.

### F2 — `check_rate_limit()` service-role only (migration 216)

Granted to `anon` + `authenticated` with no gate; every call increments the
counter for an arbitrary `(bucket, identifier)`. An attacker could hammer
`('login_email', victim@example.com)` to pre-exhaust a victim's window and lock
them out of login. The only legitimate callers are two server paths (the login
action, the public information-requests route); both now call it through the
service-role client via `src/lib/rate-limit/check.ts` (fail-open for login so a
limiter blip can't lock everyone out; fail-closed for the public write), and the
`anon`/`authenticated` EXECUTE grant is revoked. Harness: `AUTHZ-216`, `RL`.

### F3 — child-row inserts require submit + parent ownership (migration 217)

`air_quality_readings`, `ice_depth_measurements`,
`ice_operations_circle_check_results`, and `daily_report_submission_items` gated
their INSERT on view-level module access only, while the parent report is
submit-gated. A same-facility user with just a **view** grant could POST child
rows referencing **another** user's existing report, injecting/padding line items
they could never submit through the app. Parent creation stays blocked, so this
was same-facility integrity, not escalation. Fix: each INSERT now requires
submit-level permission **and** that the referenced parent belongs to the caller
(`employee_id = current_employee_id()`), with an editor/admin escape hatch.
Every app insert site is the module's staff `submit.ts` (own parent, same
request), so the legitimate path is unchanged. Harness: `GAP-217` (negative +
positive).

### F4 — `facility_documents` re-checks facility-admin before service-role write

The four document actions (`upload/update/setActive/delete`) use the
service-role client (RLS bypassed) behind `requireAdmin()` only. Not directly
exploitable — a direct PostgREST call hits the stricter `is_facility_admin`
table RLS and is rejected — but `requireAdmin()`'s role-based fallback admits an
admin-role employee lacking the `admin/admin` grant that `is_facility_admin`
requires, so the service path enforced less than the table's own policy. Each
action now calls `ensureFacilityAdmin()` (a `currentUserCan(_, "admin","admin")`
check on the user's client) before any service-role write, matching the pattern
already used by the ice-depth logo upload and the communications outbox retry.

### F5 — scheduling self-service inserts (by design)

`schedule_time_off_requests`, `schedule_availability`, and
`schedule_swap_requests` allow a user to insert their own rows
(`employee_id = current_employee_id()`, time-off additionally pinned to
`status='pending'`) with no module-permission check, while the app actions
require the scheduling `submit` grant. A same-facility employee without that
grant could self-insert their own pending requests — self-only, no cross-user or
cross-facility reach. This reads as a deliberate self-service carve-out (staff
manage their own availability/time-off); left as-is. If gating is ever desired,
add `current_employee_module_permission('scheduling') >= 'submit'` to the self
branch of those three INSERT policies.

## Confirmed solid (no gap)

- All 6 cron routes: `CRON_SECRET` bearer, SHA-256 + `timingSafeEqual`, 503 (not
  open) when unset, no caller-controlled input, service-role workers self-scope.
- `api/exports`, `api/offline-sync` (all 10 module replay handlers re-check
  `currentUserCan(_, "submit")` on the user client; facility/employee are
  server-derived), `api/health`, `schedule-ics` (192-bit capability token,
  scope hard-pinned), PDF routes (user RLS client).
- Every seed/trigger function is service-role-only or trigger-only (not callable
  as a bare RPC); `guard_users_profile_update` blocks privileged-column edits.
- Service-role write paths all re-verify facility/authorization: super-admin
  actions, employee invite, communications outbox retry, scheduling open-shift.

## Regression coverage

New `supabase/tests/rls_isolation.sql` sections probe the fixes at the DB
boundary (the door handle, not the guard): `AUTHZ-216`, the rewritten `RL`
section, and `GAP-217`. These join the per-item probes added across this review
series (`SCHED-211`, `RET-212`, `A3`, `I2`, `2Y`/I-3, `RRD`) so each confirmed
defect has a test that fails if the lock is ever removed (project I-8).
