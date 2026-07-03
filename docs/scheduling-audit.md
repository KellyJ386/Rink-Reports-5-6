# Employee Scheduling — Full Module Audit

_Audit date: 2026-07-02. Scope: everything under `/admin/scheduling` (all 11 sub-pages), the
server actions and ~30 scheduling migrations, the staff-facing app under `/reports/scheduling`,
offline/PWA behavior, notifications, and exports._

## Executive summary

The foundation is genuinely strong: centralized rule enforcement (one SQL validator called from
every assignment path), a database-level double-booking guard, a two-person publish workflow with
a real publish lock, timezone-aware validation, and a keyboard-accessible drag-and-drop grid.
What holds the module back from "best out there" falls into three buckets:

1. **Real bugs / correctness holes** (section A)
2. **Inconsistent UX polish** (section B)
3. **Missing table-stakes features** competitors have — automated email/push notifications,
   printable schedules, calendar sync, schedule acknowledgment, cost tracking with real wages
   (sections B and C)

## What exists today

**Admin** (`/admin/scheduling`) has 11 sub-pages: an Overview hub with KPIs and pending-request
panels; the **Shifts board** (day/week/month views, drag-to-create/move/resize, live conflict
warnings, coverage heatmap, CSV export, publish-request button); Templates; Publish history;
Publish requests (two-person approval — the only way to publish); Time-Off queue; Swaps queue;
Compliance rules; Job areas (with per-area cert requirements); Settings; and a Notifications log
with a manual "send reminders" form.

**Staff** (`/reports/scheduling`) already covers: next-shift hero, my-schedule (list + week
calendar), time-off requests, weekly availability, shift swaps with coworker targeting,
open-shift claiming, and an in-app notification feed. Time-off and availability work offline
through the service-worker queue.

**Enforcement is the crown jewel**: every path that assigns an employee (grid, open-shift
assign, swap approval, publish, self-claim) runs the same SQL function
(`scheduling_assignment_violations`) checking certs, overtime, minor hours, rest periods,
breaks, double-booking, time-off, unavailability, and job-area qualification. Missing certs
hard-block with an audited override; everything else is warn-and-confirm. The publish lock is
closed on all three legs (INSERT/UPDATE/DELETE) and governed RPCs are atomic (`FOR UPDATE`).

---

## A. What to FIX (correctness bugs, priority order)

1. **Approving time-off doesn't check existing shifts** — `governance-actions.ts:87-158`.
   Approve time-off after a week is published → silent conflict; nobody is warned, the shift
   stays assigned. Fix: on approve, query overlapping shifts, show them to the admin, offer
   "approve + convert shifts to open."
2. **Scheduling never sends email/push — and reminders are manual.** All scheduling
   notifications live in the in-app-only `schedule_notifications` table; the mature
   outbox→email pipeline (`src/lib/notifications/`) is unused by scheduling. Shift reminders
   require an admin to click a button (`send-reminders-form.tsx`). Staff who don't open the app
   never learn the schedule was published. Fix: route publish/cancel/time-off-decision/reminders
   through the existing outbox + add a reminders cron.
3. **Timezone/week-start inconsistencies.** Hub computes "this week" in UTC
   (`admin/scheduling/page.tsx:30-42`) while the board uses local time
   (`week-board.tsx:160-169`); "Apply template" hardcodes "Sun-anchored" regardless of
   `week_start_day` (`apply-template-form.tsx:80`); "Last published" formats in server TZ.
   Fix: one facility-TZ week helper everywhere (migration 137's engine already exists
   server-side).
4. **No confirmation or undo on shift delete** — 3 paths (`week-board.tsx:477`,
   `board-pieces.tsx:555`, `assign-popover.tsx:336`) delete instantly. Templates, compliance
   rules, and job areas *do* confirm — inconsistent. Fix: confirm dialog + post-delete undo
   toast.
