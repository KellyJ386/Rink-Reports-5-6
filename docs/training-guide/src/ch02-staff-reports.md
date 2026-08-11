# 2. Staff Report Modules

This chapter walks through every report module a staff member uses day to day. Each section covers what the module is for, how to reach it, the submission workflow, and the details worth knowing before your first shift with the app.

## 2.1 Daily Reports

**What it's for.** The shift checklist tool. You pick a work area and a shift type, tick off the checklist items your admins configured, add an optional note, and submit. It also hosts custom "report forms" and a read-only history.

**Getting there.** The Daily Reports tile or sidebar item. Header buttons: **Assignments** (supervisors only), **Report forms** (when your facility uses custom forms), and **View history**.

**Submitting a daily report:**

1. In the **Shift setup** card, choose your **Work area** (you only see areas you're allowed to submit for) and then the **Shift** template — each option shows how many checklist items it has.
2. The **Checklist** card appears with a progress bar ("3 / 12 complete"). Tap each row to check it off; rows tint in the area's color when done.
3. Add a **Note (optional)** — "Anything to flag for managers?"
4. The sticky bar at the bottom shows your live progress and the **Submit** button.

After submitting you get a confirmation screen with the area, template, timestamp, and how many items you checked, plus **Submit another** and **Sign out** buttons — handy at a shared kiosk.

**"My areas today" (assignment routing).** If your facility routes areas to people, the module opens with your assigned areas as cards — each marked **Done** or **Not started** — plus a collapsible **Open areas** section anyone can complete. An area counts as done once any of its templates has a submission for the day. Assignment updates ("Assigned to Zamboni Room for Monday…") appear in a bell banner with a **Mark read** button.

**Assignments board (supervisors).** Staff with the edit or admin tier see every active area for the day, who's assigned (including "(from schedule)" and "(default owner)" sources), and **Done/Incomplete** badges. Buttons: **Assign / Reassign** (a checkbox picker of employees), **Open up** (clears assignees so anyone can complete it), and **Re-sync from schedule**. Near the end of the day, incomplete assigned areas sort to the top under a red "Day closes soon" warning. Assignment changes are online-only — they're never queued offline.

**Report forms.** Admin-built custom forms with titled instances ("e.g. Friday Night Game"). Tap **Add Report**, give it a title, then fill in the form's fields (text, numbers, selects, checkboxes, dates, times) and either **Save draft** or **Submit report**. Drafts are yours alone; submitted reports lock. Each instance keeps a frozen snapshot of the form as it looked when created, so later admin edits don't change reports already in flight. When a day is locked, everything goes read-only with an amber lock notice.

**History and corrections.** **View history** lists recent submissions (read-only, scoped to your facility and areas), with chips for completion counts and **Corrected/Correction** markers. On your own submissions you'll see a **File correction** link: you re-tick the checklist, enter a *required* reason ("What was wrong?"), and file it. The original stays on record — corrections supersede, they never erase. Daily report history auto-deletes after 14 days.

> If you see "No areas assigned," you haven't been granted any submit areas for this module — talk to your supervisor.

## 2.2 Incident Reports

**What it's for.** Reporting a non-injury operational incident — something that happened at the facility that managers need to review. You can edit your report for 24 hours; after that it's read-only.

**Getting there.** The Incidents tile or sidebar item.

**The form — three cards:**

1. **When & where** — when it happened (defaults to now) and the **Facility space(s)**: a searchable multi-select of your facility's spaces, plus an **Other** option with a free-text description.
2. **What happened** — the **Description** (required, 500 characters with a live counter), **Activity at the time**, **Severity** (required), optional **Incident type**, **Immediate actions taken**, an ambulance-called Yes/No toggle, **Number of people involved**, and a **Follow-up required** toggle.
3. **Witnesses (optional)** — up to 3. Each witness needs a name and at least one contact (phone or email).

Before submitting, a dialog confirms: *"You can edit this report for 24 hours after submitting; after that it becomes read-only."*

**After submitting** you land on a confirmation screen showing status, severity, and timestamps, with **Edit report**, **Submit another**, and **Back to home** buttons. Open the report again within 24 hours to make changes — every edit is recorded in the report's audit trail. After the window closes (or for anyone who isn't the reporter), the report renders read-only.

The module home lists **your recent reports** from the last 30 days with severity pills and status badges (Submitted / In review / Resolved / Archived) so you can see when a manager has picked yours up.

**Offline:** new reports queue on your device; editing is online-only.

## 2.3 Accident Reports

