# Air Quality

> Part of the **RinkReports** training package. RinkReports is a progressive web app (PWA) for ice-rink operations. Brand colors: **#4DFF00** (primary green) and **#002244** (navy).
>
> **You only see data for your own facility — this is automatic.** You never switch facilities or see another rink's air-quality readings; the app keeps each facility's records separate on its own.

---

## 1. What this module is for

The Air Quality module records the air-quality readings staff take around the rink — typically carbon monoxide (CO), nitrogen dioxide (NO₂), and carbon dioxide (CO₂), measured in parts per million (ppm) — and checks each reading against your facility's compliance thresholds the moment you type it.

What makes Air Quality different from a plain log:

- It is **threshold-aware and live.** As you enter a number, the form shows a colored badge — **Within range**, **Corrective action**, **Notification**, or **Evacuation** — based on the regulatory profile your administrator selected.
- It tracks a **regulatory jurisdiction.** The thresholds, the sampling cadence ("how often must we test this week?"), and the escalation instructions all come from a compliance profile, so the form reflects the rules your facility is actually held to.
- A reading that crosses a threshold is flagged as an **exceedance**, recorded on the report, and (if your facility has alerts turned on) raises an alert for managers.
- It is **append-only.** Once you submit, the report is a permanent record — you can't edit it, you submit a new reading instead. Admins add follow-up notes rather than changing the original.

Temperature is one of several reading types defined in the database (alongside CO, NO₂, etc.), each carrying its own unit and decimal precision. Because the readings list is metadata-driven, there is **no single global °F/°C toggle** here — each reading type simply shows the unit your administrator configured for it.

## 2. Who can use it

Access is **permission-driven**: what you can do depends on the per-module permissions an admin has set for you, not strictly on your job title. Two people with the same title can have different access if an admin customized it. The table below shows the typical default mapping.

| Role tier | Typical Air Quality access |
|---|---|
| **super_admin** | Full access to everything, across the platform. ⚠ VERIFY — there is no separate "org_admin"; treat as super_admin. |
| **org_admin** | **No access** as a distinct tier — the live app has no org_admin role. ⚠ VERIFY. |
| **facility_manager** *(the `admin` role)* | Full module admin: Setup, Compliance, History, Settings, follow-up notes, exports. Requires the `air_quality` **admin** permission (or the super-admin flag). |
| **supervisor** *(the `manager` role, or a custom role)* | Submit and view readings; configure only if granted the `admin` permission. ⚠ VERIFY — exact rights depend on the permission matrix, not a fixed tier. |
| **staff** *(or a custom role)* | Submit air-quality readings (needs the `air_quality` **submit** permission). No access to the admin Setup/Compliance/History/Settings screens. |

Notes that hold true in the code regardless of title:

- To open the staff reading form at all, you need the **submit** permission for `air_quality`. If you don't have it, the page shows "No permission."
- If your account isn't linked to an active employee record, the page shows "Account not set up."
- If the facility hasn't configured any locations yet, the page shows "Not configured yet — talk to your administrator."
- The whole admin area (`/admin/air-quality`) requires facility-manager-level admin access; staff who browse to it are shown a "Forbidden" message.

## 3. How to get there

**Staff (submitting a reading):**

- In the left sidebar (or the mobile **Menu** tab), choose **Air Quality**. This opens the reading form at `/reports/air-quality`.
- The menu item only appears if your facility has the Air Quality module switched on and you have permission to use it.

**Admins (configuring the module):**

- Open the **Admin Center** (the extra link in the staff sidebar, visible to admins), then under **Module Admin** choose **Air Quality Admin** (`/admin/air-quality`).
- The admin screen has four tabs across the top: **Setup**, **Compliance**, **History**, **Settings**.

## 4. Setup & configuration (admins)

All configuration lives in the **Air Quality Admin** screen and is a facility-manager task. See the **Admin Control Center** chapter for cross-cutting setup (Facility Spaces, Modules on/off, Permissions, Exports).

