# Daily Reports

## 1. What this module is for

The Daily Reports module is RinkReports' digital replacement for the paper "shift checklist" clipboard. Your facility is divided into **work areas** — front-of-house and operational zones such as Front Desk, Pro Shop, Custodial, Skate Sharpening, Concessions, Event Set Up, Learn to Skate, Public Skate, Locker Rooms, and Building Services. (Those ten are the example areas Tennity Ice Pavilion uses; your facility's list is whatever your administrator has set up.)

For each area, an administrator builds one or more **checklists** (called "shifts" or "templates"). When you work a shift, you open Daily Reports, pick your work area and shift, tick off each task as you complete it, optionally leave a note, and submit. Managers can then review every area's reports for the day in the Admin Center.

Each work area is logged **independently** — submitting the Concessions checklist has nothing to do with whether the Locker Rooms checklist has been done. Every submission is a separate, permanent record (see Section 8 for exactly how saving and "locking" work — there is no single end-of-day report that fills up across areas).

You only see data for your own facility — this is automatic. There is no way to view or submit reports for another rink.

---

## 2. Who can use it

Daily Reports access is **permission-driven**, not strictly tier-driven: an administrator grants each person the ability to **view**, **submit**, **edit**, or **administer** the module, and — uniquely for this module — grants submit access **area by area** (the "Area Access" matrix). Two people with the same job title can therefore have different access if an admin has customized it.

The five-tier vocabulary used across this documentation maps onto the live app's roles as below. Because the real model is permission-based, treat the "Can do" column as the typical default, not a hard rule.

| Role tier | Can see | Can do |
|---|---|---|
| **super_admin** | Everything, platform-wide | Full configuration plus delete; always has area access. |
| **org_admin** | ⚠ VERIFY — no separate org-admin role exists in the live app; treat as super_admin. | ⚠ VERIFY — same as super_admin in practice. |
| **facility_manager** *(the live `admin` role)* | All areas, all submissions, and the full admin console for their own facility | Create/edit areas, templates, checklist items; grant area access; review, edit, annotate, and delete submissions. Always has submit access regardless of the Area Access matrix. |
| **supervisor** *(the live `manager` role, or a custom role)* | What their permissions allow | ⚠ VERIFY — has no special daily-reports powers by default; sees and submits only where granted, exactly like staff unless an admin has enabled the module's `admin` action for them. |
| **staff** | The areas they've been granted submit access to, plus recent History for the facility | Submit daily reports for their granted areas; view History (read-only). No access to the admin console. |

Anyone whose account is **deactivated** is denied everywhere. A signed-in user with **no area access granted** sees a "No areas assigned" message and can submit nothing until an admin grants access.

---

## 3. How to get there

**Staff:** In the left sidebar (or the bottom **Reports** / **Menu** tab on a phone), tap **Daily Reports**. This opens your reporting console at the Daily Reports page. From there, **View history** (top-right) opens the read-only History page.

The Daily Reports menu item only appears if your administrator has the module turned on for the facility and you have view/submit permission.

**Administrators:** Open the **Admin Center** (the "Admin Center" link appears in the staff sidebar for admins), then choose **Daily Reports Admin** under the "Module Admin" group.

---

## 4. Setup & configuration (admins)

The Daily Reports admin area is organized into five tabs: **Areas**, **Templates**, **Checklist Items**, **Area Access**, and **Submissions**. The first four are setup; Submissions is review (covered in Sections 5 and 6). A reminder banner notes that reports auto-delete after 14 days.

> Daily Reports configuration is a facility_manager-level (`admin`) task. It is also cross-referenced from the **Admin Control Center**, where the **Modules** page carries the master ON/OFF switch that shows or hides Daily Reports in staff navigation.

### Areas (the "tabs" staff see)

An **area** is one of the work zones staff pick from. On the **Areas** tab you can:

