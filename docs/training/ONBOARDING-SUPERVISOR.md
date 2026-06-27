# Supervisor Onboarding — Day-to-Day Oversight

*RinkReports · Version 5-6 · for supervisors (the live `manager` role or an elevated custom role)*

This guide covers what a supervisor does day to day, roughly in the order a shift unfolds: keep the schedule moving, decide the requests that land in your queue, and review what staff submitted. Links jump into the full chapters.

> **⚠ VERIFY — your rights are permission-driven, not granted by your title.** "Supervisor" is the documentation tier; the live role is `manager` (or a custom role). What you can actually do depends on the **per-module / per-action permissions** an admin has enabled for you — not on the word "manager." Two people with the same title can have different access. Every right below is a *typical* one; if a screen shows you "Forbidden" or hides a button, you simply haven't been granted that permission. Ask your admin. See [How RinkReports is organized](./MASTER-MANUAL.md#how-rinkreports-is-organized).

---

## 1. Start of shift — check the schedule

- [ ] **Review the week and open shifts.** Open **Scheduling Admin → Overview** for the dashboard (pending swaps/time-off, open shifts, week-at-a-glance), then **Shifts** for the grid. *(⚠ VERIFY — the admin grid needs the scheduling `admin` permission; if you lack it you'll see a Forbidden message. See [Employee Scheduling §5 — Admin grid](./modules/employee-scheduling.md#admin-grid--adminschedulingshifts).)*
- [ ] **Watch for coverage gaps and warnings.** The grid's right rail shows open shifts needing coverage and each person's hours vs. cap. Cert blocks are hard stops; overtime/overlap are advisory warnings. *(See [Employee Scheduling §8 — Certification & warning gates](./modules/employee-scheduling.md#certification--warning-gates-when-assigning).)*

## 2. Through the day — decide requests as they arrive

These are the approval queues that typically route to a supervisor. Only **pending** items can be decided.

- [ ] **Time-off requests.** **Scheduling Admin → Time-Off** → **Approve** / **Deny** (optional note). The employee is notified of the decision. *(See [Employee Scheduling §5 — Time-off & swaps](./modules/employee-scheduling.md#time-off--swaps-admin).)*
- [ ] **Shift swaps.** **Scheduling Admin → Swaps** → assign a target, **Approve** (re-runs all rule checks and applies the trade/coverage), **Deny**, or **Cancel**. An applied swap can't be undone afterward.
- [ ] **Open-shift claims.** Claims that need approval appear for you to approve before the shift is assigned. *(See [Employee Scheduling §5 — Staff app: Open shifts](./modules/employee-scheduling.md#staff-app--reportsscheduling).)*
- [ ] **Publishing (two-person rule).** A schedule is **requested for publish** by one admin and **approved by a different one** — you cannot approve your own request. If you filed it, a colleague approves; if a colleague filed it, you can **Approve & publish** or **Reject** with a reason. *(See [Employee Scheduling §5 — Publishing](./modules/employee-scheduling.md#publishing) and [§8 — Draft → Published lifecycle](./modules/employee-scheduling.md#draft--published-lifecycle).)*

## 3. Review what staff submitted

Each report module has an admin **History** tab with filters and a drill-down detail panel. Supervisors review submissions and add **follow-up notes** — they do **not** edit the original (records are append-only). *(⚠ VERIFY — History/admin tabs require that module's `admin` permission.)*

- [ ] **Daily Reports** — **Daily Reports Admin → Submissions**: filter by area/employee/date, open a submission, add an admin note (history auto-deletes after 14 days). *(See [Daily Reports §5 — Admin tabs](./modules/daily-reports.md#admin-tabs-submissions-review).)*
- [ ] **Refrigeration** — **Refrigeration Admin → History**: review readings, out-of-range flags, and corrective-action notes; **Add follow-up note**. *(See [Refrigeration §5.4](./modules/refrigeration-logs.md#54-admin--history-tab).)*
- [ ] **Air Quality** — **Air Quality Admin → History**: review readings, exceedances, and corrective notes; add follow-up notes. *(See [Air Quality §4 — History tab](./modules/air-quality.md#history-tab-review).)*
- [ ] **Ice Operations** — **Ice Operations Admin → History**: review operations and failed circle checks; add follow-up notes. *(See [Ice Operations §5 — Admin tabs](./modules/ice-operations.md#admin-tabs-admin--ice-operations).)*
- [ ] **Ice Depth** — **Ice Depth Admin → History** (and **Analytics** for trends/problem spots): review sessions; add follow-up notes. *(See [Ice Depth §5 — Admin tabs](./modules/ice-depth.md#admin-tabs-admin--ice-depth).)*
- [ ] **Incidents** — **Incident Reports Admin → History**: review reports, **change status** (Submitted → In review → Resolved → Archived), and add follow-up notes. The reporter owns the first 24 hours of edits; after that only status/notes change. *(See [Incident Reporting §5.E](./modules/incident-reporting.md#e-admin-incident-reports-admin-adminincident-reports) and [§8](./modules/incident-reporting.md#8-locking-saving--offline).)*

## 4. Follow-ups and handoffs

- [ ] **Add follow-up notes, don't rewrite.** Follow-up notes are append-only and visible on the report; the original submission is immutable. Use them to record corrections, actions taken, or context for the next shift.
- [ ] **Escalate alerts.** Critical signals — a failed circle check, an out-of-range refrigeration/air-quality reading, an "ambulance called" incident — raise alerts (when alerts are enabled) that surface in the Communications/alerts area for acknowledgement. *(See each module's "Locking, saving & offline" section.)*

---

## What a supervisor typically cannot do

Unless an admin has specifically granted it (⚠ VERIFY per facility):

- **Configure** a module's setup/settings (that's the module's `admin` permission — facility_manager tier).
- **Edit** a staff member's submitted report in place (everyone uses follow-up notes; incidents' 24-hour window belongs to the *reporter*).
- **Approve your own** publish request (always a different admin).
- Anything in the **Admin Control Center** Setup/System screens or the **Super Admin** console without the matching permission.

See the [Admin onboarding guide](./ONBOARDING-ADMIN.md) for the configuration tasks that sit above the supervisor's day-to-day work.