**What it's for.** Reporting a personal injury: who was hurt, how badly, which body parts, where and when, witnesses, and whether it's a workers' comp claim.

**Getting there.** The Accidents tile or sidebar item.

**The form — five numbered sections:**

1. **Person involved** — name, contact (phone or email), and age (all required).
2. **What happened** — **Severity** as colored pill buttons, **Primary injury type**, **Medical attention** (some options warn "Selecting this option will alert managers"), **Body parts affected** on an interactive body diagram, and the required description.
3. **Where & when** — date/time (defaults to now), location (facility spaces), and the activity at the time.
4. **Witnesses** — up to 5, each with a name and optional contact and statement.
5. **Workers' comp** — only needed when the injured person is an employee filing a claim. Ticking the checkbox reveals your facility's workers' comp instructions and a required "I have read and understand" acknowledgement; you can't submit a comp claim without it.

**The body diagram** deserves a minute of practice: tap regions to mark front, back, or both. Midline regions cycle front → back → both; paired regions (arms, legs) are selectable per side. The selections travel with the report.

A sticky bar shows **"Auto-saved · review before submitting"** and the **Submit report** button. The app also warns you before closing the tab with an unfinished report. Like incidents, accident reports are **editable for 24 hours** — after submitting you land directly on the report page with a green "Submitted" banner and, while the window is open, an "Editable for N more hours" notice above the edit form.

## 2.4 Ice Depth

**What it's for.** Walking the rink with a depth gauge and recording ice thickness at each configured point on a rink diagram, then reviewing and submitting the session.

**Getting there.** The Ice Depth tile — it opens straight into your default rink's diagram. If your facility has multiple rinks or diagrams, dropdowns at the top let you switch.

**Phase 1 — Measure.**

- The screen shows a USA Hockey rink diagram with numbered point chips at each measurement location (plus door markers and your facility logo). A progress bar tracks "Point 3 of 12 · 2 recorded".
- **Tap a point** to open its entry popover: type the depth, watch the live severity word (**Optimal / Below min / Above target**) and color, then **Save & Next** (or **Skip**). Pressing **Enter** or **Tab** also saves and advances.
- Chips recolor as you go: green = optimal, red = below minimum, amber = above target.

