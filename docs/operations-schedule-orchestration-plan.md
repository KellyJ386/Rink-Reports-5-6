# Connected Operations Scheduling — Review Plan

**Plan date:** 2026-09-12  
**Status:** Proposed for operational and product review; no production behavior changes are included in this plan.  
**Objective:** Connect the facility schedule, employee schedule, spaces, and operational reports so that the right on-duty employee receives a timely, actionable task and supervisors can see what is upcoming, late, completed, or uncovered.

## 1. Executive summary

The recommended design is an **operations orchestration layer**, not a direct set of one-off links between modules. Facility bookings and published employee shifts remain the sources of truth. Configurable rules translate schedule events into durable operational tasks such as:

- notify the on-duty ice technician 10 minutes before a planned ice make;
- create a locker-room inspection 30 minutes after a team's ice time ends;
- remind a manager that a rental is starting or ending;
- place quality, air-quality, ice-depth, or refrigeration readings into suitable gaps while qualified staff are on duty; and
- escalate work that has no eligible assignee, is not acknowledged, or is overdue.

The layer should create **tasks**, not transient reminders. A notification is only a delivery mechanism for a task. This gives staff a single “My operations” timeline, gives supervisors a live control board, records completion evidence, and makes retries and schedule changes safe.

### Recommended first release

Start with one rink and four workflows:

1. ice-make preparation;
2. post-rental locker-room inspection/cleaning;
3. rental start/end awareness for the duty manager; and
4. refrigeration readings scheduled once per shift in a configurable low-activity window.

Run the system in **suggest-only mode** for two weeks before enabling staff notifications. Keep existing manual procedures during the pilot, measure accuracy, then enable automatic assignment and escalation one workflow at a time.

## 2. Current foundation to reuse

The application already has most of the facts needed for orchestration:

| Existing capability | How orchestration uses it |
|---|---|
| `rink_bookings` and booking types | Rental start/end and customer/team context |
| `rink_locker_room_assignments` | Which rooms must be checked after a booking |
| `rink_resurfaces` and resurface plans | Explicit ice-make events rather than guessing from booking gaps |
| `schedule_shifts` | Who is actually on duty; only `published` shifts are eligible |
| `employee_job_areas`, qualifications, and certifications | Match work to ice tech, custodial, manager, or other qualified staff |
| Daily area assignment engine | Proven precedent for resolving schedule-driven responsibility |
| Report submissions | Completion evidence for refrigeration, air quality, ice depth, ice operations, and daily checks |
| Scheduling notifications plus email outbox | Existing in-app and email delivery patterns |
| Cron routes and `cron_runs` | Recurring evaluation, delivery, observability, and retry patterns |

The orchestration layer must not silently change bookings, published shifts, or compliance reports. It reads those modules, creates operational work, and links the eventual completion record back to its source task.

## 3. Operating model

### 3.1 One shared operational timeline

Every relevant source change produces or updates a normalized **operational event**:

- booking starts, booking ends, or booking is cancelled;
- locker room becomes due for turnover;
- planned resurface approaches;
- employee shift starts, ends, changes, or is cancelled;
- required report cadence becomes due; and
- facility opening, closing, or a configured inspection window occurs.

Rules evaluate those events against published staffing and create **task instances**. Each task has:

- a due window (`available_at`, `due_at`, optional `expires_at`);
- a facility, rink/space, booking, locker room, or report context;
- required job areas/certifications;
- an assignee, assignment reason, and fallback supervisor;
- a status (`planned`, `ready`, `acknowledged`, `in_progress`, `completed`, `skipped`, `cancelled`, `overdue`);
- completion requirements (checklist, note, photo, reading, or report submission); and
- an immutable activity history.

### 3.2 Assignment hierarchy

For each task, resolve responsibility in this order:

1. **Explicit override:** a manager manually assigns the task.
2. **Scheduled qualified employee:** a published shift overlaps the task window and its job area matches the rule.
3. **Duty role:** the published shift designated as duty manager/supervisor for that time.
4. **Qualified open pool:** notify qualified on-duty staff and allow one person to claim it.
5. **Supervisor exception queue:** if nobody qualifies or coverage is missing, create an uncovered task and notify the supervisor—never silently drop it.

Tie-breakers should be deterministic and visible: direct job-area match, then task load in the surrounding hour, then earliest shift end after the due time, then stable employee ID. Managers can always reassign with a reason.

