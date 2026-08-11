# 5. The Admin Console — Setup & System

The Admin Center is where a facility gets built: people, roles, permissions, module visibility, and the system-level tools (exports, retention, audit). This chapter covers everything except the per-module report consoles (chapter 6) and scheduling (chapter 4).

## 5.1 Getting in, and the console layout

Any `/admin` page requires admin access: you're an admin if you're a **super admin**, hold the **Admin Center permission** (the Admin module's Admin action in the permission matrix), or — as a fallback — have an active admin-tier role. Everyone else lands on the **Access denied** page, which shows exactly which account is signed in (useful when someone's in the wrong account) with Go-home and Sign-out buttons.

The sidebar groups the console into:

- **Setup** — Facility, Modules, People, Departments, Facility Spaces, Permissions
- **Module Admin** — one console per report module, plus Facility Paperwork
- **System** — Lists, PDF/Export Settings, Data Retention, Audit Log, Super Admin

Two navigation gotchas to teach on day one:

> The sidebar is **not** permission-filtered — every admin sees every link, and clicking one you lack the grant for lands on Access denied. A visible link is not proof of access. And the **Roles** page isn't in the sidebar at all: reach it from the Dashboard setup checklist or directly at /admin/roles.

The header always offers a **Dashboard** button back to the staff app, the theme toggle, and your account menu.

## 5.2 Admin Dashboard

The console home: a **setup checklist** (facility info, roles seeded, role defaults set, first admin linked, staff added, invites sent — six steps with a "Ready" badge when complete), **stat cards**, a **recent report activity** grid showing 7-day and 30-day counts per module, and an **offline sync queue** health card (pending / synced / failed counts — failed turns red).

Super admins get a **facility switcher** here that carries a `?facility=` context through to the other facility-scoped pages.

## 5.3 People (Employees)

The roster. Search by name, email, role, or code; filter Active / Inactive / All; and use **Add employee**, **Bulk add**, or the per-row actions: **Edit**, **Invite**, **Preview**, **Deactivate/Reactivate**, and (super admins only) **Delete**.

**How accounts actually get created.** There is no signup page — this is the front door:

1. **Add employee** opens a form: name, **role** (required), a live preview of that role's default permissions, **job areas** (up to 4, with a primary), employee code, hire date, **max weekly hours** (the scheduling hour-cap), **hourly wage** (admin-only; powers labor-cost estimates), email/phone, a **minor** checkbox, and emergency contact (required unless the employee is a minor).
2. The **"Create a login & apply these permissions"** checkbox (on by default) sends an email invite and seeds the role's permission defaults. Uncheck it for schedule-only staff — you can send an **Invite** later from the list.
3. The invite email lands the person on a page where **they set their own password** — admins never see or set passwords. If the email already has an account, no email is sent; the existing login is simply linked ("Existing account linked. No email sent.").

**Bulk add** (up to 100 at once) is a spreadsheet-style grid with **Paste from spreadsheet** (column order: First name, Last name, Email, Hire date, Role, Job areas — pipe-separated), a downloadable CSV template, and a **"Send login invites & apply role permissions"** switch. Watch the per-row status: **Added** (green), **Partial** (amber — the record was created but the invite or permission seeding failed; send a manual Invite later), **Failed** (red, with the reason). Bulk add can't set departments, emergency contacts, or employee codes — follow up in the single-edit form.

**Deactivating vs. deleting.** Deactivate removes access immediately and pulls the person out of shift assignment and routing — reversible from the same list. Delete is super-admin-only and permanent.

**Preview.** The **Preview** button impersonates an employee's view for one hour, with an amber banner ("Previewing as {name}") and a **Stop preview** button. Important caveat, printed right in the banner: preview narrows what the app *renders*, not what the database returns — it's a navigation sanity check, not a security test. Starting and stopping preview are both audited.

**Employee detail page** (click a name): read-only profile, **Certifications** (add with expiry dates; badges show "Expired 3d ago" / "Expires in 12d" — always pick cert names from the suggestions, since a typo breaks scheduling cert enforcement), **Module Access** (a quick per-module view with a legacy 9-level override picker — prefer the Permissions matrix for precision), **Communication Groups** membership, and recent **Activity**.

