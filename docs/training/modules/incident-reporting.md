# Incident Reporting

> **Product:** RinkReports — the Next.js progressive web app (PWA) for ice-rink operations.
> **Brand colors:** #4DFF00 (primary green) · #002244 (navy).
> **Data scoping:** *You only see data for your own facility — this is automatic.* You never switch facilities or see another rink's incidents; RinkReports keeps each facility's records separate on its own.

---

## 1. What this module is for

Incident Reporting is how staff record something that went wrong on the ice or in the building — a slip, a collision, an altercation, an equipment problem, a guest who needed medical help. A report captures **when and where** it happened, **what happened**, **how serious it was**, whether an **ambulance was called**, who was **involved**, and any **witnesses**. Once filed, the report goes to managers/admins to review, track follow-ups, and mark resolved.

Two things make this module different from most other RinkReports forms:

- **You can correct your own report for 24 hours** after submitting. After that window closes, it locks and becomes read-only (see §8). Most other report types are one-and-done with no edit window.
- There is **no photo or file upload** anywhere in this module. You describe what happened in words; you do not attach images, video, or documents.

---

## 2. Who can use it

Access is **permission-driven**, not strictly tier-driven: an administrator can turn each person's access on or off per action (view / submit / edit / admin). The table below shows the typical default mapping. Where a label feels rigid, treat it as the default and confirm against your configured facility.

| Role tier (doc vocabulary) | Typical access to Incident Reporting |
|---|---|
| **super_admin** | Full: file reports, edit own within 24h, and full admin (History, Types, Severities, Activities, status changes, follow-up notes). |
| **org_admin** | ⚠ VERIFY — the live app has **no separate org_admin tier**. Treat as super_admin. |
| **facility_manager** (live role: `admin`) | Full admin for their own facility: review every report in History, change status, add follow-up notes, and configure Types / Severities / Activities. Can also file reports. |
| **supervisor** (live role: `manager` or a custom role) | ⚠ VERIFY — typically can **file** reports and **edit their own** within 24h. Admin review/config only if granted the `admin` action for this module. |
| **staff** (live role: `staff` or a custom role) | **File** incident reports and **edit their own** within the 24-hour window. **No access** to the admin console (History/Types/Severities/Activities, status, follow-up notes). |

Notes confirmed in code:

- To even open the staff incident page, you need the **submit** permission for Incident Reporting. Without it you see a "No access" message ("You don't have permission to submit incident reports.").
- The admin console requires admin-level access; staff who try to reach it are shown a Forbidden message, not the admin screens.
- A **deactivated** account cannot file, view, or edit anything.

---

## 3. How to get there

**Staff (to file or view your own reports):**

- Open the staff app and choose **Incidents** from the sidebar (desktop) or the **Menu** tab (mobile bottom bar: Home · Reports · Menu · Account).
- This opens **Incident Reports** (`/reports/incidents`): the new-report form, followed by **Your recent reports** (your own submissions from the last 30 days).
- The Incidents menu item only appears if your facility has the module turned on (admins control this on the Modules page) and you have permission.

**Admins (to review and configure):**

- Open the **Admin Center**, and under **Module Admin** choose **Incident Reports Admin** (`/admin/incident-reports`).
- The admin page opens on the **History** tab, with tabs across the top for **History · Incident Types · Severity Levels · Activities**.

---

## 4. Setup & configuration (admins)

Configuration lives in the **Incident Reports Admin** screen (`/admin/incident-reports`). Original submitted reports are **immutable** — admins never edit a staffer's report in place; they change its **status** and add **follow-up notes** (see §5).

The header carries two shortcuts: **Manage locations** (jumps to the shared Facility Spaces list) and an **Export** button for this module.

### Severity Levels tab

Severity levels rank how serious an incident was (e.g. Critical, High, Medium, Low). This is the **required** picker on the staff form — a facility must have at least one active severity or staff see "Not configured yet."

