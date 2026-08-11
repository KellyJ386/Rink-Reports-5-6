# 3. Scheduling — For Staff

## 3.1 The one concept to learn first: draft vs. published

Every shift starts life as a **draft** while managers build the schedule. Staff never see drafts. Only when a schedule window is **published** — a two-person approval among admins — do shifts appear in your app, your calendar feed, and your notifications. A published shift is locked: managers can't quietly edit it; any change re-publishes it and notifies you, and a cancellation notifies you too.

Everything you see in scheduling is shown in your **facility's local time**, and your "week" starts on whatever day your facility configured (usually Sunday).

## 3.2 The scheduling hub

Open **Reports → Scheduling** (the tile's badge counts your unread notifications plus open shifts you could pick up). Top to bottom:

1. **NEXT SHIFT hero** — your next shift with a countdown ("NEXT SHIFT · IN 6H"), the time range, and department · role. Buttons: **Request swap** and **Full schedule**.
2. **7-day week strip** — a dot marks each day you work.
3. **Upcoming** — your next shifts over the coming 28 days.
4. **Open · Pick up** — shifts available to claim (hidden when there are none).
5. **Your claims · Awaiting approval** — claims you've made that a manager hasn't decided yet.
6. **Quick links** — My schedule, Time off, Availability, Shift swaps, Notifications.

## 3.3 My schedule

The full personal schedule with a **LIST | WEEK** toggle. List view has From/To date filters and a status filter (Published, or All — which adds cancelled shifts). A header link, **Available offline →**, opens the offline copy of your schedule; bookmark it if you work in a dead zone.

**Dropping a shift.** Each shift you can still drop shows a **Drop** button — it only appears when the shift is published and far enough out to satisfy your facility's drop-notice window. Tapping it opens a confirm dialog whose wording tells you exactly what will happen:

- If your facility requires manager approval (the default): *"Your manager will be asked to approve. You're still on the shift until they do."* → **Request drop**. The row then shows **Drop pending** with a **Withdraw** button.
- If it doesn't: *"This releases the shift immediately — it goes to the open list for a coworker to pick up."* → **Drop shift**.

You can add an optional reason for your manager. Dropping is online-only — the server re-checks everything the moment it runs.

**Calendar sync.** At the bottom of My schedule, the **Calendar sync** card gives you a personal subscription link for Google or Apple Calendar. Tap **Turn on calendar sync**, then **Copy link** and subscribe in your calendar app; your published shifts appear automatically and update within a few hours. The feed covers the last week and the next 60 days. Treat the link like a password — anyone with it can see your shifts. If you ever share it by mistake, tap **Reset link** and old links stop working immediately.

## 3.4 Open shifts: claiming extra work

Shifts that need coverage appear under **Open · Pick up** on the hub and My schedule — only shifts starting within the next 14 days, soonest first, up to five per list. Tap **Claim shift**:

- If your facility runs first-come-first-served, the shift is yours immediately.
- Otherwise the card says "· Approval req." and your claim goes to a manager; it appears under **Your claims · Awaiting approval** until decided.
- If a coworker beat you to it: "That shift is no longer available."
- The system re-checks your certifications, overlaps, and hours — a claim can be refused on the rules even if the shift is open.

Open shifts appear when a schedule is published with unassigned shifts, when a drop is approved, or when approved time off frees up a shift.

## 3.5 Availability

**Availability is a recurring weekly pattern**, not a one-off: what you set for a Tuesday applies to *every* Tuesday. That's the single most common misunderstanding — the day page even says so.

From the hub, open **Availability**, pick a day, and add blocks:

- **Start / End time**, and a **Type**: **Available**, **Preferred**, or **Unavailable**.
- **Area / department you want to work** — only your assigned job areas are offered, plus "No preference".
- **Effective from / to** dates for temporary patterns (a semester, a season).
- Optional notes. Edit or delete blocks any time.

Know what each type actually does: only **Unavailable** blocks affect enforcement (a manager scheduling over one gets warned). Available and Preferred are planning information for whoever builds the schedule. Availability submission can be turned off facility-wide; you'd see a notice if so.

Adding and editing availability works offline and syncs later.

## 3.6 Time off

From the hub, open **Time off** → **New request**. Pick the start and end (interpreted in facility-local time), add an optional reason for your manager, and **Submit request**.

Requests move through statuses: **pending** → **approved**, **denied**, or **cancelled**. You can **Cancel** your own request while it's pending or even after approval — but not once it's denied or cancelled. When a manager decides, you get a notification (and usually an email) including any note they wrote.

Time-off requests can be submitted offline.

## 3.7 Shift swaps

From the hub, open **Shift swaps** → **New swap request**:

- **Your shift to give up** (required) — your published shifts over the next 60 days.
- **Coworker (optional)** — leave it as "Anyone" to post an open request.
- **Their shift to take (optional)** — appears after picking a coworker; leave blank to "just cover mine (no trade)".
- An optional note, then **Send swap request**.

Your **Outgoing** and their **Incoming** lists track every request with a status badge:

| Status | Meaning |
|---|---|
| Pending | Filed, not yet accepted |
| Accepted | The coworker accepted (or a manager accepted on their behalf) |
| Approved & applied | A manager approved — the shifts have actually moved |
| Denied | A manager refused |
| Cancelled | Withdrawn by the requester or a manager |
| Expired | Nobody decided in time (default 72 hours) and it lapsed automatically |

**Accepting a swap does not move the shift.** A manager must give final approval, and that approval re-checks both people against all the scheduling rules — so a swap can still fail at the last step if, say, it would double-book someone. Until you see **Approved & applied**, plan to work your original shift.

## 3.8 Notifications

The hub's **Notifications** link (red badge = unread) collects everything scheduling tells you: schedule published, shift changed, open shift available, swap request received/approved/denied, time off decided, overtime warnings, and automatic shift reminders 24 hours before each published shift.

Most rows have a **Mark read** button. One is special: a **Schedule published** notification has an **Acknowledge schedule** button instead — pressing it tells your manager you've seen the new schedule, and managers see the roll-up ("acknowledged 7/12") on their side. Make it a habit after every publish.

## 3.9 What works offline

| Action | Offline? |
|---|---|
| Viewing your schedule (/offline-schedule) | Yes — last-synced copy |
| Requesting time off | Yes — queued |
| Adding/editing availability | Yes — queued |
| Claiming an open shift | No — online only |
| Dropping a shift / withdrawing a drop | No — online only |
| Swap requests and accepts | No — online only |
| Notifications / acknowledging | No — online only |

The online-only actions all depend on live shift state that could change while you're offline — the app refuses to let you act on a world that may have moved on.