### 3.3 Notification policy

Notification timing is configured per rule, not hardcoded in UI components. A typical policy is:

| Moment | Recipient | Delivery |
|---|---|---|
| Task assigned | Assigned employee | In-app timeline; optional push/email by facility policy |
| Lead time reached | Assigned employee | In-app/push; e.g. 10 minutes before ice make |
| Not acknowledged | Employee, then duty supervisor | Escalate after configurable grace period |
| Due time passed | Employee and duty supervisor | Overdue alert |
| Coverage missing | Duty manager/scheduling manager | Immediate exception |
| Task completed | Supervisor board | Live status update; no noisy message by default |

All sends require an idempotency key such as `(task_id, notification_stage, recipient_id)`, so a 5-minute evaluator can retry without sending duplicates.

## 4. Proposed workflows

### 4.1 Ice-make preparation

**Trigger:** a confirmed planned `rink_resurface`, whether manually planned or derived by the existing resurface planner.  
**Rule:** create a task 10 minutes before the resurface start.  
**Assignee:** an on-duty employee whose shift job area maps to Ice Technician and whose shift covers the preparation and ice-make window.  
**Action:** acknowledge, begin, and complete; optionally capture machine, blade/water checks, and exceptions.  
**Fallback:** if no ice technician is available, alert the duty manager at planning time and again at the lead-time boundary.  
**Completion link:** associate the task with the resulting ice-operations/resurface record rather than duplicating that report's data.

Important rule: do not infer every empty calendar gap as an ice make. A planned resurface is authoritative. The system may recommend a resurface in a usable gap, but a manager confirms it before staff are prompted.

### 4.2 Locker-room turnover

**Trigger:** a booking with one or more locker-room assignments ends.  
**Rule:** create one parent turnover task and one checklist per assigned locker room, available at booking end and due 30 minutes later by default.  
**Assignee:** an on-duty custodial employee covering the room's turnover window.  
**Action:** inspect, clean if needed, restock, record damage/lost property, and mark ready.  
**Deadline protection:** calculate the next locker-room occupancy. If it begins sooner than the normal 30-minute target, move the due time earlier and mark the task “tight turnaround.” Never schedule a due time after the next team enters.  
**Fallback:** supervisor alert if a room is double-assigned, the turnover window is too short, or no custodian is on duty.

The task should show the prior team, next team, room, booking end, next occupancy, and remaining turnover time without exposing billing details to custodial staff.

### 4.3 Rental start and end awareness

**Trigger:** confirmed rental start and end.  
**Rules:** configurable lead notices—for example, 15 minutes before start and 10 minutes before end.  
**Assignee:** on-duty duty manager/front desk role.  
**Actions at start:** confirm customer arrival, access/readiness, payment or contract exception indicator, locker-room assignment, and special notes.  
**Actions at end:** confirm exit, overtime/extension, damage, lost property, and downstream turnover status.  
**Escalation:** surface late starts, bookings running over, and conflicts on the supervisor board.

These can begin as awareness tasks with one-tap acknowledgment; facilities can later opt into a checklist.

### 4.4 Quality and compliance work in good operating windows

Quality work differs from event-driven work: it often needs to occur once or several times per shift/day, but not during the busiest transition. The planner should therefore select a **window**, not a single brittle timestamp.

Examples:

- refrigeration reading once per shift or at configured cadence;
- air-quality check during occupied operating conditions if policy requires it;
- ice-depth measurement during a sufficiently long ice-access window;
- facility quality walk after opening or before peak activity; and
- closing checks near the last booking and before the responsible shift ends.

The planner scores candidate windows using:

1. the report's compliance interval and last valid submission;
2. equipment/space access requirements;
3. booking occupancy and transition buffers;
4. resurface activity;
5. qualified employee shift coverage;
6. enough time before the assignee's shift ends; and
7. facility-defined preferred or prohibited periods.

It should choose the highest-scoring window, explain the recommendation (“20-minute open window; refrigeration-certified manager on duty”), and re-plan if the source schedule changes. Hard compliance deadlines always outrank convenience.

## 5. Data model

Use a generic core with typed source links rather than four unrelated task tables.

### 5.1 Configuration

**`operations_rule_templates`**

