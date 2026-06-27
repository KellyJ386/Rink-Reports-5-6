# Refrigeration Logs

*RinkReports training guide — Refrigeration Logs module*

---

## 1. What this module is for

The **Refrigeration Logs** module is where staff record the readings for your rink's refrigeration plant — compressors, pumps, condensers, brine/supply-return temperatures, machine hours, alarms, and anything else your facility has set up to track. Each time someone walks the plant and takes a "round" of readings, they open this form, enter the numbers, and submit.

The module does three things for you:

- **Captures readings** for each piece of equipment in a structured, repeatable way, so every round looks the same and nothing gets skipped.
- **Checks each reading against a normal range** as it's entered, and shows a "Normal: min – max" hint right under the field so staff know immediately whether a value looks right.
- **Flags out-of-range readings** and — for the most serious ("critical") ones — requires the person to write down what corrective action they took before they can submit. If your facility has turned on out-of-range alerts, managers also get notified.

Every submitted report is a permanent record. You don't edit a past report — you submit a new round. Admins can review every submission and add follow-up notes, but the original reading is never changed.

> **You only see data for your own facility — this is automatic.** There's no facility switcher, and you can't see another rink's refrigeration logs.

---

## 2. Who can use it

Access is **permission-driven**, not strictly tied to a job title. The table below shows the typical default for each tier, but an admin can grant or remove any of these on a per-person basis. The four actions that matter are **View**, **Submit** (file a reading), **Edit**, and **Admin** (configure the module).

| Tier | Submit a reading | Review history / add follow-up notes | Configure (Setup & Settings) |
|---|---|---|---|
| **super_admin** | Yes | Yes | Yes |
| **org_admin** ⚠ VERIFY | *No exact equivalent in the live app — treat as super_admin.* | — | — |
| **facility_manager** (the `admin` role) | Yes | Yes | Yes |
| **supervisor** (the `manager` role, or a custom role) ⚠ VERIFY | Typically yes (needs the `submit` permission) | Only if granted the `admin` action | Only if granted the `admin` action |
| **staff** | Yes (needs the `submit` permission) | No access to the admin History/Setup screens | No access |

Notes that hold true in code:

- To open and submit the staff form, you need the **`submit`** permission for the refrigeration module **and** an active employee account assigned to your facility. Without it, you see a "No permission" message.
- The whole **Refrigeration Admin** area (Setup / History / Settings) requires **admin-level access** (the global super-admin flag, or the `admin` permission for your facility). Non-admins are shown a "Forbidden" message rather than the screens.
- A **deactivated** account is denied everywhere — it can't sign in, submit, or view.

> ⚠ VERIFY — the rows for *supervisor* and the org_admin tier are mapped to the live `super_admin / admin / manager / staff` model from the manifest. Because access is per-person and per-action, confirm against your configured facility before treating any of these as a hard rule.

---

## 3. How to get there

**Staff (submitting a reading):**

- In the left sidebar (or the mobile **Menu** tab), choose **Refrigeration**. The address is `/reports/refrigeration`.
- If the module is turned off for your facility, or you lack the submit permission, the menu item won't be there (or you'll get a "Not available" message).

**Admins (configuring or reviewing):**

- Open the **Admin Center** (the "Admin Center" link appears in the staff sidebar for admins), then choose **Refrigeration Admin** under **Module Admin**. The address is `/admin/refrigeration`.
- The admin screen opens on the **Setup** tab by default, with **History** and **Settings** tabs alongside it.

---

## 4. Setup & configuration (admins)

All refrigeration configuration lives on the **Refrigeration Admin** page (`/admin/refrigeration`), split across three tabs: **Setup**, **History**, and **Settings**. Changes here change what staff see on the reading form. For the broader admin picture — modules on/off, permissions, exports, retention — see the **Admin Control Center** chapter.

### Getting started fast: Seed defaults

If your facility has **no sections yet**, the Setup tab shows a **"No sections yet"** card with a **Seed defaults** button. Clicking it creates six standard sections — **Compressors, Pumps, Condensers, Supply / Return, Machine Hours, Alarms** — plus a default settings row. You can then rename, add to, or delete any of them. You can also skip seeding and build everything by hand with **Add section**.

