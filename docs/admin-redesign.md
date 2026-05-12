# Admin Control Center — Redesign Plan

**Status:** Draft — not yet approved for implementation.
**Scope:** Refactor and extend the Admin Control Center so every facility can customize every module independently, with Employee Setup as the single source of truth for access, roles, permissions, and routing.
**Author:** Architecture audit, [date stamp added on review].

---

## TL;DR

This codebase is much closer to the target than the original brief implied. Most tables, RLS scaffolding, and per-module admin pages already exist and are facility-scoped. What's missing is a **finer permission grain, role-based defaults, real audit-log emission, and some UI consolidation**. This is a refactor + extension over 2–3 weeks, not a rewrite.

The single highest-leverage change is **Phase 2a + 3** (permission-level enum + role defaults + RLS migration). Everything else is paint until that lands.

---

## 1. Phase 1 — Audit of current state

### 1.1 Roles & permissions

- **Six seeded roles per facility** (`super_admin`, `admin`, `gm`, `manager`, `supervisor`, `staff`) with `hierarchy_level` — `supabase/migrations/00000000000005_seed_system_roles.sql`.
- **Permission grain is three booleans only**: `can_view`, `can_submit`, `can_admin` per (employee × module). See `module_permissions` table — `supabase/migrations/00000000000002_backbone_schema.sql:225-253`.
- Optional per-area override exists (`module_area_permissions`, m2:260-283) but only view/submit.
- DB-level enforcement via `has_module_permission(module_key, perm_type)` — `supabase/migrations/00000000000029_module_permission_helper.sql:22-69`.
- **Roles carry no permission data.** Permissions are 100% per-employee manual — no role-based defaults or templates. The current permissions UI (`src/app/admin/permissions/page.tsx`) is a per-cell toggle grid.

### 1.2 Employee setup

- `employees` table (m2:154-192): `facility_id`, `user_id`, `role_id` (single), `employee_code`, contact info, emergency contact, `is_minor`, `hire_date`, `is_active`, `deactivated_at`, `created_by`.
- `users` table (m2:121-148): auth link, `facility_id`, `full_name`, `phone`, `is_super_admin`, `is_active`, `last_seen_at`.
- Multi-department junction `employee_departments` (m2:197-220).
- Employee CRUD lives at `src/app/admin/employees/page.tsx` with an `EmployeeForm`.
- **No UI for assigning per-module permissions inside the employee record** — that lives in a separate `/admin/permissions` grid, forcing context switching.

### 1.3 Module customization (already facility-scoped)

Every module already has its own admin page, all facility-scoped via `facility_id` FK + RLS:

| Module | Admin route | Schema migration | Existing tabs |
|---|---|---|---|
| Daily Reports | `/admin/daily-reports` | m7 | Areas, Templates, Checklist Items |
| Ice Depth | `/admin/ice-depth` | m14 | Layouts, Settings |
| Ice Operations | `/admin/ice-operations` | m13 | Setup, Settings |
| Incident Reports | `/admin/incident-reports` | m8 | Types, Severities |
| Accident Reports | `/admin/accident-reports` | m10 | Dropdowns, Workers Comp, History |
| Refrigeration | `/admin/refrigeration` | m11 | Setup, Settings |
| Air Quality | `/admin/air-quality` | m12 | Setup, Settings, Compliance |
| Scheduling | `/admin/scheduling` | m15 | Shifts, Templates, Swaps, Time-Off, Compliance, Notifications, Settings |
| Communications | `/admin/communications` | m9 | Groups, Templates, Routing, Reminders, Inbox, Audit |

System pages also present: `/admin/facility`, `/admin/exports`, `/admin/retention`, `/admin/audit-log`, `/admin/super-admin`.

### 1.4 Facility scoping & RLS

- All operational tables carry `facility_id` with `ON DELETE RESTRICT`.
- Standard RLS pattern (m4): `SELECT` = super_admin OR same facility; `INSERT/UPDATE` = super_admin OR (same facility AND role in admin/gm/super_admin).
- m30 (`submission_rls_module_permissions`) layers `has_module_permission` checks onto submission tables.
- m26 revokes anon execute on functions.
- **No cross-facility leaks found in the schema** during this audit.

### 1.5 Audit log

- `audit_logs` table **exists** (m2:288-301) — `actor_user_id`, `actor_employee_id`, `action`, `entity_type`, `entity_id`, `before`, `after`, `ip`, `user_agent`. SELECT-only RLS.
- **Nothing writes to it.** The reader page `/admin/audit-log` exists but the table is effectively a stub. Zero triggers, zero app-side `insert` calls.