### First-time setup: Seed defaults

If nothing has been configured yet, the Setup tab shows a **Seed defaults** card. Clicking **Seed defaults** creates the standard ice-rink reading types — **CO, NO₂, and CO₂** — so you have a working form in one click. You can edit or add to them afterward.

### Setup tab — Equipment & Reading types

The Setup tab has two halves:

- **Locations** come from your shared **Facility Spaces** list (the same locations used by Incident and Accident reports). You don't create them here — you add, rename, or bulk-import them under **Facility Spaces** (`/admin/spaces`), and they appear here automatically. On this tab you click a location only to scope equipment to it.
- **Equipment** — monitors/sensors. You can add equipment that is **facility-wide** (not tied to a location) or **scoped to a specific location**. For each you can set a name, an optional slug, an optional model and serial number, and a sort order. Each item can be **Edited**, **Deactivated/Activated**, or **Deleted**. Equipment scoped to a location only appears as a choice on the reading form when that location is selected.
- **Reading types** — what staff actually measure (e.g. CO, NO₂, CO₂, temperature). For each reading type you set:
  - **Label** (e.g. "CO") and an optional **Key** (auto-generated from the label if blank).
  - **Unit** (e.g. ppm).
  - **Decimals** (0–6) — how many decimal places the input accepts.
  - **Required on reports** — whether staff must fill this reading in before they can submit.
  - **Sort order** — reading types can also be reordered with the ↑ / ↓ buttons.
  - Reading types can be **bulk-uploaded** and can be Edited / Deactivated / Deleted.
  - **Threshold tiers are *not* set here** — they come from the facility's compliance profile on the Compliance tab.

### Compliance tab — profile, metrics, thresholds, escalation, roles

This is where the form's "live feedback" gets its rules.

- **Compliance profile (jurisdiction).** Pick the regulatory profile for the facility from a dropdown. The reading form, the threshold tiers, the sampling cadence, and the escalation steps all derive from it. A badge shows whether it is **Binding regulation** or **Guidance**, and whether it uses the **Single-sample** or **1-hour TWA** measurement method.
- **Metrics tracked.** Check which of the profile's metrics (CO, NO₂, …) are active for your facility.
- **Threshold overrides — tighten only.** Each metric shows the profile's regulatory ceiling for each tier (**Corrective**, **Notification**, **Evacuation**). You may enter a stricter (lower) value to hold your facility to a tighter standard, or leave a field blank to use the regulatory ceiling. **You can tighten a threshold but you can never loosen it.** The screen states this plainly ("A value must be at or below the floor"), and the app **enforces it**: if you enter an override above the regulatory floor, the save is rejected with a message like "*…override is looser than the regulatory floor…; overrides may only tighten.*" Internally the engine also clamps any too-loose value back to the regulatory ceiling, so a looser number can never take effect even by accident.
- **Escalation steps.** For each tier you can type the contacts/actions operators should take (e.g. who to call at the Notification level). This text is shown in the reading form when a reading reaches that tier. Leave blank to use the built-in default guidance.
- **Role access.** Optional comma-separated role keys for "May submit readings" and "May view logs." This is **advisory only** — actual access is still governed by each user's module permissions, not by what you type here.
- **Save compliance profile** writes all of the above at once.

Below the profile panel, a **Compliance rules** section lists the facility's stored rules grouped by jurisdiction (these back the engine and any "sustained exceedance" evacuation criteria).

### Settings tab

One row of facility-wide settings:

- **Testing frequency** — free text guidance shown to staff on the reading form (e.g. "CO every 2 hours during sessions").
- **Default jurisdiction** — pre-fills the jurisdiction field when adding a compliance rule (offers existing jurisdictions as suggestions).
- **Enable air quality alerts** — master on/off switch for the alerts raised when a reading exceeds a threshold.
- **Default alert severity** — `warn`, `high`, or `critical`; used when a triggered threshold has no severity of its own.

