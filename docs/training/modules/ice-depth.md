# Ice Depth

## 1. What this module is for

Ice Depth is how RinkReports records **how thick the ice is** across a sheet — point by point, against a rink diagram, so you can see at a glance where the ice is at target, too thin, or too thick.

It is built for the way the job is actually done: you walk the rink with a depth gauge (manual or a Bluetooth caliper), tap each measurement point on a digital rink diagram, and enter the reading. Each point lights up in color the instant you enter a value — green when the depth is in range, red when it's below the minimum, amber when it's above target — so problem spots are obvious before you even finish.

This module measures **depth, not temperature.** There is no °F/°C toggle anywhere in it. Readings are recorded in the facility's chosen unit (inches or millimeters).

A few things this module deliberately does **not** do:
- **No photo documentation.** There is no camera, attachment, or image-upload step. The "documentation" is the annotated diagram and the per-point readings.
- It is a **two-phase flow** — first you *measure*, then you *review* and submit — not a single long form.

Once you submit, the session becomes a permanent, read-only record with a printable diagram, a PDF, and the option to send it to your facility's distribution list.

You only see data for your own facility — this is automatic.

## 2. Who can use it

Access is permission-driven, not strictly tied to a job title. The table below shows the typical default for each tier; an admin can grant or remove any of these per person.

| Tier | Submit a depth session | Review history / analytics | Configure rinks, diagrams, points, settings |
|---|---|---|---|
| **super_admin** | Yes | Yes | Yes (plus the only tier that can permanently delete a submitted session) |
| **org_admin** | ⚠ VERIFY — no separate org-admin tier exists in the app; treat as super_admin | ⚠ VERIFY | ⚠ VERIFY |
| **facility_manager** (`admin`) | Yes | Yes (Admin → Ice Depth) | Yes (Admin → Ice Depth) |
| **supervisor** (`manager` or custom role) | Yes, if granted the Ice Depth **submit** permission | Only if granted Ice Depth **admin** access | Only if granted Ice Depth **admin** access |
| **staff** | Yes, if granted the Ice Depth **submit** permission | No access | No access |

Notes:
- To **submit** a depth session you need the Ice Depth *submit* permission. Without it, the page shows a "No permission" message instead of the form.
- The whole **Admin → Ice Depth** area (Rinks, Diagrams, History, Analytics, Settings) requires facility-admin access for the Ice Depth module.
- **Deleting** a submitted session is restricted to super_admin — the Delete button only appears for them, and the server re-checks. Everyone else, sessions are immutable.
- A deactivated or not-yet-set-up account is denied everywhere, with an "Account not set up" message.

## 3. How to get there

**Staff (to submit a reading):**
- In the staff app, open **Ice Depth** from the left sidebar (or the **Menu** tab on mobile). The menu item only appears if your facility has the Ice Depth module turned on and you have access.
- Opening Ice Depth takes you straight to a rink diagram — the app automatically lands you on your facility's **default rink and its default diagram**. If your facility has more than one rink or diagram, a **Rink** and **Diagram** picker appears at the top so you can switch.

**Admins (to configure or review):**
- Open the **Admin Center** (the "Admin Center" link in the staff sidebar), then choose **Ice Depth Admin** under Module Admin. This opens the tabbed admin screen at `/admin/ice-depth`.

## 4. Setup & configuration (admins)

All Ice Depth setup lives under **Admin → Ice Depth**, which has five tabs: **Rinks, Diagrams, History, Analytics, Settings.** Everything here applies only to your own facility. See the **Admin Control Center** chapter for how admin access, modules, and permissions are managed.

If Ice Depth has never been set up, the Diagrams and Settings tabs show a **"Seed defaults"** card to create the initial settings/rink/diagram for you to start from.

