# Phase 1 — Agent D: RBAC & Security Regression

Read-only adversarial audit of authorization, tenant isolation, and the publish-lock
regression. Method: full read of every `"use server"` action file (48 files) + the two
non-cron route handlers + the scheduling publish-lock migrations/RPCs + the RLS policy
set (migrations 4/29/30/91/98/100/136/148/149/164). Evidence is `file:line`.

---

## Summary

The auth model holds up well. Every server action derives `facility_id` **server-side**
from `getCurrentUser().profile.facility_id` (which resolves from `users.facility_id`
keyed on `auth.uid()` — `current_facility_id()`, migration 3, not client-switchable).
No action accepts a client-supplied `facility_id` except the three super-admin actions,
which are cross-facility **by design** and correctly gated on `is_super_admin`. Actor
identity (`employee_id`) is always resolved by looking up the active `employees` row for
`auth.uid()`, never trusted from FormData. Report reporter identity (incidents) is sourced
from the login, not the payload.

**The publish-lock regression is FIXED** — three-legged (INSERT/UPDATE/DELETE) DB trigger
plus app-layer routing through audited SECURITY DEFINER RPCs. See the dedicated section.

Findings are dominated by **defense-in-depth gaps that RLS currently backstops**, plus one
genuine **DB-boundary privilege-escalation vector** (a facility admin can mint a
super-admin via a raw PostgREST write — no server action does this, but the DB permits it).

Counts: **CRITICAL 0 · HIGH 1 · MEDIUM 3 · LOW 5 · Verified-OK (large)**.

Note on `admin/employees` deep-dive: `resolveFacilityIdFromForm()` (employees/actions.ts:160)
and `resolveFacility()` (departments/spaces) correctly force `profile.facility_id` for
non-super-admins and ignore form-supplied facility. Role-hierarchy escalation is guarded by
`callerHierarchyFloor()` / `canAssignRoleLevel()` (createEmployee:217, updateEmployee:335,
createRole:143, setRoleHierarchy:240). The one employees action that does NOT re-derive
facility server-side is `seedRolesForCurrentFacility` — see D-08.

---

## Server-action / route-handler authorization matrix

`facility src` = how facility_id is derived. `actor src` = how the acting employee id is derived.
"profile" = `getCurrentUser().profile.facility_id`. "emp-lookup" = `employees` row for `auth.uid()`.

### Staff report actions (all: `requireUser` via layout + action-level employee lookup)