### History tab (review)

A filterable, read-only list of submitted reports with a drill-down detail panel. Admins **cannot edit** a submitted report; they can **add follow-up notes**, which are themselves append-only ("Notes are append-only and cannot be edited or deleted. The original report stays intact"). Filters include date range, employee, location, equipment, reading type, and whether the report had an exceedance.

## 5. Screen-by-screen walkthrough

### Staff reading form (`/reports/air-quality`)

From top to bottom, what you see:

1. **Page header** — breadcrumb (Reports → Air Quality), the eyebrow "Air quality reading," the title, and a reminder that *after you submit, the report can't be edited.*
2. **Location** (required) — a dropdown of your facility's spaces. Pick where the readings were taken. You can't submit until you choose one. Changing the location clears any equipment choice that doesn't belong to the new location.
3. **Compliance context panel** (shown when a compliance profile is configured) — displays the profile's name, a **Binding** or **Guidance** badge, and a **1-hr TWA** or **Single sample** method badge, plus any guidance note. It also includes:
   - A **frequency tracker**: a badge reading **On schedule** or **Behind by N**, and a line like "*2 of 3 this week · weekend 0/1 (weekend sample needed)*" — telling you how many readings are still required this period.
   - A **Reading type** selector — **Routine**, **Post-resurfacing**, or **Post-edging**. (This labels *why* the reading was taken and drives the frequency tracking; it is distinct from the "Reading Kind" / corrective concept below.)
4. **Equipment** (optional) — appears when monitors are configured for the selected location (or facility-wide). Pick the monitor you used.
5. **Readings** — one input per active reading type, in the admin-defined order. Each shows its **label**, its **unit** beside the box, and a **required** marker (`*`) where applicable. The numeric keypad opens on mobile, and the input respects the configured decimal precision.
   - For any reading tied to a tracked metric, a small grey hint shows the tier ceilings (e.g. "*Corrective > 35 · Notification > 100 ppm*"), and once you type a number a **live range badge** appears: **Within range** (green), **Corrective action** (amber), **Notification** (red), or **Evacuation** (red). This is the threshold-aware feedback — it updates as you type.
6. **1-hour TWA calculator** (only when the profile uses the TWA method) — a collapsible helper to enter the required samples (e.g. 13 readings, one every 5 minutes); it averages them and fills the reading for you when you click **Use average**.
7. **Compliance banner + corrective-action note** — if any reading reaches Corrective level or higher, a colored banner appears with the escalation instructions for that level, **and a required "Corrective action taken" note box appears.** You cannot submit an over-threshold reading until you describe the corrective steps you took. (This is the "corrective reading kind" — an exceedance forces a corrective note.)
8. **Notes (optional)** — anything to flag for the manager.
9. **Monitoring log sections** (collapsible, optional) — supplementary record-keeping: **Equipment & tester info** (date of test, tester certification, CO/NO₂ monitor type/model/calibration date — with a warning if a calibration is over a year old, ventilation last-inspection date); **Section 1: General information & equipment status** (arena operating status, ice resurfacers and other fuel-burning equipment with fuel types, ventilation status, last-maintenance notes); **Section 2: Air quality measurements** (routine and post-edging measurement rows with location/time/CO/NO₂/temp/note); **Section 4: Additional recommendations & notes** (electric-equipment consideration, staff-trained and public-signage checkboxes, unusual observations).
10. **Submit** — the button reads "**Submit readings for [location]**" when online, or "**Save offline**" when offline. It stays disabled until a location is chosen, every required reading is filled, and any required corrective note is written; helper text below explains what's still missing.

### Confirmation screen (`/reports/air-quality/done`)

A green checkmark and **"Submitted!"**, the location name and timestamp, a chip showing how many **readings were recorded**, and — if anything crossed a threshold — a chip showing the **exceedance count and severity**. Buttons: **Submit another** and **Back to home**.