- **Add area** — give it a **Name** (required), an optional **Slug** (a URL-safe short name; auto-generated from the name if left blank — lowercase letters, digits, and hyphens), a **Color** swatch, and a **Sort order**.
- **Edit** an area, including toggling it **Active**.
- **Reorder** with the up/down arrows (this controls the order staff see).
- **Deactivate / Reactivate** — deactivating hides the area from staff without deleting its history.
- **Delete** — only succeeds if the area has no submissions; otherwise you're told to deactivate instead.
- **Bulk upload areas** — import many at once from a file.

**The area cap.** A facility may have at most **30 active areas** at one time. This limit is enforced by the database, not just the screen. The Areas tab shows a live "X / 30 active" badge; once you hit 30, the **Add area** button reads "Cap reached" and reactivating another area is blocked until you deactivate one. (Note: some sales material mentions "up to 20 tabs" — the actual enforced cap is **30 active areas**.)

### Templates (the "shifts" / checklists)

A **template** is a named checklist that belongs to a single area — for example "Opening checklist" or "Hourly inspection." On the **Templates** tab, first pick an area from the **Area** dropdown, then:

- **Add template** — **Name** (required), optional **Description**, and **Sort order**.
- **Edit**, **Deactivate / Reactivate**, and **Delete** (delete is blocked if any submission references it — deactivate instead).

An area can have several templates; the staff member chooses which one applies to the shift they're logging.

### Checklist Items

A **checklist item** is a single tickable task within a template. On the **Checklist Items** tab, pick the **Area** and then the **Template**, then:

- **Add item** — **Label** (required; the text staff see, e.g. "Inspect ice surface for cracks") and an optional **Description** (a sub-line of guidance).
- **Edit**, reorder (up/down), **Deactivate / Reactivate**, and **Delete**.
- **Bulk upload** items into a template from a file.

A template with no items is allowed — staff can still submit it (it just records the area/shift and any note).

### Area Access

The **Area Access** tab is a grid of **staff (rows) × areas (columns)** with a checkbox in each cell. Checking a box lets that staff member submit daily reports **in that area**. Notes:

- Changes save immediately as you toggle each box (no separate Save button).
- **Admins and super admins always have access**, regardless of the boxes.
- You can **Download CSV** (a template of the current grid) and **Import CSV** to set access in bulk; the import reports counts of granted / revoked / skipped rows and any issues.

---

## 5. Screen-by-screen walkthrough

### Staff console (the Daily Reports page)

When you open Daily Reports you see a single scrolling page:

- **Header** — a breadcrumb (Reports › Daily Reports), the page title, and a **View history** button.
- **Meta-chip strip** — your name, your facility, today's date, and a **live clock** that updates every second.
- **Shift setup card** — two dropdowns:
  - **Work area** — lists only the areas you're allowed to submit to, each shown with its color swatch.
  - **Shift** — lists the templates for the area you picked, with each one's item count beside it (e.g. "Opening checklist · 8 items"). If an area has exactly one shift, it is **auto-selected** for you; otherwise you'll see "Choose shift type…" until you pick.
