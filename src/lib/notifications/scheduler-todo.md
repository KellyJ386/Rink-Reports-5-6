# Notification scheduler — deferred

Phase 4 of the production permission roadmap built the rule schema,
the recipient resolver, the per-rule timing column (immediate /
end_of_day / weekly / manual), and the `notification_outbox` table.
Immediate sends are dispatched inline by
`dispatch_rules_for_submission()` at submission time.

What is **not** wired up:

- A worker that scans `notification_outbox` for `status='pending'`
  rows whose `scheduled_for <= now()`, attempts delivery, and sets
  `status='sent'` (or `'failed'` with the error message).
- A way for the in-app "delivery" itself — today the function just
  marks the outbox row `sent` for immediate sends without inserting
  into `communication_messages` / `communication_recipients`. A
  follow-up should either:
    1. Replace the inline `status='sent'` with a real insert into
       `communication_messages` so the user sees it in their inbox, or
    2. Add a separate delivery worker that drains the outbox and
       writes the message rows.
- The "attach_pdf" flag is stored but no generator exists. UI surfaces
  the toggle with a clear note that it is non-functional until a
  PDF backend lands.
- No transport other than in-app (email/SMS deliberately out of scope).

## Implementation options when ready

**Option A — pg_cron**
- Enable `pg_cron` in a future migration.
- Define a job that runs `select * from drain_notification_outbox()` every
  minute. That function needs to be added; it should `update` the row to
  `status='sent'` (or `'failed'`) inside a single transaction per recipient.

**Option B — Next.js cron route**
- Add `/api/cron/drain-notifications/route.ts` with a `Cron-Secret` check.
- Wire to Vercel Cron (`vercel.json`) or external scheduler.

Either way, audit the choice for cross-facility leakage — the worker
must respect `facility_id` boundaries even though it runs with elevated
privileges.

## Why now is OK

The outbox is the source of truth. As long as `dispatch_rules_for_submission`
is being called from each submission action (it is, for the modules wired
in Phase 4), nothing is lost. End-of-day/weekly notifications simply sit
in the outbox with `status='pending'` until a worker is built.
