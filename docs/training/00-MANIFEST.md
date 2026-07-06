# RinkReports — Training Discovery Manifest (Phase 0)

**Status:** Read-only discovery. This document maps what exists in the code so that end-user training chapters can be written against it. Nothing here is invented; anything implied but unconfirmed is marked **⚠ VERIFY**.

**Product:** RinkReports — a Next.js (App Router) progressive web app (PWA) for ice-rink facility operations. Brand colors: **#4DFF00** (primary green), **#002244** (navy).

**Data scoping (tell users plainly):** *You only see data for your own facility — this is automatic.* Switching facilities or seeing another rink's data is not something staff or facility admins do; the app keeps each facility's records separate on its own.

---

## Role Tiers Used in This Documentation

This documentation uses a five-tier vocabulary, highest to lowest:

**super_admin → org_admin → facility_manager → supervisor → staff**

> **⚠ VERIFY — role mapping.** The live application does **not** use those five fixed tiers. The real role model is **super_admin / admin / manager / staff**, plus optional **per-facility custom roles** (e.g. `driver`). Permission is resolved per module + action through a permissions system, not a fixed tier ladder — roles only seed default permissions, and an admin can override any individual person's access per module. The closest mapping for training language:
>
> | Doc tier (this package) | Real app role | Notes |
> |---|---|---|
> | super_admin | `super_admin` (platform-wide flag) | Cross-facility; sees the Super Admin console. |
> | org_admin | *(no exact equivalent)* | **⚠ VERIFY** — the app has no separate org/multi-facility admin between super_admin and the facility admin. Treat as super_admin for now. |
> | facility_manager | `admin` (facility administrator) | The person who runs the Admin Center for one facility. |
> | supervisor | `manager` (or a custom role) | Mid-tier; some elevated scheduling/approval rights. |
> | staff | `staff` (or a custom role) | Submits reports; self-service scheduling. |
>
> Because access is permission-driven, two people with the same title can have different access if an admin has customized it. Where this manifest says "facility_manager can do X," the precise code rule is "a user with the `admin` action enabled for that module (or the global super-admin flag) can do X." Statements below should be read with that nuance; flag any place the tier label feels too rigid as **⚠ VERIFY** during chapter writing.

*Role-gating internals (for analysis only, not for the user-facing body): admin access requires the global super-admin flag, OR an enabled `admin/admin` permission row in the user's facility, OR an active employee record with an admin-tier role. Module access is gated by per-module/per-action permission rows (view / submit / edit / admin). Deactivated accounts are denied everywhere.*

---

## 1. Navigation Map

There are **two shells**: the **staff app** (sidebar + mobile bottom tabs) and the **Admin Center** (grouped admin sidebar). A person who is an admin sees both — the staff sidebar shows an extra "Admin Center" link.

### Staff shell — left sidebar / mobile menu

Each item is hidden if the facility has that module turned off (admins control this on the Modules page). Mobile devices show a bottom tab bar: **Home · Reports · Menu · Account** (Menu opens the full module list).

| Menu item | Opens | Module |
|---|---|---|
| Dashboard | `/dashboard` | (always shown) |
| Daily Reports | `/reports/daily` | Daily Reports |
| Ice Depth | `/reports/ice-depth` | Ice Depth |
| Ice Operations | `/reports/ice-operations` | Ice Operations |
| Refrigeration | `/reports/refrigeration` | Refrigeration Logs |
| Air Quality | `/reports/air-quality` | Air Quality |
| Incidents | `/reports/incidents` | Incident Reporting |
| Accidents | `/reports/accidents` | (related module) |
| Scheduling | `/reports/scheduling` | Employee Scheduling |
| Communications | `/reports/communications` | (related module) |
| Facility Paperwork | `/reports/facility-paperwork` | (related module) |
| Admin Center *(admins only)* | `/admin` | Admin Control Center |

Other staff-reachable pages not in the main menu: `/account` (your profile), `/reports/offline-queue` (pending offline submissions), `/offline-schedule` (your cached shifts for offline viewing), `/forbidden` (shown when you lack access), and the login/logout pages.

### Admin Center — grouped sidebar