5. **Admin `cancelTimeOffRequest` is unguarded** — `governance-actions.ts:160-184`: no status
   check (an already-denied request can be "cancelled"), and no notification to the employee
   (deciding a request does notify).
6. **Stale generated DB types** — `settings-form.tsx:78-91` casts around migration-117 columns
   (`availability_submission_enabled`, `require_job_area_qualification`,
   `block_on_violations`). Run `pnpm types:write` (CLAUDE.md rule; CI checks freshness).
7. **Hardcoded $26/hr labor rate** — `week-board.tsx:76` drives the Labor cost KPI and
   "Est. pay". Fix: per-employee wage column (employees module) with facility default fallback.
8. **Month view lies** — the KPI strip + CSV export still compute a one-week window while the
   grid shows a month (`week-board.tsx:204-209`, `:666`), so what's on screen doesn't match
   what's counted or exported.
9. **Positive availability is write-only.** Staff submit `available`/`preferred` blocks but
   only `unavailable` is enforced or shown anywhere. Fix: surface availability in the assign
   popover and rank/annotate candidates.
10. **Cert enforcement is string-coupled** — `job_area_certification_requirements.cert_name`
    must textually equal `employee_certifications.name` (migration 118). A typo/rename silently
    changes enforcement. Fix: FK to a cert-type table.
11. **Missing DB constraints** — overlapping/duplicate time-off requests and contradictory
    availability rows are accepted (no overlap constraints; only double-booking has a GiST
    backstop, migration 140).
12. **Offline silent fallthrough** — when no service-worker controller exists,
    `enqueueSubmission` returns false and forms fall through to a server action that fails
    offline with no "saved offline" message (`use-sync-queue.ts:71-73`).
13. **Dead `compliance_warnings` column** — always written `[]` (`grid-actions.ts:467`,
    `admin-core-actions.ts:631`); warnings are recomputed live instead. Persist on write or
    drop the column.
14. **Smaller items:**
    - `shift_reminder` is missing from the notifications badge map (falls back to grey), and
      that page hardcodes raw Tailwind palette colors — violating the semantic-token/dark-mode
      convention (as does the staff hub, `reports/scheduling/page.tsx:23-26`).
    - Compliance reorder ↑/↓ buttons lack aria-labels (`compliance-client.tsx:176-191`).
    - `AssignPopover` is a hand-rolled dialog: no focus trap, no Escape handler, and a backdrop
      click discards edits without a guard.
    - The hub's Modules grid omits a Job Areas card even though it's a top-level tab.
    - `PublishButton` allows publish requests for empty weeks (no zero-draft guard).
    - Swap requests aren't validated upfront — staff can submit swaps that can never be
      approved and only find out at manager approval time (`reports/scheduling/actions.ts`).
    - Several lists silently cap at 50–500 rows with no pagination (time-off 50, notifications
      100, coworker shifts 500).
    - Template shift form still requires `department_id` although the DB made it nullable
      (migration 130).
    - `shift_changed` notification type is overloaded for cancellations (migration 150
      workaround) — recipients can't distinguish an edit from a cancel.
    - `saveGridTemplate`'s comment claims applying a template re-runs assignment checks;
      `applyTemplateToWeek` actually bulk-inserts raw rows (safe only while template shifts are
      always unassigned — a fragile, undocumented invariant).

## B. What to CHANGE (UX / product)

1. **Add an admin Availability page.** Settings has an availability-submission toggle but
   managers have no screen to *see* submitted availability. A week grid of who's
   available/preferred/unavailable is core scheduling UX.
2. **Unify destructive-action UX** (confirm + undo everywhere) and **unify the two inboxes**
   (scheduling's `schedule_notifications` vs communications' `communication_messages`).
3. **Time-off approval with context**: show the employee's shifts in the requested range,
   remaining crew that day, and other approved time-off overlapping it.
4. **Printable/exportable schedules**: a print-view week grid and per-employee schedule PDF.
   Today the exports module emits a flat shift dump, and scheduling is the one module without
   per-column configuration (`MODULE_COLUMN_OPTIONS`).
