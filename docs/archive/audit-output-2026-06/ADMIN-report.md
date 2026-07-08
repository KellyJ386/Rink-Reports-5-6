# Admin Control Center Audit — Agent-ADMIN

- **Repo:** /home/user/Rink-Reports-5-6
- **Supabase project (MCP):** `bqbdgwlhbhabsibjgwmk` (live; single-facility seed dataset)
- **Mode:** AUDIT-ONLY. No code/schema writes. Only this report + ADMIN-DONE.
- **Date:** 2026-06-17.
- **Cross-references:** SCHEMA-report.md (105 tables, RLS on), SEC-report.md (0 🔴, facility_id server-side everywhere), BUILD-report.md (build/types/lint PASS), OFFLINE-report.md (sync PASS).

Severity legend: 🔴 CRITICAL · 🟡 WARNING · 🟢 MINOR · ✅ OK

---

## GRADE: 82 / 100

## Status: STRONG with two real privilege-escalation gaps and two spec-vs-reality UX gaps

The Admin Control Center is mature and largely controls every module **without code deploys**:
runtime DB-driven config is the rule across all report modules, every module has a facility-scoped
admin page reachable from a single hub, the permission model (`user_permissions` +
`role_permission_defaults`) is real and enforced in RLS, and `requireAdmin`/`requireSuperAdmin`
are correctly server-enforced. The grade is held below 90 by: (1) **no intra-facility tier guard**
on role assignment / permission grant (a facility admin can mint another facility admin), (2) **no
`facility_modules` enable/disable** mechanism — modules are toggled only indirectly via permissions,
(3) **staff nav + dashboard tiles show ALL modules to ALL staff** (gating is server-side 403 only,
not nav-hiding as the spec requires), and (4) **system-health dashboard uses the wrong windows**
(today / 90d, not the spec's 30d-active / 7d-reports, and **no offline-sync queue widget**).

---

## Strengths

1. **Runtime config cascade is the dominant pattern.** Every report module reads its config from the
   DB at request time (`export const dynamic = "force-dynamic"`), facility-scoped — see cascade table.
   Changing checklist items, thresholds, equipment, compressors, incident severities, job areas, etc.
   requires **no deploy**, only a DB/admin-UI edit.
2. **Single comprehensive admin hub.** `src/components/admin/nav-config.ts` exposes Setup (Facility,
   People, Departments, Facility Spaces, Permissions), Module Admin (all 10 modules), and System
   (Exports, Retention, Audit Log, Super Admin). Every module's settings is reachable.
3. **Real, enforced permission model.** `requireAdmin` (`src/lib/auth/require-admin.ts`) gates the
   whole `/admin` tree server-side: super_admin OR enabled `user_permissions(admin/admin)` in facility
   OR active employee with admin-tier role; deactivated accounts (even super admins) denied first
   (`require-admin.ts:32-34`). Report pages gate via `currentUserCan(...)` → `current_user_has_permission`
   RPC, fail-closed.
4. **facility_id is server-derived, never trusted from the client** (confirmed by SEC-report CHECK 1).
   `resolveFacilityIdFromForm` (employees/actions.ts:143-177) forces non-super-admins to their session
   facility and ignores the form value.
5. **Audit trail is live, not a stub.** `audit_logs` has **553 rows** (MCP). DB triggers
   (`migration 46_audit_triggers_expansion`, building on m41) cover roles, departments, permission
   defaults, all submission tables, communications, notification_outbox; app-side `logAudit()`
   (`src/lib/audit/log.ts`) covers non-CRUD events. Viewer at `/admin/audit-log` reads facility-scoped.
6. **Soft-delete preserves data.** `deactivateEmployee`/`reactivateEmployee` flip `is_active` +
   `deactivated_at`; hard `deleteEmployee` is super-admin-only.
7. **Config tables populated (MCP row counts):** roles 5, role_permission_defaults 151,
   user_permissions 140, module_area_permissions 26, daily_report_areas 17, refrigeration_equipment 7,
   ice_operations_equipment 3, air_quality_thresholds 3, incident_types 5, employee_job_areas 10.

---

## Critical / high-severity findings

### 🔴 C1 — No intra-facility privilege-escalation guard on role assignment
`createEmployee`/`updateEmployee` (`src/app/admin/employees/actions.ts:201`, `:297-308`) write
`role_id` straight from the form after only `requireAdmin()`. There is **no `hierarchy_level`
comparison** preventing a facility admin from assigning the `admin` (or `super_admin`) role to an
arbitrary employee. Because `requireAdmin` (`require-admin.ts:68-79`) treats any active employee with
`roles.key in ('admin','super_admin')` as a console admin, a facility admin can **mint another
facility admin** with no tier check. (`users.is_super_admin` itself is *not* settable this way —
that is gated behind `requireSuperAdmin` in super-admin/actions.ts — so this is intra-facility lateral
escalation to admin, not a jump to global super-admin.)

### 🔴 C2 — No guard against granting `admin`/`admin` via the permissions matrix
`src/app/admin/permissions/user-permission-actions.ts` (`upsertUserPermission` :42, `applyPresetToUser`
:88, `bulkImportUserPermissionsCsv` :137) upsert into `user_permissions` after only `requireAdmin()`,
with `module_name`/`action` accepted from input — `admin`/`admin` passes validation. Cross-facility
writes are blocked by RLS (`migration 77`, `user_permissions_write` requires caller admin/admin in the
same facility_id), but **nothing — app or RLS — stops a facility admin granting `admin`/`admin` to any
user in their own facility.** Same escalation outcome as C1 by a second path. The bulk CSV import also
reads `facility_id` from the row and does not re-validate it against the caller's facility in app code
(RLS still backstops cross-facility).

> Combined C1+C2: a facility admin has two unguarded routes to create peers. RLS prevents cross-tenant
> leakage (the platform-critical property), so this is high, not catastrophic — but it violates the
> spec's "assign roles within own tier (no privilege escalation)" requirement.

### 🟡 W1 — No module enable/disable per facility (no `facility_modules`)
There is **no `facility_modules` table and no enable/disable-module UI.** (Grep for
`facility_modules`/`module_enabled` finds only migration comments and the redesign doc.) A facility
"disables" a module only indirectly by setting every `user_permissions`/`role_permission_defaults`
action to off. There is no first-class per-facility module toggle, so an admin cannot cleanly turn a
module off platform-wide for the facility from one switch. Spec checklist item "facility_modules
(enable/disable per module per facility)" → **NOT FOUND.**

### 🟡 W2 — Disabled modules are NOT hidden from staff nav / dashboard tiles
`src/components/app/sidebar-nav.tsx:29-41` renders a **hardcoded `NAV_ITEMS` list of all 11 modules to
every staff user**, and `src/app/dashboard/page.tsx` renders tiles for **all `KNOWN_MODULES`**, filtered
only by the employee's personal `hidden_modules` preference — **not** by `user_permissions`. Access is
still enforced: each report page server-side `currentUserCan(...)` → redirects to `/forbidden`. So this
is a UX/spec gap (nav shows modules the user can't use), not a security hole. Spec §13 / checklist
"disabled modules hidden from ALL staff nav immediately" → **FAIL (server-403 only, no nav-hide).**

### 🟡 W3 — System-health dashboard uses wrong metrics / missing sync widget
`src/app/admin/page.tsx` overview cards show: total facilities, active employees, **reports submitted
today** (not 7d), **incidents+accidents last 90 days** (not "pending/unreviewed incidents"). It does
**not** show: active users in last 30 days, reports submitted in last 7 days, pending/unreviewed
incident count, or **offline-sync queue status**. Checklist "system health dashboard" → **PARTIAL.**

### 🟡 W4 — Zod gap (inherited, platform-wide)
Per SEC-report W1, admin config CRUD largely uses hand-rolled validation (`nonEmpty`, `asInt`, UUID
regex) rather than Zod; the scheduling grid + CSV `zodRow` importers are the exceptions. Graded 🟡
per the rubric, not 🔴.

---

## Spec-vs-reality role gap (report, not punished — graded against actual design)
Spec hierarchy `super_admin → org_admin → facility_manager → supervisor → staff` does **not** match the
implemented model. Live `roles` (MCP): `super_admin(0) → admin(1) → manager(2) → staff(3)` + custom
`driver(4)`; `gm`/`supervisor` retired (migrations 58/87), and there is **no `org_admin`** tier (multi-
facility org grouping is handled by `users.is_super_admin` + the super-admin facility switcher, not an
org_admin role). The actual `user_permissions` + `role_permission_defaults` matrix is internally
consistent and correctly enforced. **The gap is in the spec.** (Also noted in SCHEMA #7, SEC S1.)

---

## CHECKLIST

### SCHEMA config coverage
| Item | Result | Evidence |
|---|---|---|
| Facility config table w/ cross-module values | ✅ PASS | `facilities.settings` jsonb + per-module `*_settings` tables (SCHEMA-report §D) |
| facility_modules (enable/disable per module per facility) | ❌ NOT FOUND | no table; no UI (W1) |
| User/profile role assignment + module permission overrides | ✅ PASS | `employees.role_id`; `user_permissions` overrides (permissions/user-permission-actions.ts) |
| Daily report tab/checklist config in DB | ✅ PASS | daily_report_areas/templates/checklist_items (17/51/506 rows) |
| Operation types + equipment types configurable | 🟡 PARTIAL | equipment/fuel/rinks in DB; **operation-type set hardcoded** (see cascade) |
| Compressor count + readings-per-shift configurable | ✅ PASS | refrigeration_equipment rows (count) + refrigeration_fields/sections in DB |
| Air quality thresholds configurable | ✅ PASS | air_quality_thresholds (warn/alert/compliance min/max) |
| Incident types configurable | ✅ PASS | incident_types (5) + incident_severity_levels via /admin/incident-reports |
| Job areas + cert requirements configurable | ✅ PASS | employee_job_areas (10) + job_area_certification_requirements (0 today, table+UI exist) |

### UI user management
| Item | Result | Evidence |
|---|---|---|
| Invite/create staff | ✅ PASS | employees/actions.ts createEmployee + invite-employee.ts |
| Assign roles within own tier (no escalation, server-verified) | ❌ FAIL | no tier guard (C1) |
| Enable/disable modules per user | 🟡 PARTIAL | per-user user_permissions matrix exists; but admin/admin grant unguarded (C2) |
| Deactivate accounts (data preserved) | ✅ PASS | deactivateEmployee sets is_active=false (actions.ts:372-408) |
| Activity log / audit trail viewable | ✅ PASS | /admin/audit-log reads audit_logs (553 rows); triggers write |

### UI facility config
| Item | Result | Evidence |
|---|---|---|
| Edit facility name/address/contact | ✅ PASS | facility-form.tsx fields name/slug/address/city/state/zip/phone/email |
| Rink count / rink names | 🟡 PARTIAL | not on facility form; rinks live in ice_operations_rinks + ice_depth_rinks + facility_spaces (editable in their own admin pages) |
| Equipment registry (resurfacer names) | ✅ PASS | ice_operations_equipment via /admin/ice-operations |
| All module settings reachable from Admin hub | ✅ PASS | nav-config.ts Module Admin group (all 10) |

### UI module management
| Item | Result | Evidence |
|---|---|---|
| Enable/disable each module | ❌ NOT FOUND | no facility_modules toggle (W1) |
| Disabled modules hidden from ALL staff nav immediately | ❌ FAIL | nav hardcoded; server-403 only (W2) |
| Toggle effective without re-login | 🟡 N/A→PARTIAL | permission changes are read per-request server-side (force-dynamic), so they DO take effect without re-login; but there's no module toggle to begin with |

### UI system health dashboard
| Item | Result | Evidence |
|---|---|---|
| Active users (30d) | ❌ NOT FOUND | dashboard shows active employees count, not 30d-active |
| Reports submitted (7d) | 🟡 PARTIAL | shows "today", not 7d (admin/page.tsx:269-275) |
| Pending/unreviewed incidents | 🟡 PARTIAL | shows incidents+accidents 90d total, not pending/unreviewed |
| Offline sync queue status | ❌ NOT FOUND | no widget (offline_sync_queue not surfaced in admin dashboard) |

### ADMIN→MODULE CASCADE (runtime config read from DB, not compiled in)
| Module config | Runtime-DB? | Evidence (file:line) |
|---|---|---|
| Daily tabs / areas / checklist | ✅ RUNTIME-DB | daily/actions.ts:53-59; daily/page.tsx:96-117 |
| IceOps operation types | 🟡 HARDCODED | reports/ice-operations/types.ts:27-53 (`OPERATION_TYPES`/`OPERATION_TAB_ORDER`) — set needs deploy |
| IceOps equipment / fuel | ✅ RUNTIME-DB | ice-operations/[operationType]/page.tsx:153-162, :279-284 |
| Refrig compressor count / fields | ✅ RUNTIME-DB | refrigeration/page.tsx:137-168 (equipment rows = compressor count) |
| Air thresholds (warn/alert min/max) | ✅ RUNTIME-DB | air-quality/[locationSlug]/page.tsx:126-147 |
| Incident types / severities | ✅ RUNTIME-DB | incidents/page.tsx:143-156 (severity_levels + activities; staff form uses these) |
| Scheduling job areas / certs | ✅ RUNTIME-DB | scheduling/availability/[date]/page.tsx:127-129; admin/scheduling/job-areas |

> 🟡 Only the **Ice Operations operation-type set** (4 tabs + their labels + op→equipment_type mapping)
> is compiled into `reports/ice-operations/types.ts`. Adding/renaming an operation type needs a deploy.
> Everything else cascades from the DB at runtime, facility-scoped, no deploy.

### ROLE ENFORCEMENT
| Tier | Expectation | Result | Evidence |
|---|---|---|---|
| super_admin | full access all facilities | ✅ PASS | requireAdmin returns early on is_super_admin; super-admin/actions.ts requireSuperAdmin |
| org_admin (multi-facility in org) | — | N/A | **no org_admin role exists**; super_admin + facility switcher covers cross-facility (spec gap) |
| facility_manager → "admin"/"manager" (own facility) | own facility only | ✅ PASS (scope) / ❌ tier | RLS + requireAdmin scope to facility_id; but no within-tier assignment guard (C1/C2) |
| supervisor/staff NO admin access (server-enforced) | denied | ✅ PASS | requireAdmin → redirect /forbidden unless super_admin OR admin/admin perm OR admin-tier employee; staff have none |

---

## Files needing work (for future non-audit PRs)

1. `src/app/admin/employees/actions.ts` (createEmployee ~:201, updateEmployee :297-308) — add
   server-side tier guard: caller's role `hierarchy_level` must be ≤ (i.e. not assign a role more
   privileged than) the target `role_id`'s level; block non-super-admins from assigning admin/super_admin. (C1)
2. `src/app/admin/permissions/user-permission-actions.ts` (:42,:88,:137) — block non-super-admins from
   granting `module_name='admin', action='admin'`; re-validate CSV `facility_id` against caller facility
   in app code (not RLS only). (C2)
3. **New** `facility_modules` table + `/admin` module-toggle UI (per-facility enable/disable). (W1)
4. `src/components/app/sidebar-nav.tsx` + `src/app/dashboard/page.tsx` — filter `NAV_ITEMS`/tiles by the
   caller's resolved `user_permissions` (view access) so disabled modules disappear from nav, not just 403. (W2)
5. `src/app/admin/page.tsx` — fix health metrics to 30d-active-users + 7d-reports + pending/unreviewed
   incident count, and add an offline-sync-queue status widget (offline_sync_queue). (W3)
6. `src/components/admin/nav-config.ts` — `/admin/roles` page exists but isn't linked in the nav (minor). 
7. Platform-wide: introduce a shared Zod schema layer for admin CRUD (W4 / SEC W1).