### Rinks tab
A **rink** is a sheet of ice. Create one with **New rink** (name, optional slug, sort order). For each rink you can:
- **Rename**, change **sort order**.
- **Make default** — the rink staff land on first (only an active rink can be the default).
- **Deactivate / Activate** — hide a rink from staff without deleting it.
- **Delete** — only allowed once the rink has no diagrams; otherwise you're told to move or delete its diagrams first.

The **first rink you create automatically becomes the facility default.**

### Diagrams tab (the diagram + measurement points)
A **diagram** (called a "layout" internally) belongs to a rink and defines the rink picture plus where the measurement points sit. There is a cap of **8 active diagrams** per facility (shown as "X / 8 active").

- **New diagram** — choose its rink (required), a name, optional slug/description, and an **aspect ratio** (width ÷ height; default `0.425`, roughly a vertical NHL rink). You must create a rink first.
- Selecting a diagram opens the **point-placement editor**:
  - A **USA Hockey rink** drawing fills the panel. An optional **Logo URL** can be set per diagram (square PNG/SVG with transparent background) and renders at center ice.
  - A mode toolbar with three modes:
    - **Place** — click anywhere on the rink to drop a new numbered point.
    - **Select** — click a point to open its editor (set a **Label**, fine-tune **X/Y** position as 0–1 fractions, move up/down in order, **Deactivate/Activate**, or **Delete**).
    - **Drag** — drag a point to reposition it; release to save.
  - **Renumber 1..N** compacts the active points' numbers into order.
  - A cap of **60 active points** per diagram is enforced.
- Per diagram you can also **rename**, set **description / logo / aspect ratio / sort order**, **Make default** (the diagram staff land on for that rink), **Deactivate/Activate**, or **Delete** (deleting cascades the points; if sessions reference it, deactivate instead). Deleting a point keeps the snapshots on any existing measurements.

