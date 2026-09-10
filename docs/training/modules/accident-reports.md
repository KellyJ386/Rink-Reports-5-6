# Accident Reports

> **Product:** RinkReports — the Next.js progressive web app (PWA) for ice-rink operations.
> **Brand colors:** #4DFF00 (primary green) · #002244 (navy).
> **Data scoping:** *You only see data for your own facility — this is automatic.* You never switch facilities or see another rink's accidents; RinkReports keeps each facility's records separate on its own.

---

## 1. What this module is for

Accident Reports is how staff document an injury — a guest or employee who got hurt on the ice or in the building. A report captures **who was hurt** and how to reach them, **when and where** it happened, **what happened**, how **severe** it was, what kind of **injury** and **which body parts** were affected (on an interactive body diagram), whether **medical attention** was needed, any **witnesses**, and whether it's a **Workers' Compensation** claim.

Accident Reports is the close sibling of **Incident Reporting** (see that chapter) — same submitter/admin shape, same 24-hour self-edit window, same append-only follow-up notes and change log. The differences worth knowing up front:

- **There's an interactive body diagram.** Staff mark exactly which body parts were hurt — front, back, or both — on a two-view (front/back) figure, independently for the left and right side of paired regions. Incident Reporting has nothing like it.
- **A dedicated Workers' Comp tab.** Admins write one block of instructions text that appears to staff the moment they flag a report as a workers'-comp claim, with a required "I have read and understand" acknowledgement.
- **One dropdown value can raise a Communications alert.** Admins can mark a Medical Attention value (e.g. Emergency Room) as "Triggers communication alert" — selecting it on a submission fires a facility-wide alert into the Communications module (see §8).
- **No status lifecycle.** Unlike Incident Reporting's Submitted → In review → Resolved → Archived pipeline, an accident report has no status field at all. Admins track follow-up entirely through **follow-up notes** and the **change log** — there's no status to change. If you came from the Incident Reporting chapter expecting a status dropdown here, there isn't one; that's intentional, not an oversight.

---

## 2. Who can use it

Access is **permission-driven**, not strictly tier-driven: an administrator can turn each person's **submit** and **admin** access on or off per person, per facility, independent of their role label.

