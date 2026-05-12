# Notification scheduler

Phase 4 built the rule schema, the recipient resolver, the per-rule
timing column (immediate / end_of_day / weekly / manual), and the
`notification_outbox` table. Immediate sends are dispatched inline by
`dispatch_rules_for_submission()` at submission time.

## Drain worker (migration 47 + cron route)

`drain_notification_outbox(p_max_rows)` (migration 47) processes due
outbox rows by:

1. Claiming `status='pending'` rows whose `scheduled_for <= now()` with
   `FOR UPDATE SKIP LOCKED` so multiple workers can't double-send.
2. Grouping by `(facility_id, rule_id, source_record_id, subject)` and
   inserting a single `communication_messages` row per group.
3. Fanning the group's recipients into `communication_recipients`.
4. Marking the claimed outbox rows `sent`.

Email/SMS is explicitly out of scope: the message lands in the in-app
inbox via `communication_messages` and shows up the next time the
recipient loads their dashboard.

The route at `src/app/api/cron/drain-notifications/route.ts` calls
that function. It requires:

- `SUPABASE_SERVICE_ROLE_KEY` — server-only env var; never exposed.
- `CRON_SECRET` — must be sent as `Authorization: Bearer <secret>`.

`vercel.json` schedules it every 5 minutes. Other hosts can configure
GitHub Actions, an external uptime ping, or pg_cron with the same path.

## Still deferred

- **PDF attachments.** `attach_pdf` is stored on routing rules and on
  outbox rows but the drain function ignores it. When a PDF renderer
  is added it should generate the attachment, upload to Supabase
  Storage, and store the object URL in a new column (e.g. `pdf_url`)
  before the message is created. Until then the toggle is a no-op
  preference; the UI surfaces this clearly.
- **Failed-send retries.** The function only marks rows `sent` or
  leaves them `pending`. It does not handle `failed` rows yet —
  there is no transport that can fail (insert into Postgres is the
  whole pipeline). If a future transport (push, email) is added,
  introduce an `attempts` column and exponential backoff in the
  claim query.
- **Per-recipient acknowledgement requirements.** The drain inserts
  `requires_acknowledgement = false`. If a future rule should require
  ack (e.g. accident reports with severity = critical), add a column
  to `communication_routing_rules` and propagate it through the
  outbox row to the message insert.

## Local testing

```bash
# In one terminal: a local supabase stack must already be running.
psql "$DATABASE_URL" -c "select * from public.drain_notification_outbox(500)"

# Or via the route, with the dev server running:
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/drain-notifications
```
