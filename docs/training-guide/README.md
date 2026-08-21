# Rink Reports Guides

Two PDFs live here:

- **`rink-reports-training-guide.pdf`** — the complete training guide covering
  every staff report module, the scheduling system (staff and admin sides), and
  the full admin console. (Note: predates the Rink Scheduling & Billing module.)
- **`rink-reports-facility-setup-guide.pdf`** — how to set up Rink Reports for an
  individual facility, end to end: facility creation, people and permissions,
  shared infrastructure, per-module configuration (including Rink Scheduling &
  Billing), communications routing, and the go-live checklist.

## Training guide contents

1. Welcome & Getting Started — sign-in, navigation, dashboard, account, permissions primer
2. Staff Report Modules — daily, incidents, accidents, ice depth, ice operations,
   refrigeration, air quality, dasher boards, facility paperwork, communications, offline work
3. Scheduling — For Staff — my schedule, open shifts, drops, availability, time off, swaps, calendar sync
4. Scheduling — For Admins — the rules engine, grid, templates, two-person publish, queues, settings
5. Admin Console — Setup & System — employees, permissions, roles, facility, exports, retention, audit log, super admin
6. Admin Console — Module Administration — each module's admin console and the alert/routing pipeline
7. Quick Reference — status lifecycles, approval matrix, offline matrix, training checklists

## Facility setup guide contents

1. Before You Begin — the setup sequence, who does what, seed buttons
2. Create the Facility & First Admin — facility record, invites, module visibility, roles, roster
3. Shared Infrastructure — departments, facility spaces, lists, facility paperwork
4. Configure the Report Modules — per-module setup (daily, incidents, accidents, ice depth,
   ice ops, refrigeration, air quality, dasher boards)
5. Employee Scheduling Setup — settings, job areas & certifications, compliance, templates
6. Rink Scheduling & Billing Setup — rinks, rate cards, lists, displays, settings, coverage
7. Communications & Alert Routing — groups, templates, routing rules, reminders
8. System Configuration & Go-Live — exports, retention, health checks, go-live checklist

## Rebuilding the PDFs

The guides are authored as markdown chapters in `src/` and rendered with
[reportlab](https://pypi.org/project/reportlab/):

```bash
pip install reportlab
cd docs/training-guide/src
python3 build_pdf.py ../rink-reports-training-guide.pdf \
  ch01-getting-started.md ch02-staff-reports.md ch03-scheduling-staff.md \
  ch04-scheduling-admin.md ch05-admin-core.md ch06-admin-modules.md ch07-quickref.md

GUIDE_SUBTITLE="Facility Setup Guide — Configuring a Facility End to End" \
GUIDE_HEADER="Rink Reports — Facility Setup Guide" \
GUIDE_BLURB="How to stand up Rink Reports for an individual facility." \
python3 build_pdf.py ../rink-reports-facility-setup-guide.pdf \
  setup01-before-you-begin.md setup02-facility-and-people.md \
  setup03-shared-infrastructure.md setup04-report-modules.md \
  setup05-employee-scheduling.md setup06-rink-scheduling.md \
  setup07-communications.md setup08-system-golive.md
```

Edit the chapter markdown, re-run the build, and commit both.
