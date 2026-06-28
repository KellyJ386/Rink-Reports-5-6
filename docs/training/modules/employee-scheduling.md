# Employee Scheduling

> Brand: RinkReports. Primary green **#4DFF00**, navy **#002244**.
>
> **You only see data for your own facility — this is automatic.** You never switch facilities or see another rink's schedule; RinkReports keeps each facility's records separate for you.

---

## 1. What this module is for

Employee Scheduling is how a facility **plans who works which shift** and how staff **manage their own availability and requests**. It has two sides:

- **The admin scheduling grid** — managers build a week of shifts by dragging on a calendar, assign people to them, and then publish the schedule so staff can see it.
- **The staff scheduling app** — each employee sees their upcoming shifts, sets weekly availability, requests time off, picks up open shifts, and asks to swap shifts with a coworker.

**Important — there is no payroll, timekeeping, or clock-in/out here.** Scheduling is **assignment only**: it says *who is scheduled to work when*. It does **not** record hours actually worked, clock anyone in or out, produce timesheets, or calculate pay. The one pay-adjacent number, **"max weekly hours,"** is purely an **overtime/scheduling warning threshold** — when an assignment would push someone over it, the grid shows a warning. It changes nothing about pay.

The module also runs **scheduling rule checks** as you assign people: required-certification gaps, double-booking, approved time-off overlap, minor hour caps, overtime thresholds, and required breaks. Most are advisory warnings; a missing required certification is a hard block (see §8).

---

## 2. Who can use it

Access is **permission-driven**, not a fixed rank ladder. The table below is the typical default mapping; because an admin can customize any person's permissions per module, two people with the same title can differ. **⚠ VERIFY** any place a tier label feels too rigid for a specific facility.

| Tier (doc vocabulary) | Real app role | Scheduling access (default) |
|---|---|---|
| super_admin | `super_admin` (platform-wide) | Full admin grid + all approvals across the system; sees everything an org/facility admin sees. |
| org_admin | *(no exact equivalent — **⚠ VERIFY**; treat as super_admin)* | No separate tier exists in RinkReports. |
| facility_manager | `admin` (facility administrator) | Full admin grid: build/assign/publish shifts, approve publish requests, decide time-off and swaps, configure settings and job areas. Needs the `admin` permission for this facility. |
| supervisor | `manager` (or a custom role) | Mid-tier. Whatever the admin grid permission grants them; commonly review/decision rights. **⚠ VERIFY** per facility — gated by permissions, not title. |
| staff | `staff` (or a custom role such as `driver`) | Staff scheduling app only (my shifts, availability, time off, claim open shifts, request/accept swaps). Needs the scheduling `view` permission; submitting requests needs `submit`. **No access** to the admin grid. |

- The **admin grid** (`/admin/scheduling`) requires the `admin` permission (or super_admin). Non-admins who try are shown a **Forbidden** message.
- The **staff app** (`/reports/scheduling`) requires an active employee account with the scheduling **`view`** permission. Without `view`, the page shows "You don't have access to scheduling yet." Submitting availability or time off additionally needs **`submit`**; if you only have `view`, you can see your schedule but not file requests.
- A **deactivated** account is denied everywhere.

---

## 3. How to get there

**Staff side — `/reports/scheduling`** ("Scheduling" in the staff menu / mobile bottom tabs):

- The landing screen shows a **Next shift** hero, a 7-day week strip, your **Upcoming** shifts, any **Open · Pick up** shifts you can claim, **Your claims · Awaiting approval**, and **Quick links** to My schedule, Time off, Availability, Shift swaps, and Notifications.

**Admin side — `/admin/scheduling`** (Admin Center → Module Admin → **Scheduling Admin**):

- A sticky sub-navigation runs across the top: **Overview · Shifts · Templates · Publish history · Publish requests · Time-Off · Swaps · Compliance · Job areas · Settings · Notifications.**
- **Overview** is the dashboard (KPI cards, pending swaps/time-off, open shifts, week-at-a-glance, module tiles).
- **Shifts** is the drag-and-drop grid where you actually build the schedule.