| Group | Menu item | Opens | Module |
|---|---|---|---|
| **Setup** | Facility | `/admin/facility` | Admin Control Center |
| | Modules | `/admin/modules` | Admin Control Center |
| | People | `/admin/employees` | Admin Control Center (employees) |
| | Departments | `/admin/departments` | Admin Control Center |
| | Facility Spaces | `/admin/spaces` | Admin Control Center |
| | Permissions | `/admin/permissions` | Admin Control Center |
| **Module Admin** | Daily Reports Admin | `/admin/daily-reports` | Daily Reports |
| | Ice Depth Admin | `/admin/ice-depth` | Ice Depth |
| | Ice Operations Admin | `/admin/ice-operations` | Ice Operations |
| | Incident Reports Admin | `/admin/incident-reports` | Incident Reporting |
| | Accident Reports Admin | `/admin/accident-reports` | (related) |
| | Refrigeration Admin | `/admin/refrigeration` | Refrigeration Logs |
| | Air Quality Admin | `/admin/air-quality` | Air Quality |
| | Scheduling Admin | `/admin/scheduling` | Employee Scheduling |
| | Communications Admin | `/admin/communications` | (related) |
| | Facility Paperwork | `/admin/facility-documents` | (related) |
| **System** | Lists | `/admin/lists` | Admin Control Center |
| | PDF/Export Settings | `/admin/exports` | Admin Control Center |
| | Data Retention | `/admin/retention` | Admin Control Center |
| | Audit Log | `/admin/audit-log` | Admin Control Center |
| | Super Admin | `/admin/super-admin` | Admin Control Center (super_admin only) |

The **Roles** screen (`/admin/roles`) exists and is reached from the People/Permissions area; it is **⚠ VERIFY** whether it appears as its own sidebar link (it is not in the sidebar config — likely linked from within People/Permissions).

*Source: `src/components/app/sidebar-nav.tsx`, `src/components/app/bottom-tab-bar.tsx`, `src/components/admin/nav-config.ts`, `src/app/**` route folders.*

---

## 2. Role Gating (summary)

**The gate at the front door.** Any unauthenticated visit to `/admin`, `/reports`, `/dashboard`, or `/account` is bounced to login; once signed in, login/signup pages redirect to the dashboard.

- **Staff pages (`/reports/*`, `/dashboard`, `/account`)** require an active, signed-in employee account assigned to a facility. A deactivated account is denied. *(staff and up)*
- **Admin Center (`/admin/*`)** requires facility_manager-level access (the `admin` permission) or super_admin. Non-admins who try are shown a "Forbidden" message, not bounced to login. *(facility_manager and up)*
- **Super Admin console (`/admin/super-admin`)** is for super_admin only — managing facilities and platform-wide users.
- **Per-module visibility on the staff side** is also gated by whether the facility has the module enabled (Modules page) AND whether the person has the `view`/`submit` permission for that module.

**Action-level gating (general pattern across modules):**
- *View* a module — needs the module's `view` permission.
- *Submit* a report — needs `submit`.
- *Edit* an existing record — needs `edit` (and, for most report modules, only within the allowed window; see §8).
- *Configure* a module in the Admin Center (templates, thresholds, equipment, settings) — needs `admin` for that module (facility_manager tier).
- *Delete* records / facilities — generally **super_admin only**. **⚠ VERIFY** per module.

> **⚠ VERIFY:** Because access is permission-driven, the exact tier for any single button can be customized per person/facility. Treat the tiers above as the *default* mapping and validate against a real configured facility before publishing hard claims like "supervisors can approve swaps."

*Source: `src/proxy.ts`, `src/lib/supabase/session.ts`, `src/lib/auth/require-user.ts`, `src/lib/auth/require-admin.ts`, `src/lib/auth/get-is-admin.ts`, module `_lib` permission checks.*

---

## 3. Per-Module Component Inventory

> Cross-module pattern: most report forms open, you fill fields, you tap **Submit**, and you land on a **"Submitted!" confirmation screen** with a green checkmark, a summary, and **Submit another** / **Back to home** buttons. Most modules are **append-only** — once submitted you cannot edit (incidents are the exception, see §8). Most forms also work **offline** (see §7).

### 3.1 Daily Reports (the staff "Daily Reports" menu)

**Pages:** launch/console (`/reports/daily`), history (`/reports/daily/history`), confirmation (`…/done`).