### 1.6 Communications

- `communication_groups` is first-class with members + routing rules (m9). Not ad-hoc.
- Groups are manually populated — not auto-derived from departments or roles.

---

## 2. Gaps vs. spec

| # | Gap | Severity |
|---|---|---|
| 1 | Permission grain is 3 flags; spec wants 9 levels (None / View / Submit / EditOwn / EditAll / Approve / Publish / ManageSettings / Admin) | **High** |
| 2 | No role-based permission *defaults/templates* — every employee configured manually | **High** |
| 3 | `audit_logs` table exists but nothing writes to it | **High** (compliance) |
| 4 | Approval / Publish workflow not modeled. Scheduling spec wants human approval before publish; only `can_submit` + `can_admin` exists today | **High** |
| 5 | Module-access matrix UI is a flat grid; no bulk ops ("copy from", "apply role template") | Medium |
| 6 | Employee form doesn't surface module access; admins context-switch to a separate page | Medium |
| 7 | Generic `module_customizations` / `module_field_configs` / `module_notification_rules` tables don't exist — each module has its own bespoke settings tables | Low (current pattern is fine, just inconsistent) |
| 8 | No "preview module as employee" feature | Low |
| 9 | Communication groups are not auto-derived from departments/roles | Low |
| 10 | No facility-defined "custom employee fields" | Low |

---

## 3. Recommended architecture

**Guiding principle: keep what works.** The per-module admin pages and per-module settings tables already work — inverting to generic `module_field_configs` JSON blobs would regress type safety and DX. The redesign is **three layers on top of what exists**, not a teardown.

### Layer A — Permissions model upgrade (additive, backward-compatible)

Add a `permission_level` enum but keep the old flag columns during migration so nothing breaks.

```sql
create type module_permission_level as enum (
  'none', 'view', 'submit', 'edit_own', 'edit_all',
  'approve', 'publish', 'manage_settings', 'admin'
);

alter table module_permissions
  add column permission_level module_permission_level;

create table role_module_permission_defaults (
  role_id uuid references roles(id) on delete cascade,
  module_key text not null,
  permission_level module_permission_level not null,
  primary key (role_id, module_key)
);
```

**Effective permission resolution:** `coalesce(employee_override.level, role_default.level, 'none')`. Implement as a SQL function `effective_module_permission(employee_id, module_key) returns module_permission_level` and call it everywhere instead of the current `has_module_permission`.

The enum is ordered so that policies can write `effective_module_permission(...) >= 'submit'::module_permission_level`.

### Layer B — Audit logging that actually fires

Two parts:

1. **DB triggers** on sensitive tables (`employees`, `module_permissions`, `role_module_permission_defaults`, `facility_settings`, `incident_reports`, `accident_reports`, schedule publish events) that write to `audit_logs` with `before`/`after` JSON.
2. **App-side helper** `logAudit({action, entity_type, entity_id, before, after})` in `src/lib/audit/` for events that aren't pure CRUD — PDF sent, email sent, schedule published, incident viewed.

### Layer C — UI consolidation

