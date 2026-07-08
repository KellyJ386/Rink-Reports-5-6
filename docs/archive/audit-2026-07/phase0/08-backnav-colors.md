# Phase 0.5 — Back-Navigation Inventory + Color Token Sweep

## Back navigation

| ID | Module | File:Line | Element | Mechanism | Destination | Deep-link safe? |
|---|---|---|---|---|---|---|
| B-001 | reports/refrigeration | submission-form.tsx:466 | ArrowLeft "Back" | **router.back()** | browser history | **NO** |
| B-002 | shells | components/app/global-header.tsx:157 | ArrowLeft (admin header) | router.push | /dashboard | YES |
| B-003 | reports/ice-operations | ice-ops-shell.tsx:86 | ArrowLeft "Back" | Link | /reports | YES |
| B-004 | reports/ice-depth | [layoutSlug]/page.tsx:201 | ChevronLeft | Link | /reports/ice-depth | YES |
| B-005 | reports/ice-depth | done/page.tsx:347 | Back to Form | Link | /reports/ice-depth/{slug} | YES |
| B-006 | reports/scheduling | availability/page.tsx:166 | ChevronLeft (week nav) | Link | ?week=prev | YES |
| B-008 | reports/refrigeration | done/page.tsx:119 | Back to home | Link | /reports | YES |
| B-009–B-010 | reports/ice-depth | done/page.tsx:506, page.tsx:42 | Back to Dashboard | Link | /dashboard | YES |
| B-011 | reports/ice-operations | done/page.tsx:170 | Back to home | Link | /reports | YES |
| B-012 | reports/communications | compose/done/page.tsx:119 | Back to inbox | Link | /reports/communications | YES |
| B-013 | reports/air-quality | done/page.tsx:150 | Back to home | Link | /reports | YES |
| B-014 | reports/incidents | done/page.tsx:163 | Back to home | Link | /reports | YES |
| B-015 | reports/incidents | [id]/page.tsx:253 | Back to incident reports | Link | /reports/incidents | YES |
| B-016–B-020 | admin detail views | refrigeration/report-detail.tsx:114, air-quality/report-detail.tsx:408, incident-reports/report-detail.tsx:88, daily-reports/submission-detail.tsx:124, ice-operations/submission-detail.tsx:101 | Back to list | Link href={backHref} | module list | YES |
| B-021 | admin/air-quality | log/page.tsx:222 | ← Back to history | Link | /admin/air-quality?tab=history | YES |
| B-022–B-023 | admin/employees | bulk/page.tsx:87, [id]/page.tsx:149 | Back to Employees | Link | /admin/employees | YES |
| B-024 | admin/communications | inbox-tab.tsx:517 | Back | Link href={backHref} | /admin/communications | YES |
| B-025 | admin/audit-log | log-detail.tsx:61 | ← Back to log | Link | /admin/audit-log | YES |
| B-026–B-027 | admin/ice-depth | layout-editor.tsx:88, session-detail.tsx:140 | ← Back to layouts/history | Link | /admin/ice-depth | YES |
| B-028 | reports/accidents | page.tsx:329 | Back to reports | Link | /reports | YES |

**Finding:** exactly one deep-link-unsafe back control — **B-001** `router.back()` in the refrigeration submission form (breaks on direct URL entry / refresh). All 27 others use explicit hrefs to the logical parent.

## Color token sweep (mission invariant 7)

- **#69BE28 (deprecated):** zero occurrences in src/ or public/. Fully purged. ✅
- **#4DFF00 (brand green):** 16 occurrences — globals.css defines `--rr-green: #4DFF00` → exposed as `--primary`/`--action-green`; plus src/lib/tokens.ts:15 mirror, splash gradients (request-information.tsx:33,345,422; page.tsx:408), ice-depth SVG markers (usa-rink.tsx:212; layout-editor.tsx:674,681; reports submission-form.tsx:50,72,398; send-report-button.tsx:60), scheduling local consts (my-schedule/page.tsx:203, week-calendar.tsx:26, scheduling/page.tsx:25), departments color-picker default (department-form.tsx:114).
- **#002244 (rink navy):** 6 occurrences — `--rr-navy` in globals.css, tokens.ts:19, usa-rink.tsx:211, request-information.tsx:35,346,423, layout-editor.tsx:680.
- Support tokens: `--rr-green-ink: #1A9B00`, `--rr-green-hover: #45E600`, `--rr-green-shadow: #2E9900`, `--rr-navy-dark: #001630`.
- Phase 1 note: raw hex literals outside globals.css/tokens.ts (scheduling local consts, SVG inline fills, splash gradients) are candidates for token consolidation, but both themes already route through semantic tokens per CLAUDE.md.