**What the staff member sees and does:**
- A meta-chip strip: your name, facility, live date, live time.
- **Work Area** dropdown (only the areas you're allowed to submit to; shows color swatches).
- **Shift** dropdown (the checklists/templates for that area; auto-selects if there's only one).
- A **checklist card** with a progress bar and a checkbox per item.
- An optional **Note** textarea.
- A sticky **Submit** bar showing "X / Y complete"; offline shows "will sync when reconnected."
- **History** page: a read-only list of recent submissions.

**What Submit does:** records the checklist as a new submission (append-only) and notifies as configured, then shows the confirmation screen.

*Source: `src/app/reports/daily/` (page.tsx, history/, _components/daily-report-console.tsx, actions.ts, _lib/).*

### 3.2 Refrigeration Logs ("Refrigeration")

**Pages:** form (`/reports/refrigeration`), confirmation (`/reports/refrigeration/done`). The form page also lists your recent submissions.

**What the staff member sees and does:**
- Header with **Back** and **Dashboard** buttons; meta-chip strip incl. current outdoor temperature.
- A **°F / °C toggle** in the "Log Information" card header — flips how temperatures display (values are stored consistently regardless).
- Reading time, optional **Shift** text, optional **Round #** (shows "of N" if the facility caps readings per shift).
- One **card per section** (e.g. chillers, brine), each with its equipment and reading fields. Field types: numeric, text, yes/no checkbox, dropdown, and read-only "calculated on submit" fields.
- A **"Normal: min – max"** hint under numeric fields.
- If a reading is critically out of range, a required **corrective-action note** box appears.
- Optional Notes; **Submit** (label changes to "Save on this device" when offline).

**What Submit does:** saves the reading set; out-of-range readings can trigger a manager alert (if the facility enabled that). Confirmation screen shows value count and any out-of-range count.

*Source: `src/app/reports/refrigeration/` (page.tsx, _components/submission-form.tsx, done/, actions.ts, _lib/).*

### 3.3 Incident Reporting ("Incidents")

**Pages:** form + recent list (`/reports/incidents`), view/edit existing (`/reports/incidents/[id]`), confirmation (`…/done`).

**What the staff member sees and does:**
- Occurred-at time, **Severity** dropdown, **Activity** dropdown (with an "Other" free-text option), **Facility Spaces** multi-select (with "Other space" free text), **Description** (required), **Immediate actions**, an **Ambulance called** checkbox, **Persons involved**, **Follow-up required** checkbox, and up to **3 witnesses** (name/phone/email/statement each).
- A confirmation dialog ("Are you sure?") before the report is filed.

**What Submit does:** files the incident with status "submitted." **This module is editable for 24 hours** — the confirmation screen offers an **Edit report** button and the report stays openable from the recent list during that window.

*Source: `src/app/reports/incidents/` (page.tsx, [id]/, _components/submission-form.tsx, done/, actions.ts, _lib/).*

### 3.4 Ice Operations ("Ice Operations")

**Pages:** redirect entry (`/reports/ice-operations`), per-type form (`/reports/ice-operations/[operationType]`), confirmation (`…/done`). A shell shows recent activity and **tabs** for the enabled operation types.

**Operation types (a facility can hide any of them):** Ice Make, Edging, Blade Change, Circle Check.
- **Ice Make:** Rink (required), Machine (required), water used, machine hours, snow %, notes.
- **Edging:** Machine (required), notes.
- **Blade Change:** Machine (required), person performing the change, notes.
- **Circle Check:** Machine plus a **checklist** (optionally from an admin-defined template); failed items require a corrective note.

**What Submit does:** records the operation (append-only); the confirmation screen confirms it and notes "you can't edit this after submitting."

*Source: `src/app/reports/ice-operations/` (page.tsx, [operationType]/_components/{ice-make,edging,blade-change,circle-check}-form.tsx, ice-ops-shell, actions.ts, _lib/).*

### 3.5 Air Quality ("Air Quality")

**Pages:** form (`/reports/air-quality`), confirmation (`…/done`).

**What the staff member sees and does:**
- **Location** dropdown, **Reading Kind** (routine / corrective; corrective requires a note), and a dynamic list of **readings** (equipment + the facility's reading types, each with units, decimals, and required flags).
- A **compliance context** panel may show how many readings are required this period and live **within-range / warn / alert** feedback against the facility's thresholds.
- Date of test, optional Notes, **Submit**.

**What Submit does:** saves the readings; readings beyond thresholds are flagged as exceedances. Confirmation screen shows reading count and any exceedance count/severity.

*Source: `src/app/reports/air-quality/` (page.tsx, _components/submission-form.tsx, done/, actions.ts, _lib/).*

### 3.6 Ice Depth ("Ice Depth") — special two-phase flow

**Pages:** layout picker (`/reports/ice-depth`), measure (`/reports/ice-depth/[layoutSlug]`), review/done (`…/done`).

This module measures **ice depth, not temperature**, so there is **no °F/°C toggle**. It is a two-phase, tap-driven flow tuned for Bluetooth calipers:

- **Measure phase:** an interactive **USA-hockey rink diagram (SVG)** with a tappable chip at each measurement point. Tap a point → a small popover opens → type the depth (or take it from a caliper) → **Enter** moves to the next point, **Skip** skips it. Each chip changes color live by severity (within range / below min / above target). A stats line shows "X of Y filled" plus averages. An optional Notes box. A **Go to Review** button.
- **Review/done phase:** the submitted report with the annotated diagram, a measurement list, severity stat pills, and actions: **Download PDF**, **Print Diagram**, **Send Report**, **Submit Another**, **Back to Dashboard**.

**What Submit does:** records the session and all point measurements with severity, then shows the printable review.

*Source: `src/app/reports/ice-depth/` (page.tsx, [layoutSlug]/page.tsx, [layoutSlug]/done/ + pdf, _components/submission-form.tsx, actions.ts, _lib/).*

### 3.7 Admin Control Center — per-screen inventory

> All admin screens follow a tabbed layout: a config table with **Add / Edit / Delete** buttons (often with drag/reorder and active/inactive toggles), plus filterable read-only **History** tables with a drill-down detail panel and an "add follow-up note" action.

- **Facility** (`/admin/facility`): super_admin sees all facilities and can create/edit/delete one; a facility_manager sees a read-only summary of their own facility.
- **Modules** (`/admin/modules`): one ON/OFF switch per module — a **visibility switch** that shows/hides the module in staff navigation. It does **not** change individual permissions.
- **People / Employees** (`/admin/employees`, `/admin/employees/[id]`, `/admin/employees/bulk`): add, edit, deactivate/reactivate employees; per-employee module-access overrides; bulk import. (Full lifecycle in §5.)
- **Departments** (`/admin/departments`): create/edit/delete/reorder departments (used by scheduling and routing).
- **Facility Spaces** (`/admin/spaces`): the shared list of locations that feeds Incident, Accident, and Air Quality location pickers.
- **Permissions** (`/admin/permissions`, `/admin/permissions/[userId]`): per-user matrix of modules × actions (view/submit/edit/admin) toggles. (See §5.)
- **Roles** (`/admin/roles`): create custom roles, edit each role's default permission matrix, rename, deactivate/reactivate, copy defaults between roles.
- **Daily Reports Admin** (`/admin/daily-reports`): tabs for **Areas, Templates, Checklist Items, Area Access, Submissions** — see §4.
- **Refrigeration Admin** (`/admin/refrigeration`): tabs for **Setup** (sections, equipment, fields, thresholds), **History**, **Settings** — see §4.
- **Ice Operations Admin** (`/admin/ice-operations`): tabs for **Setup** (rinks, equipment, fuel types, circle-check items, templates), **History**, **Settings** — see §4.
- **Air Quality Admin** (`/admin/air-quality`): tabs for **Setup** (equipment, reading types), **Compliance** (profile, metrics, thresholds, escalation), **History**, **Settings** — see §4.
- **Ice Depth Admin** (`/admin/ice-depth`): tabs for **Rinks, Layouts** (draw/edit the diagram and measurement points), **History, Analytics, Settings** (units, threshold colors).
- **Incident Reports Admin** (`/admin/incident-reports`): tabs for **History, Types, Severities, Activities**; status change + follow-up notes on each report.
- **Accident Reports Admin** (`/admin/accident-reports`): tabs for **History, Dropdowns, Workers' Comp** (instruction text).
- **Communications Admin** (`/admin/communications`): tabs for **Inbox (alerts + messages), Templates, Groups, Routing, Reminders, Deliveries, Audit**; resolve/acknowledge alerts, manage recipient groups and routing rules.
- **Facility Paperwork** (`/admin/facility-documents`): upload (incl. bulk), categorize, reorder, delete, download documents.
- **Lists** (`/admin/lists`): per-domain custom dropdown option lists used across modules.
- **PDF/Export Settings** (`/admin/exports`): run an export per module, and set export branding/layout/field defaults.
- **Data Retention** (`/admin/retention`): per-module retention days, auto-purge toggle, manual purge. (See §8.)
- **Audit Log** (`/admin/audit-log`): read-only, filterable trail of create/update/delete/auth events with before/after detail.
- **Super Admin** (`/admin/super-admin`): platform stats, facility create/edit/delete, user activate/deactivate and super-admin promotion/facility assignment, invite-service health.

*Source: `src/app/admin/**` (each sub-folder's page.tsx, _components/, _lib/, actions.ts).*

---

## 4. Admin-Configurable Settings

What an admin (facility_manager tier) can change that alters how a module behaves for staff:

### Modules
- Per-module **ON/OFF** visibility switch (hides the module from staff navigation). Does not change permissions.

### Daily Reports
- **Areas:** create/edit (name, slug, color), reorder, activate/deactivate; bulk import.
  - **⚠ VERIFY — area cap:** the training package mentions "up to 20 tabs." The code enforces a cap on **active areas via a database limit**, which the admin-modules discovery reported as **30**, not 20. Confirm the exact number against the live DB trigger before publishing. The "tabs" the user sees on Daily Reports correspond to **areas** (and shift templates within an area).
- **Templates** (the "shifts"/checklists per area): create/edit/delete, active toggle, sort; bulk import.
- **Checklist Items** per template: create/edit/delete, reorder, active toggle; bulk import.
- **Area Access:** a per-employee × per-area "can submit" matrix.

### Refrigeration
- **Sections** (e.g. Chiller 1), **equipment** per section, and **fields** (reading types) per section — all add/edit/delete.
- **Thresholds** per field (warn/alert min/max) → drive the "Normal range" hints and out-of-range alerts.
- **Settings:** out-of-range alerts on/off, default alert severity, and **readings-per-shift** cap (optional; shows as "Round # of N" to staff). *Confirmed: compressor/equipment count and readings-per-shift are admin-configurable.*

### Ice Operations
- **Rinks**, **equipment** (categorized by equipment type, e.g. resurfacer/edger/sharpener), **fuel types**, **circle-check items**, and **circle-check templates** (grouping items) — all add/edit/delete.
- **Settings:** which **operation types are enabled** (Ice Make / Edging / Blade Change / Circle Check), alerts on/off, default alert severity. *Confirmed: operation types and equipment types are admin-configurable.*

### Air Quality
- **Equipment** per location and **reading types** (label, unit, decimals, required) — add/edit/delete.
- **Compliance:** select a compliance profile, choose active metrics, **override thresholds** (warn/alert min/max per metric), configure **escalation**, and set submit/view role access.
- **Settings:** alerts on/off, default alert severity, testing-frequency guidance text, default jurisdiction. *Confirmed: thresholds (warn/alert min/max) are admin-configurable.*

### Ice Depth
- **Rinks** and **Layouts** (draw the diagram: dimensions, measurement points with positions/labels).
- **Settings:** measurement unit (inches/cm), low/ok/high **threshold colors**, and low/high threshold values.

### Incident / Accident Reports
- Incident: configurable **Types, Severities, Activities** lists.
- Accident: configurable **dropdown option lists** (injury type, body part, activity, medical attention, workers'-comp outcome) and **Workers' Comp instruction text**.

### Other system settings
- **Lists:** facility-specific custom dropdown lists.
- **Exports:** branding, page layout, default fields per module.
- **Data Retention:** per-module retention days + auto-purge.
- **Departments / Facility Spaces / Roles / Permissions:** see §3.7 and §5.

*Source: `src/app/admin/{modules,daily-reports,refrigeration,ice-operations,air-quality,ice-depth,incident-reports,accident-reports,lists,exports,retention}/` (_components/*, actions.ts).*

---

## 5. Employee Lifecycle

All of this lives under **People / Permissions / Roles** in the Admin Center and is a facility_manager-tier task (with some steps reserved for super_admin).

**Add an employee** — `/admin/employees` → **Add new employee** opens a form: first/last name (required), **Role** dropdown (required), employee code, email, phone, "is minor," emergency contact (required unless minor), hire date, max weekly hours, **job areas** (multi-select, up to 4), and **"needs system login."** Saving creates the employee and, if a login was requested, can send an email invite and seed that role's default permissions.

**Assign a role** — chosen in the same form; an admin can only assign roles **at or below their own rank** (super_admin is unrestricted). Changing a role re-seeds that person's default permissions while keeping any manual overrides.

**Assign a facility** — automatic for a normal admin (their own facility). Only super_admin can place someone in a different facility (done from the form / Super Admin console).

**Set permissions (overrides)** — `/admin/permissions` → pick a user → a **matrix of every module × four actions** (view / submit / edit / admin). Toggling sets a per-user override; clearing it falls back to role defaults. Per-employee module access can also be set from the employee's detail page.

**Bulk import** — `/admin/employees/bulk`: a grid where you type or paste rows (first/last name, email, role, hire date, job areas as `Area1|Area2`), up to 100 at a time, with live validation and an optional "send invites" toggle. Submitting creates them all at once.

**Deactivate (preferred) vs delete** — from the employee list, **Deactivate** sets the account inactive (soft delete; record and permissions are retained for history). A deactivated person **cannot sign in, submit, or view any data** until reactivated. **Reactivate** restores them with permissions intact. **Delete** is a hard removal and is **super_admin only** — rare, and it removes history.

**Roles** — `/admin/roles`: create custom per-facility roles, edit each role's default permission matrix, rename, deactivate/reactivate, and copy defaults between roles. Custom roles (e.g. `driver`) seed staff/supervisor-level defaults.

*Source: `src/app/admin/employees/{page.tsx,actions.ts,[id]/,bulk/}`, `src/app/admin/roles/`, `src/app/admin/permissions/`, `src/lib/permissions/`.*

---

## 6. Payroll / Timekeeping — Explicit Check

**No payroll, timekeeping, clock-in/clock-out, punch, or timesheet feature was found in the codebase.**

The Employee Scheduling module is **assignment-only**: it creates and publishes shifts, assigns people, runs hour-cap/overtime *compliance warnings*, and handles time-off / swap / availability requests. It does **not** record actual hours worked, clock people in or out, produce timesheets, or calculate pay. The only pay-adjacent value is a per-employee **max weekly hours** field, used purely as a scheduling/overtime-warning threshold — not a payroll calculation.

*Source: codebase-wide search for payroll/clock-in/timesheet terms (no matches); `src/app/admin/scheduling/_lib/*`.*

---

## 7. Offline Behavior

RinkReports is a PWA with an **offline submission queue**. The real offline technology is the browser's **service worker + IndexedDB** — **not Dexie**. (Two separate IndexedDB databases are used: `rink-offline-queue`, owned by the service worker for queued submissions; and `rink-schedule-cache`, a per-user cache of your own published shifts for offline viewing.)

**⚠ VERIFY — "Dexie" claim in the package is incorrect.** No Dexie library is used; offline storage is plain IndexedDB accessed directly by the service worker and a small client helper.

**What the user experiences:**
- **Browsing offline:** the app does **not** serve cached pages — opening a new page offline shows a simple "You're offline" screen. The offline value is the submission queue, not offline page browsing. The one exception is **`/offline-schedule`**, a data-free shell that renders **your own** cached upcoming shifts from the schedule cache.
- **Submitting offline:** report forms detect that you're offline, the Submit button reads **"Save on this device,"** and the entry is queued locally. A banner/indicator shows pending and failed counts; `/reports/offline-queue` lists them.
- **Syncing:** when you're back online the queue replays automatically (oldest first), re-running the same validation and permission checks server-side. Each item has a unique id so a retry can't create duplicates. Transient failures retry with backoff (up to 4 attempts); permanent rejections (e.g. an admin deactivated a referenced option while you were offline) are parked as failed.

**Which modules queue offline (staff submissions):** Daily Reports, Refrigeration, Air Quality, Incidents, Accidents, Ice Depth, Ice Operations, Communications messages, and the **self-service scheduling** writes: **availability** and **time-off requests**.

**What is NOT offline:**
- **Scheduling shift claiming, swaps acceptance, and the entire admin scheduling grid** (drag-create/edit/delete, publish) are **online-only** by design — they depend on live shift state and on cert/hour-cap/publish-lock enforcement that can't be safely replayed later. **⚠ VERIFY:** swap *requests* (vs. acceptance) — the staff-side discovery suggested swap requests may queue, while the offline-sync route only implements availability and time-off replay; treat swap/claim as online-only until confirmed.

*Source: `public/sw.js`, `src/lib/offline/{use-sync-queue.ts,schedule-cache.ts,retry-policy.ts}`, `src/app/api/offline-sync/route.ts`, `src/app/offline-schedule/`, `src/app/reports/offline-queue/`.*

---

## 8. Lock / Submit / Publish Behavior

**Report modules (general):** submitting creates a permanent, **append-only** record. After submitting you generally **cannot edit** — you submit a new report instead. Exceptions:
- **Incidents:** editable by the reporter for **24 hours** after submission; after that it's locked.
- **Ice Depth:** the measure→review flow lets you adjust points before you finalize, but a submitted session is its own immutable record.
- Admins do not "edit" staff submissions in place; they **add follow-up notes** and (for incidents) change a **status** (e.g. open/closed) from the admin History detail panel.

**Employee Scheduling — publish & locks:**
- Shifts start as **drafts** (admins build them on the grid). Publishing makes them **published** and visible to staff; unassigned published shifts become **open shifts** staff can claim.
- **Publish-lock:** once a shift is published it **cannot be freely edited or deleted**. Admins can still change a published shift, but only through a controlled, **audited** path that re-checks cert/hour-cap rules; deleting a published shift is a **soft cancel** (it's marked cancelled, not erased). This protects staff who've already planned around the posted schedule.
- **Publish requests:** a schedule can be **requested for publish** by one person and **approved by another** — the requester can't approve their own request.
- **Approvals as locks:** time-off and swaps move through pending → approved/denied; staff can cancel their own pending (or approved) time-off, and cancel pending/accepted swaps, but cannot alter a decision once an admin has made it.

**Data Retention (admin):** the Retention screen can auto-purge old records per module after a configurable number of days (with a per-module minimum). This is destructive cleanup, not a per-record lock, and is gated behind a warning.

*Source: `src/app/reports/incidents/` (24h edit), `src/app/admin/scheduling/_lib/{grid-actions.ts,publish-request-actions.ts,enforcement.ts}`, `src/app/admin/retention/`.*

---

## Gaps & Questions

1. **⚠ Role tier mapping.** The five-tier vocabulary (super_admin/org_admin/facility_manager/supervisor/staff) does not match the live model (super_admin/admin/manager/staff + custom roles) and access is permission-driven, not tier-driven. There is **no "org_admin" equivalent** in the code. Every "tier X can do Y" claim should be validated against a configured facility before publishing.
2. **⚠ Daily Reports area/tab cap.** Package says "up to 20 tabs"; code enforces a DB cap reported as **30 active areas**. Confirm the exact number and whether "tabs" = areas or = templates-within-an-area in the user's mental model.
3. **⚠ Offline tech.** Package mentions "Dexie." The app uses **plain IndexedDB via a service worker**, not Dexie. Documentation should describe it generically ("saved on your device, syncs when you reconnect") and not name Dexie.
4. **⚠ Scheduling offline scope.** The staff-side exploration suggested swap requests / claims might queue offline, but the server replay endpoint only implements **availability** and **time-off**. Confirm whether swap-request and open-shift-claim are truly online-only (likely yes).
5. **⚠ Roles screen navigation.** `/admin/roles` exists but is not in the admin sidebar config; confirm how admins reach it (likely from within People or Permissions).
6. **⚠ Per-module delete rights.** "Delete = super_admin only" holds for facilities and is the general RLS pattern, but per-module delete (e.g. an admin deleting an area/template/session) should be confirmed module-by-module before stating it.
7. **Related modules not deeply mapped.** Accidents, Communications, Facility Paperwork, Departments, Spaces, Lists, Exports, Audit Log were inventoried at a screen level but are secondary to the 8 core modules; deeper field-level detail can be pulled in their own chapters if needed.
8. **Dashboard & Account pages** were noted as routes but their on-screen content was not fully inventoried; capture during the relevant chapter if they need training coverage.