- **Checklist card** — once a shift is chosen, its items appear as a list of large checkboxes (each with its optional description line). At the top is a **"X / Y complete" counter** and a **progress bar** that fills (and tints to the area's color) as you tick items. A template with no items shows "No checklist items on this template. You can still submit."
- **Note card** — an optional free-text box ("Anything to flag for managers?").
- **Sticky submit bar** — pinned to the bottom of the screen. It shows your progress ("X/Y complete") and a **Submit** button. The button stays disabled until a shift is selected. When you're offline it adds "· offline — will sync when reconnected."

After you submit, you land on a **"Submitted!"** confirmation screen with a green check, the area and shift name, the timestamp, an "X of Y items checked" summary, and **Submit another** plus a sign-out option.

### History page

**View history** opens **Daily Report History** — a read-only list of recent daily reports for your facility (newest first). Each row shows the area (with its color dot), the shift/template name, the timestamp, who submitted it, and an "X/Y complete" badge. A note at the bottom reminds you reports auto-delete after 14 days. You cannot edit anything from here.

### Admin tabs (Submissions review)

In **Daily Reports Admin → Submissions**, managers get a filterable table of submissions:

- **Filters** — by area, by employee, and by date range (defaults to the last 14 days).
- **Table** — Submitted time, Area, Template, Employee, Items (checked/total), Notes count, and an **Open** link.
- **Detail panel** (after clicking Open) — shows the full checklist with each item's checked/unchecked state, the list of notes, and admin actions: **toggle any item**, **add an admin note**, **edit or delete existing notes**, and **delete the submission**. There is a **Back to list** link to return to the filtered table.

---

## 6. Step-by-step: common tasks

### Submit a daily report (staff)

1. Open **Daily Reports** from the sidebar (or Reports tab).
2. In **Work area**, pick the zone you're logging.
3. In **Shift**, pick the checklist (it may already be chosen if there's only one).
4. Tick each task as you complete it; watch the progress bar.
5. Optionally type a **Note** for managers.
6. Tap **Submit** in the sticky bar.
7. Confirm on the **Submitted!** screen, or tap **Submit another** to log a different area.

### Add a new work area (admin)

1. Go to **Daily Reports Admin → Areas**.
2. Click **Add area** (if the "X / 30 active" badge shows you're at the cap, deactivate one first).
3. Enter a **Name**, optionally adjust the **Slug**, pick a **Color**, set a **Sort order**.
4. Click **Create area**. It now appears as an option in the staff Work area dropdown for anyone granted access.

### Build a checklist template (admin)

1. Go to **Daily Reports Admin → Templates** and choose the **Area** from the dropdown.
2. Click **Add template**, give it a **Name** (and optional description), then **Create template**.
3. Switch to the **Checklist Items** tab, choose the same **Area** and your new **Template**.
4. Click **Add item** for each task (Label required), or use **Bulk upload** to paste many at once.
5. Reorder items with the up/down arrows so they read top-to-bottom the way staff work.

### Grant area access to an employee (admin)

1. Go to **Daily Reports Admin → Area Access**.
2. Find the employee's row and the area's column.
3. **Check the box** — it saves immediately. (To grant many at once, use **Download CSV**, edit the `can_submit` column, and **Import CSV**.)

The employee will now see that area in their Work area dropdown the next time they open Daily Reports.

### Review or annotate a submission (admin)

1. Go to **Daily Reports Admin → Submissions** and use the filters to narrow the list.
2. Click **Open** on a row.
3. Add an **admin note**, adjust a checkbox if needed, or **Delete submission**. Notes you add are visible to admins and to staff on the report.

---

## 7. Field reference

**Staff console**

| Field | Type | Required | Notes |
|---|---|---|---|
| Work area | Dropdown | Yes | Only areas you have submit access to; shows a color swatch. |
| Shift | Dropdown | Yes | Templates within the chosen area; shows each one's item count; auto-selected if only one exists. |
| Checklist items | Checkboxes | No | One per active item on the template; drive the progress bar. A template may legitimately have zero items. |
| Note | Text area | No | Free text for managers; saved with the submission. |

**Area form (admin)**

| Field | Type | Required | Notes |
|---|---|---|---|
| Name | Text | Yes | What staff see in the Work area dropdown. |
| Slug | Text | No | Auto-generated from the name if blank; lowercase letters, digits, hyphens only. |
| Color | Color picker | No | Accents the area in dropdowns, the checklist, and History. |
| Sort order | Number | No | Lower numbers appear first. |
| Active | Checkbox | No (edit only) | Inactive areas are hidden from staff but keep their history; counts against the 30-active cap only while active. |

**Template form (admin)**

| Field | Type | Required | Notes |
|---|---|---|---|
| Name | Text | Yes | E.g. "Opening checklist." |
| Description | Text | No | Optional sub-line shown in the admin table. |
| Sort order | Number | No | Order of shifts within the area. |
| Active | Checkbox | No (edit only) | Inactive templates are hidden from staff. |

**Checklist item form (admin)**

| Field | Type | Required | Notes |
|---|---|---|---|
| Label | Text | Yes | The task text staff tick off. |
| Description | Text | No | Optional guidance line under the label. |
| Sort order | Number | No (edit only) | New items are auto-placed at the end. |
| Active | Checkbox | No (edit only) | Inactive items don't appear on new submissions. |

---

## 8. Locking, saving & offline

**There is no end-of-day "report" that locks.** Unlike a single paper sheet that fills up over a shift, RinkReports treats each submit as its own complete record. Specifically:

- **Saved vs submitted.** While you're filling in the checklist, nothing is stored on the server — your ticks live in the page until you tap **Submit**. Pressing Submit creates the report.
- **Append-only.** Every Submit creates a **new, permanent record**. Staff cannot go back and edit a submitted report; if something was wrong, you simply submit again — the new submission is a separate row, and both are kept for the audit trail. Each report is automatically tagged with your facility's local calendar date so managers can group a day's reports, but a new day doesn't "close" the previous one — there is no lock step.
- **What admins can change.** Managers don't reopen a staff report for the staffer to edit; from the Submissions detail panel they can toggle items, add/edit/delete admin notes, or delete the whole submission.
- **Auto-delete.** Daily reports are kept for **14 days** and then automatically purged. History and the admin Submissions list only show what's still within that window.

> ⚠ VERIFY — "the report locks/submits at end of day." The training package described an end-of-day lock. The code does **not** implement a per-day lock or a single rolling report; it uses an append-only model (one immutable record per Submit, tagged with the facility-local date, auto-deleted after 14 days). Describe it that way.

**Offline ("Save on this device").** Daily Reports works without a connection:

- If you tap Submit while offline, the report is **saved on your device** and queued. The confirmation reads **"Saved on this device"** and explains it will submit automatically once you're back online — and that the same checks run then. You can keep working.
- The sticky bar shows an "offline — will sync when reconnected" hint so you know you're in offline mode.
- When your connection returns, the queued report submits on its own. Each queued report carries a unique identifier so a retry can't create a duplicate, and the same area, shift, and permission checks that run online are re-applied when it syncs. If access was revoked while you were offline, the queued report can be rejected at sync time.

---

## 9. Troubleshooting & FAQ

**"No areas assigned" / the Work area dropdown is empty.** You haven't been granted submit access to any area. Ask an admin to check the **Area Access** grid in Daily Reports Admin.

**"Account not ready" or "Your account isn't fully set up yet."** Your employee record isn't active or fully provisioned. Contact your administrator.

**I can't find Daily Reports in my menu.** Either the module is turned off for your facility (an admin controls this on the **Modules** page) or you lack view permission.

**The Shift dropdown says "No shifts available."** The selected area has no active templates yet. An admin needs to add at least one template to that area.

**I ticked the wrong box / submitted by mistake.** You can't edit a submitted report. Submit a corrected one — both are kept — and, if needed, ask a manager, who can adjust or delete the submission from the Submissions tab.

**Admin: "Cap reached" when adding an area.** Your facility already has 30 active areas (the database limit). Deactivate an area you no longer use, then add the new one.

**Admin: "Cannot delete area/template with existing submissions."** Deletion is blocked once reports reference the item. Use **Deactivate** instead — it hides the area or template from staff while preserving history.

**My report didn't show up.** If you submitted offline, it's queued and will appear once it syncs. Also remember History only shows the last **14 days**; older reports are auto-deleted.

**Can I see another facility's reports?** No. You only see data for your own facility — this is automatic.

---

## Source

`src/app/reports/daily/` (`page.tsx`, `actions.ts`, `_components/daily-report-console.tsx`, `history/page.tsx`, `[areaSlug]/[templateId]/done/page.tsx`, `_lib/submit.ts`, `_lib/compute.ts`, `_lib/offline.ts`); `src/app/admin/daily-reports/` (`page.tsx`, `actions.ts`, `area-access-actions.ts`, `types.ts`, `_components/areas-tab.tsx`, `templates-tab.tsx`, `items-tab.tsx`, `area-access-tab.tsx`, `submission-detail.tsx`, `area-form.tsx`, `item-form.tsx`); `supabase/migrations/00000000000007_daily_reports_schema.sql` (30-active-area cap trigger, 14-day retention). Cross-referenced with `docs/training/00-MANIFEST.md`.