- facility-scoped rule name and active flag;
- event type (`booking_start`, `booking_end`, `resurface_start`, `cadence_due`, `opening`, `closing`);
- offsets and due-window length;
- required job area/certification and fallback job area;
- checklist/template ID and completion mode;
- notification/escalation policy;
- applicability filters such as booking type, rink, space type, or operating day; and
- version number, so existing task instances retain the rule used to create them.

**`operations_job_area_mappings`**

- maps operational capabilities (`ice_tech`, `custodial`, `duty_manager`, `front_desk`) to the existing facility job-area records;
- supports multiple job areas per capability; and
- is explicitly configured per facility instead of relying on free-text role names.

### 5.2 Runtime records

**`operations_events`**

- normalized source type/ID, event kind/time, source revision, facility, context JSON, and cancellation state;
- unique on source + kind + revision/idempotency identity.

**`operations_tasks`**

- rule/version, event, context IDs, available/due/expiry timestamps;
- assignee and assignment strategy;
- status, priority, acknowledgment/completion timestamps;
- linked completion module/record ID; and
- `source_fingerprint` for safe re-planning.

**`operations_task_activity`**

- append-only assignment, acknowledgment, status, escalation, skip, and re-plan events;
- actor, timestamp, reason, and before/after metadata.

**`operations_task_notifications`**

- recipient, stage, channel, delivery status, attempt count, and idempotency key;
- bridge to the existing email outbox rather than a second email sender.

### 5.3 Security and retention

- Every row is facility-scoped and RLS-protected.
- Staff read tasks assigned to them or offered to their qualified claim pool; supervisors with an `operations` edit/admin permission see facility-wide work.
- Only the orchestration service and authorized manager actions create/reassign/cancel tasks.
- Staff cannot forge a completion link; completion is validated against a real same-facility report or an approved checklist action.
- Activity history is append-only and retained at least as long as the linked operational/compliance record.
- Customer/team details in task payloads are minimized by role; billing and private contact data are not copied into tasks.

## 6. Processing architecture

### 6.1 Event ingestion

Use an **outbox pattern** in the database. Booking, locker-room, resurface, and published-shift changes enqueue lightweight source-change rows in the same transaction. A worker claims them with `FOR UPDATE SKIP LOCKED`, normalizes events, and invokes the planner.

For the first release, a short-cadence cron (for example every 2–5 minutes) can drain the outbox and activate due tasks. This matches the current deployment model and is easier to operate than introducing a separate queue service. The worker must be safe under overlap and retries.

### 6.2 Planning versus activation

Split the engine into two stages:

1. **Planner:** looks ahead 24–72 hours, creates tasks, resolves staffing, detects coverage gaps, and re-plans when schedules change.
2. **Activator:** marks tasks ready, sends lead-time notifications, escalates missed acknowledgments/due times, and reconciles completion links.

Planning early gives supervisors time to fix tomorrow's gaps. Activating near the event avoids unnecessary staff noise.

### 6.3 Schedule changes

Each task stores a source fingerprint. When a booking, room assignment, resurface, or employee shift changes:

- untouched planned tasks are updated or reassigned;
- already acknowledged tasks receive a clear “time/assignment changed” notification;
- cancelled source events cancel their incomplete tasks and notify affected staff;
- completed tasks remain immutable and are flagged for supervisor review if the source was later altered; and
- manual assignment overrides persist unless a manager chooses “return to automatic assignment.”

### 6.4 Time handling

- Store timestamps as `timestamptz`; display and derive business-day boundaries in the facility timezone.
- Handle daylight-saving transitions through existing facility-timezone utilities.
- Use interval overlap, not calendar-date equality, for overnight shifts and rentals.
- Define whether a shift must cover the entire task window or only the due instant per rule; safety-critical work should require full-window coverage.

## 7. Product experience

### 7.1 Staff: “My operations”

A mobile-first timeline groups work into **Now**, **Next**, and **Later**:

- countdown and location;
- why the employee received it;
- source context (rink, team/rental, locker rooms);
- acknowledge/start/complete actions;
- deep link into the required report;
- “cannot complete” with structured reason; and
- offline read cache, while assignment and claiming remain online-only to prevent collisions.

Urgent tasks may use push notifications later, but the in-app task remains the authoritative record.

### 7.2 Supervisor: operations control board

The board overlays facility events and employee coverage on a shared timeline and provides:

- next 2 hours and full-day views;
- unassigned, tight-turnaround, not-acknowledged, and overdue lanes;
- staffing/qualification gaps before they become urgent;
- rental starting/ending indicators;
- room readiness and resurface status;
- suggested quality-check windows with explanation;
- drag/reassign controls with audit reason; and
- filters by rink, space, job area, employee, and workflow.

The manager should be able to answer, at a glance: **what is happening, who owns the next action, and what needs intervention?**

### 7.3 Configuration and simulation

An admin rule builder provides safe defaults but permits facility-specific offsets, role mappings, checklists, channels, and escalation times. Before enabling a rule, “Preview next 7 days” should show the tasks it would have created, proposed assignees, and gaps. Publishing a rule requires confirmation and records its version.

## 8. Delivery phases

### Phase 0 — Operational discovery and decisions (1 week)

- Shadow ice tech, custodial, front-desk, and duty-manager workflows at the pilot rink.
- Confirm actual lead times, turnover definition, quality-check cadence, escalation chain, and whether employees carry shared or personal devices.
- Map existing job areas to operational capabilities.
- Decide which alerts need in-app, push, email, or only the supervisor board.
- Establish baseline measures: missed ice makes, room-not-ready events, late checks, manager radio calls, and notification volume.

**Exit gate:** operations owner signs off on the decision register in section 10 and four pilot rule definitions.

### Phase 1 — Task foundation and shadow planner (2 weeks)

- Add configuration, event, task, activity, and notification-ledger schema with RLS.
- Add outbox hooks for bookings, locker-room assignments, resurfaces, and published shifts.
- Build pure, unit-tested assignment and window-scoring functions.
- Run planner/activator in shadow mode with no staff notifications.
- Add an admin-only preview showing proposed tasks, assignees, explanations, and exceptions.

**Exit gate:** seven days of pilot data show no cross-facility leakage, no duplicate tasks, deterministic assignments, and agreed accuracy targets.

### Phase 2 — Ice makes and rental awareness (2 weeks)

- Enable ice-make and rental start/end tasks.
- Add staff timeline, acknowledgment, manager board, reassignment, and uncovered-task escalation.
- Deep-link ice-make completion to the existing ice operations flow.
- Instrument delivered, opened, acknowledged, completed, overdue, and reassigned milestones.

**Exit gate:** at least 95% of eligible events create exactly one correct task; no critical task disappears on retries or schedule edits.

### Phase 3 — Locker-room turnover (1–2 weeks)

- Generate task/checklist instances from locker-room assignments.
- Add next-occupancy deadline compression and tight-turnaround warnings.
- Add damage/lost-property exception routing and room-ready status.
- Pilot with one custodial shift before enabling all hours.

**Exit gate:** room tasks reference the correct booking and rooms, are due before next occupancy, and uncovered periods reach a supervisor.

### Phase 4 — Quality-window planner (2 weeks)

- Add configurable cadence definitions and candidate-window scoring.
- Start with refrigeration; then add air quality, ice depth, and other daily quality checks separately.
- Deep-link to existing report forms and reconcile valid submissions as completion.
- Ensure compliance deadlines cannot be deferred by a “better” operational window.

**Exit gate:** each required cadence produces the expected number of tasks, recommends explainable feasible windows, and correctly recognizes report completion.

### Phase 5 — Hardening and broader rollout (ongoing)

- Add push delivery only after measuring in-app behavior and notification fatigue.
- Add offline timeline caching, reporting, trend dashboards, and staffing recommendations.
- Roll out rink-by-rink behind facility and per-rule flags.
- Tune rules from measured outcomes; preserve versioned history.

## 9. Acceptance criteria and test strategy

### Functional scenarios

1. **Ice make:** a 19:00 planned resurface and published 17:00–22:00 ice-tech shift creates one task due at 18:50, assigned to that technician.
2. **No coverage:** the same resurface with no qualified published shift creates an uncovered exception for the duty manager; it is never assigned to off-duty staff.
3. **Locker room:** a booking ending at 20:00 with rooms 3 and 4 creates turnover checklists due at 20:30, or earlier if either room's next occupancy begins before 20:30.
4. **Booking changed:** moving the booking updates untouched tasks; an acknowledged assignee gets a change notice; no duplicate survives.
5. **Shift cancelled:** planned tasks re-resolve; acknowledged tasks escalate; manual overrides are not silently replaced.
6. **Refrigeration:** one required reading is placed inside an eligible on-duty low-activity window and a valid submitted refrigeration report completes it.
7. **Retry:** repeated/overlapping worker runs produce the same task and notification counts.
8. **Isolation:** employees and managers cannot read, claim, update, or link tasks belonging to another facility.
9. **Timezone:** overnight shifts and daylight-saving transition days resolve to the correct facility-local timeline.
10. **Permissions:** custodial staff see room/team operational context but not rental billing or customer contact data.