| Action | File:line | Auth | Perm check | facility src | actor src | Verdict |
|---|---|---|---|---|---|---|
| submitTimeOffRequest | reports/scheduling/actions.ts:94 | requireUser | currentUserCan(scheduling,submit):104 | emp-lookup:112 | emp-lookup:126 | OK |
| cancelTimeOffRequest | reports/scheduling/actions.ts:145 | requireUser | ownership | emp-lookup:160 | own-emp check:169 | OK |
| upsertAvailability | reports/scheduling/actions.ts:202 | requireUser | currentUserCan:211 | emp-lookup:222 | own-emp:293 | OK (job-area validated 258) |
| deleteAvailability | reports/scheduling/actions.ts:323 | requireUser | ownership | RLS | own-emp:339 | OK (D-06: no explicit fac filter) |
| submitSwapRequest | reports/scheduling/actions.ts:356 | requireUser | — | emp-lookup:433 | emp-lookup:434 | OK (target validated 391-428) |
| cancelSwapRequest | reports/scheduling/actions.ts:464 | requireUser | — | emp-lookup:479 | own-emp:483 | OK |
| acceptSwapRequest | reports/scheduling/actions.ts:515 | requireUser | — | RLS | own-emp:533 | OK (D-06: no explicit fac filter) |
| claimOpenShift | reports/scheduling/actions.ts:560 | requireUser | RPC | RPC (definer) | RPC (definer) | OK |
| markNotificationRead / All | reports/scheduling/actions.ts:595/624 | requireUser | — | emp-lookup | own-emp:610/637 | OK |
| submitRefrigerationReport | reports/refrigeration/actions.ts:69 | requireUser:20 | currentUserCan(refrigeration,submit):47 | emp-lookup:56 | emp-lookup:55 | OK |
| submitIncidentReport | reports/incidents/actions.ts:30 | requireUser:34 | currentUserCan(incident_reports,submit):57 | emp-lookup:66 | emp-lookup:62 | OK (reporter from login) |
| updateIncidentReport | reports/incidents/actions.ts:84 | requireUser:89 | RLS + ownership:119 | existing.facility:131 | own-emp:119 | OK (edit window 122) |
| submitIceOperationsReport | reports/ice-operations/actions.ts:98 | requireUser:35 | currentUserCan(ice_operations,submit):58 | emp-lookup:66 | emp-lookup:84 | OK |
| submitIceDepthSession | reports/ice-depth/actions.ts:100 | requireUser:30 | currentUserCan(ice_depth,submit):75 | emp-lookup:84 | emp-lookup:82 | OK |
| sendIceDepthReport | reports/ice-depth/actions.ts:122 | requireUser:127 | currentUserCan:148 | emp-lookup:177 | own-fac check:166 | OK |
| submitDailyReportAction | reports/daily/actions.ts:124 | requireUser:78 | persistDaily area perm (_lib/submit) | emp-lookup:110 | emp-lookup:109 | OK |
| getAllowedDailyAreas | reports/daily/actions.ts:39 | requireUser:40 | area perm filter:68 | emp-lookup:56 | emp-lookup:64 | OK |
| sendCommunicationsMessage | reports/communications/actions.ts:122 | requireUser | currentUserCan(communications,submit):84 | emp-lookup:107 | emp-lookup:106 | OK (group membership validated) |
| acknowledgeAlert / markMessageRead / acknowledgeMessage | reports/communications/actions.ts:136/194/234 | requireUser | — | emp-lookup | own-emp | OK (idempotent) |
| submitAirQualityReport | reports/air-quality/actions.ts:22 | requireUser:31 | currentUserCan(air_quality,submit):52 | emp-lookup:60 | emp-lookup:59 | OK |
| submitAccidentReport | reports/accidents/actions.ts:45 | requireUser:53 | currentUserCan(accident_reports,submit):74 | emp-lookup:82 | emp-lookup:81 | OK |
| updateAccidentReport | reports/accidents/actions.ts:100 | requireUser:109 | RLS + ownership:139 | existing.facility:248 | own-emp:139 | OK (edit window 142) |
| hide/showDashboardModule | dashboard/actions.ts:8/18 | requireUser:12/22 | RPC self-only (auth.uid) | n/a | auth.uid (RPC) | OK |
| updateAccountProfile | account/_lib/actions.ts:26 | requireUser:30 | canEditProfile RPC:39 / self:35 | existing.facility:138 | validated 31-39 | OK |
| updatePasswordAction | (auth)/update-password/actions.ts:12 | auth.getUser:29 | — (reset-link flow) | n/a | auth.getUser | OK |
| loginAction / signOut | (auth)/login/actions.ts:12, lib/auth/sign-out.ts:10 | pre-auth | — | n/a | n/a | OK |

### Admin actions (all: `requireAdmin` + `facility_id = profile.facility_id`, all queries `.eq(facility_id)`)

Verified clean across: spaces, scheduling/job-areas, roles, retention, refrigeration,
modules, lists, incident-reports, ice-operations, ice-depth, facility, facility-documents,
exports, employees, employees/[id], employees/bulk, departments, daily-reports,
daily-reports/area-access, communications, air-quality, air-quality/log, accident-reports,
plus all scheduling `_lib` actions (admin-core, governance, publish-request, grid). Each
calls `requireAdmin()` first and never reads facility from client input. (See governance-actions.ts
resolveAdminContext:44, admin-core-actions.ts:33, grid-actions.ts resolveFacility:180,
publish-request-actions.ts:18.)

### Super-admin actions (gated on `is_super_admin`, cross-facility by design)

| Action | File:line | Gate | facility src | Verdict |
|---|---|---|---|---|
| setSuperAdminFlag | admin/super-admin/actions.ts:36 | requireSuperAdmin:40 (is_super_admin) | user-scoped client, RLS enforces | OK (self-revoke guard 52) |
| sendPasswordReset | admin/super-admin/actions.ts:72 | requireSuperAdmin:76 | service-role client, gated | OK |
| checkInviteServiceHealth | admin/super-admin/actions.ts:128 | requireSuperAdmin:129 | — | OK (key fingerprint server-log only) |
| setFacilityActive | admin/super-admin/actions.ts:231 | requireSuperAdmin:235 | FormData facility_id (super-admin) | OK (cross-facility by design) |

### Impersonation / preview

| Action | File:line | Gate | Verdict |
|---|---|---|---|
| startPreviewAs | lib/auth/preview-actions.ts:22 | requireAdmin:23; non-super-admins constrained to own facility:34-35 | OK (target must be active:31; audit-logged:59) |
| stopPreview | lib/auth/preview-actions.ts:77 | requireAdmin:83 | OK |

### Route handlers