### Admin tabs (`/admin/air-quality`)

**Setup**, **Compliance**, **History**, **Settings** — covered in §4. The History detail panel shows the submitter's notes, each reading with its at-submit verdict, and an append-only follow-up-note thread; an **Export** action is available from the page header.

## 6. Step-by-step: common tasks

### Record an air-quality reading (staff)

1. Open **Air Quality** from the sidebar/menu.
2. Choose the **Location**.
3. If a compliance panel appears, glance at the **frequency tracker** to see whether more readings are due this period, and set the **Reading type** (Routine / Post-resurfacing / Post-edging).
4. Optionally pick the **Equipment** (monitor) you used.
5. Enter each reading. Watch the **live range badge** — green means within range.
6. If a badge turns amber or red, read the **escalation banner**, take the action it describes, then fill in the required **Corrective action taken** note.
7. Add optional **Notes** (and any monitoring-log details your facility wants).
8. Tap **Submit readings**. You land on the **Submitted!** screen showing the reading and exceedance counts.

### Tighten a threshold (admin)

1. Go to **Air Quality Admin → Compliance**.
2. Make sure the correct **jurisdiction profile** is selected.
3. Under **Threshold overrides (tighten only)**, find the metric and tier, and type a value **at or below** the shown regulatory ceiling. (Leaving it blank keeps the regulatory ceiling.)
4. Click **Save compliance profile**. If you accidentally enter a value *above* the floor, the save is rejected — you can only tighten.

### Add a reading type (admin)

1. Go to **Air Quality Admin → Setup**.
2. In the **Reading types** card, use the **Add reading type** form: enter a **Label**, optional **Key**, **Unit**, **Decimals**, and tick **Required on reports** if staff must always fill it.
3. Click **Add reading type**. Reorder with ↑ / ↓ if needed. (Bulk upload is available for many at once.)

### Set up compliance escalation (admin)

1. Go to **Air Quality Admin → Compliance**.
2. Select the **jurisdiction profile**.
3. Under **Escalation steps**, type the contacts and actions for each tier — **Corrective**, **Notification**, **Evacuation**. (Blank fields fall back to built-in default guidance.)
4. Click **Save compliance profile**. This text now appears in the staff reading form's banner whenever a reading reaches that tier.

## 7. Field reference

**Staff reading form**

| Field | Type | Required | Notes |
|---|---|---|---|
| Location | Dropdown (facility spaces) | Yes | Must be chosen before you can submit. |
| Reading type | Dropdown: Routine / Post-resurfacing / Post-edging | Shown with a compliance profile | Labels why the reading was taken; drives frequency tracking. |
| Equipment | Dropdown | No | Only monitors valid for the chosen location (or facility-wide). |
| Each reading (e.g. CO, NO₂, CO₂, Temp) | Numeric, decimal | Per its "Required" flag | Unit and decimal precision come from the reading type. Shows tier-ceiling hint + live range badge. |
| Live range badge | Computed | — | Within range / Corrective action / Notification / Evacuation, per the effective (override-tightened) thresholds. |
| 1-hour TWA calculator | Sample entry helper | No | Only for profiles using the TWA method; averages samples into the reading. |
| Corrective action taken | Text | **Yes, when any reading is over threshold** | You cannot submit an exceedance without it. |
| Notes | Text | No | For the manager. |
| Date of test / tester certification / monitor info / sections 1, 2, 4 | Mixed (collapsible) | No | Supplementary monitoring-log detail. |

**Thresholds shown (per metric, from the compliance profile):**

| Tier | Meaning on the form |
|---|---|
| Within range | Reading is at or below the corrective ceiling — green badge. |
| Corrective | Reading exceeds the corrective ceiling — amber badge; corrective note required. |
| Notification | Reading exceeds the notification ceiling — red badge; notify per escalation steps. |
| Evacuation | Reading exceeds the evacuation ceiling — red badge; follow evacuation protocol. |