### Engineering checks

- Unit tests for rule evaluation, interval overlap, assignment tie-breakers, deadline compression, scoring, fingerprints, and notification idempotency.
- SQL tests for constraints, RLS, privileged worker gates, append-only activity, and claim concurrency.
- Integration tests from source change → outbox → planner → activation → notification → completion.
- End-to-end tests for the staff timeline and supervisor exception/reassignment flow.
- Load test at several times expected peak event volume, including a morning schedule import that changes hundreds of shifts/bookings.
- Failure drills for worker timeout, email/push outage, stale shifts, deleted locker assignment, and schedule edits during activation.

## 10. Decisions needed from reviewers

| # | Decision | Recommended default |
|---|---|---|
| 1 | What is the authoritative ice-make trigger? | Confirmed `rink_resurface`; suggestions never notify until confirmed |
| 2 | Locker-room timing | Available at rental end, due 30 minutes later, compressed before next occupancy |
| 3 | Who is the fallback supervisor? | Published shift mapped to `duty_manager`; otherwise scheduling/operations admin exception queue |
| 4 | Can any qualified employee claim shared work? | Yes for low-risk checks; no for safety-critical ice work without explicit assignment |
| 5 | Which channels launch first? | In-app timeline plus supervisor board; email only for uncovered/overdue exceptions |
| 6 | What counts as acknowledgment? | Explicit one-tap acknowledgment; opening a notification is not enough |
| 7 | What completes a compliance task? | A valid linked report submission, not a manual checkbox |
| 8 | Can a manager skip a task? | Yes, with required reason and audit event; compliance tasks may not be skipped unless policy permits |
| 9 | How far ahead should planning run? | 48 hours, refreshed on every relevant schedule change |
| 10 | When may automatic rules go live? | After a two-week suggest-only pilot meets agreed accuracy and noise thresholds |

## 11. Success measures

Compare the pilot against the Phase 0 baseline:

- **Coverage:** percentage of eligible events with a correctly assigned task before lead time.
- **Readiness:** percentage of ice makes and locker turnovers completed by due time.
- **Compliance:** percentage of required reports completed inside the required interval.
- **Exception lead time:** median time supervisors receive notice of an uncovered task.
- **Assignment stability:** percentage of tasks not requiring manual reassignment.
- **Notification quality:** alerts per employee per shift, acknowledgment rate, and muted/ignored rate.
- **Operational load:** reduction in radio calls, handwritten reminders, and manager follow-up.
- **Reliability:** duplicate task/notification rate, worker failure rate, and source-to-task latency.

Initial targets for the controlled pilot should be conservative: ≥95% correct task generation, zero lost critical tasks, <1% duplicates, ≥90% on-time acknowledgment for ice-make tasks, and no increase in missed compliance readings. Final targets should be set with the facility team after baseline measurement.

## 12. Guardrails and non-goals

- Do not auto-edit the employee or facility schedule to make a task fit in the first release.
- Do not infer qualifications from free-text role labels.
- Do not send alerts from browser timers; all due-state and delivery decisions are server-owned.
- Do not make notifications the source of truth; tasks and activity history are authoritative.
- Do not mark a compliance task complete without validating its linked submission.
- Do not expose draft employee shifts to the planner; only published shifts are eligible.
- Do not hide uncovered work. A visible exception is safer than a plausible but invalid automatic assignment.
- Do not replace radio/emergency procedures for immediate life-safety events.

## 13. Review outcome

Approval of this plan should authorize **Phase 0 discovery and Phase 1 shadow-mode design only**. Before implementation begins, reviewers should confirm the ten decisions above, nominate one pilot facility and an operational owner, and provide the exact first four rule definitions. Production notifications remain off until pilot evidence is reviewed at the Phase 1 exit gate.
