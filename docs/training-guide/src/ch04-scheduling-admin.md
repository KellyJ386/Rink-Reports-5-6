# 4. Scheduling — For Admins

Scheduling administration requires both admin-console access *and* the scheduling module's admin grant — console access alone lands on the Forbidden page. A sticky tab bar runs across every page: **Overview · Shifts · Templates · Publish history · Publish requests · Time-Off · Availability · Swaps · Compliance · Job areas · Settings · Notifications**.

## 4.1 The rules engine (read this first)

One shared validation engine checks *every* path that puts a person on a shift — grid edits, open-shift assignment, swap approvals, publish approvals, and staff self-claims. The checks:

| Check | What it flags |
|---|---|
| Certification missing | The job area requires a cert the employee lacks (or it expires before the shift) |
| Minor overtime | Exceeds the weekly hour limit for minors |
| Overtime | Pushes past the overtime threshold |
| Break required | The shift is long enough to require a break that isn't scheduled |
| Min rest | Doesn't leave the required rest between shifts |
| Double-booked | Overlaps another shift for the same employee |
| Unavailable | Falls within a time the employee marked Unavailable |
| Time off | Overlaps approved time off |
| Not qualified | The employee isn't assigned to the shift's job area |
| Hour cap | Puts the employee over their personal weekly cap |
| Operating hours | Falls outside the facility's configured open hours |

**Two tiers of severity:**

1. **Certification gaps always hard-block**, regardless of settings. A facility manager can override — the popover shows "Blocked — missing required certification", an override-reason field, and an **Override & assign** button — and *every override is written to the audit log* on the Compliance page.
2. **Everything else is advisory**: an amber "Heads up — this assignment:" box and a **Confirm & save** button. If the facility turns on **block on violations**, the same box becomes "Blocked by facility policy" and the save is disabled.

Unassigned (open) slots never gate — there's nobody to validate.

## 4.2 Overview

The scheduling command center: four stat cards (**Scheduled hours** with published/draft split, **Shifts this week**, **Open shifts** — with a red "N unassigned (no listing)" warning when shifts exist that nobody can see or claim — and **Pending requests** split by swap/time-off/drop), plus the three approval queues inline and a module card grid with live counts.