| Handler | File:line | Auth | Perm | facility src | Verdict |
|---|---|---|---|---|---|
| GET /api/exports | api/exports/route.ts:24 | requireAdmin:27 | authorizeExport view:36 | profile.facility:39 | OK |
| POST /api/offline-sync | api/offline-sync/route.ts:56 | getCurrentUser:57 | currentUserCan per-module (278/370/468/662…) | profile.facility (server):109… | OK |
| GET ice-depth done/pdf | reports/ice-depth/[layoutSlug]/done/pdf/route.ts:16 | requireUser:16 | **none** (RLS only) | RLS-scoped client | D-05 (see findings) |
| GET admin air-quality log/pdf | admin/air-quality/log/pdf/route.ts:18 | requireAdmin:18 | admin | profile.facility:20 | OK |

---

## Publish-lock verdict: **FIXED**

The prior audit's publish-lock bypass is closed on **all three legs (INSERT/UPDATE/DELETE)**
by a DB-boundary trigger, backed by app-layer routing of every published-shift mutation
through audited SECURITY DEFINER RPCs. The trigger is the authoritative backstop; the app
layer is defense-in-depth.

**DB trigger — `schedule_shifts_publish_lock()`** (migration 148, hardened+extended by 164:27-86):
fires `BEFORE INSERT OR UPDATE OR DELETE` (trigger recreated 164:83-86). For an end-user
PostgREST role (`authenticated`/`anon`):
- INSERT with `status='published'` → rejected (164:49-56) — closes the create-leg.
- UPDATE of a row whose OLD `status='published'` → rejected (164:70-74).
- DELETE of a row whose OLD `status='published'` → rejected (164:58-64).
- Governed writers (`current_user in postgres/supabase_admin/service_role`, or the
  `rr.publish_lock_bypass` txn flag) pass (164:40-43). SECURITY DEFINER RPCs run as the
  table owner, so they are allowed.

**Every mutation path traced:**

| Path | Entry | Touches published? | Enforcement | Verdict |
|---|---|---|---|---|
| createGridShift | grid-actions.ts:412 | No — hard-codes `status:"draft"` (465) | app (createSchema omits status, 92-98) + trigger INSERT guard | FIXED |
| updateGridShift (draft) | grid-actions.ts:489 | No | direct UPDATE, RLS + trigger | FIXED |
| updateGridShift (published) | grid-actions.ts:577 | Yes | routes to RPC `scheduling_admin_edit_published_shift` (578); direct UPDATE would hit trigger | FIXED |
| deleteGridShift (draft) | grid-actions.ts:824 | No | direct DELETE | FIXED |
| deleteGridShift (published) | grid-actions.ts:812 | Yes | routes to RPC `scheduling_admin_cancel_shift` (813); direct DELETE hits trigger | FIXED |
| applyTemplateToWeek | admin-core-actions.ts:534 | No — inserts `status:"draft"` only (629) | app + trigger INSERT guard | FIXED |
| assignOpenShift | admin-core-actions.ts:99 | Yes (parent is published) | RPC `scheduling_admin_assign_open_shift` (definer, re-validates, 148:131) | FIXED |
| decideOpenShiftClaim | admin-core-actions.ts:156 | Yes | RPC `scheduling_decide_open_claim` (definer) | FIXED |
| cancelShift | admin-core-actions.ts:202 | Yes | RPC `scheduling_admin_cancel_shift` (definer) | FIXED |
| approveSwap | governance-actions.ts:307 | Yes (mutates assignees) | RPC `scheduling_apply_swap` (definer, migration 136:260; re-validates both directions, audits, notifies) — intended audited path | FIXED |
| assignSwapTarget / denySwap / cancelSwap | governance-actions.ts:220/357/417 | No — only mutate `schedule_swap_requests`, never `schedule_shifts` | RLS | FIXED (n/a) |
| decideTimeOffRequest | governance-actions.ts:87 | No — writes time-off + notification only | RLS | FIXED (n/a) |
| approveAndPublishRequest | publish-request-actions.ts:110 | draft→published transition | RPC `scheduling_approve_publish_request` (definer, 136:403; two-person: rejects self-approve 447; re-validates every draft) | FIXED |
| offline-sync scheduling replay | api/offline-sync/route.ts:459 | **No** — only `submit_availability` + `request_time_off` (477/559); any other action → 400 (588). Never writes `schedule_shifts`. | currentUserCan(scheduling,submit):468 | FIXED (cannot touch shifts) |

DB trigger covers **INSERT + UPDATE + DELETE** (confirmed 164:85). The two-person control
(requester ≠ approver) is enforced both in the RPC (136:447) and the reject action
(publish-request-actions.ts:199). Swap approval mutating published assignees is the
**intended, re-validated, audited path**, not a bypass.

