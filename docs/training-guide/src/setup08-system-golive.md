# 8. System Configuration & Go-Live

## 8.1 PDF / Export settings

**Admin → PDF/Export Settings** configures how every exported CSV and PDF looks, once per facility:

- **Branding** — logo URL (about 300 × 80 px), header text (e.g. "Max Ice Center — Confidential"), footer text.
- **Layout & format** — paper size (Letter/A4), date format, CSV delimiter, and the include-on-every-export checkboxes (facility name, export date, submitted-by).
- **Column visibility per module** — untick columns you don't want in exports (they stay in the database). Column pickers now cover Daily Reports, Incidents, Accidents, Refrigeration, Air Quality, Ice Depth, Ice Operations, Communications, **Employee Scheduling**, and **Dasher Boards**. A module never configured exports all its columns.

The same page runs on-demand exports (module + CSV/PDF + date range; limits: 2,000 rows, 366 days), and most consoles carry a quick last-30-days **Export** dropdown.

## 8.2 Data retention

**Admin → Retention** sets how long each module's submissions are kept, with nightly auto-purge per module. Regulatory floors are enforced in the database:

| Module group | Floor |
|---|---|
| Daily, Ice Depth, Ice Operations, Communications, **Dasher Boards** | 30 days |
| Refrigeration, Air Quality | 90 days |
| Incident and Accident Reports | 365 days |
| **Rink Scheduling & Billing** | **7 years** (financial floor — raise, never shorten) |
| Audit Log | 7 years (raise, never shorten) |

Module-specific notes: dasher-boards purges remove inspection walks, but **unresolved issues are never purged at any age**; rink-scheduling purges cover bookings, invoices, and payments — customers, rate cards, and facility setup are configuration and never age out. Setting any module to Forever disables its auto-purge. Audit-log destruction is staged and needs **two different admins** to approve.

## 8.3 Health checks (super admin)

Before go-live, a super admin should glance at two cards on **Admin → Super Admin**:

- **Invite service health** — probes the invite email service and names the exact failure if it's broken.
- **Cron health** — the last recorded run of each scheduled job (notification drain, email send, reminders, retention purge, scheduling expiry, daily-assignment snapshots, rink coverage sweep) with OK / Overdue / Failed / No-runs badges and the last error text for failures. All background behavior — alert emails, digests, reminders, purges, booking-coverage alerts — depends on these firing.

Note that outbound email delivers to **real recipients in production** — test routing rules with a small target group before pointing them at "whole facility."

## 8.4 Go-live checklist

Work through this list with a test staff account (or the **Preview** button on an employee row):

1. Facility record correct — name, address, and especially **timezone**.
2. Setup checklist on the admin dashboard shows **Ready** (6/6).
3. Modules page pruned to what the facility actually uses.
4. Roles' permission defaults reviewed; staff bulk-added; every **Partial** row re-invited; certifications entered with expiry dates.
5. Each enabled report module: seeded, configured, and **one test submission filed** — confirming area access, thresholds, and range hints look right.
6. Employee Scheduling: settings saved, job areas with required certs, compliance rules active, at least two scheduling admins (publishing needs a second approver).
7. Rink Scheduling: surfaces, rate cards, customers, and displays configured (chapter 6); a test booking priced correctly by the rate engine.
8. Communications: groups and templates created, routing rules previewed with **Preview Recipients**, a test alert fired end-to-end (inbox + email + PDF), Deliveries tab empty.
9. Export settings branded; retention windows confirmed per your jurisdiction.
10. Cron health and invite service health both green.
11. Staff briefed on offline basics: the sync badge, the Pending Sync Queue, and **Sync now** on iPhones/iPads.