**Using a Bluetooth caliper** (there's a built-in helper for this): pair the caliper once in your device's Bluetooth settings — it shows up as a keyboard. Then tap a point and press the caliper's **DATA** button; the reading types itself in and advances to the next point, hands-free. Set the caliper to the same unit as the form.

**Phase 2 — Review & submit.** Tap **Review & Submit** (enabled once at least one point is recorded). You'll see the average depth in large type, pills counting optimal / thick / below-min / skipped points, the full per-point list, and a notes field. The submit button tells you the truth about coverage — "Submit (10 of 12 recorded)" — so partial sessions are explicit.

**The done screen** shows a SUBMITTED badge, stat pills, and the read-only diagram with your values, plus **Download PDF**, **Print Diagram** (prints just the diagram, no app chrome), **Send Report** (emails the configured recipients), **Submit Another**, and **Back to Dashboard**.

Thresholds (the low/high limits and the unit) come from your facility's ice-depth settings — the defaults are 1 and 1.5 inches.

## 2.5 Ice Operations

**What it's for.** The ice maintenance log: five quick-entry forms in one module. Nothing here can be edited after submitting, so double-check before you tap.

**Getting there.** The Ice Operations tile. Tabs across the top: **Ice Make · Circle Check · Edging · Blade Change · Propane Tank Change** (your facility can disable individual tabs). A **Show Activity Feed** button reveals the last 8 submissions facility-wide.

**The five forms:**

- **Ice Make Activity** — log a resurfacing run: rink, machine, **water used** (with a Gal / L / % Tank unit toggle — % Tank only works when the machine has a tank capacity on file, and switching units converts your number), machine hours, snow taken (%), time on/off, notes.
- **Digital Circle Check** — pick the machine and answer every checklist item with **Pass** or **Fail**. Items start unanswered — nothing is pre-checked, so a recorded "pass" always means someone actually looked. A **Fail** requires a "What's wrong?" note. Submit stays disabled until every item is answered ("Tap Pass or Fail on every item to submit — 4 remaining"). If the machine has no fuel type on file you'll pick one first so the right checklist template loads.
- **Edging** — machine, hours run, notes.
- **Blade Change** — machine, old blade hours, new blade ID (serial), notes.
- **Propane Tank Change** — machine and machine hours; the date is recorded automatically when you submit.

Machine dropdowns show each machine's running hours ("Zamboni 552 — 1,240 hrs") and are filtered to the right equipment type per form. The done screen shows the operation, timestamps, rink/equipment, and — for circle checks — a red "N failed items" chip.

**Offline:** all five forms queue, and the log keeps the time you did the work, not the time it later syncs.

## 2.6 Refrigeration

**What it's for.** The plant-room reading round: every configured reading, per section and per piece of equipment, with out-of-range values flagged as you type.

**Getting there.** The Refrigeration tile. If your facility has enabled alerts, an amber banner reminds you: "Out-of-range readings will trigger an alert to managers."

**The form:**

- **Log Information** card — your name and facility (read-only), the reading time (defaults to now), and optional **Shift** and **Round #** fields (if your facility logs, say, 3 rounds per shift, the form says so).
- **°F / °C toggle** in the card header. Flipping it converts every temperature you've already typed, and re-labels every field and range hint. Values are always stored in °F regardless of what you display.
- **One card per section**, with fields for the section itself and a labeled subgroup for each piece of equipment. Numeric fields show a **normal-range hint** underneath ("Normal: 12 – 18 psi") based on your facility's thresholds.
- **Critical readings require a note.** If a value breaches a *critical* threshold, a red **Corrective action** box appears inline and the report won't submit until you describe what you did about it.
- **Notes (optional)**, then the full-width **Submit refrigeration report** button.

The done screen shows the timestamp plus chips for "N values recorded" and "N out-of-range". The module home lists your last 30 days of submissions with out-of-range badges.

## 2.7 Air Quality

**What it's for.** Logging CO and NO2 (and any other configured readings) per location, checked live against your facility's jurisdiction-aware compliance thresholds — with the full regulatory monitoring log attached.

**Getting there.** The Air Quality tile. Note in the header: after you submit, the report can't be edited.

**The workflow, top to bottom:**

1. Pick the **Location** (required before anything else).
2. If your facility has a **jurisdiction profile**, a compliance card shows its name, a **Binding** or **Guidance** badge, the measurement method (**1-hr TWA** or **Single sample**), a **frequency tracker** ("On schedule" / "Behind by 2" with your weekly and weekend sample counts), and a **Reading type** dropdown.
3. Pick the monitoring **Equipment** if monitors are configured.
4. Enter each **reading**. Fields bound to a compliance threshold show a tier hint ("Corrective > 25 · Notification > 50 · Evacuation > 100 ppm") and a live badge the moment you type: **Within range**, **Corrective action**, **Notification**, or **Evacuation**.
5. For TWA jurisdictions, a collapsible **1-hour TWA calculator** takes your readings at 5-minute intervals, averages them, and fills the main field via **Use average**.
6. Any over-threshold reading triggers a **compliance banner** with your facility's escalation instructions (for example, Evacuation: "Evacuate the facility now and contact the fire department immediately") and a **required Corrective action taken** note — the submit button stays disabled until you fill it in.
7. The **Monitoring log** — collapsible sections mirroring the regulatory form: equipment and tester info (monitor models, calibration dates — with a warning if calibration is over a year old), general information and equipment status, routine and post-edging measurement tables, and additional recommendations (staff trained, public signage checkboxes).

The submit button labels itself "**Submit readings for {Location}**" once you've picked one. The done screen shows readings recorded and, when applicable, a severity-colored exceedance chip.

**Offline:** submissions queue, and the same exceedance checks run when they sync.

## 2.8 Dasher Boards

**What it's for.** A single-screen field tool for the rink perimeter. Tap any board panel, glass panel, or door on the diagram to report a problem; open issues stay pinned to the asset until they're fixed. A formal **inspection walk** is an optional overlay that ends with a sign-off.

**Getting there.** The Dasher Boards tile — straight to your default rink's condition map, with a rink switcher in the header.

**Reading the diagram.** Legend: **red = open severity-A issue · yellow = open B/C issue · coral = flagged fail with no issue yet · lime = door**. A **Glass** switch toggles the glass layer, and the diagram zooms. The toolbar shows "Last walked {date} by {name}" and — for submitters — a **Start inspection walk** button.

**Reporting an issue (the everyday flow — no walk needed).** Tap an asset to open its sheet. The **Report issue** form is right there: pick **Board** or **Glass** if the position has both, choose severity — **A — Safety critical**, **B — Needs repair** (the default), or **C — Cosmetic** — pick a category, describe the problem, and **Submit issue**. Severity A adds two required extras: an **Action taken** note and a **Supervisor** to notify, stated up front.

**The asset sheet also shows:** open issues on that asset (with **Acknowledge** for severity A — supervisor tier — and **Mark fixed**), a walk-only Pass/Fail **condition check**, the read-only **replacement spec** (dimensions, thickness, material), and a collapsible **issue history**.

**Checklist — due today.** When inspection items are due, a card lists them grouped by cadence (daily / weekly / monthly / yearly) with **Pass** / **Flag** buttons. Flagging an item opens the issue form automatically — a flagged item needs a reported issue behind it.

**Inspection walks.** Start a walk and a sticky bar tracks it: tap problem assets as you circle the rink — **untapped assets are attested OK at sign-off** — and answer any due checklist items. **Sign off** opens walk notes and **Complete walk**. The sign-off is refused while severity-A issues are unacknowledged or due items are unanswered. The done screen shows pass/fail/issue counts, a diagram colored with this walk's results, and **Download PDF / Print / Send Report** buttons.

**Permission tiers:** view = see the map; submit = report issues, run walks, resolve B/C issues; edit = acknowledge and resolve severity A; admin = configure the perimeter (admin console).

**Offline:** everything queues — starting walks, checks, issues, even the sign-off (validated when it syncs). Acknowledge/resolve and history need a connection.

## 2.9 Facility Paperwork

**What it's for.** A read-only library of documents your admins uploaded — policies, handbooks, safety documents, manuals.

**Getting there.** The Facility Paperwork tile.

**Using it.** Filter by category (only categories that actually contain documents are offered), then tap **Download** on any card. Download links are short-lived and generated per request, so always download from the page rather than bookmarking a file URL. Staff can't upload or edit here — that's the admin console's Facility Paperwork module.

## 2.10 Communications

**What it's for.** Your inbox: facility-wide operational **alerts** raised by other modules, **direct messages** to you, and — if you can send — a **Sent** view with read and acknowledgement receipts.

**Getting there.** The Communications tile or sidebar item (with an unread badge).

**Alerts tab.** Every alert for your facility, newest first — alerts are operational safety signals, so everyone with communications access sees all of them. Open one to read the full body; if it **requires acknowledgement**, an **Acknowledge this alert** card appears with an optional notes field. Once acknowledged, the alert shows when you did it.

**Messages tab.** Messages delivered to you. **Opening a message marks it read automatically** — acknowledgement, when required, stays a deliberate button press. Messages can carry a **PDF attachment** (Download PDF attachment button). **Reply** is available when the sender is a real person (not a system-generated message).

**Sent tab** (senders only). Your messages with per-recipient receipts: who read it and when, who acknowledged.

**Composing.** Tap **New message**: optionally start from a **template** (fills subject, body, and the ack flag), write your message, pick one or more **recipient groups** (staff only see groups flagged for staff messaging), optionally toggle **Requires acknowledgement**, and **Send message**. The confirmation screen shows the recipient count and receipts list. Replies lock the recipient to the original sender and prefill "Re: …".

## 2.11 Working offline

Rink Reports is built for rinks with dead zones. The rule of thumb: **submitting works offline; browsing needs a connection.**

**What happens when you submit offline.** The report is saved on your device ("Saved on this device") and queued. When you're back online it submits automatically — and the server runs the exact same validation and threshold checks it would have run live. The amber offline banner at the top of every reports page tells you how many submissions are waiting.

**The sync badge and queue.** The header badge shows "N pending" (amber) or "N failed" (red); tap it to open the **Pending Sync Queue**. Each queued item shows its module, status ("pending", "retry in 45s", "failed", or "won't retry"), and the last error. Buttons: **Retry failed** and **Sync now** — worth knowing on iPhones and iPads, which don't sync in the background, so open the app and tap **Sync now** after a shift in a dead zone.

**Offline pages.** Three lightweight pages work with no connection at all, using data saved the last time you were online: **/offline-daily** (your daily-report areas), **/offline-forms** (custom report forms — you can create and fill these offline), and **/offline-schedule** (your published shifts). Each shows an amber "Offline — showing last-synced data" banner and refuses to show stale data as if it were today's.

**What can go wrong (and what it means):**

- *"You're offline and the offline queue isn't ready yet. Keep this page open and try again."* — the device has never synced for your account; the app refuses to fake a save. Your entries are still on screen.
- A queue item marked **"won't retry"** hit a permanent error (for example, the day locked before it synced). It's parked, never silently dropped — contact your administrator if you're unsure why.
- Queued items belong to the account that created them; someone else signing in on the same device can't flush your queue.
