# Admin Control Center

## 1. What this module is for

The Admin Control Center is the configuration hub for one ice rink in RinkReports. It is where the person who runs a facility sets up everything the staff app depends on: the facility's basic information, which report modules are turned on, the people who work there, the roles and permissions that decide who can do what, the shared lists that feed dropdowns across the app, and the system-wide settings for exports, data retention, and the audit trail.

Think of it as the back office. Staff members spend their time in the report flows (Daily Reports, Refrigeration, Incidents, and so on). Admins spend their time here, deciding how those flows behave. Nothing a staff member sees on their device — the modules in their menu, the areas they can submit to, the dropdown options they pick from — is hardcoded. It is all driven by what an admin configures in this Control Center.

You only see data for your own facility — this is automatic. Everything you create, edit, or view here applies to your rink and no one else's. (The one exception is the Super Admin console, described in section 5, which is reserved for the platform owner who manages every facility at once.)

## 2. Who can use it

RinkReports does not use a rigid ladder of five fixed job titles. Access is **permission-driven**: each person's abilities are resolved per module and per action (View / Submit / Edit / Admin), and an admin can customize any individual's access. The table below maps the documentation's five-tier vocabulary onto how the live app actually behaves. Treat the "What they can do" column as the *default* for that tier — an admin can widen or narrow it for any single person.

| Role tier | What they can see | What they can do |
|---|---|---|
| **super_admin** | Everything, across every facility. The only tier that sees the Super Admin console and the cross-facility facility list. | Create, edit, and activate/deactivate facilities; create and edit any facility's settings; promote or demote other super admins; reset any user's password; hard-delete employees; assign a person to a different facility; everything an org_admin/facility_manager can do. |
| **org_admin** | ⚠ VERIFY — **the live app has no separate org/multi-facility admin tier.** There is no role between super_admin and the single-facility admin. For now, treat any "org_admin" need as super_admin. | (No distinct equivalent exists in the code.) |
| **facility_manager** (live role: `admin`) | The full Admin Control Center for their own facility. Their own facility's settings appear **read-only** — they cannot edit facility info. | Turn modules on/off; add/edit/deactivate/reactivate employees; assign roles at or below their own rank; set per-person permission overrides; create and edit custom roles; manage departments, spaces, lists, exports, retention, and read the audit log. **Cannot** create/edit facilities, hard-delete employees, or grant Admin Center access. |
| **supervisor** (live role: `manager`, or a custom role) | Depends entirely on the permissions an admin has granted. By default a manager has no Admin Center access unless given the `admin` action on the `admin` module. | ⚠ VERIFY — supervisor abilities are not a fixed tier; they are whatever permission rows an admin enables. Two people with the title "manager" can have different access. |
| **staff** (live role: `staff`, or a custom role) | **No access** to the Admin Control Center. Attempting to open `/admin` shows a "Forbidden" message. | Nothing here. Staff work only in the report flows and self-service scheduling. |

How the gate actually works (plain version): the Admin Control Center opens for you if you are a super admin, **or** you have the Admin action enabled on the Admin module for your facility, **or** you are an active employee whose role is Administrator or Super Admin. A deactivated account is denied everywhere, immediately.

## 3. How to get there

From the staff app, admins see an extra **Admin Center** link in the left sidebar (staff do not). Selecting it opens the Admin Control Center, which has its own grouped sidebar.

The Admin sidebar is organized into three groups. The Setup and System groups are the Admin Control Center itself; the Module Admin group links out to each report module's own configuration (covered in those modules' own chapters).

- **Dashboard** — `/admin` (setup checklist + activity overview)
- **Setup**
  - Facility
  - Modules
  - People
  - Departments
  - Facility Spaces
  - Permissions