## 5.4 Permissions (Module Access Control)

The authoritative answer to "what can this person do." Pick a user, and you get a matrix: 11 modules down the side (the nine report modules, Scheduling/Communications, and **Admin**), four actions across — **View / Submit / Edit / Admin**. Each checkbox saves instantly. A user with no rows has **zero access**.

- **View** — can see the module. **Submit** — can create entries. **Edit** — can modify submissions. **Admin** — can configure the module and use its admin console.
- **Presets** (Full Access, Submitter Only, Viewer Only, No Access) fill the whole matrix in one click.
- **The one checkbox to treat with respect:** the **Admin module's Admin action** is the Admin Center key — it makes someone a facility admin. Only super admins can grant it; presets applied by a facility admin silently leave it off.
- Facility admins manage only their own facility's users; the target must be an active member of the facility.
- A **Bulk CSV import** (user, facility, module, action, enabled) exists for migrations; invalid rows are skipped with per-line reasons.

**Overrides are sticky.** Every edit made in this grid is stamped as a manual override, and role re-seeding never overwrites it. If you hand-tune here and later expect a role change to fix things — it won't.

Also note: the matrix shows all modules whether or not the facility has them enabled. Permissions and module visibility are independent systems.

## 5.5 Roles

Roles bundle permission defaults so you don't hand-toggle 44 checkboxes per hire. The resolution rule, stated on the page: *explicit override → role default → no access.*

**Canonical roles** (seeded automatically, undeletable): Super Admin (level 0), Administrator (1), Manager (2), Staff (3). You can add **custom roles** (e.g. "rink_lead", "driver") with a display name, an immutable lowercase key, a hierarchy level (lower = higher rank), and a description.

**The defaults matrix**: roles × modules, four checkboxes per cell (V · S · E · A). Flipping a box **immediately re-applies to that role's current staff** — manual overrides are preserved, but this is a many-people-at-once screen; change it deliberately. A **Copy permission defaults** panel bulk-copies one role's defaults to another.

Safety rails: you can't create or edit a role that outranks your own; the Admin-Center cell is super-admin-only (and copying skips it); deactivating a role that people still hold warns you — those employees fall back to only their explicit overrides until reassigned.

## 5.6 Departments, Facility Spaces, Modules, and Lists

**Departments** — group shifts for the schedule's department filter and shift assignment (e.g. Ice Crew, Front Desk). Name, slug, color, sort order; reorder with arrows; deactivate rather than delete (existing shifts keep their department; it just leaves new-assignment pickers).

**Facility Spaces** — the shared list of physical areas feeding the location pickers in **Incident Reports, Accident Reports, and Air Quality**. Seed a starter set (Main Rink, Lobby, Locker Room…), add manually, or CSV bulk-import (duplicates are skipped, never overwritten). Deleting a space referenced by reports is blocked — *"Cannot delete; in use by N report(s). Deactivate instead."* Teach "deactivate, never delete" here.

**Modules** — per-facility on/off switches controlling which modules appear in **staff navigation**. The page says it plainly: this is a **visibility switch only** — it does not change per-employee permissions, and disabled modules stay protected by their own access rules. Missing settings default to enabled, and Dashboard/Admin Center are never toggleable. The #1 misconception to head off: turning a module off is not a security control; the permission matrix is.

**Lists** — per-facility option lists for dropdowns. Today that's one list: **Timezones** (the IANA zones offered in the Facility settings picker). Seed the canonical set (idempotent — safe to re-run, never overwrites your edits), add/edit/deactivate. Keys must be real IANA zone names; deleting anything in use is blocked.

## 5.7 Facility settings

What you see depends on who you are:

- **Facility admins get a read-only view.** The card says it outright: *"Only super admins can edit facility settings."* If the rink's phone number changes, route it to a super admin.
- **Super admins** manage every facility: create (which also seeds the canonical roles automatically), edit name/slug/timezone/address/contact, and set active status. A nice touch worth demoing: typing a **zip code auto-selects the timezone**, with a note to override only if the rink sits on a boundary.

## 5.8 Facility Paperwork (admin side)