### Sections

A **section** is a card on the staff form (for example, "Compressors" or "Brine"). On the Setup tab, sections are listed down the left; each entry shows its name and a count of "*N* equipment, *N* fields." Pick one to manage it.

For each section you can:

- **Add section** — name (required) and an optional slug (auto-generated from the name).
- **Rename** — change name, slug, and sort order (controls the order cards appear in).
- **Deactivate / Activate** — a deactivated section is hidden from the staff form but kept for history.
- **Delete** — removes the section. This is blocked if equipment, fields, or reports still reference it; the app suggests deactivating instead.

### Equipment

Within a section, **Equipment** is the list of individual units — e.g. "Compressor 1," "Compressor 2." The count of compressors (or any equipment) is entirely admin-configurable: add as many as your plant has. Each piece of equipment gets its own labeled group of fields on the staff form.

For each section you can **Add equipment** (name, optional slug) and, per item, **Edit** (name, slug, sort order), **Deactivate / Activate**, or **Delete**.

### Fields

**Fields** are the actual reading inputs. A field can be **section-level** (not tied to a specific unit) or attached to a **specific piece of equipment**. For each field you set:

- **Label** — what staff see (e.g. "Suction pressure").
- **Key** — an internal identifier (auto-generated from the label if left blank).
- **Type** — one of:
  - **numeric** — a number entry; the only type that supports thresholds and the "Normal:" range hint.
  - **text** — free text.
  - **boolean** — a yes/no checkbox.
  - **select** — a dropdown; you supply the options, one per line as `key|Label`.
  - **computed** — a read-only value calculated automatically on submit from other numeric fields in the same section. Staff see "Calculated automatically on submit" and never type into it.
- **Unit** — e.g. `psi`, `°F`. (Temperature units drive the °F/°C toggle behavior — see §5.)
- **Sort order** — reorder fields with the ↑ / ↓ buttons on each row.

Each field can be **Deactivated / Activated** or **Deleted**, and fields are also marked required where configured (a required field shows a red mark to staff and blocks submit if empty).

### Thresholds (normal ranges)

A **threshold** defines the normal range for a numeric field and how serious it is to fall outside it. Open a numeric field's **Thresholds** panel (the "Thresholds" button on the field row) to add one. Each threshold has:

- **Min** and/or **Max** — the normal range. You can set just one side. This is exactly what staff see as the **"Normal: min – max"** hint.
- **Severity** — **warn**, **high**, or **critical**.
- **Scope** — for a section-level field, you can scope a threshold to **All equipment** or to one specific unit. An equipment-specific threshold wins over a section-wide one for that unit.

Severity matters at submit time:

- A reading outside **any** active threshold is flagged **out-of-range** and counted on the confirmation screen and in History.
- A reading outside a **critical** threshold additionally **forces the staff member to write a corrective-action note** before they can submit (see §5).

Thresholds can be **Edited**, **Deactivated / Activated**, or **Deleted**.

### Settings (the Settings tab)

There is one settings row per facility, controlling alerting and the per-shift cap:

- **Enable out-of-range alerts** — a checkbox. When on, submitting a report with any out-of-range reading raises an alert to managers (a banner reminds staff: *"Out-of-range readings will trigger an alert to managers."*).
- **Default alert severity** — **warn / high / critical** — used when a triggered threshold doesn't carry its own severity.
- **Readings per shift** — a number from **1 to 99**, or **blank for unlimited**. This is the expected number of reading rounds per shift. When set, it (a) caps the Round number staff can enter and (b) shows staff the "of N" indicator and a "This facility logs *N* readings per shift" hint. The server rejects a round number above this cap.

Click **Save settings** to apply.

---

## 5. Screen-by-screen walkthrough

### 5.1 Staff reading form (`/reports/refrigeration`)

**Header.** At the top: a "Reports › Refrigeration" breadcrumb, the page title **Refrigeration**, and two buttons — **Back** (returns to the previous page) and **Dashboard** (jumps to your dashboard).

