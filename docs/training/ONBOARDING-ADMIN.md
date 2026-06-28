# Admin Onboarding — Stand Up a New Facility

*RinkReports · Version 5-6 · for super_admin / org_admin / facility_manager*

This is the guided first-day path for getting a brand-new rink live in RinkReports. Work top to bottom: each step builds on the one before it, and the early steps unlock the later screens. Links jump into the full module chapters where the detail lives.

> **Role note (⚠ VERIFY — permission-driven, not title-driven).** RinkReports has no `org_admin` tier in the live app — treat any org_admin step as **super_admin**. Most setup below is a **facility_manager** (`admin`) task, but a few steps are **super_admin-only** and are flagged ⚠ **super_admin only**. Access is resolved per module/action, so confirm any "who can do this" claim against your configured facility. See [How RinkReports is organized](./MASTER-MANUAL.md#how-rinkreports-is-organized).

> **Everything you configure applies to your facility only — this is automatic.** See the [Admin Control Center](./modules/admin-control-center.md) chapter for the full back-office reference.

---

## Phase 1 — Create the facility and its core configuration

- [ ] **⚠ super_admin only — Create the facility.** In **Admin Center → Facility**, click **New Facility** and fill in Name, Slug (unique), Timezone, and address/contact. A regular admin sees this screen read-only. *(See [Admin Control Center §5 — Facility](./modules/admin-control-center.md#facility-adminfacility).)*
- [ ] **Seed the canonical roles.** From the **Admin Dashboard** setup checklist ("Canonical roles seeded"), open the Roles screen and **Seed default roles** to create Super Admin / Administrator / Manager / Staff. *(Roles has no sidebar link — reach it from the dashboard checklist. ⚠ VERIFY navigation. See [Admin Control Center §5 — Roles](./modules/admin-control-center.md#roles-adminroles).)*
- [ ] **Review role permission defaults.** On the Roles screen, set each role's default View / Submit / Edit / Admin per module so new employees inherit sensible access. Add any custom per-facility roles (e.g. `driver`) now.
- [ ] **Turn on the modules you'll use.** In **Admin Center → Modules**, flip the on/off switch for each module (Daily Reports, Ice Depth, Ice Operations, Refrigeration, Air Quality, Incidents, Accidents, Scheduling, Communications, Facility Paperwork). This controls **staff navigation visibility only** — it doesn't grant permissions. *(See [Admin Control Center §5 — Modules](./modules/admin-control-center.md#modules-adminmodules).)*
- [ ] **Set up shared lists.** Create **Departments** (for scheduling/routing) and **Facility Spaces** (the location list used by Incident, Accident, and Air Quality — use **Seed defaults** for a standard set). *(See [Admin Control Center §5 — Departments / Facility Spaces](./modules/admin-control-center.md#departments-admindepartments).)*

## Phase 2 — Add people and assign roles

- [ ] **Add your employees.** In **Admin Center → People**, use **Add employee** (or **Bulk add** for up to 100 at once). Set name, **Role**, and decide **Create a login & apply these permissions** (on for people who sign in; off for schedule-only staff such as minors). *(See [Admin Control Center §5 — People / Employees](./modules/admin-control-center.md#people--employees-adminemployees) and the employee field reference in §7.)*
- [ ] **Assign roles and job areas.** Choose each person's role in the same form (you can only assign roles at or below your own rank), and pick up to 4 **job areas** (one Primary) for scheduling. Set **Max weekly hours** if you want an overtime warning threshold.
- [ ] **Send invites.** For login users, the invite goes out when you create them (or via the **Invite** row action / the bulk "send invites" toggle). Seed permissions are applied automatically.
- [ ] **⚠ super_admin only — Cross-facility placement & Admin access.** Only a super_admin can place someone in a *different* facility and grant the **Admin module's Admin action** (Admin Center access). A regular admin cannot hand out Admin Center access. *(See [Admin Control Center §5 — Permissions](./modules/admin-control-center.md#permissions-adminpermissions).)*

## Phase 3 — Configure each module's settings

Open each enabled module's admin area (Admin Center → Module Admin) and complete its **Setup & configuration** section. Most modules offer a **Seed defaults** button to get a working starting point.

- [ ] **Daily Reports** — create **Areas** (up to **30 active**; ⚠ VERIFY exact cap), build **Templates** and **Checklist Items**, and grant **Area Access** per employee. *(See [Daily Reports §4](./modules/daily-reports.md#4-setup--configuration-admins).)*
- [ ] **Refrigeration Logs** — **Seed defaults** or build **Sections / Equipment / Fields**, set **Thresholds** (normal ranges), and configure **Settings** (out-of-range alerts, readings-per-shift cap). *(See [Refrigeration §4](./modules/refrigeration-logs.md#4-setup--configuration-admins).)*
- [ ] **Air Quality** — add **Reading types** and **Equipment**, choose a **Compliance** profile and **tighten thresholds** if needed (you can only tighten, never loosen — ⚠ VERIFY), and set **Settings** (alerts, testing-frequency text). *(See [Air Quality §4](./modules/air-quality.md#4-setup--configuration-admins).)*
- [ ] **Ice Operations** — set up **Rinks, Equipment, Fuel types, Circle-check items/templates**, then choose **Visible operations** and alerts in **Settings**. *(See [Ice Operations §4](./modules/ice-operations.md#4-setup--configuration-admins).)*
- [ ] **Ice Depth** — create **Rinks** and **Diagrams** (place measurement points), and set **Settings** (unit — inches/mm ⚠ VERIFY, thresholds, colors, alerts). *(See [Ice Depth §4](./modules/ice-depth.md#4-setup--configuration-admins).)*
- [ ] **Incident / Accident Reporting** — configure **Severity Levels** (at least one is required), **Activities**, and **Types**; the location list comes from Facility Spaces. *(See [Incident Reporting §4](./modules/incident-reporting.md#4-setup--configuration-admins).)*
- [ ] **Employee Scheduling** — set up **Job areas** (with required certifications), **Settings** (week start, approval rules, warning behavior), and **Templates / Compliance** rules. *(See [Employee Scheduling §4](./modules/employee-scheduling.md#4-setup--configuration-admins).)*

## Phase 4 — Permissions, retention, exports

- [ ] **Fine-tune permissions.** In **Admin Center → Permissions**, override any individual's module × action access (View / Submit / Edit / Admin). Presets (Full Access / Submitter Only / Viewer Only / No Access) write a whole row at once. Remember the **Admin-module Admin** cell is super_admin-only to grant. *(See [Admin Control Center §5 — Permissions](./modules/admin-control-center.md#permissions-adminpermissions).)*
- [ ] **Set data retention.** In **Admin Center → Data Retention**, set keep-days per module (0 = forever, or ≥ 30) and decide on nightly auto-purge. Heed the warning for incident/accident/workers'-comp records. *(See [Admin Control Center §5 — Data Retention](./modules/admin-control-center.md#data-retention-adminretention).)*
- [ ] **Configure exports.** In **Admin Center → PDF/Export Settings**, set branding (logo, header/footer), layout (paper size, date format, CSV delimiter), and per-module column visibility. Run a test export. *(See [Admin Control Center §5 — PDF/Export Settings](./modules/admin-control-center.md#pdf--export-settings-adminexports).)*
- [ ] **Check the Setup checklist & audit log.** Return to the **Admin Dashboard** — the setup checklist should read "Ready." Spot-check the **Audit Log** to confirm your changes are recorded. *(See [Admin Control Center §5 — Dashboard / Audit Log](./modules/admin-control-center.md#dashboard-admin).)*

---

## Quick reference — what's super_admin-only

These steps cannot be done by a facility_manager (`admin`) and must go to a super_admin:

- Create / edit / activate / deactivate a **facility**.
- Place an employee in a **different facility**.
- Grant the **Admin module's Admin action** (Admin Center access).
- **Hard-delete** an employee (others use Deactivate).
- Anything in the **Super Admin console** (`/admin/super-admin`).

*(All confirmed in [Admin Control Center §2 and §9](./modules/admin-control-center.md#2-who-can-use-it). ⚠ VERIFY — org_admin has no live equivalent; treat as super_admin.)*