Upload the documents staff browse in the Facility Paperwork module. **Bulk Upload**: pick a **Category** (Emergency Action Plan, Employee Handbook, Staff Manual, Policy Document, Safety Document, Other), select multiple files (PDF, Word, Excel, PowerPoint, text, or images — 25 MB each; invalid files are rejected in the browser before upload with the reason), add an optional shared description, and **Upload documents**.

Manage the list per document: **Hide/Show** (takes it off the staff page without deleting — prefer this over Delete), **Edit** (title, category, description), and **Delete** (permanent, confirmed).

One error message worth knowing by heart: *"Your account has admin console access but not the facility admin permission required to manage documents."* That's not a bug — the account got into the console via a role fallback but lacks the explicit Admin/Admin grant. Fix it in the Permissions matrix (super admin required).

## 5.9 PDF / Export Settings

Two tools on one page:

**Run an export.** Pick a module, format (**CSV** or **PDF**), and a date range, then download. Exportable modules: Daily Reports, Incident Reports, Accident Reports, Refrigeration, Air Quality, Ice Depth, Ice Operations, Communications. Limits: 2,000 rows and a 366-day window per export. The download re-checks permissions independently — you need the module's View action, so an admin who can open this page may still be refused a specific module.

**Export settings** (one set per facility): **Branding** (logo URL, header text like "Max Ice Center — Confidential", footer text), **Layout & format** (Letter/A4, date format, CSV delimiter, and include-on-every-export checkboxes for facility name, export date, and submitted-by), and **Column visibility per module** — unchecked columns are hidden from exports but remain in the database. A module never configured exports all its columns.

Most report consoles also carry a quick **Export** dropdown in their header (Download CSV / Download PDF for the last 30 days, plus a link here for custom ranges).

## 5.10 Data Retention

Per-module rules for how long submitted data is kept, measured from submission date. Each module row shows its window, whether **nightly auto-purge** is on, and when it last ran; expand to edit ("Keep for (days)" with preset chips from 30 days to 10 years, or **Forever**) and to run a **Manual purge** immediately (double-confirmed; cannot be undone; runs regardless of the auto-purge flag).

**Regulatory floors are enforced in the database**, not just the form: 30 days for daily/ice modules and communications, 90 for refrigeration and air quality, **365 for incident and accident reports**, and **7 years for the audit log** — the audit window can be raised, never shortened. Setting a module to Forever turns auto-purge off automatically and hides the purge button. Scheduling has no retention row on purpose — it can't be purged from here.

**Audit-log destruction is the product's one two-person operation.** Expired audit rows are staged into a batch, not deleted. The pending-destruction card shows "Awaiting first approval" / "1 of 2 approvals"; the second approval must come from a *different* admin, and **Cancel & restore** puts every row back untouched. Every retention change and purge is itself audited.

## 5.11 Audit Log

An immutable record of create, update, delete, and authentication events across the facility. Filters (all URL-driven, so a filtered view is shareable): action, entity type, actor, date range (From defaults to 30 days back), and an IP/entity-ID search. The table shows up to 300 rows — narrow with filters rather than scrolling.

Click a row for the detail: actor (or "System" for automated changes), IP address, user agent, and collapsible **Before / After** JSON showing exactly what changed. App-level events like preview start/stop and retention changes are recorded alongside row-level changes.

## 5.12 Super Admin

Cross-facility platform management — the link is visible to all admins, but the page itself is super-admins only. Panels:

- **Facilities** — every tenant, with Activate/Deactivate per facility.
- **Super admins & users** — every platform user. **Promote/Revoke** super-admin status (you cannot revoke your own), and **Reset password** — generates a one-time recovery link to hand to the user.
- **Invite service health** — a diagnostic that probes the email-invite service and reports the exact failure mode (key missing, invalid, or wrong project) so broken invites can be diagnosed without a developer.

**Consolidated: what only super admins can do.** Create/edit facilities; delete employees; grant Admin Center access (by any path — matrix, preset, CSV, role default, or copy); assign admin-tier roles; promote/revoke super admins; generate password resets; switch facility context; and delete individual ice-depth sessions, refrigeration reports, and air-quality reports.
