# Rink Reports Training Guide

`rink-reports-training-guide.pdf` is the complete training guide covering every
staff report module, the scheduling system (staff and admin sides), and the full
admin console.

## Contents

1. Welcome & Getting Started — sign-in, navigation, dashboard, account, permissions primer
2. Staff Report Modules — daily, incidents, accidents, ice depth, ice operations,
   refrigeration, air quality, dasher boards, facility paperwork, communications, offline work
3. Scheduling — For Staff — my schedule, open shifts, drops, availability, time off, swaps, calendar sync
4. Scheduling — For Admins — the rules engine, grid, templates, two-person publish, queues, settings
5. Admin Console — Setup & System — employees, permissions, roles, facility, exports, retention, audit log, super admin
6. Admin Console — Module Administration — each module's admin console and the alert/routing pipeline
7. Quick Reference — status lifecycles, approval matrix, offline matrix, training checklists

## Rebuilding the PDF

The guide is authored as markdown chapters in `src/` and rendered with
[reportlab](https://pypi.org/project/reportlab/):

```bash
pip install reportlab
cd docs/training-guide/src
python3 build_pdf.py ../rink-reports-training-guide.pdf \
  ch01-getting-started.md ch02-staff-reports.md ch03-scheduling-staff.md \
  ch04-scheduling-admin.md ch05-admin-core.md ch06-admin-modules.md ch07-quickref.md
```

Edit the chapter markdown, re-run the build, and commit both.
