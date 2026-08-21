# 5. Employee Scheduling Setup

Scheduling administration requires the scheduling module's Admin grant on top of console access. Configure in this order:

## 5.1 Seed and review Settings

**Admin → Scheduling → Settings.** If no settings exist yet, **Seed defaults** creates the settings row *and* three starter compliance rules (minor max weekly hours, overtime threshold, required break). Then review:

| Setting | Default | Why it matters |
|---|---|---|
| Week start day | Sunday | Drives every week window, staff and admin |
| Default shift minutes | 480 | Length of a freshly drawn shift |
| Minor max weekly hours / Overtime / Break rules | 18 / 40 / 30 min after 6 h | Feed the assignment warnings |
| Swap request expiry (hours) | 72 | Undecided swaps lapse automatically |
| Default hourly rate | — | Labor-cost fallback when an employee has no wage |
| Opens at / Closes at | 06:00–23:00 | The grid's visible hours (a "closes at midnight" checkbox exists) |
| Shift-drop notice (hours) | 0 | How far ahead staff must drop a shift |

**Toggles** with the biggest visible impact: swaps require manager approval · **open shifts first-come-first-served** (off = every claim needs a manager) · notify on publish · notify on overtime · allow staff availability submission · require job-area qualification · **block grid saves that raise warnings** (turns advisory "Confirm & save" into a hard wall) · **shift drops need manager approval** (changes the staff Drop dialog and whether the button appears).

## 5.2 Job areas and certifications

**Admin → Scheduling → Job areas** — the areas employees can be assigned to (Front Desk, Concessions…); each employee holds up to four (assigned on their employee record). Add areas, order them, and — the important part — attach **required certifications** per area. These requirements are exactly what produces the hard certification block when someone unqualified is put on a shift, so they're only as good as the cert records on employee profiles (chapter 2.6).

## 5.3 Compliance rules

**Admin → Scheduling → Compliance** — the facility-level rules driving assignment warnings: Minor max hours, Overtime, Break required, Certification required, Min rest between shifts, plus custom rules. The seeded three cover most facilities; add or adjust as your jurisdiction requires. The bottom of the page keeps the **certification override audit log** — every manager override, with who, what, and the reason.

## 5.4 Templates

**Admin → Scheduling → Templates** — reusable weekly patterns. Build one from scratch (slots by day: job area, times, break minutes, role label, staff count), or capture one later from the grid with **Save as template**. Applying a template always produces **unassigned draft shifts** — it can never place people, so the rules engine is never bypassed.

## 5.5 Know the publish flow before your first schedule

Publishing is a deliberate two-admin handshake: one admin files **Request publish** from the grid; a *different* admin approves it under **Publish requests** (the separation is enforced — you can't approve your own). Approval re-validates every assigned draft, publishes, opens claim listings for unassigned shifts, and notifies staff. Plan for two scheduling admins per facility or publishes will stall.

Draft shifts are invisible to staff; only publishing releases them. Reminders go out automatically 24 hours before each published shift.