---

## Findings

| Sev | ID | file:line | Description | Suggested fix |
|---|---|---|---|---|
| HIGH | D-01 | migration 100:155-167 (`guard_users_profile_update`) + 98:48-51 (`users_update` RLS) | The privilege-escalation guard **exempts** any `is_facility_admin()` (admin/admin permission) from the `is_super_admin` / `facility_id` immutability check (155: `if is_super_admin() or is_facility_admin(old.facility_id) then return new`). RLS `users_update` already allows a facility admin to UPDATE any same-facility `users` row. Net: a **facility admin can set `is_super_admin=true`** on any user in their facility (incl. themselves) via a raw PostgREST `UPDATE public.users`, minting a cross-tenant super-admin. No server action exposes this, and the RLS harness only tests that a *manager* (not an admin) is blocked (rls_isolation.sql:1490-1493). This is a real DB-boundary escalation from facility-scoped to global. | In the guard, do **not** blanket-exempt facility admins for the `is_super_admin` column: only `is_super_admin()` callers may raise `is_super_admin`. Keep facility-admin exemption for `is_active`/`facility_id`. Add an RLS harness assertion that a facility admin cannot set another user's (or their own) `is_super_admin`. |
| MEDIUM | D-02 | facility-paperwork/page.tsx:85-94 + migration 85:69-74 (`facility_documents_select`) | `/reports/facility-paperwork` has **no module permission check** (only `requireUser` + active-employee lookup), and the `facility_documents_select` RLS policy gates on `facility_id = current_facility_id()` **only** — no `has_module_access`. Any active staff member at a facility can list and obtain signed download URLs for **all** facility documents regardless of module permissions. May be intended (paperwork = broadly readable), but it is the one report surface with no per-module gate. | Confirm intent. If gated, add `has_module_access('facility_paperwork')` (or the paperwork module key) to the SELECT policy and a `currentUserCan` check on the page; otherwise document the decision explicitly. |
| MEDIUM | D-03 | permissions/user-permission-actions.ts (setUserModulePermission) + employees/actions.ts (role assign) | A facility admin can grant `module_name='admin', action='admin'` (or assign the `admin`/`super_admin` role key) to any user in their facility — creating peer admins. This matches the CLAUDE.md permission model (admins own their facility's authorization) and is **facility-scoped** (cannot reach `users.is_super_admin`), so it is not cross-tenant. Flagged so the product owner explicitly ratifies "any facility admin can create another facility admin." | Confirm by-design. Optionally add an audit-log entry when the `admin/admin` permission is granted, and/or require a second admin to confirm admin-tier grants. |
| LOW | D-04 | employees/actions.ts:504-512 (`deleteEmployee`) | Super-admin-gated (508), but the `.delete()` scopes by `.eq("id", id)` only — no `.eq("facility_id", …)`. Relies entirely on RLS. Harmless today (super-admin only, and delete is a rare op) but inconsistent with the facility-scoped pattern used elsewhere. | Add `.eq("facility_id", …)` for defense-in-depth. |
| LOW | D-05 | reports/ice-depth/[layoutSlug]/done/pdf/route.ts:16-27 | The ice-depth PDF route runs `requireUser()` + a UUID `id` param and relies **entirely on RLS** (`ice_depth_sessions_select` requires `has_module_access('ice_depth')`) to scope the render to the caller's facility. Unlike the sibling submission pages it has **no `currentUserCan('ice_depth','view')` check**. RLS makes it safe today (a user without ice_depth access cannot read the session), so this is defense-in-depth only. | Add an explicit `currentUserCan(supabase,'ice_depth','view')` gate in the route for parity with the page-level checks, so the endpoint fails closed independent of RLS. |
| LOW | D-06 | reports/scheduling/actions.ts:334 (deleteAvailability), :526 (acceptSwapRequest) | These two SELECTs omit an explicit `.eq('facility_id', …)` filter and lean on RLS + an ownership (`employee_id`) predicate. Correct today (RLS scopes reads; ownership predicate is on the write), but inconsistent with every sibling action that filters facility explicitly. | Add explicit facility filters for defense-in-depth and clearer errors. |
| LOW | D-07 | migration 100:155 (guard) applies to `is_active`/`facility_id` too | Same facility-admin exemption also lets a facility admin move a user's `facility_id` or toggle `is_active` on same-facility rows via raw PostgREST. `is_active` toggle is legitimate admin behavior; `facility_id` relocation to a *different* facility is bounded by the RLS `with check` (must remain `= current_facility_id()`), so it cannot export a user out of the facility. Noting for completeness alongside D-01. | Covered by the D-01 column-specific fix (restrict the escalation-sensitive columns). |
| MEDIUM | D-08 | employees/actions.ts:538-556 (`seedRolesForCurrentFacility`) | Accepts a `facilityId` **string argument from the client** and uses it directly in the `roles` upsert (548) after only `requireAdmin()` + a non-empty check (543). There is **no `facilityId === profile.facility_id`** verification for non-super-admins — the only thing stopping a facility admin from seeding canonical roles into *another* facility is the `roles` INSERT RLS policy. This is the one admin write that trusts a client-supplied facility_id. (Contrast every other employees/departments/spaces action, which re-derives facility server-side.) Impact is bounded (seeding standard roles, not data theft) but it violates the "facility_id must be server-derived" invariant. | Re-derive: `const { profile } = await requireAdmin(); if (!profile?.is_super_admin && facilityId !== profile?.facility_id) return {ok:false,error:…}` — or drop the parameter and use `profile.facility_id` directly. |
| LOW | D-09 | permissions/page.tsx:25-30; permissions/[userId]/page.tsx (user load) | The permissions list SELECTs `users` with `.eq("is_active", true)` and **no facility filter**, and the per-user page loads the target `users` row by `id` with no facility filter — both rely entirely on the `users_select` RLS policy (migration 98:29-35: same-facility OR self OR super-admin) to scope results. RLS does bound a facility admin to their own facility today, so there is no actual cross-facility leak, but the queries are written as if intending to list all users and would leak immediately if the RLS predicate regressed. The write path (`upsertUserPermission`) is already facility-checked (user-permission-actions.ts:72) and admin/admin grants are super-admin-only (75). | Add an explicit non-super-admin `.eq('facility_id', profile.facility_id)` filter to the list query and a `notFound()` guard on the detail page when the target user's facility ≠ caller's, for defense-in-depth. |

---

## Verified-OK

- **facility_id is never client-trusted** except super-admin cross-facility actions
  (`setFacilityActive`), which are `is_super_admin`-gated. `current_facility_id()`
  (migration 3:64-74) resolves from `users.facility_id` for `auth.uid()` — no
  client-switchable facility, no `?facility=` param, no facility-switcher component.
- **Publish-lock**: INSERT+UPDATE+DELETE all covered by `trg_schedule_shifts_publish_lock`
  (migration 164:83-86); every app path routes published mutations through definer RPCs.
- **Two-person publish**: self-approve rejected in RPC (136:447) and reject action
  (publish-request-actions.ts:199).
- **offline-sync**: per-module `currentUserCan` on every replay branch; `facility_id` and
  `employee_id` are server-injected from the session (route.ts:62-94), never from payload;
  scheduling replay is restricted to availability + time-off (cannot touch shifts);
  `local_id` idempotency is a client UUID and every write is facility/employee-scoped
  server-side, so a guessed `local_id` cannot let user A overwrite user B's logical row
  with foreign data (scoping is re-derived, not taken from the queued row).
- **api/exports**: `requireAdmin` + `authorizeExport` (module + `view` action, super-admin
  bypass, fails closed) + `buildExport` pins every query to the caller's `facility_id`.
- **PDF/log routes**: air-quality log PDF is `requireAdmin` + server-derived `facility_id`
  filter; ice-depth PDF is RLS-scoped (see D-05).
- **Report detail pages** (`incidents/[id]`, `accidents/[id]`, `daily/history`): no
  page-level module check, but the corresponding SELECT RLS policies enforce
  `has_module_access(module) AND employee_id = current_employee_id()` (or module-admin) —
  a staff user with no permission row reads nothing. Access is **deny-by-default**
  (`has_module_access`, migration 91:73-94, returns false with no `user_permissions` row).
- **super-admin actions**: all gated on `is_super_admin`; service-role client
  (`createAdminClient`) only reachable behind `requireSuperAdmin`.
- **preview/impersonation**: admin-gated, non-super-admins constrained to own facility,
  audit-logged; the preview cookie de-escalates (views as target employee), does not
  elevate.
- **admin layout** `requireAdmin` (admin/layout.tsx) + scheduling second layer; the two
  `/admin` route handlers (exports, air-quality log/pdf) each self-guard since route
  handlers do NOT inherit layout guards.
- **self-escalation on own profile** is blocked by the guard for non-admins (harness
  rls_isolation.sql:1441-1443, 1490-1493) — the residual gap is the *admin-tier* exemption
  (D-01), not the staff path.