**The approval panels** (also available in the grid's right rail):

- **Pending drops** — Approve or Deny with an optional note. The approve copy is blunt on purpose: *"Approving unassigns the shift and opens it for claims. Nobody is covering it until a coworker picks it up."*
- **Pending swaps** — Approve or Deny with a note visible to the requester.
- **Pending time-off** — Approve or Deny. **The conflict branch matters:** if approval would overlap shifts the employee already holds, the app stops and lists them, then offers **Approve & unassign shifts** (drafts are cleared; published shifts go through the governed edit path, return to the open-claim pool, and the employee is notified), **Approve anyway**, or **Cancel**.
- **Open shifts** — **Assign** (pick an employee; the rules engine hard-blocks unqualified fills) or, for claimed listings, **Approve claim** / **Decline**.

## 4.3 The Shifts grid

The main canvas. Drag in a day column to create a shift; drag a block to move it or its edges to resize; click a shift to assign, duplicate, or delete.

**Toolbar:** week navigation, **DAY | WEEK | MONTH** views (month is read-only — click a day to edit that week), **Add shift**, and **Request publish**. A KPI strip shows scheduled hours, shift count, **labor cost** (hours × each employee's wage, falling back to the facility default rate), and open shifts. A sub-toolbar offers color-by (job area or person), a coverage heatmap, density options, **Apply template…**, CSV **Export**, **Print** (a clean weekly roster), and a job-area filter.

**Creating and editing shifts.** Drawing a block (or **Add shift**) opens the shift popover: start/end times, **Employee** (or "Open / unassigned"; minors are marked), **Job area**, and a **Repeat weekly** toggle with day-of-week chips and an end date — with a live count ("Will create 12 shifts") and caps of 84 days / 62 occurrences. A **Save as template** link saves the block's times and job area as a reusable one-slot template. While the engine checks the assignment, the save button adapts: **Save**, **Confirm & save** (advisory warnings), or **Override & assign** (cert gap, manager-only, audited).

For recurring batches, every occurrence is checked: a cert gap anywhere blocks the batch until overridden; advisory issues aggregate into one confirm; and per-date conflicts skip only that date, with a toast reporting exactly what was skipped and why.

**Published shifts are different.** Editing one carries the notice *"This shift is published — saving republishes it and notifies affected staff."* Drag-moving is disabled. Deleting a published shift is actually a governed **cancel** (the employee is notified); draft deletes are immediate with an **Undo** toast. Deleting a shift in a recurring series offers **Delete series (drafts)** — published occurrences are left for individual cancellation.

**The right rail** shows either the selected shift's detail (employee/job-area dropdowns that re-validate instantly, duration/break/pay chips, Edit/Duplicate/Delete) or, with nothing selected, the open-shift, swap, time-off, and drop queues plus a per-person hours crew list.

## 4.4 Templates

Reusable weekly patterns. Build one from scratch on the Templates tab (name, slug, description, then slots by day: job area, times, break minutes, role label, and a staff count — one draft shift is created per count), or capture one from the grid with **Save as template**.

**Apply template** (from the grid): pick the template and the week — any date snaps to that week's start. Applying always produces **unassigned draft shifts**; a template can never place people directly, so the rules engine is never bypassed. Archived templates must be reactivated before applying.

## 4.5 Publishing — always two people

Publishing is a deliberate two-admin handshake:

1. **File a request** from the grid (**Request publish · week of …**), optionally with notes for the approver. Guards: there must be draft shifts in the window, and overlapping pending requests are refused.
2. **A different admin approves** on the **Publish requests** tab. If you filed it, your buttons are replaced with *"You filed this request — a different admin must approve or reject it."* — the separation is enforced server-side too.
3. **Approve & publish** does everything in one transaction: re-validates every assigned draft, publishes them, opens claim listings for unassigned shifts, notifies staff (in-app and email), and records the event. Rejections require a reason.

**Publish history** is the read-only log: when, range, shift count, who published — and an **Acknowledged** column ("7/12") counting how many staff pressed **Acknowledge schedule** on their notification. That's your read-receipt for the schedule.

## 4.6 Time-off, availability, and swaps queues

**Time-off** — filter by status (default Pending). Approve/Deny with a note the employee sees; the conflict branch from §4.2 applies. Admins can also cancel an approved request, which notifies the employee.

**Availability** — a read-only planning grid: employees down the side, the facility week across the top, blocks colored **Available** (blue) / **Preferred** (green) / **Unavailable** (red) with job-area preferences. A card below lists employees who submitted nothing. Remember the footnote: *only Unavailable blocks affect enforcement* — the rest is planning information.

**Swaps** — filter by status (default Open = pending + accepted). Actions:

- **Assign target** (pending, no target yet): picking an employee *accepts on their behalf* — they're notified that it still needs final approval.
- **Approve**: runs the atomic swap — both shifts locked, both directions re-validated, then the trade (or one-way coverage) is applied and both employees notified. Failures are specific about which direction broke which rule.
- **Deny** / **Cancel** with notes.

Undecided swaps auto-expire after the configured window (default 72 hours, capped at the shift's start).

## 4.7 Compliance and job areas

**Compliance** — the facility rules that drive the warnings: Minor max hours, Overtime, Break required, Certification required, Min rest between shifts, plus custom rules. Add, edit, reorder, enable/disable. At the bottom, the **certification override audit log**: every "Override & assign" ever pressed — when, who, which employee, which missing certs, and the reason typed. Show this in training; it's the accountability half of the override button.

**Job areas** — the assignable areas (Front Desk, Concessions…). Each employee can hold up to four. Add, rename, reorder, deactivate (delete is blocked if assigned — deactivate instead), plus CSV bulk upload. Per area, add **required certifications** — these are exactly what produces the hard cert block at assignment time.

## 4.8 Settings

Seed defaults on first run (also seeds three starter compliance rules). The fields:

| Setting | Effect |
|---|---|
| Week start day | Changes everyone's week window, everywhere |
| Default shift minutes | Length of a freshly drawn shift (default 480) |
| Minor max hours / Overtime hours / Break rules | Feed the corresponding warnings |
| Swap request expiry (hours) | Undecided swaps lapse after this (default 72) |
| Default hourly rate | Labor-cost fallback when an employee has no wage |
| Opens at / Closes at (+ midnight checkbox) | The grid's visible hours; outside-hours shifts still save with an advisory |
| Shift-drop notice (hours) | How far ahead staff must drop; 0 = any time before start |

**Toggles:** swaps require manager approval · open shifts first-come-first-served · notify on publish · notify on overtime · allow staff availability submission · require job-area qualification · **block grid saves that raise warnings** · **shift drops need manager approval**.

Four of these deserve their own minute in training because they visibly change what staff see: the week start day; first-come-first-served (off = every claim needs a manager); block-on-violations (turns "Confirm & save" into a wall); and the drop-approval toggle plus notice hours (changes the staff Drop dialog's wording and whether the button appears at all).

## 4.9 Notifications (admin view)

A read-only feed of every scheduling notification sent to staff, filterable by type, recipient, read state, and date. Also a **Send shift reminders** card: reminders go out automatically 24 hours before each published shift; this sends them earlier for a wider window (1–168 hours), de-duplicated so no shift gets two.