**Meta-chip strip.** A row of small chips just below the header, each with an icon: **your name**, **facility name**, **today's date**, the **live time** (it ticks each second), and the current **outdoor temperature** for your facility (e.g. "72°F · *location*"). If weather isn't available it reads "Temp unavailable."

**Offline banner.** If you're offline, a small note appears: *"You're offline. Your report will be saved on this device and submitted automatically when you reconnect."* (See §8.)

**Alerts banner.** If your facility has out-of-range alerts turned on, a note reminds you that out-of-range readings will alert managers.

**Log Information card.** This card holds the round's basics and the unit toggle:

- **°F / °C toggle** — a switch in the card header. It changes only how temperatures are **displayed**; values are always stored canonically in **°F**. Flipping it converts any temperature values you've already typed, once, to the new display unit. Non-temperature fields (like `psi`) are unaffected.
- **Facility** and **Employee** — shown read-only.
- **Reading time** — a date-and-time picker, pre-filled with now. Adjust it if you're logging a round you took earlier.
- **Shift (optional)** — free text, e.g. "AM / PM / Overnight."
- **Round # (optional)** — the round number for this shift. If your facility set a readings-per-shift cap, the label reads **"Round # (optional) — of *N*"** and a hint below says how many readings the facility logs per shift. Entering a round above the cap is rejected on submit.

**Section cards.** One card per active section, in the order admins set. Within a card:

- **Section-level fields** appear first in a responsive grid.
- Each **piece of equipment** gets its own sub-heading (e.g. "Compressor 1") with its fields grouped beneath it.

**Field types as they appear:**

- **numeric** — a number box (decimal keypad on mobile) with the unit shown beside it and appended to the label, e.g. "Suction pressure (psi)." Temperature fields show "(°F)" or "(°C)" matching the toggle.
- **text** — a single-line text box.
- **boolean** — a checkbox with the field label.
- **select** — a dropdown of the admin-defined options.
- **computed** — a greyed, read-only box reading "Calculated automatically on submit."

**Normal-range hints.** Under each numeric field that has a threshold, a muted line reads **"Normal: min – max unit"** (or "≥ min" / "≤ max" if only one bound is set). When you flip the °F/°C toggle, temperature ranges convert to match.