---

## 4. Setup & configuration (admins)

Before staff see a useful schedule, an admin sets up a few things. These all live under **Scheduling Admin**.

### Job areas (positions) — `/admin/scheduling/job-areas`

"Job areas" are the **positions** people can be scheduled into (e.g. *Skate Rental*, *Front Desk*, *Resurfacer*).

- **Add** a job area by typing a name and pressing **Add area** (or **Bulk upload**).
- **Reorder** with the up/down arrows, **rename** inline, and **deactivate** (toggle) or **delete**.
  - Deactivating hides an area from *new* assignments without affecting people already assigned.
  - Deleting is only allowed when **no one is assigned**; otherwise deactivate instead.
- **Required certifications:** under each area you can add cert names (e.g. *CPR*). RinkReports will then **hard-block** assigning anyone who lacks a current matching certification to a shift in that area (a manager can override — see §8).

### Assigning people to job areas (cross-reference)

Adding an employee, choosing their role, and seeding permissions is covered in the **Admin Control Center** chapter. The **scheduling-specific** parts of the employee form are:

- **Job areas** — multi-select, **up to 4** per employee (cross-training). One can be marked the **Primary job area**. These determine which positions the person can be scheduled/qualified for, and which areas they can pick when setting availability.
- **Max weekly hours** — an optional **per-employee cap**. Leave blank for "No individual cap." This is the overtime-warning threshold only (not payroll).

### Scheduling settings — `/admin/scheduling/settings`

One settings form controls scheduling behavior facility-wide. There is also a **Seed defaults** button that fills in sensible starting values and a few default compliance rules.

Key settings (see §7 for the full list):

- **Week start day**, **Default shift minutes**.
- **Minor max weekly hours**, **Overtime weekly hours**, **Minimum break minutes / after hours** — feed the advisory warnings.
- **Swaps require manager approval**, **Swap request expiry (hours)** (default 72), **Open shifts: first-come, first-served**.
- **Notify employees when schedule is published**, **Notify on overtime warnings**.
- **Allow staff to submit weekly availability** (on/off).
- **Require employees to be assigned to a shift's job area.**
- **Block scheduling-grid saves that raise warnings** — when **on**, advisory warnings (hours cap, overlap, etc.) *block* the save; when **off**, they are advisory and a manager can confirm and save anyway. (Missing required certs always block regardless.)

### Templates & compliance

- **Templates** (`/admin/scheduling/templates`) are reusable shift patterns you can apply to a week. You can also save a block straight from the grid (see §5).
- **Compliance** (`/admin/scheduling/compliance`) lists the rule set (minor hours, overtime, required break) that drives the warnings; rules can be enabled/disabled, edited, and reordered.

---

## 5. Screen-by-screen walkthrough

### Admin grid — `/admin/scheduling/shifts`

The grid header reads: *"Drag in a day column to create a shift; drag a block to move it, or its edges to resize. Click a shift to assign, duplicate, or delete."*

- **Views:** Day / Week / Month toggle, with Previous/Next and **Today**. Month view is read-only — click a day to drop into the editable week.
- **Drag-create:** drag in a day column to paint a new shift; an **assign popover** opens.
- **Move / resize:** drag a block to move it; drag its top/bottom edge to change start/end. Changes save immediately (optimistically).
- **Assign popover** (create or edit): set **Start time / End time**, choose an **Employee** (or *Open / unassigned*), and a **Job area**. As you choose, RinkReports checks for conflicts live ("Checking for conflicts…") and shows any cert block or advisory warnings. You can also **Save as template** from here.
- **Click a shift** → a detail panel on the right lets you **assign**, **duplicate**, **edit**, or **delete** it.
- **Position (job-area) filter:** a filter chip row narrows the board to one job area so the whole view — grid, hours, crew tally — stays consistent.
- **Right rail:** Open shifts needing coverage, Swap requests, Time-off, and a Crew roster with each person's scheduled hours vs. their cap.
- **Export** writes the visible week to CSV. A KPI strip shows scheduled hours, shift count, open shifts, and pending swaps.
- **Request publish · (week)** button — files a publish request for the visible week (see below).

