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

## Where it appears in the app

Admins can read every chapter and download this PDF from **Admin → System →
Training & Docs** (`/admin/training`). That page is driven by the manifest in
`src/lib/training-docs.ts`; a new chapter or PDF must be added there too (the
unit test `src/lib/training-docs.test.ts` fails until it is).

## Rebuilding the PDF

The guide is authored as markdown chapters in `src/` and rendered by the
shared training-PDF builder (`scripts/training-pdf/build.py`, reportlab), which
also produces the manuals under `docs/training/pdf/`:

```bash
pip install -r scripts/training-pdf/requirements.txt   # needs DejaVu fonts installed
pnpm docs:pdf                                          # rebuild every training PDF
pnpm docs:pdf:check                                    # report PDFs whose markdown changed
```

Edit the chapter markdown, rebuild, and commit both. Each PDF embeds a hash of
its sources, and `src/lib/training-docs.test.ts` fails when a PDF is stale, so
a doc edit can't merge without its rebuilt PDF. Output is deterministic: an
unchanged source rebuilds to an identical file.