- **Add severity** opens a side panel with: **Key** (lowercase letters, digits, underscores — e.g. `high`, `very_high`; must be unique in your facility), **Display name** (what staff see), **Color**, and **Sort order**.
- Each row can be **Edit**ed, **Deactivate**d / **Reactivate**d, or **Delete**d. Deactivating hides it from the staff picker while keeping it on past reports.
- **Delete is blocked** if any reports already use that severity — you'll be told "Cannot delete; in use by N reports. Deactivate instead."
- If no severities exist yet, a **Seed defaults** card offers the four standard levels: **Critical, High, Medium, Low**. Seeding is safe to run more than once (it skips duplicates).

### Activities tab

Activities describe what was going on when the incident happened ("Activity at the time" on the staff form) — e.g. Public Skating, Hockey, Figure Skating. This picker is **optional** for staff, and staff can always choose **"Other…"** and type a free-text activity instead.

- **Add / Edit / Deactivate / Reactivate / Delete** work the same way as severities (Key + Display name + Color + Sort order). Delete is blocked when an activity is in use; deactivate instead.
- **Seed default activities** offers Public Skating, Hockey, Figure Skating, Learn to Skate, and Maintenance.
- A **bulk import** card accepts a simple CSV (`display_name, key, color, sort_order`, one per line). Duplicate keys are skipped, not overwritten.

### Incident Types tab

Incident Types categorize reports (e.g. Slip / Fall, Equipment, Altercation).

- **Add incident type** captures **Name**, **Slug** (auto-derived from the name if left blank), **Color**, and **Sort order**, with the same Edit / Deactivate / Reactivate / Delete controls. Delete is blocked when a type is in use.
- ⚠ VERIFY — **Type is shown and filtered on in the admin History view, but the current staff submission form does not present an incident-type picker.** Type appears as a column/filter and on the report detail; it is not collected from staff in the live form. Confirm whether your facility expects staff to pick a type before training on it as a staff field.

### Facility Spaces (the "where" list) — lives elsewhere

The **Facility space** picker on the staff form is **not** configured inside this module. It is fed by the shared **Facility Spaces** list in the Admin Center (**Setup → Facility Spaces**, `/admin/spaces`), which is the same list used by Accident and Air Quality. Use the **Manage locations** button on the Incident Reports Admin header to jump straight there. Add, rename, reorder, or deactivate spaces there and they appear (or disappear) in the staff picker automatically. Staff can always add an **"Other"** free-text space when the right location isn't listed.

> **Cross-reference — Admin Control Center.** Module visibility (whether Incidents shows in staff navigation at all) is set on the **Modules** page; who can file or administer is set under **Permissions / Roles**; the location list is **Facility Spaces**. See the Admin Control Center chapter for those shared screens.

---

## 5. Screen-by-screen walkthrough

### A. The staff incident form (`/reports/incidents`)

The page opens with an "Incident Reports" header, then the form, then **Your recent reports** below. The form is grouped into cards:

**Card 1 — When & where**

- **When did it happen?** (required) — a date-and-time picker, pre-filled with the current date/time. Adjust it to when the incident actually occurred.
- **Facility space** (required) — a dropdown you can **multi-select**; pick one or more spaces. If there are many spaces a **search box** appears. At the bottom is an **Other** option — tick it and a free-text box appears to **describe the space**. You must pick at least one space *or* fill in an "Other" space.

**Card 2 — What happened**