**Corrective-action box.** If a numeric value breaches a **critical** threshold, a highlighted **Corrective action** box appears under that field with a "(required)" mark. You must describe the action taken; submit is blocked until you do. (Warn/high out-of-range readings are still flagged, but don't force a note.)

**Notes.** A general **Notes (optional)** card near the bottom for any overall comments about the round.

**Submit.** A full-width button at the bottom:

- Online: **"Submit refrigeration report."**
- Offline: **"Save on this device."**
- While saving: **"Submitting…"**

If you try to submit with a missing required field, an unparseable number, or a missing critical corrective-action note, the form highlights the problem and jumps you to the first one.

**Your recent submissions.** Below the form, if you've submitted in the last 30 days, a read-only list shows each report's time, a "*N* values" badge, and an "*N* out-of-range" badge where applicable.

### 5.2 Confirmation screen (`/reports/refrigeration/done`)

After a successful online submit you land on a **"Submitted!"** screen with a green checkmark, the submission timestamp, a "*N* values recorded" chip, and — if any reading was out of range — an "*N* out-of-range" chip. Two buttons: **Submit another** and **Back to home**.

(When you submit **offline**, you instead see an inline **"Saved on this device"** confirmation with a **Back to dashboard** button — the report syncs later.)

### 5.3 Admin — Setup tab

Covered in detail in §4. Left column: the section list (with equipment/field counts and an "off" badge for inactive sections) plus an **Add section** card. Right column: the selected section's **Equipment**, **Section-level fields**, per-equipment field groups, and inline **Thresholds** panels — each with Add / Edit / Deactivate / Delete controls.

### 5.4 Admin — History tab

A filterable, read-only table of submitted reports. Filters include **employee**, a **date range** (defaults to the last 14 days), an **out-of-range** filter (yes/no), and a **notes search**. Columns: **Submitted**, **Submitter**, **Values**, **OOR** (out-of-range count badge), **Notes** (excerpt), and a **View** link. **Load more** appears when there are additional rows. There's also an **Export** button in the page header.

Clicking **View** opens the **report detail**: who submitted it and when, the reading-taken time / shift / round, the submitter's notes, then **Recorded values** grouped by equipment (each value shown with its unit and an **Out of range** / **OK** status), and a **Follow-up notes** section. Admins can **Add follow-up note** here — notes are append-only and the original report is immutable (you cannot edit a submitted reading).

### 5.5 Admin — Settings tab

The single settings form described in §4: out-of-range alerts on/off, default alert severity, and readings-per-shift.

---

## 6. Step-by-step: common tasks

### Log a refrigeration reading (staff)

1. Open **Refrigeration** from the menu.
2. In **Log Information**, confirm or adjust the **Reading time**; optionally type the **Shift** and **Round #**.
3. (Optional) Flip the **°F / °C** toggle to your preferred temperature display.
4. Work down each section card, filling in the fields for every piece of equipment. Watch the **"Normal: …"** hints.
5. If a reading turns **critically** out of range, fill in the **Corrective action** box that appears.
6. Add any overall comments in **Notes**.
7. Tap **Submit refrigeration report** (or **Save on this device** if offline).
8. On the **Submitted!** screen, choose **Submit another** or **Back to home**.

### Add a compressor (or any equipment) / add a section (admin)

1. Go to **Admin Center › Refrigeration Admin › Setup**.
2. To add a unit: pick the section (e.g. "Compressors"), then in **Equipment** use **Add equipment** — type the name (e.g. "Compressor 3") and **Add equipment**.
3. To add a whole new section: use **Add section** in the left column.
4. Add the **fields** each new section/equipment needs (see next task).

### Add a reading field

1. On **Setup**, select the section.
2. In the **Section-level fields** block (or a specific equipment's "Fields for …" block), use **Add field**.
3. Enter the **Label**, choose the **Type** (numeric / text / boolean / select / computed), set the **Unit** if any, and — for **select** — list options as `key|Label`, one per line.
4. **Add field.** Reorder with ↑ / ↓ as needed.

### Set a normal range / threshold

1. On **Setup**, find the **numeric** field and click **Thresholds**.
2. In **Add threshold**, set **Min** and/or **Max**, pick the **Severity** (warn / high / **critical**), and (for a section-level field) choose the **Scope** — All equipment or one unit.
3. **Add threshold.** Staff will now see "Normal: min – max" under that field, and critical breaches will demand a corrective-action note.

### Set readings per shift

1. Go to **Refrigeration Admin › Settings**.
2. In **Readings per shift**, enter a number from **1–99** (or leave blank for unlimited).
3. **Save settings.** Staff now see "Round # — of *N*" and can't submit a higher round number.

### Turn on out-of-range alerts (admin)

1. Go to **Settings**, check **Enable out-of-range alerts**, and pick a **Default alert severity**.
2. **Save settings.** Submissions with out-of-range readings now raise a manager alert that requires acknowledgement.

### Review a report and add a follow-up note (admin)

1. Go to **History**, filter as needed, and click **View** on a report.
2. Read the recorded values and any corrective-action notes.
3. In **Add follow-up note**, type your note and **Add note**. The original report stays unchanged.

---

## 7. Field reference

**Round / log fields (staff form, Log Information card):**

| Field | Type | Required | Notes |
|---|---|---|---|
| Reading time | Date & time | No (defaults to now) | When the round was taken. |
| Shift | Text | No | Free text, e.g. AM / PM / Overnight. |
| Round # | Whole number | No | Capped at the facility's readings-per-shift value; shows "of N" when set. |
| Notes | Long text | No | General comments about the round. |
| Corrective action | Long text | **Yes, when a value breaches a *critical* threshold** | Appears inline under the offending numeric field. |

**Reading fields** are entirely admin-defined per facility, so there is no fixed list. Each follows its configured type:

| Field type | What staff enter | Normal/expected range shown? |
|---|---|---|
| numeric | A number, in the field's unit | **Yes** — "Normal: min – max unit," from the field's threshold(s) |
| text | Free text | No |
| boolean | A yes/no checkbox | No |
| select | One option from a dropdown | No |
| computed | *(nothing — read-only, calculated on submit)* | Shows a range only if a threshold is set on the computed value |

**Default seeded sections** (if an admin clicks *Seed defaults*): Compressors, Pumps, Condensers, Supply / Return, Machine Hours, Alarms. Specific equipment and fields within them are configured per facility.

> The exact reading labels, units, and normal ranges at your rink depend on how your administrator configured Setup and Thresholds. Use the on-screen "Normal: …" hints as the source of truth for what's expected.

---

## 8. Locking, saving & offline

**Append-only.** A submitted refrigeration report is a permanent record. There is **no edit** of a past report — you submit a **new** round instead. Admins don't change submitted values either; they **add follow-up notes**, which are themselves append-only. The detail screen states plainly: *"The original report is immutable."*

**Saving online.** Tapping **Submit refrigeration report** files the report, records every value (with out-of-range flags), saves any corrective-action notes against the exact readings they address, optionally raises a manager alert, and takes you to the **Submitted!** screen.

**Offline ("Save on this device").** RinkReports is a progressive web app, so the form works without a connection:

- When you're offline the Submit button reads **"Save on this device,"** and an on-screen note explains the report is queued locally.
- After saving offline you see a **"Saved on this device"** confirmation. The report is held on your device and **submits automatically when you reconnect**, re-running the same checks (required fields, critical notes, and the readings-per-shift cap) on the server.
- A pending/failed indicator and the offline-queue page let you see anything still waiting to sync.
- Because each queued report carries a unique id, a retry can't create a duplicate.

Don't close the tab with unsaved readings still on screen — the app warns you before a refresh or close would discard them (until the report has been queued or submitted).

---

## 9. Troubleshooting & FAQ

**"No permission" when I open Refrigeration.**
You don't have the **submit** permission for this module. Ask an admin to enable it for you in the Permissions area.

**"Account not set up."**
Your sign-in isn't linked to an active employee record at a facility. Contact your administrator.

**"Not configured yet" / "Refrigeration reporting isn't configured yet."**
No active sections or fields exist for your facility. An admin needs to seed defaults or build sections, equipment, and fields on the Setup tab.

**The Refrigeration menu item is missing.**
Either the module is switched off for your facility (admins control this on the Modules page) or you lack the view/submit permission.

**It won't let me submit — a corrective-action box is red.**
A numeric reading is **critically** out of range. Fill in the **Corrective action** box for that field, then submit.

**My round number was rejected.**
It exceeded the facility's **readings-per-shift** cap. Use a number within "of N," or ask an admin to raise the cap on the Settings tab.

**I flipped to °C and my entered numbers changed.**
That's expected — the toggle converts displayed temperatures. Values are stored in °F regardless; only the display changes.

**I made a mistake on a submitted report.**
You can't edit it. Submit a corrected new round. For the record, an admin can add a follow-up note explaining the correction.

**Do out-of-range readings always alert managers?**
Only if an admin has enabled **out-of-range alerts** on the Settings tab. When enabled, an alert is raised (requiring acknowledgement) summarizing the out-of-range readings.

**Can I see another rink's logs?**
No. You only see data for your own facility — this is automatic.

---

## Source

Staff flow: `src/app/reports/refrigeration/page.tsx`, `src/app/reports/refrigeration/_components/submission-form.tsx`, `src/app/reports/refrigeration/done/page.tsx`, `src/app/reports/refrigeration/actions.ts`, `src/app/reports/refrigeration/_lib/compute.ts`, `src/app/reports/refrigeration/_lib/submit.ts`. Admin flow: `src/app/admin/refrigeration/page.tsx`, `src/app/admin/refrigeration/types.ts`, `src/app/admin/refrigeration/_components/setup-tab.tsx`, `.../settings-tab.tsx`, `.../history-tab.tsx`, `.../report-detail.tsx`, `.../seed-defaults-card.tsx`. Role/permission context: `docs/training/00-MANIFEST.md`.