5. **Dashboard surfacing**: next shift + unread scheduling count on the staff dashboard tile;
   pending approvals count on the admin side.
6. **Heatmap driven by data, not hardcoded 7–21 "core hours"** (`week-grid.tsx:554`) — use
   operating hours or demand.
7. **Offline coverage**: make the main "My schedule" view offline-capable (the separate
   `/offline-schedule` shell is barely discoverable — one small text link), and either queue or
   clearly disable cancel/claim/swap actions offline.
8. **Template quality-of-life**: auto-generate slug, "copy last week," drop the department
   requirement on template slots.

## C. Ideas to be BEST-IN-CLASS

1. **Smart assignment suggestions** — rank eligible employees per open slot by qualification,
   cert validity, availability/preference, hours remaining under cap, rest rules, and cost. One
   "Suggest fill" button on every open shift. All enforcement data already exists in
   `scheduling_assignment_violations`; this is a UI over data the system already has.
2. **Schedule acknowledgment** — "12 of 15 staff have seen this week's schedule." The
   communications pipeline already supports `requires_acknowledgement`; scheduling just doesn't
   use it.
3. **Calendar sync (ICS feed)** — tokenized per-employee URL so shifts land in Google/Apple
   Calendar automatically. Cheap to build, huge perceived value.
4. **Web push notifications** — it's already a PWA with a service worker; push for
   publish/reminders/swap events is the natural next step past email.
5. **Publish diffs** — on republish, compute what changed vs the last publish and notify only
   affected employees ("your Tuesday shift moved 1h earlier") instead of a generic blast.
6. **Labor budget view** — real wages + weekly budget vs scheduled vs overtime forecast on the
   KPI strip.
7. **Demand-linked coverage** — tie rink events/ice slots to required staffing levels so the
   heatmap shows true under/over-staffing. This is the rink-specific angle generic scheduling
   tools can't offer.
8. **Time-clock lite** — clock-in/out against shifts with variance reporting; unlocks
   actual-vs-scheduled labor cost.
9. **Multi-week rotation patterns** and shift bidding/standby lists for open shifts.
10. **Schedule activity timeline** — an audit feed of edits/approvals. Today only publishes and
    cert overrides are audited; time-off/swap decisions and shift edits leave no dedicated
    trail.

---

## Notable strengths (for balance)

- Single-source validator called by every assignment path — rules cannot drift or be bypassed.
- Two-person publish enforced at RLS **and** row-level CHECK constraints.
- Publish lock closed on INSERT/UPDATE/DELETE (migrations 148/164); governed SECURITY DEFINER
  RPCs are atomic and race-safe (`FOR UPDATE` / `SKIP LOCKED`).
- GiST exclusion constraint makes double-booking race-proof at the DB boundary (migration 140).
- Cert overrides get an immutable audit table (migration 148).
- Facility-timezone-correct validator windows and availability matching (migration 137).
- Offline replay is idempotent (`offline_sync_queue.local_id`) with online-parity permission
  checks.
- Every route has a `loading.tsx` skeleton; the shift grid supports keyboard drag-and-drop via
  `@dnd-kit` with published-shift locking mirrored in the UI.

## Critical files (for follow-up fixes)

- Admin board: `src/app/admin/scheduling/shifts/_components/{week-board,week-grid,assign-popover,board-pieces}.tsx`
- Server actions: `src/app/admin/scheduling/_lib/{grid-actions,governance-actions,admin-core-actions,publish-request-actions,enforcement}.ts`
- Validator + lock: `supabase/migrations/00000000000118…137…148…164` (`scheduling_assignment_violations`, publish lock)
- Notifications: `src/lib/notifications/dispatch.ts`, `src/app/api/cron/*`, `send-reminders-form.tsx`
- Staff: `src/app/reports/scheduling/*`; offline: `src/lib/offline/use-sync-queue.ts`, `src/app/api/offline-sync/route.ts`