| Role tier (doc vocabulary) | Typical access to Accident Reports |
|---|---|
| **super_admin** | Full: file reports, edit own within 24h, and full admin (History, Dropdowns, Workers' Comp, follow-up notes). |
| **org_admin** | ⚠ VERIFY — the live app has **no separate org_admin tier**. Treat as super_admin. |
| **facility_manager** (live role: `admin`) | Full admin for their own facility: review every report in History, add follow-up notes, and configure Dropdowns / Workers' Comp instructions. Can also file reports. |
| **supervisor** (live role: `manager` or a custom role) | ⚠ VERIFY — typically can **file** reports and **edit their own** within 24h. Admin review/config only if granted the module-scoped `admin` action for Accident Reports. |
| **staff** (live role: `staff` or a custom role) | **File** accident reports and **edit their own** within the 24-hour window. **No access** to the admin console (History/Dropdowns/Workers' Comp). Can only ever see their **own** submitted reports — the database's row-level security scopes a non-admin's read access to `employee_id = you`, so there's no staff-facing way to browse coworkers' reports even by guessing a URL. |

Notes confirmed in code:

- To open the staff accident page, you need the **submit** permission for Accident Reports (`accident_reports` / `submit`). Without it you see "No access — You don't have permission to submit accident reports."
- The admin console requires **both** general Admin Center access (`requireAdmin`) **and** the module-scoped `accident_reports` / `admin` grant (`requireModuleAdmin`). An admin with console access but not this specific grant is blocked at every action with: *"Your account has admin console access but not the accident reports module's admin permission. Ask an administrator to grant it under Admin → Permissions."*
- A **deactivated** employee account cannot file, view, or edit anything.
- Filing requires an active `employees` row linked to your login; if your account isn't linked yet you'll see "Account not ready — Your account isn't fully set up yet. Contact your administrator."

---

## 3. How to get there

**Staff (to file or view your own reports):**

- Open the staff app and choose **Accidents** from the sidebar (desktop) or the **Menu** tab (mobile bottom bar: Home · Reports · Menu · Account).
- This opens **Accident Reports** at **`/reports/accidents`** — note the URL says "accidents," not "accident-reports." The new-report form comes first, followed by **Your recent submissions** (your own filings from the last 30 days).
- The Accidents menu item only appears if your facility has the module turned on and you have the **submit** permission.

**Admins (to review and configure):**

- Open the **Admin Center**, and under **Module Admin** choose **Accident Reports Admin** at **`/admin/accident-reports`** — here the folder is "accident-reports," unlike the staff route above.
- The admin page opens on the **History** tab, with tabs across the top for **History · Dropdowns · Workers' Comp**.

---

## 4. Setup & configuration (admins)

Configuration lives in the **Accident Reports Admin** screen (`/admin/accident-reports`). Original submitted reports are **immutable** — admins never edit a staffer's report in place; they can only add **follow-up notes** (see §5). The header carries two shortcuts: **Manage locations** (jumps to the shared Facility Spaces list) and an **Export** button for this module.

### Dropdowns tab

Five configurable vocabularies drive the staff form, confirmed directly from `DROPDOWN_CATEGORIES` in `types.ts`:

| Category | Shown to staff as | Required on staff form? |
|---|---|---|
| **Injury Type** | "Primary injury type" | No |
| **Body Part** | (feeds the body diagram, not a dropdown) | Yes — facility must have at least one active value |
| **Activity** | "Activity at time of accident" | No |
| **Medical Attention** | "Medical attention" | Yes — facility must have at least one active value |
| **Severity** | "Severity" (pill buttons) | Yes — facility must have at least one active value |

**Location is deliberately not one of the five.** As of migration 142, accident locations come from the shared **Facility Spaces** list (`/admin/spaces`) — the same list Incident Reporting and Air Quality use — not from `accident_dropdowns`. Use the **Manage locations** header button to jump there.

Each value has a **Key** (lowercase letters, digits, underscores; unique within its category per facility), **Display name**, **Color**, and **Sort order**, plus **Edit / Deactivate / Reactivate / Delete** controls (the same pattern as Incident Reporting's Severity/Activity/Type tabs). Deactivating hides a value from the staff picker while keeping it on past reports. **Delete is blocked** if a value is already in use — for Body Part specifically the error reads "Cannot delete; in use on **existing reports**. Deactivate instead," and for every other category it's the generic "in use by existing reports" wording.

**The "Triggers communication alert" checkbox — Medical Attention only.** When editing or creating a **Medical Attention** value, the form shows an extra checkbox: **"Triggers communication alert."** Its description in the app reads: *"When the staff selects this medical-attention level, fire a comms alert (e.g. ER, Hospitalization). Stored as `metadata.triggers_alert`."* This is a real, working wire, not just a label:

- The flag is stored as `{"triggers_alert": true}` in that dropdown row's `metadata` JSON column.
- When a staff member submits (or edits) a report and picks a Medical Attention value with this flag set, the submission form shows an inline warning right under the dropdown: *"Selecting this option will alert managers."*
- On successful submission, the server looks up the chosen Medical Attention row's metadata and, if `triggers_alert` is true, inserts a row directly into the shared **`communication_alerts`** table — the same table the Communications module reads from — with `source_module = "accident_reports"`, `requires_acknowledgement = true`, title **"Accident report requires medical attention follow-up,"** and a body summarizing who was hurt and why (truncated description). Its `severity` is mapped from the report's chosen accident-severity **key**: `critical`→critical, `high`→high, `medium`→warn, `low`→info (defaulting to `high` if severity wasn't set). This is best-effort: if the alert insert fails, the accident report itself is still saved.
- Separately (and always, regardless of the checkbox), every accident submission also runs the facility's general notification **dispatch rules** with the subject "Accident report submitted" — that's the same fan-out every module's submissions go through, distinct from the medical-attention alert above.

The seed defaults mark **Medical Office Visit, Emergency Room,** and **Hospitalization** as triggering an alert out of the box (**None** and **First Aid** do not).

**Seed defaults.** If a facility has zero dropdown rows in *any* category, a **Seed defaults** card appears and seeds **all five categories at once** in one click (not one category at a time): the canonical Body Part set (19 keys — two legacy ones, `Arms` and `Head/Neck`, seed **inactive** since new submissions use the split `Upper Arms`/`Lower Arms` and `Head`/`Face-Jaw`/`Neck` regions instead), four Severity levels (Low/Medium/High/Critical, each with a default color), five Medical Attention values, ten Injury Types, and eight Activities. Seeding is idempotent (safe to re-run; it skips duplicates on `(facility_id, category, key)`).

**Bulk import.** Each category tab has a **Bulk upload values** CSV import (columns: Category, Key, Display Name, Color, Active, Triggers Alert). `Triggers Alert` is accepted for any row but silently forced to `false` unless the row's category is `medical_attention`.

### Workers' Comp tab

This is **not** a workflow — it's a single admin-editable block of instructions text (a `Textarea`, up to a page or so, newlines preserved) shown to staff at the moment they toggle **"Workers' comp claim?"** on the submission (or edit) form. There's no approval step, no separate claim record, and no routing: it's purely informational copy an admin writes once (e.g. "Call HR at ext. 204 and complete form WC-1 within 24 hours"), with a "Last updated [date]" stamp. Staff must tick a required **"I have read and understand the workers' comp instructions above"** checkbox before they can submit a workers'-comp-flagged report; ticking it stamps `workers_comp_acknowledged_at` on the report.

### Facility Spaces (the "where" list) — lives elsewhere

Same as Incident Reporting: the **Location** picker on the staff form is fed by the shared **Facility Spaces** list (Admin Center → Setup → Facility Spaces, `/admin/spaces`), reached via the **Manage locations** button on this module's header. It is optional on the staff form.

> **Cross-reference — Admin Control Center.** Module visibility is set on the **Modules** page; who can file or administer is set under **Permissions / Roles**; the location list is **Facility Spaces**. See the Admin Control Center chapter for those shared screens.

---

## 5. Screen-by-screen walkthrough

### A. The staff accident form (`/reports/accidents`)

The page opens with an "Accident Reports" header, then the form (five numbered section cards), then **Your recent submissions** below.

**1 · Person involved**

- **Injured person's name** (required), **Contact — phone or email** (required, one free-text field, not split), **Age** (required, whole number 0–120).

**2 · What happened**

- **Severity** (required) — rendered as a row of colored pill buttons (`SeverityRadioPill`), not a dropdown; the admin-defined Severity list. Because this pill group isn't a native form control, the browser's required-field check can't catch a missing pick — the app enforces it in JavaScript right before the confirmation dialog opens ("Please select a severity before submitting").
- **Primary injury type** (optional) — admin-defined Injury Type dropdown.
- **Medical attention** (optional, but the facility must have at least one configured value or the form won't load) — admin-defined dropdown; shows the "Selecting this option will alert managers" notice when the chosen value has `triggers_alert` set (see §4).
- **Body parts affected** — the interactive body diagram (see below). Not required; you can submit with none selected.
- **What happened?** (required) — a free-text description, no character cap enforced in the UI (unlike Incident Reporting's 500-character limit).

**3 · Where & when**

- **When did it happen?** (required) — a date-and-time picker defaulting to the current moment.
- **Location** (optional) — a dropdown of active Facility Spaces.
- **Activity at time of accident** (optional) — admin-defined Activity dropdown.

**4 · Witnesses (optional, up to 5)**

- **Add witness** / each row has **Name**, **Phone or email (optional)**, and a **statement** textarea, plus **Remove**. Unlike Incident Reporting, only the **name** is required per witness here — contact and statement are both optional.

**5 · Workers' comp**

- A **"Workers' comp claim?"** checkbox. Turning it on reveals the admin-configured **instructions** block (read-only) and a required **"I have read and understand…"** acknowledgement checkbox. The submit button is disabled until that box is checked.

**The interactive body diagram.** Two SVG figures render side by side — a **Front View** and a **Back View** — built from simple shapes per region (head, torso, limbs, hands, feet, etc.). Tapping any region cycles it through a simple state machine per the view you're tapping in: **none → this view → both → the other view → none.** So tapping a leg on the Front View the first time marks it "front only"; tap it again on the Back View and it becomes "both"; tap either view a third time and it clears. **Paired regions** — shoulders, upper/lower arms, elbows, wrists, hands, fingers, upper/lower legs, knees, ankles, feet — are independently selectable per **left vs. right** side, so marking the right knee never touches the left. **Midline regions** — head, face/jaw, neck, torso, hips — have a single front/back/both state with no left/right split (face/jaw is front-only; back and both are disabled for it). A **"Selected body parts"** panel beneath the diagram lists every current pick with a colored Front/Back/Both badge and a **Remove** button, plus a **Clear all** link. An **"Add by list (accessible alternative)"** collapsible panel offers the same picks as explicit front/back/both/none buttons per region, for anyone who can't or doesn't want to tap the SVG. Two legacy body-part keys (a combined "Arms" and a combined "Head/Neck") exist only to keep historical pre-migration reports rendering correctly and are never offered on new submissions.

**Submit & the "Are you sure?" dialog.** The button reads **Submit report** (or **Save offline** — see §8). Tapping it validates the form, then opens: **"Submit this accident report?"** — *"Accident reports can only be edited within 24 hours of submission. Make sure all details are accurate before confirming."* — **Confirm & submit** or **Go back**.

### B. After submitting (`/reports/accidents/[id]?submitted=1`)

You land on the single-report page with a green "Submitted. Thank you. You can review or edit this report below." banner, followed immediately by either the editable form or the read-only view (see below) for that same report.

### C. Your recent submissions

Below the form on the main accidents page, **Your recent submissions · last 30 days** lists your own filings — a severity dot, the injured person's name, a severity pill, the medical-attention value (if any), and the submission time. Clicking a row opens that report at `/reports/accidents/[id]`.

### D. The single-report view / 24-hour edit (`/reports/accidents/[id]`)

- **Within 24 hours, and it's yours:** the **edit form** opens, pre-filled with everything you entered (including the body diagram and witnesses), inside a warning banner reading **"Editable for N more hour(s)."** Change anything and **Save changes**; every change is written to the report's change log.
- **After 24 hours (or someone else's report — which RLS won't even let a non-admin fetch):** a **read-only view** renders instead, showing every field, the body diagram (non-interactive), and witnesses. If the window has closed on your own report it adds: *"The 24-hour edit window has closed. Contact a manager if you need to change this report."*

### E. Admin: Accident Reports Admin (`/admin/accident-reports`)

**History tab** — a filterable table of every accident at your facility (most recent first, up to 200 shown with a **Load more** link). Columns: Submitted, Injured person, Severity, Medical, Location, Activity, W/C (workers' comp), Body parts (count), and a **View** link. Filters: date range (defaults to the last 30 days), employee (reporter), severity, body part, location, activity, medical attention, and workers'-comp yes/no.

**Report detail panel** — opens from History → View. It shows:

- The **Original report** (read-only, never editable here): injured person, contact, age, occurred-at, submitted-at, severity, primary injury type, location, activity, medical attention, workers'-comp status and acknowledgement time, and the full description.
- The **body diagram**, rendered read-only from the report's saved selections.
- **Witnesses** — name, contact, statement.
- **Follow-up notes** — an append-only thread (**Add follow-up note** → **Add note**); notes show author and time and cannot be edited or deleted once added.
- **Change log** — an append-only audit trail (create/update) with an expandable before/after JSON diff. Visible to admins only.

There is **no status field or status control anywhere on this screen** — that's the sharpest contrast with Incident Reporting's History/detail view.

**Dropdowns · Workers' Comp tabs** — the configuration screens described in §4.

---

## 6. Step-by-step: common tasks

**File an accident report (staff)**
1. Sidebar/Menu → **Accidents**.
2. Fill in the injured person's **name**, **contact**, and **age**.
3. Pick a **Severity** pill (required), optionally an **injury type** and **medical attention**, mark any injured **body parts** on the diagram, and describe **what happened**.
4. Set **when it happened**, and optionally a **location** and **activity**.
5. Optionally add up to **5 witnesses** (name required; contact/statement optional).
6. If this is a workers'-comp claim, toggle it on, read the instructions, and check the acknowledgement box.
7. Tap **Submit report**, then **Confirm & submit** in the dialog.

**Edit an accident report within 24 hours (reporter)**
1. Open the report from **Your recent submissions**.
2. If you're inside the window, the edit form opens pre-filled — change any field, including body-diagram selections and witnesses.
3. Tap **Save changes**. The change is written to the report's change log; you can keep editing until the window closes.

**Add a follow-up note (admin)**
1. Admin Center → **Accident Reports Admin** → **History** → **View** on the report.
2. Scroll to **Follow-up notes**, type the note, and click **Add note**.
3. The note is permanent — it can't be edited or deleted, and there's no status to change alongside it.

**Add a new dropdown value (admin)**
1. Admin Center → **Accident Reports Admin** → **Dropdowns**.
2. Pick the category tab (Injury Type / Body Part / Activity / Medical Attention / Severity) and click **Add [category] value**.
3. Enter a **Key**, **Display name**, **Color**, and **Sort order**. For Medical Attention, optionally check **"Triggers communication alert."**
4. **Create value.** It's live on the staff form immediately. (Use **Seed defaults** to populate all five categories at once instead.)

**Write or update the Workers' Comp instructions (admin)**
1. Admin Center → **Accident Reports Admin** → **Workers' Comp**.
2. Edit the instructions textarea and **Save**. Staff see the new text the next time they toggle a workers'-comp claim on.

---

## 7. Field reference

| Field | Where | Required? | Notes |
|---|---|---|---|
| Injured person's name | Staff form | **Yes** | Free text. |
| Contact (phone or email) | Staff form | **Yes** | Single free-text field, not split by type. |
| Age | Staff form | **Yes** | Whole number, 0–120. |
| Severity | Staff form | **Yes** | Pill-button picker; admin-defined; client-enforced (not a native required field). |
| Primary injury type | Staff form | No | Admin-defined dropdown. |
| Medical attention | Staff form | No (list itself must be non-empty) | Admin-defined dropdown; a value can carry `triggers_alert`. |
| Body parts affected | Staff form | No | Interactive front/back diagram; paired regions track left/right independently. |
| What happened? (Description) | Staff form | **Yes** | Free text, no enforced character cap. |
| When did it happen? | Staff form | **Yes** | Date & time picker; defaults to now. |
| Location | Staff form | No | From the shared Facility Spaces list. |
| Activity at time of accident | Staff form | No | Admin-defined dropdown. |
| Witnesses (up to 5) | Staff form | No | Each: Name required; Phone/email and statement optional. |
| Workers' comp claim? | Staff form | No (defaults off) | Reveals instructions + a required acknowledgement checkbox when on. |
| Reporter identity | (Automatic) | — | Filled from your login; not asked on the form. |
| Follow-up notes | Admin detail | — | Append-only; can't be edited or deleted. |
| Status | — | — | **Does not exist** for this module (contrast with Incident Reporting). |
| Dropdown — Key | Admin config | **Yes** | Lowercase letters, digits, underscores; unique per category per facility. |
| Dropdown — Display name | Admin config | **Yes** | What staff see. |
| Dropdown — Color / Sort order | Admin config | No | Swatch and list ordering. |
| Dropdown — Triggers communication alert | Admin config | No | Medical Attention category only; ignored elsewhere. |
| Workers' Comp instructions | Admin config | No | Free text shown to staff on a workers'-comp-flagged submission. |

---

## 8. Locking, saving & offline

**The 24-hour edit window (confirmed, same mechanism as Incident Reporting).** Every accident report is stamped with `edit_window_ends_at = submitted_at + 24 hours` at creation. While `now() <= edit_window_ends_at`, **the reporter (and only the reporter) can edit their own report** — every field, the body diagram, and witnesses. Each save writes a before/after snapshot to the report's change log. **Once the 24 hours pass, the report locks**: even the reporter now sees the read-only view, and the update database policy itself refuses the write ("The edit window for this report has closed."). After that, admins can still add **follow-up notes**, but the original report and its history are immutable at the database level, not just hidden in the UI — there's no admin override that reopens editing (see the RLS excerpt in `00000000000010_accident_reports_schema.sql`: `UPDATE: super_admin OR module admin OR (own row AND now() <= edit_window_ends_at)` — note that even a module admin cannot update someone else's original report after the fact, only add notes).

**No status lifecycle.** As covered in §1/§5, this module has no equivalent of Incident Reporting's Submitted → In review → Resolved → Archived states. "Handling" an accident report administratively means adding follow-up notes; there is nothing to mark resolved.

**Medical-attention alerts.** Submitting (or editing into) a Medical Attention value flagged **"Triggers communication alert"** inserts a high-priority, acknowledgement-requiring row into the shared `communication_alerts` table for the Communications module to surface — see §4 for exactly how the severity mapping and messaging work. This is best-effort and never blocks your submission. Separately, every accident submission (regardless of medical attention) also runs the facility's general notification dispatch rules.

**Offline.** RinkReports is a PWA, so you can file an accident report with no connection:

- The submit button changes to **Save offline**, and the sticky bar footnote reads "offline — will sync when reconnected."
- After confirming, you see **"Saved on this device"** — the report (including the body-diagram JSON and witnesses) is queued locally via the service worker's sync queue (`moduleKey: "accident_reports"`) and submitted automatically once you reconnect, running through the exact same persistence pipeline — including the medical-attention alert check — as an online submission. The replay is idempotent (a local-id claim token prevents duplicate rows if retried).
- **Editing an existing report is online-only.** The offline queue handles *new* accident reports only; the 24-hour edit path runs against the live record and isn't queued. ⚠ VERIFY — this parallels Incident Reporting's documented behavior; the accidents edit-form component itself doesn't call the offline queue, so this reads as intentional rather than confirmed by an explicit code comment the way the submission path is.

---

## 9. Troubleshooting & FAQ

**"You don't have permission to submit accident reports."** Your account lacks the **submit** permission for this module. Ask an admin to enable it (Permissions / Roles).

**"Account not ready" / "Your account isn't fully set up yet."** Your login isn't linked to an active employee record. Contact your administrator.

**"Not configured yet" — accident reporting isn't set up.** Your facility needs at least one active value in **Severity**, **Medical Attention**, and **Body Part** before staff can file. An admin should add values (or use **Seed defaults**) on the Dropdowns tab.

**I can't find the right location.** The **Location** field is optional — leave it blank, or ask an admin to add the space under **Facility Spaces** (Admin Center → Setup → Facility Spaces).

**Why did my submission trigger a notice about alerting managers?** The Medical Attention value you picked (typically Emergency Room, Hospitalization, or a Medical Office Visit) is configured by an admin to raise a Communications alert. This is expected — it gets the right people looking at a serious injury faster.

**I need to fix my report but the edit form won't open.** The **24-hour window has closed** — the report is now permanently read-only, even to admins. Ask a manager/admin to add a **follow-up note** with the correction.

**Can I mark a report as "Resolved"?** No — this module has no status field. Follow-up notes are how admins record what happened next.

**Why is the Workers' Comp checkbox grayed out until I check a box?** Turning on "Workers' comp claim?" requires you to also check "I have read and understand the workers' comp instructions above" before the form will submit — this is a required acknowledgement, not a bug.

**Why can't I edit someone else's report?** You can only edit (or even open) your **own** report, and only within its 24-hour window — the database itself won't return another employee's accident report to a non-admin account.

**I submitted while offline — did it go through?** It's saved on your device and will submit automatically when you reconnect, including any medical-attention alert. You'll find it in **Your recent submissions** once it syncs.

---

## Source (footnote)

*Staff flow:* `src/app/reports/accidents/page.tsx`, `src/app/reports/accidents/actions.ts`, `src/app/reports/accidents/types.ts`, `src/app/reports/accidents/_components/submission-form.tsx`, `src/app/reports/accidents/[id]/page.tsx`, `src/app/reports/accidents/[id]/_components/edit-form.tsx`, `src/app/reports/accidents/[id]/_components/read-only-view.tsx`, `src/app/reports/accidents/_lib/compute.ts`, `src/app/reports/accidents/_lib/compute.test.ts`, `src/app/reports/accidents/_lib/submit.ts`, `src/app/reports/accidents/_lib/offline.ts`, `src/app/reports/accidents/_lib/dropdowns.ts`.
*Body diagram:* `src/components/staff/body-diagram/body-diagram.tsx`, `src/components/staff/body-diagram/types.ts`, `src/components/staff/body-diagram/lazy.tsx`.
*Admin flow:* `src/app/admin/accident-reports/page.tsx`, `src/app/admin/accident-reports/actions.ts`, `src/app/admin/accident-reports/types.ts`, and `_components/` (`history-tab.tsx`, `history-filters.tsx`, `report-detail.tsx`, `dropdowns-tab.tsx`, `dropdown-form.tsx`, `dropdowns-import.ts`, `workers-comp-tab.tsx`, `seed-defaults-card.tsx`).
*Schema / 24-hour window / alerts:* `supabase/migrations/00000000000010_accident_reports_schema.sql` (`edit_window_ends_at … default (now() + interval '24 hours')`, RLS policies), `00000000000051_accident_witnesses_and_age.sql`, `00000000000142_accidents_use_facility_spaces.sql` (location moved to `facility_spaces`), `00000000000009_communications_schema.sql` (`communication_alerts` shared table).
*Navigation:* `src/components/app/sidebar-nav.tsx` (staff "Accidents" nav entry, `moduleKey: "accident_reports"`).
