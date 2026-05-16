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

## PDF attachments (shipped — in-app + email)

`attach_pdf` on a routing rule now renders a PDF of the source record
and delivers it both via the in-app message and as an email attachment:

1. `renderDuePdfs()` in the drain cron route picks `notification_outbox`
   rows with `attach_pdf = true` and `pdf_url IS NULL`, calls
   `renderPdfForModule()` (`src/lib/notifications/pdf/render.tsx`), and
   uploads the buffer via `uploadSubmissionPdf()`. The storage path is
   stamped back onto the outbox row.
2. `drain_notification_outbox()` copies `pdf_url` onto the
   `communication_messages` row when it fans the outbox into messages.
3. The recipient's inbox (`src/app/reports/communications/page.tsx`)
   signs the storage path on read and `message-detail.tsx` renders a
   "Download PDF attachment" button.
4. `runEmail()` in the send-communications cron route reads the same
   `pdf_url`, fetches the bytes once per path via `downloadPdf()` (cached
   per batch), and passes them to Resend as a single
   `rink-report.pdf` attachment. PDF download failures degrade to a
   text-only send rather than blocking the run.

Per-module templates exist for `accident_reports`, `air_quality`,
`daily_reports`, `ice_depth`, `incident_reports`, and `refrigeration`.
Other modules fall back to the generic `SubmissionPdf` template using
`fetchSubmissionSnapshot`.

## Still deferred

- **Failed-send retries.** The drain function only marks rows `sent`
  or leaves them `pending`. It does not handle `failed` rows yet —
  there is no transport that can fail (insert into Postgres is the
  whole pipeline). When a transport that can fail is added (email
  bounce, push token expired), introduce an `attempts` column and
  exponential backoff in the claim query.
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