- **Employee detail page** becomes a tabbed view: Profile / Departments / Module Access / Communication Groups / Activity. The Module Access tab embeds the matrix scoped to one employee — same data as `/admin/permissions`, sliced differently.
- **Module Access Matrix** (`/admin/permissions`) gets: per-cell dropdown of the 9 levels, "Apply role template" button, "Copy from employee" button, bulk edit by department.
- **New `/admin/roles`** page to manage role-based defaults (the templates that drive Layer A's defaults).
- **"Preview as employee"** = impersonation-lite: an admin-only cookie that overrides effective permissions in `getCurrentUser()` (NOT the auth identity — `auth.uid()` stays the admin, audit logs reflect that).

### What NOT to change

- Per-module bespoke settings tables (`daily_report_areas`, `ice_depth_layouts`, etc.). They're fine.
- The `proxy.ts` / `requireAdmin` auth flow. Works.
- Facility scoping. Already correct.
- Route group layout. Only nav addition is `/admin/roles`.

---

## 4. Database schema changes

### 4.1 New migrations (in order)

| Migration | Purpose | Risk |
|---|---|---|
| `00000000000038_permission_level_enum.sql` | Create enum, add column to `module_permissions`, create `role_module_permission_defaults`, create `effective_module_permission()` | Low — additive |
| `00000000000039_backfill_permission_levels.sql` | Translate existing 3-flag rows: `can_admin → 'admin'`, `can_submit → 'submit'`, `can_view → 'view'`, else `'none'` | Low |
| `00000000000040_rls_use_effective_permission.sql` | Update m30 policies to call `effective_module_permission(...) >= '<level>'` | **Medium — RLS** |
| `00000000000041_audit_triggers.sql` | Triggers on sensitive tables → `audit_logs` | Low |
| `00000000000042_scheduling_approval_workflow.sql` | `schedule_publish_requests` table with `requested_by`, `approved_by`, `published_at` | Low |
| `00000000000043_employee_custom_fields.sql` | `employee_custom_fields` + `employee_custom_field_values` (facility-scoped) | Low |

### 4.2 Tables that already exist and need no schema change

`facilities`, `users`, `employees`, `roles` (employee_roles), `departments`, `employee_departments`, `modules` (implicit via `module_key` strings), `facility_modules` (implicit — every facility sees all modules subject to permissions), `module_permissions`, `module_area_permissions`, `communication_groups`, `communication_group_members`, `audit_logs`, `facility_settings`.

### 4.3 Tables in the spec we do NOT need

- Generic `module_customizations` / `module_field_configs` / `module_notification_rules` — bespoke per-module tables are already in place and work better than a JSON blob.

---

## 5. RLS policy changes

### 5.1 Pattern for permission-gated reads

```sql
-- BEFORE (m30):
create policy "view submissions by module view"
on daily_report_submissions for select using (
  has_module_permission('daily_reports', 'view')
);

-- AFTER:
create policy "view submissions by module view"
on daily_report_submissions for select using (
  effective_module_permission(auth_employee_id(), 'daily_reports')
    >= 'view'::module_permission_level
);
```

### 5.2 New policy for edit-own vs edit-all

```sql
create policy "edit own submission"
on daily_report_submissions for update using (
  (effective_module_permission(auth_employee_id(), 'daily_reports')
     >= 'edit_own'::module_permission_level
   AND submitted_by = auth_employee_id())
  OR
  effective_module_permission(auth_employee_id(), 'daily_reports')
    >= 'edit_all'::module_permission_level
);
```

### 5.3 Schedule publish guard

```sql
create policy "publish schedules"
on schedule_publish_requests for update using (
  effective_module_permission(auth_employee_id(), 'scheduling')
    >= 'publish'::module_permission_level
  AND requested_by <> auth_employee_id() -- human approval: requester cannot self-approve
);
```

### 5.4 Sensitive report access

Incident and accident reports already have stricter RLS. Tighten to:

```sql
create policy "view incident reports"
on incident_reports for select using (
  effective_module_permission(auth_employee_id(), 'incident_reports')
    >= 'view'::module_permission_level
);
```

---

## 6. Admin UI sitemap

```
/admin                              Dashboard (existing)
├── /admin/facility                 Facility settings (existing — verify covers spec §4)
├── /admin/employees                Employee list (existing)
│   └── /admin/employees/[id]       Employee detail (NEW — tabbed)
│       ├── Profile
│       ├── Departments
│       ├── Module Access           (matrix scoped to this employee)
│       ├── Communication Groups
│       └── Activity                (audit log filtered to this employee)
├── /admin/departments              (NEW — currently inline on employees page)
├── /admin/roles                    (NEW — role-based permission defaults)
├── /admin/permissions              Module Access Matrix (existing, rebuild UI)
│
├── /admin/daily-reports            (existing)
├── /admin/ice-depth                (existing)
├── /admin/ice-operations           (existing)
├── /admin/incident-reports         (existing)
├── /admin/accident-reports         (existing)
├── /admin/refrigeration            (existing)
├── /admin/air-quality              (existing)
├── /admin/scheduling               (existing)
├── /admin/communications           (existing)
│
├── /admin/exports                  PDF/Export settings (existing)
├── /admin/retention                Data retention (existing)
├── /admin/audit-log                Audit log viewer (existing — needs data)
└── /admin/super-admin              Super-admin tools (existing)
```

---

## 7. Employee permission matrix (the 9 levels)

| Level | Cumulative meaning |
|---|---|
| `none` | Module not visible. Nav hides it, direct URL → 403. |
| `view` | Can see records but not create or edit. |
| `submit` | + can create new records (e.g. file a daily report). |
| `edit_own` | + can edit records they themselves created. |
| `edit_all` | + can edit any record in the facility. |
| `approve` | + can approve submitted records (e.g. swap requests, time-off). |
| `publish` | + can publish records visible to staff (e.g. schedules). |
| `manage_settings` | + can configure the module's admin settings page. |
| `admin` | + full control including permission changes for other employees on this module. |

**Resolution order:** employee override → role default → `none`.

---

## 8. Module customization matrix

What each module's admin page must let a facility configure (existing pages cover most of this; deltas marked **[NEW]**):

| Module | Customizable today | Spec gaps |
|---|---|---|
| Daily Reports | Areas, templates, checklist items | [NEW] up-to-20 tab cap enforcement, [NEW] per-tab assigned employees/departments, [NEW] end-of-day locking rule |
| Ice Depth | Layouts (up to 8), measurement points, thresholds, colors | [NEW] Bluetooth caliper pairing config, [NEW] per-layout assigned users |
| Ice Operations | Operation types, equipment, recipients | [NEW] equipment-specific workflow per type |
| Refrigeration | Compressor count, ranges, alert thresholds, recipients | OK |
| Air Quality | Jurisdiction, frequency, escalation tiers, recipients | [NEW] regulatory-floor lock (admins can tighten, not loosen) |
| Incident Reporting | Categories, severities | [NEW] separate Incident vs Accident form config, follow-up workflow, [NEW] who-can-close |
| Accident Reports | Dropdowns, workers comp, history | Existing SVG body diagram already in place |
| Scheduling | Shifts, templates, compliance, notifications | [NEW] publish approval workflow (see §5.3), [NEW] 200-staff scalability test |
| Communications | Groups, templates, routing, reminders | [NEW] auto-derive groups from departments option, [NEW] PDF header config |

---

## 9. Implementation steps (phased)

| Phase | Scope | Files touched | Size | Risk |
|---|---|---|---|---|
| **2a** | Migrations: `permission_level` enum, `role_module_permission_defaults`, `effective_module_permission()` function, backfill | 2 new migrations | ~150 lines SQL | Low |
| **2b** | Audit-log triggers on sensitive tables | 1 new migration | ~100 lines SQL | Low |
| **3** | Replace `has_module_permission` callers with `effective_module_permission`. Update m30 RLS. New `src/lib/permissions/` helper. | ~10-15 files | Medium | **Medium — touches RLS** |
| **4** | New `/admin/roles` page. Rewrite `/admin/permissions` matrix with dropdowns + bulk ops. Tabbed employee detail. | ~6-8 new files | Medium | Low (UI only) |
| **5** | App-side audit helper. Emit on PDF send, schedule publish, incident view. | ~5 files | Small | Low |
| **6** | Scheduling approval workflow (`schedule_publish_requests` table + UI) | ~4 files | Small | Medium |
| **7** | Facility-defined custom employee fields | 1 migration + ~3 files | Small | Low |
| **8** | "Preview as employee" mode | ~3 files | Small | **Medium — security-sensitive** |
| **9** | Cross-facility RLS regression test + security review | — | — | — |

**Total realistic estimate:** 2–3 weeks of focused work for one engineer. **Phase 2a + 3 is the keystone** — until it ships, everything else is paint.

---

## 10. Code changes — concrete file list

### Files to create

```
supabase/migrations/00000000000038_permission_level_enum.sql
supabase/migrations/00000000000039_backfill_permission_levels.sql
supabase/migrations/00000000000040_rls_use_effective_permission.sql
supabase/migrations/00000000000041_audit_triggers.sql
supabase/migrations/00000000000042_scheduling_approval_workflow.sql
supabase/migrations/00000000000043_employee_custom_fields.sql

src/lib/permissions/index.ts
src/lib/permissions/effective.ts        # client + server wrapper around effective_module_permission
src/lib/permissions/levels.ts           # enum + ordering helpers
src/lib/audit/log.ts                    # logAudit() helper
src/lib/audit/index.ts

src/app/admin/roles/page.tsx            # role permission defaults editor
src/app/admin/roles/_components/role-matrix.tsx
src/app/admin/employees/[id]/page.tsx   # tabbed employee detail
src/app/admin/employees/[id]/_components/module-access-tab.tsx
src/app/admin/employees/[id]/_components/activity-tab.tsx
src/app/admin/departments/page.tsx      # promote from inline
```

### Files to modify

```
src/app/admin/permissions/page.tsx               # dropdown UI, bulk ops
src/app/admin/permissions/_components/permissions-table.tsx
src/components/admin/nav-config.ts               # add /admin/roles, /admin/departments
src/lib/auth/require-admin.ts                    # consider using manage_settings level instead of role keys
src/types/database.ts                            # regenerate after migrations 38-43
```

### Module pages that may need surgical updates after Phase 3

Any page calling `has_module_permission` or reading `module_permissions.can_*` directly. Likely candidates (verify with grep before Phase 3):

```
src/app/admin/scheduling/publish/page.tsx        # publish gate
src/app/reports/**                               # submission gates
```

---

## 11. Test plan

### 11.1 RLS regression matrix

For each modified policy (Phase 3 + 6), as each of the 6 roles, attempt:

| Operation | Expected outcome by role |
|---|---|
| SELECT on facility A as facility A admin | allowed |
| SELECT on facility A as facility B admin | denied |
| SELECT on facility A as facility A staff with `view` | allowed |
| SELECT on facility A as facility A staff with `none` | denied (0 rows) |
| UPDATE own submission with `edit_own` | allowed |
| UPDATE other's submission with `edit_own` | denied |
| UPDATE other's submission with `edit_all` | allowed |
| Schedule publish by requester with `publish` | denied (same requester ≠ approver) |
| Schedule publish by different employee with `publish` | allowed |

### 11.2 Audit log verification

After each Phase 2b trigger, manually update/insert/delete a row in the audited table and verify an `audit_logs` entry appears with correct `before`/`after`.

### 11.3 Permission resolution unit tests

Test `effective_module_permission(employee_id, module_key)`:
- employee with explicit override → returns override
- employee with no override but role has default → returns role default
- employee with no override and role has no default → returns `'none'`
- inactive employee → returns `'none'` regardless

### 11.4 UI smoke tests (manual via `pnpm dev`)

- Set role default to `submit` on Daily Reports for `staff` → all staff employees gain submit access without per-employee config.
- Override one staff member to `none` → that one loses access; others retain it.
- "Apply role template" button on permissions matrix → fills in defaults, leaves overrides alone.
- "Preview as employee" → admin sees only the modules that employee can see.

### 11.5 Cross-facility leak test

Seed two facilities. Log in as admin of facility A. Attempt by direct URL and by SQL (via Supabase Studio):
- Read any table filtered by facility B's id → 0 rows.
- Update any table filtered by facility B's id → 0 rows affected.
- Call any RPC with facility B's id → denied or 0 rows.

---

## 12. Security checklist

- [ ] Every new table has `facility_id` + RLS policies modeled on m4 + m30.
- [ ] `effective_module_permission` is `security definer` with `search_path = public, pg_temp` (per m6 hardening pattern).
- [ ] Audit triggers run as `security definer` and never expose `before`/`after` for billing or auth tokens.
- [ ] "Preview as employee" never elevates — it only narrows. `auth.uid()` in audit logs stays the admin.
- [ ] Anon role has no `EXECUTE` on new functions (m26 pattern).
- [ ] Incident/accident report RLS gets explicit `permission_level >= 'view'` check, not just `can_view`.
- [ ] Cross-facility test (§11.5) passes for every new table and every modified policy.
- [ ] Schedule publish enforces requester ≠ approver at both RLS and app layer (defense in depth).
- [ ] `role_module_permission_defaults` can only be written by `admin`-level on the `admin` module — meta-permissions are themselves permissioned.
- [ ] Backfill migration (m39) verified idempotent before merge to main.

---

## 13. Hard rules carried forward from the brief

- No facility-specific settings hardcoded in app code. No Tennity-specific tabs.
- No cross-facility employee or settings exposure. Verify per §11.5.
- Employees never see modules they aren't assigned to (`permission_level = 'none'` hides nav + 403s direct URL).
- Normal employees cannot access `/admin/*` (existing `requireAdmin` covers this; consider switching to `effective_module_permission('admin', ...) >= 'view'` after Phase 3).
- Employee Setup is the single source of truth — every module reads access, routing, and notifications from it.
- Every module remains independently functional.
- Mobile-friendly UI (existing PWA + responsive Tailwind already in place).

---

## 14. Open questions for product

1. Should a facility admin be allowed to **create new roles** beyond the seeded six, or is the role list a system-level constant?
2. For Air Quality "regulatory minimums," who owns the floor values — is there a `regulatory_floors` table per jurisdiction, or do we hardcode by jurisdiction string?
3. Does "human approval before publish" on scheduling require a second admin, or can the same admin approve their own request after a cooling-off period?
4. For "preview as employee" — should the impersonation be logged in `audit_logs`? (Recommended: yes.)
5. Custom employee fields — should they appear on PDFs/exports automatically, or only inside admin UI?
6. Subscription tier / Stripe / HubSpot fields in `facility_settings` — out of scope for this redesign, or in scope?

---

## 15. Next step

Once this plan is approved (or amended), the first PR should implement **Phase 2a + Phase 3 together** — the migration plus all callsite + RLS updates. Shipping them separately leaves the codebase half-migrated.