- **Description** (required) — a free-text box, up to **500 characters** (a live counter shows how many you've used). Describe what happened in detail.
- **Activity at the time** (optional) — a dropdown of admin-defined activities, plus **"Other…"** which reveals a free-text box.
- **Severity** (required) — a dropdown of admin-defined severity levels.
- **Immediate actions taken** (optional) — a free-text box for what was done right after.
- **Was an ambulance called?** — a Yes/No toggle (defaults to No). Turning it on raises a higher-priority alert to the facility (see §8).
- **Number of people involved** (optional) — a numeric field; accepts a whole number (0 or more) only.
- **Follow-up required** — a Yes/No toggle (defaults to No).

**Card 3 — Witnesses (optional)**

- Add up to **3 witnesses**. Use **Add a witness** / **Add another witness**; each row has **Name**, **Phone**, **Email**, and a **Brief statement**, and a **Remove** button. A counter shows `n/3`.
- Rule per witness: if you start a witness you must give a **name** and **at least one contact** (phone or email). Empty witness rows are simply ignored.

**Reporter identity is automatic.** The form does **not** ask for your name or phone — RinkReports fills the reporter from your login so it can't be spoofed.

**Submit & the "Are you sure?" dialog.** The submit button reads **Submit incident report**. Tapping it first checks the required fields, then opens a confirmation dialog: **"Submit this incident report?"** with the reminder that *you can edit it for 24 hours, after which it becomes read-only.* Choose **Confirm & submit** to file it, or **Go back** to keep editing.

### B. The "Reported" confirmation screen (`…/done`)

After submitting you land on a confirmation screen with a green check and "Reported — Thank you, [your name]. Your report has been submitted." It shows a summary (Status, Severity, when it happened, when submitted, and any "Other space"), a note that *"You can edit this report for 24 hours,"* and three buttons: **Edit report**, **Submit another**, **Back to home**.

### C. Your recent reports list

Below the form, **Your recent reports (Last 30 days)** lists your own submissions. Each entry shows the time submitted, a colored **severity** pill, a **status** badge (Submitted / In review / Resolved / Archived), any "Other" location, and a short excerpt of the description. Click **Incident** on a row to open that report.

### D. The single-report view / 24-hour edit (`/reports/incidents/[id]`)

Opening one of your reports does one of two things:

- **Within 24 hours, and it's yours:** the **Edit Incident Report** form opens, pre-filled with everything you entered, with an "Editable until [date/time]" note. Make changes and **Save changes**; a confirmation dialog ("Save changes to this report?") reminds you the change is recorded in the report's history. After saving you see a "Changes saved" banner and can keep editing until the window closes.
- **After 24 hours, or if it isn't yours:** a **read-only** view of the report. If it's yours, it says *"The 24-hour edit window for this report has closed, so it's now read-only."* A **Back to incident reports** button returns you to the list.

### E. Admin: Incident Reports Admin (`/admin/incident-reports`)

**History tab** — a filterable table of every incident at your facility (most recent first). Columns: Submitted, Reporter, Type, Severity, Location, Status, and a **View** link. Filters let you narrow by **status, type, severity, employee, location, and a date range (from/to)**. Click **View** to open the detail panel.

**Report detail panel** — opens from History → View. It shows:

- The **Original report** (read-only, never editable here): Type, Severity, Activity (or the "(other)" text), Occurred-at, Reporter name & phone, **Ambulance called** (highlighted when Yes), People involved, Follow-up required, Facility spaces (including any "other"), Description, and Immediate actions.
- **Witnesses** — each name with phone/email and statement.
- **Status** — a **Change status** dropdown (Submitted → In review → Resolved → Archived) and a timeline of when each status was reached (Submitted / Reviewed / Resolved / Archived).
- **Follow-up notes** — an append-only thread. Type into **Add follow-up note** and **Add note**. Notes show author and time and **cannot be edited or deleted** once added.
- **Change log** — an append-only audit trail of edits (create/update) with who and when. Visible to admins only.

**Incident Types · Severity Levels · Activities tabs** — the configuration lists described in §4.

---

## 6. Step-by-step: common tasks

**File an incident report (staff)**
1. Sidebar/Menu → **Incidents**.
2. Set **When did it happen?**
3. Open **Facility space** and tick one or more spaces (or tick **Other** and describe it).
4. Write the **Description** (required, up to 500 characters).
5. Optionally pick **Activity** (or "Other…"), set **Severity** (required), add **Immediate actions**, toggle **Ambulance called** and **Follow-up required**, and enter **people involved**.
6. Optionally add up to **3 witnesses** (each needs a name + phone or email).
7. Tap **Submit incident report**, then **Confirm & submit** in the dialog.
8. You land on the **Reported** screen.

**Edit an incident within 24 hours (reporter)**
1. From the **Reported** screen tap **Edit report**, or open the report from **Your recent reports**.
2. If you're inside the window, the edit form opens pre-filled. Change anything (spaces, severity, witnesses, etc.).
3. Tap **Save changes** → **Save changes** in the confirmation dialog.
4. You'll see "Changes saved" and can keep editing until the window closes. After 24 hours the report locks to read-only.

**Change an incident's status (admin)**
1. Admin Center → **Incident Reports Admin** → **History**.
2. **View** the report.
3. In the **Status** section, pick a new value (Submitted / In review / Resolved / Archived). It saves immediately and stamps the matching timestamp.

**Add a follow-up note (admin)**
1. Open the report detail (History → View).
2. Scroll to **Follow-up notes**, type your note in **Add follow-up note**, and click **Add note**.
3. The note is permanent — it can't be edited or deleted.

**Add a new severity (admin)**
1. Admin Center → **Incident Reports Admin** → **Severity Levels**.
2. Click **Add severity**.
3. Enter a **Key** (e.g. `high`), a **Display name** (e.g. High), a **Color**, and a **Sort order**.
4. **Create severity.** It appears in the staff Severity dropdown right away. (To get four standard levels at once, use **Seed defaults** when the list is empty.)

**Add an activity (admin)** — same flow on the **Activities** tab (**Add activity**), or use **Seed default activities** / the **CSV bulk import**.

---

## 7. Field reference

| Field | Where | Required? | Notes |
|---|---|---|---|
| When did it happen? | Staff form | **Yes** | Date & time picker; defaults to now. |
| Facility space | Staff form | **Yes** | Multi-select from Facility Spaces; or tick **Other** + free text. At least one space or an "Other." |
| Other space | Staff form | Conditional | Free text; required if **Other** is ticked. |
| Description | Staff form | **Yes** | Free text, max **500 characters** (live counter). |
| Activity at the time | Staff form | No | Admin-defined list, plus **"Other…"** free text. |
| Severity | Staff form | **Yes** | Admin-defined list; facility must have at least one. |
| Immediate actions taken | Staff form | No | Free text. |
| Was an ambulance called? | Staff form | No (defaults No) | Yes raises a critical, acknowledgement-requiring alert to the facility. |
| Number of people involved | Staff form | No | Whole number, 0 or more. |
| Follow-up required | Staff form | No (defaults No) | Yes/No toggle. |
| Witnesses (up to 3) | Staff form | No | Each: Name + (Phone or Email) required; Statement optional. |
| Reporter name / phone | (Automatic) | — | Filled from your login; not asked on the form, not editable. |
| Status | Admin detail | — | Submitted / In review / Resolved / Archived; admin-set. |
| Follow-up notes | Admin detail | — | Append-only; can't be edited or deleted. |
| Incident Type | Admin History/detail | — | Admin-configurable category; ⚠ VERIFY whether staff pick it (not in the live staff form). |
| Severity / Activity — Key | Admin config | **Yes** | Lowercase letters, digits, underscores; unique per facility. |
| Display name | Admin config | **Yes** | What staff see in the dropdown. |
| Color / Sort order | Admin config | No | Color swatch and ordering in the list. |

---

## 8. Locking, saving & offline

**Submitted status.** A new report is saved with status **Submitted**. Admins later move it through **In review → Resolved → Archived** as they handle it.

**The 24-hour edit window (confirmed).** When a report is created, RinkReports stamps an edit-window end time of **submission + 24 hours**. While the current time is at or before that mark, **the reporter (and only the reporter) can edit their own report** — change details, spaces, severity, witnesses, etc. Every change is written to the report's change log. **Once 24 hours pass, the report locks**: the reporter sees a read-only view ("The 24-hour edit window for this report has closed"), and any attempt to save is rejected ("The edit window for this report has closed."). After that, only admins act on the report — and even they **never edit the original**; they change **status** and add **follow-up notes** instead. The original report and its follow-up notes/change log are immutable.

**Ambulance alerts.** Filing a report with **Ambulance called = Yes** raises a high-priority, acknowledgement-requiring alert so it surfaces above routine notifications. This is best-effort and never blocks your submission.

**Offline.** RinkReports is a PWA, so you can file an incident with no connection. When you're offline:

- The submit button changes to **Save offline** and a banner notes *"This report will be saved on your device and submitted automatically when you reconnect."*
- After confirming, you see **"Saved on this device"** with a **Submit another report** button. The report is queued locally and submitted automatically once you're back online — re-running the same checks as an online submission, with no duplicates.
- **Editing an existing report is online-only.** The offline queue handles *new* incident reports; the 24-hour edit/update path runs against the live record and isn't queued.

---

## 9. Troubleshooting & FAQ

**"You don't have permission to submit incident reports."** Your account lacks the **submit** permission for this module. Ask an admin to enable it (Permissions / Roles).

**"Account not ready" / "Your account isn't fully set up yet."** Your login isn't linked to an active employee record. Contact your administrator.

**"Not configured yet" — no severities.** A facility needs at least one active **Severity Level** before staff can file. An admin should add one (or **Seed defaults**) on the Severity Levels tab.

**I can't find the right location in the Facility space list.** Tick **Other** in the dropdown and type the space. Admins can add it permanently in **Facility Spaces** (Admin Center → Setup → Facility Spaces).

**The activity I need isn't listed.** Choose **"Other…"** and type it in. Admins can add activities on the Activities tab.

**I need to fix my report but the edit form won't open.** The **24-hour window has closed** — the report is now read-only. Ask a manager/admin to add a **follow-up note** with the correction; the original can't be changed.

**Can I attach a photo?** No. This module has no photo or file upload — describe the incident in the Description and Immediate-actions fields.

**Why can't I edit someone else's report?** You can only edit your **own** report, and only within its 24-hour window. Others' reports are read-only to you.

**My note/status change disappeared from the dropdown.** Follow-up notes are append-only and permanent (they can't be edited or deleted). A status change saves immediately and stamps its timestamp; if it didn't apply you'll get an on-screen error.

**I submitted while offline — did it go through?** It's saved on your device and will submit automatically when you reconnect. You'll find it in **Your recent reports** once it syncs.

---

## Source (footnote)

*Staff flow:* `src/app/reports/incidents/page.tsx`, `src/app/reports/incidents/_components/submission-form.tsx`, `src/app/reports/incidents/[id]/page.tsx`, `src/app/reports/incidents/done/page.tsx`, `src/app/reports/incidents/actions.ts`, `src/app/reports/incidents/_lib/compute.ts`, `src/app/reports/incidents/_lib/submit.ts`, `src/app/reports/incidents/types.ts`.
*Admin flow:* `src/app/admin/incident-reports/page.tsx`, `src/app/admin/incident-reports/actions.ts`, `src/app/admin/incident-reports/types.ts`, and `_components/` (`history-tab.tsx`, `history-filters.tsx`, `report-detail.tsx`, `types-tab.tsx`, `severities-tab.tsx`, `severity-form.tsx`, `activities-tab.tsx`, `activity-form.tsx`, `type-form.tsx`, `seed-defaults-card.tsx`, `status-badge.tsx`).
*Schema / 24-hour window:* `supabase/migrations/00000000000103_incident_reports_redesign_columns.sql` (`edit_window_ends_at … default (now() + interval '24 hours')`), `…104_incident_report_children.sql`, `…102_incident_activities.sql`, `…105_facility_spaces_incident_admin_write.sql`.