### Publishing

- **Publish requests** (`/admin/scheduling/publish/requests`): the queue of pending requests. Each shows the range, who filed it, and notes. A different admin clicks **Approve & publish** (confirm dialog: "Approve and publish all draft shifts in this window?") or **Reject** with a required reason. **You cannot approve or reject your own request** — the buttons are hidden and the system blocks it, showing "You filed this request — a different admin must approve or reject it."
- **Publish history** (`/admin/scheduling/publish`): an append-only log of every publish event (when, range, shift count, who published).

### Time-off & swaps (admin)

- **Time-Off** (`/admin/scheduling/time-off`): pending employee requests; **Approve** / **Deny** (with an optional note) — only pending requests can be decided. The employee is notified of the decision.
- **Swaps** (`/admin/scheduling/swaps`): pending swap requests; a manager can **assign a target**, **Approve** (re-runs all rule checks and applies the trade or a one-way coverage hand-off), **Deny**, or **Cancel**. An applied swap can't be denied or cancelled afterward.

### Staff app — `/reports/scheduling`

- **My schedule** — your upcoming published shifts.
- **Availability** (`/reports/scheduling/availability`) — your weekly availability rows. Add an entry: **Day of week**, **Start/End time**, **Type** (Available / Preferred / Unavailable), an optional **Area/department you want to work** (only areas you're assigned to), optional **Effective from/to** dates, and notes. Edit or remove entries. If your facility has turned availability submission off, you'll see a message instead.
- **Time off** (`/reports/scheduling/time-off`) — **New request** with **Starts**, **Ends**, and an optional reason. Track status (pending/approved/denied) and cancel your own (see §8).
- **Open shifts** — on the landing screen, published shifts with no one assigned appear under **Open · Pick up** with a **Claim shift** button. Some are marked **Approval req.** A claim you make appears under **Your claims · Awaiting approval** until a manager approves it.
- **Shift swaps** (`/reports/scheduling/swaps`) — **New swap request**: pick **your shift to give up**, optionally a **coworker**, and optionally **their shift to take** (a trade) or leave it as just covering yours. Lists show **Outgoing** and **Incoming** requests with status; you can **Accept** an incoming pending swap directed at you, or **Cancel** your own pending/accepted one.
- **Notifications** (`/reports/scheduling/notifications`) — schedule alerts (publish, decisions, swap notices); mark one or all read.

---

## 6. Step-by-step: common tasks

**Place and edit a shift (admin)**
1. Go to **Scheduling Admin → Shifts**. Navigate to the right week.
2. **Drag** in a day column to create a shift (or click **Add shift**).
3. In the popover, set **Start/End time**, pick an **Employee** (or leave *Open*), and a **Job area**. Resolve any warnings, then **Save**.
4. To edit later, **drag** to move/resize, or **click** the shift and use the detail panel (assign / duplicate / edit / delete).

**Publish a schedule**
1. Build the week's draft shifts on the grid.
2. Click **Request publish · (week)**, add optional notes for the approver, and **File request**.
3. A **different** admin opens **Publish requests**, clicks **Approve & publish**, and confirms. Drafts in that window become **published**; any unassigned published shifts open for claims.

**Request a publish & approve it (two-person flow)**
1. Admin A files the publish request (above).
2. Admin B opens **Publish requests → Approve & publish** (or **Reject** with a reason). Admin A cannot approve their own — that's by design.

**Submit availability (staff)**
1. **Scheduling → Availability → New availability** (or per-day).
2. Choose day, times, **Type**, optional **area** and effective dates, then **Add availability**. (Queues offline if you're disconnected — see §8.)

**Request time off (staff)**
1. **Scheduling → Time off → New request.**
2. Set **Starts** and **Ends**, add an optional reason, **Submit request**. Track its status; cancel while pending/approved if plans change.

**Claim an open shift (staff)**
1. On the **Scheduling** landing screen, find a shift under **Open · Pick up**.
2. Tap **Claim shift**. If it needs approval, it moves to **Your claims · Awaiting approval** until a manager approves. (Online only.)

**Request a swap (staff)**
1. **Scheduling → Shift swaps → New swap request.**
2. Pick **your shift to give up**, optionally a **coworker** and **their shift**, add a note, **Send swap request**.
3. The coworker (if chosen) is notified and can **Accept**; a manager then approves it if your facility requires approval. (Online only.)

---

## 7. Field reference

### Admin shift (assign popover / detail)

| Field | What it is |
|---|---|
| Start time / End time | The shift's hours. End must be after start. |
| Employee | Who is assigned, or **Open / unassigned**. |
| Job area | The position the shift is for (drives qualification & cert checks). |
| Break minutes | Unpaid break length, subtracted from scheduled hours in tallies. |
| Role label | Optional free-text label shown on the shift. |
| Notes | Optional shift notes. |
| Status | **Draft**, **Published**, or **Cancelled** (set by the publish / cancel flows, not typed directly). |
| Override reason | Optional note recorded when a manager overrides a certification block. |

### Scheduling settings

| Setting | Effect |
|---|---|
| Week start day | First day of the scheduling week. |
| Default shift minutes | Default length for a newly created shift. |
| Minor max weekly hours | Cap used to warn when a minor is over-scheduled. |
| Overtime weekly hours | Threshold for the overtime warning. |
| Minimum break minutes / after hours | When a long shift should include a break (advisory). |
| Swaps require manager approval | If on, an accepted swap still needs a manager to approve/apply it. |
| Swap request expiry (hours) | Undecided swaps lapse to "expired" after this (default 72, capped at the shift start). |
| Open shifts: first-come, first-served | How open-shift claims are resolved. |
| Notify on publish / on overtime | Whether staff get notified on those events. |
| Allow staff to submit weekly availability | Turns the staff availability form on/off. |
| Require employees to be assigned to a shift's job area | Enforces job-area qualification. |
| Block scheduling-grid saves that raise warnings | On = advisory warnings block; off = advisory only (manager confirms). |

### Staff availability

| Field | What it is |
|---|---|
| Day of week | Sunday–Saturday. |
| Start / End time | The window for that day. |
| Type | Available / Preferred / Unavailable. |
| Area / department you want to work | Optional; must be a job area you're assigned to. |
| Effective from / to | Optional date range the entry applies to. |
| Notes | Optional. |

### Staff time-off / swap

| Field | What it is |
|---|---|
| Starts / Ends (time off) | The requested off period. End must be after start. |
| Reason (time off) | Optional. |
| Your shift to give up (swap) | The shift you want covered/traded. |
| Coworker (swap) | Optional target coworker. |
| Their shift to take (swap) | Optional — makes it a trade rather than one-way coverage. |
| Note (swap) | Optional message. |

---

## 8. Locking, saving & offline

### Draft → Published lifecycle

- New shifts are **drafts** — admins build and rearrange them freely; staff don't see drafts.
- A schedule is released through a **publish request** that a **second admin approves** (requester ≠ approver). Approving turns drafts in that window **published** and visible to staff; any **unassigned** published shift becomes an **open shift** staff can claim.

### Publish-lock (what changes after publishing)

- Once a shift is **published it is locked** from free editing or deletion. Admins can still change a published shift, but only through a **controlled, audited path** that re-checks the scheduling rules and notifies affected staff (the editor shows "This shift is published — saving republishes it and notifies affected staff").
- **Deleting a published shift is a soft cancel** — it is marked **cancelled**, not erased, so there's a record. (Draft shifts are deleted outright.)

### Approvals as locks

- **Time-off** and **swaps** move **pending → approved/denied** (swaps also pass through **accepted** and end at **approved & applied**). You can **cancel your own pending (or approved) time-off**, and **cancel your own pending/accepted swap**, but you **cannot reverse a manager's decision**, and an **applied swap** can't be undone here.

### Certification & warning gates (when assigning)

- A **missing/expired required certification** for the shift's job area is a **hard block**. Only a facility manager can **override**, and every override is **logged** (with an optional reason).
- Other signals — overtime, minor hours, double-booking, approved-time-off overlap, missing break, job-area mismatch — are **advisory**. They warn and require a **Confirm & save**, *unless* the facility turned on "block saves that raise warnings," in which case they block too.

### What queues offline vs. online-only

RinkReports is a PWA: some staff actions are **saved on your device and sync when you reconnect**. Scheduling's offline scope is deliberately narrow:

- **Queues offline (staff):** **Submit availability** and **Request time off**. When offline, the form saves locally and shows "Saved offline — will sync when you're back online," replaying once reconnected.
- **Online-only (by design):** the **entire admin grid** (drag-create / edit / move / delete / publish), **claiming an open shift**, **swap requests**, **accepting a swap**, and **cancelling a swap**. These depend on live shift state and on cert/hour-cap/publish-lock checks that can't be safely replayed later, so they require a connection. *(Confirmed in code: swap request/accept/cancel and open-shift claim all run as direct online actions with no offline queue.)*

---

## 9. Troubleshooting & FAQ

**"Where do I see hours worked or run payroll?"**
You don't — that isn't in RinkReports. Scheduling is **assignment only**: it plans who works when. There's no clock-in/out, timesheet, or pay calculation. "Max weekly hours" is only a warning threshold for over-scheduling.

**"I can't approve my own publish request."**
Correct — a publish must be approved by a **different** admin than the one who filed it. Ask a colleague with admin access to approve it.

**"The grid won't let me assign this person."**
If it's a **certification block**, the person lacks a required cert for that job area — only a facility manager can override (it's logged). If it's an **advisory warning** (overtime, overlap, etc.), click **Confirm & save** — unless your facility blocks warning saves, in which case fix the conflict first.

**"I claimed/swapped a shift while offline and nothing happened."**
Claiming and swaps are **online-only**. Reconnect and try again. (Availability and time-off *do* queue offline.)

**"Staff say they can't see the schedule."**
Check that the schedule for that week has been **published**, the staff member has the scheduling **`view`** permission, and their account is **active** and assigned to your facility. To let them file requests too, they also need **`submit`**.

**"A published shift disappeared from history after delete."**
It didn't — deleting a **published** shift is a **soft cancel** (status *cancelled*), so the record remains. Only **drafts** are removed outright.

**"Why can't this employee be scheduled in this position?"**
They may not be assigned to that **job area**, or the area may be **deactivated**. Add the area to their employee record (up to 4) or reactivate the area under **Job areas**.

---

## Source (footnote)

`src/app/reports/scheduling/` (page.tsx, actions.ts, swaps/, time-off/, availability/, notifications/, my-schedule/, _components/{availability-form, time-off-form, swap-form, swap-action-button, claim-open-shift-button}.tsx); `src/app/admin/scheduling/` (page.tsx, shifts/page.tsx + _components/{week-board, assign-popover, publish-button}.tsx, publish/page.tsx, publish/requests/_components/requests-client.tsx, job-areas/_components/job-areas-client.tsx, settings/_components/settings-form.tsx, _components/scheduling-nav.tsx, _lib/{grid-actions, publish-request-actions, enforcement, governance-actions}.ts); `src/app/admin/employees/_components/employee-form.tsx` (job areas, max weekly hours); `src/app/api/offline-sync/route.ts` (scheduling replay = availability + time-off only); `docs/training/00-MANIFEST.md`.