Admins set each tier's ceiling per metric on the Compliance tab. The **effective** ceiling is the regulatory floor, optionally **tightened** (lowered) by a facility override — never raised.

## 8. Locking, saving & offline

- **Append-only.** A submitted air-quality report is permanent. You cannot edit it — submit a new reading instead. Admins don't edit submissions either; they add **follow-up notes**, which are themselves append-only.
- **Exceedances.** On submit, the server re-evaluates every reading against the facility's effective thresholds (the same engine the form previews with). Readings over threshold are flagged as **exceedances**, the report records the highest severity, and — if alerts are enabled in Settings — an alert is raised for managers. A required corrective-action note must accompany any exceedance. A separate "sustained exceedance" rule can raise a critical, evacuation-level alert when readings stay high over time.
- **Offline.** Air Quality works offline. If you're offline when you submit, the button reads **Save offline**, the readings are queued on your device, and you see a "Saved on this device" confirmation. When you reconnect, the queued reading submits automatically and the **same exceedance checks run then** — so an over-threshold reading is flagged on sync, not silently accepted. Each queued item has a unique id, so a retry can't create a duplicate. (See the **Offline** chapter for the queue and pending/failed indicators.)

## 9. Troubleshooting & FAQ

**The Air Quality menu item isn't showing.** Either your facility has the module switched off (an admin controls this on the Modules page) or you don't have the `air_quality` view/submit permission. Ask your administrator.

**I opened the form and it says "No permission" / "Account not set up" / "Not configured yet."** "No permission" = you lack the submit permission. "Account not set up" = your login isn't linked to an active employee record. "Not configured yet" = the facility has no locations yet (an admin adds them in Facility Spaces).

**The Submit button is greyed out.** You must choose a **Location**, fill in **every required reading**, and — if any reading is over threshold — write the **Corrective action taken** note. The helper text under the button tells you which one is missing.

**A reading turned red and now there's a note box I can't skip.** That reading exceeded a threshold. Take the action in the escalation banner, then describe what you did in the **Corrective action taken** box. This is required before an over-threshold reading can be saved.

**I can't raise a threshold above the regulatory number (admin).** That's by design — **thresholds can be tightened but never loosened.** Enter a value at or below the regulatory ceiling, or leave it blank to use that ceiling.

**Why is there no °F/°C switch?** Temperature is just one of several database-defined reading types, each with its own configured unit. There's no single global temperature toggle; the unit shown next to each reading is whatever the admin set for that reading type.

**Can I fix a reading I just submitted?** No — reports are append-only. Submit a corrected new reading; an admin can add a follow-up note to the original explaining the correction.

**Will my reading still get checked if I submit it offline?** Yes. It's queued on your device and re-evaluated against the thresholds when it syncs, so exceedances are still flagged.

---

## Source

Staff: `src/app/reports/air-quality/page.tsx`, `src/app/reports/air-quality/_components/submission-form.tsx`, `src/app/reports/air-quality/actions.ts`, `src/app/reports/air-quality/done/page.tsx`, `src/app/reports/air-quality/types.ts`, `src/app/reports/air-quality/_lib/{compliance.ts,submit.ts,compute.ts,load-compliance.ts,sustained.ts}`. Admin: `src/app/admin/air-quality/page.tsx`, `src/app/admin/air-quality/types.ts`, `src/app/admin/air-quality/actions.ts`, `src/app/admin/air-quality/_components/{setup-tab.tsx,compliance-tab.tsx,compliance-profile-panel.tsx,settings-tab.tsx,history-tab.tsx,report-detail.tsx,seed-defaults-card.tsx}`. Permission/auth: `src/lib/permissions/check.ts`, `src/lib/auth`. Threshold tighten-only enforcement: `validateOverrides` and `effectiveMetricTiers` in `_lib/compliance.ts`, called from `saveComplianceProfileConfig` in `src/app/admin/air-quality/actions.ts`.