- **Module Admin** (cross-linked, documented in each module's chapter)
  - Daily Reports Admin, Ice Depth Admin, Ice Operations Admin, Incident Reports Admin, Accident Reports Admin, Refrigeration Admin, Air Quality Admin, Scheduling Admin, Communications Admin, Facility Paperwork
- **System**
  - Lists
  - PDF/Export Settings
  - Data Retention
  - Audit Log
  - Super Admin *(only functions for super_admin; others are bounced to a Forbidden screen)*

**Roles** is a real screen but it is **not in the sidebar**. You reach it from the Admin Dashboard's setup checklist — the "Canonical roles seeded" and "Role permission defaults" checklist items both have a button that opens it. (You can also type the address directly.) The Roles screen links back out to Permissions and People, but People and Permissions do not link to Roles. ⚠ VERIFY this is the intended navigation; the screen has no sidebar entry.

## 4. Setup & configuration (admins)

This section is the quick map of every admin-configurable option in the Control Center, where it lives, the valid values, and the effect. Screen-by-screen detail follows in section 5.

| Setting | Where | Valid values | Effect |
|---|---|---|---|
| Module on/off | Modules | On / Off per module | Shows or hides the module in **staff navigation only**. Does not change anyone's permissions. |
| Facility info (name, slug, timezone, address, contact, active) | Facility | Text/dropdown; slug must be lowercase letters/numbers/hyphens and unique | Identifies the facility. **Editable by super_admin only**; a regular admin sees it read-only. |
| Employee record | People | See field reference (section 7) | Creates the person, their role, job areas, and optional login. |
| Role assignment | People (employee form) | Any role at or below your own rank | Seeds that role's default permissions onto the person; manual overrides are kept. |
| Per-person permission override | Permissions, or the employee detail "Module Access" tab | View / Submit / Edit / Admin per module | Overrides the role default for that one person. Clearing falls back to the role default. |
| Custom roles & role defaults | Roles | Display name, key, hierarchy level, per-module action matrix | Defines a reusable permission template; changing it re-applies to that role's staff (overrides preserved). |
| Departments | Departments | Name, slug, color, sort order, active | Feeds the schedule department filter, shift assignment, and communication routing. |
| Facility Spaces | Facility Spaces | Name, slug, sort order, active | Feeds the location pickers in Incident, Accident, and Air Quality reports. |
| Lists (custom dropdowns) | Lists | Per-domain options (currently Timezones) | Customizes dropdown options used elsewhere (today: the facility timezone picker). |
| Export branding/layout/columns | PDF/Export Settings | Logo URL, header/footer text, paper size, date format, CSV delimiter, per-module column checkboxes | Controls how exported PDFs and CSVs look and which columns appear. |
| Data retention | Data Retention | Keep-days (0 = forever, or ≥ 30) + nightly auto-purge on/off per module | Permanently deletes records older than the threshold. Destructive. |

## 5. Screen-by-screen walkthrough

### Dashboard (`/admin`)

The landing screen. It shows a **Setup checklist** card (Facility info, Canonical roles seeded, Role permission defaults, First admin linked, Staff added, Invites sent) — each item has a status icon and a button that jumps you to the right screen. A badge reads "Ready" when all are done or "N left" otherwise. Below the checklist are overview cards (Active employees, and for super admins, Total facilities), a **Recent report activity** grid showing submission counts per module for the last 7 and 30 days, and an **Offline sync queue** card showing pending / synced / failed counts for offline submissions. A super admin sees a **facility switcher** dropdown in the header to pick which facility the dashboard reflects.

### Facility (`/admin/facility`)

This screen looks different depending on who you are.

**Regular admin (facility_manager):** you get a **read-only** view of your facility. A "Facility settings" card states "Only super admins can edit facility settings. Contact your administrator to make changes." It lists Name, Slug, Timezone, Status, Address, City, State, Zip code, Phone, Email, Created, and Last updated, plus an "At a glance" card counting Employees / Departments / Roles. You cannot change anything here.

**Super admin:** you get a full "Facilities" management screen — a card per facility (name, Inactive pill if applicable, slug · timezone · created date) with **Manage employees** and **Edit** buttons, plus a **New Facility** button at the top. Editing opens the facility form; saving requires super admin.

**Facility form fields:** Name (required, 2+ characters), Slug (required, lowercase letters/numbers/hyphens, must be unique — typing the name auto-suggests a slug until you edit it), Timezone (dropdown, options come from the Lists screen), Address, City, State (2-letter), Zip code, Phone number, Email, and (edit only) an **Active** checkbox ("Inactive facilities are hidden from most views"). The submit button reads **Create facility** / **Save changes**. There is no separate deactivate button — activation is the Active checkbox in the edit form.

### Modules (`/admin/modules`)

A single **on/off switch per module**, under a "Staff modules" card. The description spells it out: "This is a visibility switch only — it does not change per-employee permissions, and disabled modules remain protected by their own access rules." Turning a module off hides it from the staff navigation for this facility; it does not revoke anyone's underlying permissions.

The ten toggles are: Daily Reports, Ice Depth, Ice Operations, Refrigeration, Air Quality, Incidents, Accidents, Scheduling, Communications, Facility Paperwork. (Dashboard and the Admin Center itself are never toggleable.) Flipping a switch is immediate — no Save button — and shows a confirmation toast such as "Daily Reports enabled for this facility." If a save fails, the switch rolls back and shows an error.

### People / Employees (`/admin/employees`)

Titled "Employee / User Setup." A search box (name, email, role, code) and a status filter (**Active** / **Inactive** / **All**) sit above the employee table (columns: Name, Role, Email, Phone, Status, Actions). Two top buttons: **Bulk add** and **Add employee**.

**Per-row actions:** **Edit** (opens the form), **Invite** (only when the person is active, has an email, and has no login yet — sends a magic-link sign-in invite), **Preview** (view the app as that person), **Deactivate** / **Reactivate**, and **Delete** (shown only to super admins).

**Add / Edit employee form** (slides in from the right) — see the field reference in section 7 for the full list. Key behaviors:
- **Role** is required; the form shows a live **Role permissions** preview of what that role grants. A regular admin can only assign a role at or below their own rank.
- **Create a login & apply these permissions** (create mode, default on) sends an email invite and seeds the role's permissions. Requires an email. Uncheck it for schedule-only staff (e.g. minors) who do not log in.
- **Job areas**: pick up to 4; one can be marked **Primary**. You can create a new job area inline.
- **Employee is a minor** checkbox: when checked, the emergency contact name and phone become optional; otherwise both are required.

**Deactivate** opens a confirmation: "{name} will lose access immediately and stop appearing in shift assignments and routing rules. You can reactivate them later from this same list." Deactivation is a soft delete — the record and permissions are kept. **Delete** (super admin only) confirms "Delete {name}? This cannot be undone." and is a permanent hard removal.

**Employee detail page** (open a name) has tabs: **Profile** (read-only; edit via the list), **Certifications** (add/edit/delete certs with issuer and expiry, status badges warn when expiring or expired), **Module Access** (per-module effective level, its source, a "set override" dropdown, and a "Clear override" button), **Communication Groups** (add/remove the person from groups), and **Activity** (a read-only audit list for that person).

**Bulk add** (`/admin/employees/bulk`): a grid where you type or paste rows (First name, Last name, Email, Hire date, Role, Job areas), up to **100 at a time**, with live validation. Buttons: Add row, Paste from spreadsheet, Download template, Clear all. A **"Send login invites & apply role permissions"** switch (default on) controls whether each person gets an invite. Submitting reports each row as Added, Partial, or Failed.

### Departments (`/admin/departments`)

Departments power the schedule's department filter, shift assignment, and communication routing. The table shows Name (with a color dot), Slug, Order (with up/down reorder arrows), Status, and Actions. **Add department** opens a form: Name (required), Slug (optional, auto-generated, lowercase/digits/hyphens), Color (default green #4DFF00), Sort order, and — in edit mode — Active. Rows can be **Edit**ed and **Deactivate**d / **Reactivate**d. There is **no delete** for departments; deactivating hides a department from new assignments while existing shifts keep theirs.

### Facility Spaces (`/admin/spaces`)

The shared list of physical locations that feed the location pickers in Incident, Accident, and Air Quality reports. **Seed defaults** creates a standard set (Main Rink, Lobby, Locker Room, Pro Shop, Parking Lot, and more). You can also **Add space** manually or **bulk import** from pasted CSV. Each space has Name, Slug, Sort order, and (edit only) Active. Rows offer **Edit**, **Deactivate** / **Reactivate**, and **Delete**. Delete confirms "Delete space \"{name}\"? This cannot be undone." — but a space that is referenced by existing reports cannot be deleted; the app tells you to deactivate it instead.

### Permissions (`/admin/permissions`)

Titled "Module Access Control." It lists every active user; pick one to open their **permission matrix**. The matrix is a grid of **modules (rows) × four actions (columns): View, Submit, Edit, Admin**. The ten module rows are Daily Reports, Ice Depth, Ice Operations, Incident Reporting, Accident Reporting, Refrigeration, Air Quality, Employee Scheduling, Communications, and Admin.

- **What each action means:** View = can see the module; Submit = can create and submit entries; Edit = can modify their own or facility submissions; Admin = can change, approve, or configure that module's settings.
- **Each checkbox is a live write** — clicking it saves immediately and sets a per-person override. There is no Save button. If a save is rejected, the box rolls back.
- **Presets** (top-right buttons): **Full Access**, **Submitter Only** (View + Submit), **Viewer Only** (View), **No Access** (clears everything). A preset writes all module/action cells at once.
- **Admin guard:** only a super admin can grant the Admin module's Admin action (Admin Center access). For a regular admin, that one cell stays off even under Full Access, and they can only edit permissions within their own facility.
- A **Bulk CSV import** panel lets you paste rows with the header `user_id,facility_id,module,action,enabled`.
- A user with no facility assigned cannot have permissions set until a facility is assigned (the screen says so and links to People). A super admin user bypasses module permissions automatically; a notice explains the toggles only matter if their super-admin flag is removed.

You can also set a person's per-module override from their **employee detail → Module Access** tab.

### Roles (`/admin/roles`)

Define reusable permission templates for your facility. **Seed default roles** (from the People area) creates the four canonical roles: Super Admin, Administrator, Manager, Staff. The Roles screen has two parts:

- **Role Manager:** rename, add, deactivate, reactivate, and reorder roles. **New role** asks for Display name, Key (lowercase letters/digits/underscores, e.g. `rink_lead`), Hierarchy level (0 = highest), and an optional Description. System roles cannot be deactivated. A **Copy permission defaults** control bulk-copies one role's module defaults onto another. Deactivating a role that still has assigned employees prompts a confirmation explaining those employees keep only their explicit overrides.
- **Role permission defaults matrix:** for each role, toggle the default **V / S / E / A** (View / Submit / Edit / Admin) per module. Changing a default re-applies to that role's current staff, but any per-person overrides set in Module Access Control are preserved.

A regular admin cannot create or modify a role that outranks their own hierarchy level.

### Lists (`/admin/lists`)

Per-facility custom dropdown option lists. Today there is exactly one list domain: **Timezones**, which feeds the Facility settings timezone picker. **Seed defaults** loads the canonical set (safe to run repeatedly; never overwrites your edits). You can **Add**, **Edit**, **Deactivate** / **Reactivate**, and **Delete** options. Each option has a Key (for timezones, a valid IANA identifier such as `America/New_York`), a Display name, a Color, a Sort order, and (edit only) Active. An option that is in use cannot be deleted — deactivate it instead.

### PDF / Export Settings (`/admin/exports`)

Two parts.

**Run an export:** pick a **Module**, a **Format** (CSV or PDF), and a **From** / **To** date range, then **Download**. The columns, delimiter, date format, and branding come from the settings below.

**Export settings** (one **Save export settings** button):
- **Branding** — Logo URL (recommended 300×80 px), Header text, Footer text (shown on exported PDFs).
- **Layout & Format** — Paper size (Letter / A4), Date format (MM/DD/YYYY, DD/MM/YYYY, or YYYY-MM-DD), CSV delimiter (comma / tab / semicolon), and an "Include on every export" group (Facility name, Export date, Submitted-by name).
- **Column Visibility per Module** — checkboxes per module choosing which columns appear in its export. Unchecked columns are hidden from exports but stay in the database.

### Data Retention (`/admin/retention`)

Controls how long submitted data is kept per module, measured from each record's submission date. Summary cards show modules configured, auto-purge enabled count, and when a purge last ran. Each module row shows its current keep period and an **Edit** button.

- **Keep for (days):** a number, with preset buttons (30 days, 90 days, 180 days, 1 year, 2 years, 3 years, 5 years, Forever). Each module shows a recommended minimum (e.g. 365 for Incident/Accident/Audit Log). The value must be 0 (forever) or at least 30.
- **Enable nightly auto-purge:** when on, records older than the threshold are permanently deleted each night.
- **Manual Purge:** a "Run purge now" button reveals an inline confirmation ("Are you sure? This will permanently delete records.") before deleting immediately.

A red **Auto-purge warning** card stresses that deletion is permanent and irreversible — review your legal and regulatory retention obligations, especially for incident, accident, and workers' compensation records, before enabling it.

### Audit Log (`/admin/audit-log`)

A **read-only**, filterable trail of create / update / delete / login / logout events. Filters: **Action**, **Entity type**, **Actor**, **From** / **To** dates, and a search by entity ID. The table columns are When, Actor, Action (color-coded badge), Entity type, and Entity ID. Selecting an entry's timestamp opens a detail panel with the full record, IP address, user agent, and collapsible **Before** / **After** snapshots. It shows up to 300 entries (newest first, last 30 days by default); narrow with filters. There is nothing to edit here.

### Super Admin (`/admin/super-admin`)

**Super_admin only** — anyone else is sent to a Forbidden screen. Platform-wide management: stat cards (Total facilities, Active facilities, Total users, Super admins); a **Facilities** panel to **Activate** / **Deactivate** facilities (paginated); a **Super admins & users** panel to **Reset password** (creates a recovery link), and **Promote** / **Revoke** super-admin status for other users (you cannot revoke your own); and an **Email invite service** health card with a **Run health check** button that verifies the deployment can send sign-in invites.

## 6. Step-by-step: common tasks

**Turn a module on or off**
1. Open **Modules** from the Admin sidebar.
2. Find the module row.
3. Click its switch. It flips immediately and shows a toast confirming the change. (Off hides it from staff navigation; permissions are unaffected.)

**Add an employee and assign a role**
1. Open **People**, then click **Add employee**.
2. Enter First name and Last name.
3. Pick a **Role** (you can only pick roles at or below your own rank). Review the permission preview.
4. Decide on **Create a login & apply these permissions** — leave it on (and enter an Email) for someone who logs in; uncheck it for schedule-only staff.
5. Optionally add Job areas (up to 4, mark one Primary), Employee code, Hire date, Max weekly hours, Phone.
6. If the person is a minor, check **Employee is a minor** (emergency contact becomes optional); otherwise enter the emergency contact name and phone.
7. Click **Create employee**. If a login was requested, an invite email goes out and the role's permissions are seeded.

**Override one person's permissions**
1. Open **Permissions** and pick the user (or open the person in **People** and go to the **Module Access** tab).
2. In the matrix, tick or untick the **View / Submit / Edit / Admin** box for the module you want to change. It saves instantly.
3. To reset to the role default, untick the overrides (or use the **No Access** preset / **Clear override**). Note: only a super admin can grant the Admin module's Admin action.

**Create a custom role**
1. Open the **Roles** screen (from the Admin Dashboard setup checklist).
2. In Role Manager, click **New role**.
3. Enter a Display name, a Key (lowercase letters/digits/underscores), a Hierarchy level (0 = highest; you cannot create a role above your own rank), and an optional Description. Click **Create**.
4. In the role permission defaults matrix, toggle the **V / S / E / A** boxes per module to set what the role grants. Changes apply to staff with that role (their manual overrides are kept).

**Configure data retention**
1. Open **Data Retention** and click **Edit** on a module.
2. Set **Keep for (days)** (use a preset or type a number; 0 = forever, or at least 30).
3. Optionally turn on **Enable nightly auto-purge**, then **Save**.
4. To delete old records now, use **Run purge now** and confirm. This is permanent — heed the warning, especially for incident, accident, and workers' comp data.

**Export records**
1. Open **PDF/Export Settings**.
2. In "Run an export," pick the **Module**, **Format** (CSV or PDF), and the **From** / **To** dates.
3. Click **Download**. The file uses the branding, layout, and column settings configured below.

## 7. Field reference

**Employee form** (People → Add/Edit employee):

| Field | What it means | Valid values/units | Required? | Notes |
|---|---|---|---|---|
| First name | Given name | Text, up to 100 chars | Yes | |
| Last name | Family name | Text, up to 100 chars | Yes | |
| Role | The person's role | Any facility role at/below your rank | Yes | Seeds that role's permission defaults; shows a live preview. |
| Create a login & apply these permissions | Whether to provision a sign-in | Checkbox | No (create only, default on) | Requires an email; sends an invite. Uncheck for schedule-only staff. |
| Job areas | Cross-trained work areas (scheduling) | Up to 4 selections | No | One can be marked Primary; can create new areas inline. |
| Employee code | Internal staff code | Text | No | |
| Hire date | Start date | Date | No | |
| Max weekly hours | Per-person scheduling cap | Number 1–168 | No | Blank uses the facility default; the shift grid warns when exceeded. |
| Email | Contact / login address | Email | No* | *Required if a login is being created. |
| Phone | Contact number | Phone | No | |
| Employee is a minor | Flags an under-age worker | Checkbox | No | When on, emergency contact becomes optional. |
| Emergency contact name | Who to call | Text | Required unless minor | |
| Emergency contact phone | Emergency number | Phone | Required unless minor | |

**Facility form** (super_admin only):

| Field | What it means | Valid values/units | Required? | Notes |
|---|---|---|---|---|
| Name | Facility name | Text, 2+ chars | Yes | |
| Slug | URL identifier | Lowercase letters, numbers, hyphens; unique | Yes | Auto-suggested from the name. |
| Timezone | Local time zone | IANA zone from the Lists picker | No | Defaults if blank/invalid. |
| Address / City / State / Zip code | Mailing address | Text (State is 2-letter) | No | |
| Phone / Email | Facility contact | Phone / email | No | Email must be valid if provided. |
| Active | Whether the facility is live | Checkbox (edit mode) | No | Inactive facilities are hidden from most views. |

**Retention row** (Data Retention):

| Field | What it means | Valid values/units | Required? | Notes |
|---|---|---|---|---|
| Keep for (days) | Retention period | 0 (forever) or ≥ 30 days | Yes | Per-module recommended minimums shown (e.g. 365 for incident/accident/audit). |
| Enable nightly auto-purge | Automatic deletion | Checkbox | No | Permanently deletes records older than the threshold each night. |

## 8. Locking, saving & offline

**Admin configuration is online-only.** The Admin Control Center is a desk task and is not part of the offline submission queue. You must be connected to use it; there is no "save on this device" here.

**Saving behaves in two patterns.** Some screens save **instantly on click** — module switches, the permission matrix checkboxes and presets, and the role default matrix all write immediately with no Save button (a failed write rolls the control back and shows an error). Forms (Facility, Employee, Department, Space, List option, Retention, Export settings) collect your input and save when you press the submit button (**Create…** / **Save changes** / **Save export settings**).

**What "locked" means here.** Admins do not edit staff submissions in place. The Audit Log is permanently read-only — it is an immutable record. Facility records and employees use soft deactivation (kept for history) rather than deletion wherever possible; true deletes are reserved for super admins and, for facilities and referenced spaces/list options, are blocked or steered to "deactivate instead." Data Retention purges are the one deliberately destructive action, gated behind a warning and an inline confirmation.

## 9. Troubleshooting & FAQ

**Why can't I edit my facility's name or address?** Editing facility settings is reserved for super admins. As a facility admin you get a read-only view. Ask your super admin to make the change.

**Why don't I see the Super Admin screen working?** It only functions for super admins. If you open it without that flag you are sent to a Forbidden screen. This is by design.

**Why can't I grant someone Admin Center access?** Only a super admin can enable the Admin module's Admin action. For a regular admin, that one cell stays off even when you apply Full Access.

**Why can't I assign the Administrator role to someone?** You can only assign roles at or below your own rank. A manager can't create or promote into an admin-tier role; a super admin is unrestricted.

**Why can't I find the Roles screen in the sidebar?** It has no sidebar entry. Open it from the Admin Dashboard's setup checklist ("Canonical roles seeded" or "Role permission defaults"). ⚠ VERIFY — this is the only built-in path besides the direct address.

**Why can't I delete this employee / space / list option?** Hard-deleting employees is super-admin only — others should use Deactivate. A facility space or list option that is referenced by existing records can't be deleted at all; deactivate it instead so history stays intact.

**I turned a module off but the person can still reach it by URL — why?** The Modules switch only controls **navigation visibility**. The module is still protected by its own access rules; to actually remove someone's access, change their permissions in the Permissions screen.

**I deactivated someone but they say they can still see things.** Deactivation takes effect immediately for new sign-ins and blocks access, but an already-open session may need a refresh. A deactivated account cannot sign in, submit, or view data until reactivated.

**Why is the permission matrix empty / greyed out for a user?** A user with no facility assigned has nowhere to store permissions yet — assign them a facility from People first. A super-admin user bypasses module permissions entirely, so the toggles are informational unless their super-admin flag is removed.

**Why did my export download the wrong columns?** Column visibility is per module in PDF/Export Settings. Unchecked columns are intentionally hidden from exports (the data still exists in the database).

---

## Source (footnote)

Key files verified for this chapter (paths for maintainers only; not part of the user-facing content):

- Access gating: `src/lib/auth/require-admin.ts`, `src/lib/auth/get-is-admin.ts`, `src/proxy.ts`, `src/lib/supabase/session.ts`
- Permission model: `src/lib/permissions/actions.ts` (modules × View/Submit/Edit/Admin, presets), `src/lib/permissions/levels.ts`, `src/lib/permissions/index.ts`
- Navigation & shell: `src/components/admin/nav-config.ts`, `src/components/admin/sidebar-nav.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`
- Modules: `src/app/admin/modules/page.tsx`, `_components/module-toggles.tsx`, `actions.ts`, `src/lib/modules/module-keys.ts`
- Facility: `src/app/admin/facility/page.tsx`, `_components/{facility-form,read-only-view,facilities-table,new-facility-button,edit-facility-section}.tsx`, `actions.ts`, `types.ts`
- People/Employees: `src/app/admin/employees/{page.tsx,actions.ts,types.ts}`, `_components/{employee-form,employees-client,role-permission-preview,seed-roles-button}.tsx`, `[id]/_components/employee-detail.tsx`, `[id]/actions.ts`, `bulk/_components/bulk-add-client.tsx`, `bulk/{actions.ts,_lib/validation.ts}`
- Permissions: `src/app/admin/permissions/{page.tsx,user-permission-actions.ts,validators.ts}`, `[userId]/page.tsx`, `_components/permission-matrix.tsx`
- Roles: `src/app/admin/roles/{page.tsx,actions.ts}`, `_components/{role-manager,roles-matrix}.tsx`
- Departments / Spaces: `src/app/admin/departments/**`, `src/app/admin/spaces/**`
- Lists: `src/app/admin/lists/**`, `_lib/facility-dropdowns.ts`
- Exports: `src/app/admin/exports/{page.tsx,actions.ts,types.ts}`, `_components/{export-settings-form,run-export-panel}.tsx`
- Retention: `src/app/admin/retention/{page.tsx,actions.ts,types.ts}`, `_components/retention-row.tsx`
- Audit Log: `src/app/admin/audit-log/**`
- Super Admin: `src/app/admin/super-admin/{page.tsx,actions.ts,types.ts}`, `_components/{facilities-panel,super-admin-users-panel,invite-service-health-card}.tsx`
