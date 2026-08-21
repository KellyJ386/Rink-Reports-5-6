# 7. Communications & Alert Routing

Communications is the hub that turns module submissions into notifications. Without routing rules, alerts still land in the admin inbox — they just don't fan out to people. Set this up after the modules, because rules reference module-specific areas and severities.

## 7.1 Groups

**Admin → Communications → Groups** — named recipient lists (e.g. "Managers", "Ice Crew", "On-call"). Add members per group. The **"Staff can message this group"** toggle controls which groups appear in the *staff* compose screen — leave it off for admin-only distribution lists.

## 7.2 Templates

Reusable subject/body/acknowledgement presets used by broadcasts, staff compose, and reminders. Create at least the ones your routing and reminders will reference.

## 7.3 Routing rules — the core of alerting

Each rule fans matching submissions out to people. Per rule:

- **Name** (e.g. "Critical refrigeration alarms → on-call")
- **Source module** and a **severity** filter (info / warn / high / critical, or Any)
- **Area** (optional) — a daily-report area or air-quality location for area-scoped rules
- **Target** — exactly one of: group, role, employee, or department
- **Timing** — Immediate, End-of-day digest, Weekly, or Manual (queued, no auto-send)
- **Attach PDF of the submission** — renders a PDF of the source record, links it in-app, and attaches it to the email
- **Require recipient acknowledgement** — recipients must acknowledge in their inbox; use for critical alerts

Use **Preview Recipients** on every rule before trusting it — it shows exactly who the rule will hit.

A sensible starter set: critical refrigeration → managers (immediate, ack required) · air-quality exceedances → managers (immediate, PDF attached) · accident reports with alert-flagged medical attention → managers (immediate, ack + PDF) · failed circle checks → ice crew lead (end-of-day digest) · severity-A dasher issues → operations manager (immediate).

## 7.4 Reminders

Recurring scheduled sends: a 5-field cron schedule (e.g. `0 9 * * 1` = 9:00 AM every Monday, evaluated in the facility's timezone), a template, and a group/role target. Good for weekly safety-check nudges.

## 7.5 Verify the pipeline

Background jobs render PDFs, drain the queue, and send emails every few minutes with automatic retries. After configuring, submit a test report that trips a rule and confirm: the alert appears in the inbox, the recipients got the message and email, and the PDF attached if requested. Anything that fails permanently surfaces under **Deliveries** with a **Retry** button — an empty Deliveries tab is your healthy state.