### Settings tab
One row per facility controls how depths are classified and displayed:
- **Measurement unit** — `inches` or `mm`. (⚠ VERIFY — the training brief said "in/cm," but the app's unit options are **inches** and **mm**, not centimeters.)
- **Low threshold** — at or below this value, a reading is flagged **low (below min)**.
- **High threshold** — above this value, a reading is flagged **high (above target)**.
- **Low / OK / High colors** — the color each severity shows in admin views (History detail, Analytics).
- **Enable alerts on submitted sessions**, **Alert on** (`low` / `high` / `any`), and **Default alert severity** — when on, a submitted session that contains the chosen severities can trigger a notification to your facility's configured recipients.

> Existing sessions **snapshot** the unit and thresholds at the moment they were submitted. Changing settings later does **not** reclassify old history.

## 5. Screen-by-screen walkthrough

### Layout (rink + diagram) picker
Opening Ice Depth redirects you onto the default rink's default diagram. If your facility has more than one rink or more than one diagram, a top bar shows a **Rink** dropdown and a **Diagram** dropdown. Switching either jumps you to that diagram's measure screen. A **sync chip** (online/offline indicator) sits in the header, and a back arrow returns to Ice Depth.

### Measure phase (the interactive rink)
This is the first of two phases. The screen shows:
- A point-progress line — **"Point X of Y"** while you're entering, or **"Y points — tap to enter"** before you start — and a **"X recorded"** counter, plus a green progress bar.
- A collapsible **"Using a Bluetooth caliper?"** helper (see §6).
- The **USA Hockey rink diagram** with a numbered **chip at every measurement point.**

To record a point:
1. **Tap a chip.** A small **popover** opens anchored to that point, showing the point number, its label, a number field (with the facility's unit beside it), and **Skip** / **Save & Next** buttons.
2. **Type the depth** (or let a Bluetooth caliper type it). The field only accepts digits and a single decimal point, up to 3 decimal places.
3. As you type, the popover border, the point chip, and a small label update **live by severity** — **Optimal** (green), **Below min** (red), or **Above target** (amber).
4. **Press Enter** (or Tab) to save and jump to the next point. On the last point the button reads **"Save & Review"** and takes you to the review screen. **Esc** closes the popover without advancing. **Skip** moves to the next point without recording this one.

You can revisit any point at any time by tapping its chip again — entering a new value overwrites the old one. When at least one point has a value, the big **"Review & Submit"** button at the bottom becomes active and jumps you to the review phase. (Nothing is saved to the server during the measure phase — it's all on your screen until you submit.)

### Review & Submit phase
"Step 3 of 3." This is your last chance to check the readings before they become a permanent record:
- A **summary card** with a small annotated rink thumbnail, the **average depth**, and **severity pills**: "N optimal," "N thick," "N below min," and "N skipped" as applicable.
- A **per-point list** — each point's number (colored by severity), its label, its status (Optimal / Below min / Above target / Not recorded), and the recorded value.
- A **Notes (optional)** box.
- A green **Submit** button. Its label reflects completeness — **"Submit Reading"** when every point is recorded, or **"Submit (X of Y recorded)"** otherwise. (When offline it reads **"Save Offline."**)
- A **"← Back to measure"** link to return and adjust before finalizing.

### Done / confirmation screen
After submitting you land on the confirmation screen for that session:
- A green checkmark and a **Submitted** badge, the diagram name, and the submitted timestamp.
- **Stat pills**: Optimal, Below min, Above target, and Total measurements.
- The **annotated rink diagram** with every measured point colored by severity, plus any submitter **Notes**.
- Action buttons:
  - **Download PDF** — downloads a PDF of the session report.
  - **Print Diagram** — opens the browser print dialog; print styling hides the app chrome so only the rink diagram (with name and timestamp) prints, full-page on US Letter portrait.
  - **Send Report** — emails/sends the report to your facility's Ice Depth recipients (see §6). Ice Depth does **not** auto-send on submit; sending stays under your control.
  - **Submit Another** — returns to Ice Depth to start a new session.
  - **Back to Dashboard**.
  - **Back to Form** (top) returns to the measure screen for that diagram.

### Admin tabs (Admin → Ice Depth)
- **Rinks** — manage sheets of ice (see §4).
- **Diagrams** — draw diagrams and place/label measurement points (see §4).
- **History** — a filterable list of submitted sessions (filter by diagram, employee, date range, and whether the session had low/high readings, with "Load more" paging). Click a session to open a **detail panel**: the annotated diagram at its snapshot severities, submitter info, unit and thresholds as snapshotted, low/high badges, submitter notes, and an **append-only follow-up notes** thread you can add to. Super admins also see a **Delete session** button (with a confirmation dialog).
- **Analytics** — per-diagram trends over a date range: summary stats (sessions, readings, average depth, % below min, % above target), a **"Problem spots"** heat-map of the rink colored by each point's most common condition, a **per-point breakdown** table (worst-first), and a **daily activity** strip.
- **Settings** — unit, thresholds, colors, alerting (see §4).

## 6. Step-by-step: common tasks

### Measure ice depth across the rink
1. Open **Ice Depth**. Pick the **Rink** and **Diagram** at the top if prompted.
2. **Tap the first point** on the rink diagram.
3. **Type the depth** and press **Enter** to save and advance to the next point. Use **Skip** to leave a point unrecorded.
4. Watch each chip color in: green = optimal, red = below min, amber = above target.
5. When done (or after recording at least one point), tap **Review & Submit**.
6. On the review screen, check the per-point list and average, add **Notes** if needed, then tap **Submit Reading**.

### Use a Bluetooth caliper
RinkReports doesn't pair the caliper for you — calipers in this class (e.g. iGaging Absolute Origin) connect at the OS level as a **Bluetooth keyboard.**
1. **Pair once** in your phone/tablet's Bluetooth settings: hold the caliper's **DATA** button until it appears (it shows up as a keyboard), then connect.
2. Set the caliper to the **same unit** as the form (shown in the in-app helper).
3. In the form, **tap a point** to open its popover, then press the caliper's **DATA** button — the reading fills in and the form jumps to the next point automatically. Keep pressing DATA to walk the whole rink hands-free.

Tip: the in-app **"Using a Bluetooth caliper?"** panel above the rink has these steps. The caliper's Enter (and Tab) terminator both save and advance, just like pressing Enter yourself.

### Create a rink layout (admin)
1. **Admin → Ice Depth → Rinks** → **New rink**. Name it and save. (The first rink becomes the default.)
2. Go to the **Diagrams** tab → **New diagram**, pick the rink, name it, set the aspect ratio, and create.
3. Open the new diagram. In **Place** mode, **click the rink** to drop each measurement point.
4. Switch to **Select** mode to **label** points and fine-tune positions; use **Drag** mode to nudge them. Use **Make default** so staff land on this diagram for that rink.
5. Confirm in **Settings** that the unit and low/high thresholds are right for this facility.

### Download, print, or send a report
On a session's **Done** screen (or reach a past session through Admin → History):
- **Download PDF** to save/share a PDF copy.
- **Print Diagram** to print the annotated rink (the app chrome is hidden automatically).
- **Send Report** to push it to the facility's configured Ice Depth recipients. If none are set up, you'll see "No recipients are configured for ice depth — set up a send list in Admin → Communications." The button confirms how many recipients it reached.

## 7. Field reference

| Field | Where | What it is |
|---|---|---|
| Rink | Layout picker | Which sheet of ice you're measuring (only if more than one exists). |
| Diagram | Layout picker | Which point layout to use for this rink (only if more than one exists). |
| Measurement point | Measure phase | A numbered, optionally labeled spot on the rink. Tap to enter its depth. |
| Depth value | Point popover | The reading, in the facility's unit (inches or mm). Digits + one decimal point, up to 3 decimals; must be zero or positive. |
| Notes (optional) | Review phase | Free text for anything worth flagging (conditions, equipment, resurface schedule). |
| Severity (auto) | Everywhere | Computed from the reading vs. thresholds: **Optimal** (in range), **Below min** (≤ low threshold), **Above target** (> high threshold). Not editable. |
| Average depth (auto) | Review / Done | Average of all recorded readings in the session. |
| Stat pills (auto) | Review / Done | Counts of optimal / below-min / above-target / skipped / total points. |
| **Admin — Settings** | | |
| Measurement unit | Settings | `inches` or `mm`. |
| Low / High threshold | Settings | Boundaries that classify each reading's severity. |
| Low / OK / High color | Settings | Colors used in admin History and Analytics. |
| Enable alerts / Alert on / Default alert severity | Settings | Whether and when a submitted session triggers a notification. |
| **Admin — Rink** | Name, slug, sort order, default, active | Defines a sheet of ice. |
| **Admin — Diagram** | Name, slug, description, rink, logo URL, aspect ratio, sort order, default, active | Defines a rink picture and its point set. |
| **Admin — Point** | Label, X (0–1), Y (0–1), order, active | A single measurement location on a diagram. |

## 8. Locking, saving & offline

**Adjust freely before you finalize.** During the **measure** phase, nothing is sent to the server — every reading lives on your screen. You can re-tap any point to change its value, skip points, and bounce between **measure** and **review** ("← Back to measure") as many times as you like. The only thing that commits a session is the **Submit** button on the review screen.

**A submitted session is immutable.** Once submitted it becomes a permanent, read-only record. There is no "edit this session." If something was wrong, you record a **new** session. Admins don't edit submitted sessions in place — on the History detail panel they can add **append-only follow-up notes**, and that's it. The only way a session is removed is a **super-admin hard delete**, which is gated behind a confirmation dialog and cannot be undone.

**Snapshots protect history.** Each session stores the unit, thresholds, and each point's number/label/position at submit time. Editing a diagram or changing Settings afterward never changes how past sessions look or are classified — deleted points even keep their snapshots on old measurements.

**Offline.** Ice Depth works offline:
- If you're offline when you submit, the button reads **"Save Offline"** (or "Save on this device"), and the session is **queued on your device.** You'll see a "Saved on this device" confirmation; the session submits automatically when you reconnect, and the same severity checks and rules run then.
- A queued session is replayed exactly once (it can't create a duplicate) and lands the same record an online submit would.
- ⚠ VERIFY: if your device can't queue offline at all (no service worker active), the app blocks the submit and tells you plainly to reconnect or reload — your typed readings stay on screen rather than being lost.
- Note: offline covers **submitting** a session. Browsing previously submitted sessions or the Done page requires a connection.

## 9. Troubleshooting & FAQ

**"No permission" when I open Ice Depth.** Your account doesn't have the Ice Depth *submit* permission. Ask an admin to grant it (Admin → Permissions).

**"Account not set up."** Your login isn't linked to an active employee record yet. Contact your administrator.

**"Not configured" / "No diagrams."** Your facility hasn't created a rink and diagram yet, or no diagram is assigned to your rinks. An admin sets these up under Admin → Ice Depth → Rinks and Diagrams.

**A point chip won't turn green even with a value in it.** Green means "Optimal." If the chip is red or amber, the reading is below the low threshold or above the high threshold for your facility — that's expected behavior flagging a thin or thick spot, not an error.

**My Bluetooth caliper types into the wrong place / nothing happens.** Make sure you've **tapped a point first** so its popover (the input) is focused, then press the caliper's DATA button. The caliper must be paired as a keyboard in your device's Bluetooth settings, and set to the same unit as the form.

**I entered the wrong depth.** Before submitting, just tap that point again and type the correct value, or use "← Back to measure" from the review screen. After submitting, the session is locked — record a new one.

**Can I add a photo?** No. Ice Depth has no photo or attachment feature by design; the record is the annotated diagram and the readings.

**Why is there no °F/°C switch like Refrigeration has?** Because this module measures **depth**, not temperature. The unit (inches or mm) is set once by an admin in Settings.

**"Send Report" says no recipients.** No distribution list is configured for Ice Depth. An admin sets one up under Admin → Communications.

**Do changes to thresholds change my old reports?** No. Each session snapshots its unit and thresholds at submit time; later settings changes never reclassify history.

**Why does the average / counts look off vs. what I measured?** Skipped points aren't counted in the average or severity totals — only recorded readings are. The summary shows how many points were skipped.

## Source

- Staff flow: `src/app/reports/ice-depth/page.tsx`, `src/app/reports/ice-depth/[layoutSlug]/page.tsx`, `src/app/reports/ice-depth/_components/{submission-form.tsx,diagram-nav.tsx,sync-chip.tsx}`, `src/app/reports/ice-depth/actions.ts`, `src/app/reports/ice-depth/_lib/{compute.ts,submit.ts,offline.ts}`, `src/app/reports/ice-depth/types.ts`
- Done / PDF / send / print: `src/app/reports/ice-depth/[layoutSlug]/done/page.tsx`, `src/app/reports/ice-depth/[layoutSlug]/done/_components/{send-report-button.tsx,print-diagram-button.tsx}`, `src/app/reports/ice-depth/[layoutSlug]/done/pdf/route.ts`
- Admin: `src/app/admin/ice-depth/page.tsx`, `src/app/admin/ice-depth/_components/{rinks-tab.tsx,layouts-tab.tsx,layout-editor.tsx,history-tab.tsx,session-detail.tsx,analytics-tab.tsx,settings-tab.tsx,seed-defaults-card.tsx}`, `src/app/admin/ice-depth/{actions.ts,types.ts}`, `src/app/admin/ice-depth/_lib/analytics.ts`
- Shared rink rendering: `src/components/ice-depth/usa-rink.tsx`, `src/components/ice-depth/rink-geometry.ts`
