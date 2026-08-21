# 2. Create the Facility & First Admin

## 2.1 Create the facility (super admin)

In **Admin → Facility**, click **New facility** and fill in:

- **Name** and **Slug** (auto-suggested from the name; lowercase letters, numbers, hyphens; used in URLs and must be unique).
- **Zip code** — typing it auto-selects the **Timezone**; the helper confirms "Set to {zone} from the zip code". Override only on a timezone boundary.
- Address, city, state, phone, email.

Creating a facility automatically seeds the four **canonical roles** in the same transaction: Super Admin (level 0), Administrator (1), Manager (2), Staff (3). If you ever land in a facility without roles, the Employees page offers a **Seed default roles** button.

Facility admins get a **read-only view** of this page — every later change to the facility record (even a phone number) goes through a super admin.

## 2.2 Verify invites work before anything else

Account provisioning runs on email invites, so confirm the pipeline before creating fifty employees. **Admin → Super Admin → Invite service health** probes the invite service and reports the exact failure mode (key missing, invalid, or wrong project) if it's broken. Fix that first — otherwise every "Add employee with login" ends in *"Email invitations aren't available right now."*

## 2.3 Create the first facility admin

1. In **Admin → People** (super admin, with the facility selected via the dashboard switcher), **Add employee**: name, the **Administrator** role (assigning an admin-tier role is super-admin-only), email, phone, emergency contact.
2. Leave **"Create a login & apply these permissions"** checked — it sends the invite and seeds the Administrator role's permission defaults.
3. In **Admin → Permissions**, open the new user and confirm the **Admin module × Admin action** cell is on. That checkbox *is* Admin Center access, and only a super admin can grant it.

The invite email lands the person on a set-your-own-password page — admins never see or set passwords. If the email already has an account, no email is sent and the existing login is linked silently.

From here on, the facility admin can do everything else in this guide except the super-admin items flagged along the way.

## 2.4 Decide module visibility

**Admin → Modules** lists a toggle per staff module. Turn off what this facility doesn't use — disabled modules disappear from staff navigation and the dashboard.

Two things to internalize:

> The toggle is a **visibility switch only**. It does not change per-employee permissions, and a disabled module's data stays protected by its own access rules. Use the Permissions matrix to control *access*; use Modules to control *clutter*.

Missing settings default to **enabled** — a brand-new facility shows everything until you prune. Dashboard and the Admin Center are never toggleable.

## 2.5 Roles and permission defaults

Open **/admin/roles** (it's not in the sidebar — reach it from the dashboard setup checklist or by URL). Two jobs:

1. **Add custom roles** if the facility needs them (e.g. `rink_lead`, `driver`): display name, an immutable lowercase key, a hierarchy level (lower = higher rank), description. You can't create a role that outranks your own.
2. **Set the defaults matrix** — for each role × module, toggle the default **V**iew / **S**ubmit / **E**dit / **A**dmin actions. These defaults are what gets stamped onto every employee you create with that role. Get them right *before* bulk-adding staff and you'll rarely touch the per-user matrix.

Rules of the road: flipping a default **immediately re-applies to that role's current staff** (manual per-user overrides survive); the Admin-Center cell is super-admin-only; **Copy permission defaults** bulk-copies one role's defaults onto another.

Resolution order, as the page states it: *explicit override → role default → no access.* A user with no permission rows has zero access.

## 2.6 Add the staff roster

**Admin → People → Bulk add** for anything beyond a handful:

- Up to 100 rows per batch. **Paste from spreadsheet** (columns: First name, Last name, Email, Hire date, Role, Job areas — pipe-separated, matching existing areas) or use the downloadable CSV template.
- The **"Send login invites & apply role permissions"** switch (on by default) invites everyone in one pass. Uncheck it for schedule-only records — minors, seasonal staff — and invite later from the list.
- Watch the per-row status: **Added** / **Partial** (record created but invite or permission seeding failed — send a manual **Invite** later) / **Failed** (with the reason).
- Bulk add can't set departments, emergency contacts, or employee codes — follow up in each employee's edit sheet.

For individual adds, the single **Add employee** sheet also captures job areas (max 4, with a primary), **max weekly hours** (the scheduling hour cap), **hourly wage** (admin-only; powers labor-cost estimates), the **minor** flag, and emergency contact (required unless a minor).

**Certifications** live on the employee detail page (Certifications tab): add each cert with its expiry date, and *always pick the name from the suggestions* — scheduling's certification enforcement matches by name, and a typo breaks it.

## 2.7 Fine-tune per-user permissions

**Admin → Permissions** is the authoritative matrix: 13 module rows × View / Submit / Edit / Admin, per user, saving on every click. Watch two adjacent rows carefully: **Employee Scheduling** (`scheduling`, staff shifts) and **Rink Scheduling** (`rink_scheduling`, ice bookings and billing) are different modules. Use the presets (Full Access, Submitter Only, Viewer Only, No Access) for quick starts. Remember:

- Edits here are stamped as **manual overrides** — role re-seeding never overwrites them. Prefer fixing the role default when the change applies to everyone with the role.
- The matrix shows every module whether or not it's enabled for the facility — permissions and visibility are independent.
- A **Bulk CSV import** exists for migrations; invalid rows are skipped with per-line reasons.
