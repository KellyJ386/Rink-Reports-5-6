# Ice Depth Module — Phase 4 Audit Report

**Date:** 2026-06-20  
**Auditor:** Claude Code (automated)  
**Grade: 79 / 100**

---

## Executive Summary

The Ice Depth module is architecturally solid: DB-driven points, server-side severity computation with threshold snapshots, full RLS, offline SW queue, CSV/PDF export, and a well-tested compute layer. Seven of ten checklist items pass cleanly. The three gaps that reduce the score are: (1) hardcoded severity hex colors in the submission form and orphaned send-button that bypass the semantic design system; (2) the `SendReportButton` component is orphaned — built and connected to a working server action but never rendered on the post-submit screen; (3) the `ice_depth_sessions` table does not store a direct `rink_id` column — the rink is only traceable via a JOIN through `ice_depth_layouts.rink_id`, weakening the "saves with rink/sheet id" criterion.

---

## Checklist Results

### Item 1 — Measurement points DB-driven (ice_depth_points), not hardcoded

**PASS**

Points are loaded from `ice_depth_points` on every page render.

- `src/app/reports/ice-depth/[layoutSlug]/page.tsx:91–101` — server component queries `ice_depth_points` filtered by `layout_id` and `is_active`, ordered by `sort_order` then `point_number`.
- `supabase/migrations/00000000000014_ice_depth_schema.sql:156–219` — `ice_depth_points` table with `x_position`, `y_position` (0..1 fractions), `point_number`, `label`, `sort_order`. DB-enforced cap of 60 active points per layout (trigger `enforce_ice_depth_points_cap`).
- The admin layout editor (`src/app/admin/ice-depth/_components/layout-editor.tsx`) places points visually; `src/app/admin/ice-depth/actions.ts:544–593` inserts them into the DB.
- No hardcoded point coordinates anywhere in the report submission path.

**Effort to reach 100%:** 0 (already complete).

---

### Item 2 — No photo feature (confirm absence)

**PASS**

No photo, camera, image upload, or file-attachment code exists anywhere in the ice-depth module.

- `grep -rn "photo|camera|upload"` across `src/app/reports/ice-depth/` and `src/app/admin/ice-depth/` returns zero hits relevant to user uploads. The one SVG `<image>` hit in `layout-editor.tsx:645` renders the rink logo inline, not a user-upload feature.
- `supabase/migrations/00000000000014_ice_depth_schema.sql` — no photo or attachment columns on any table.
- `src/app/reports/ice-depth/_lib/submit.ts` — persists no binary data.

**Effort to reach 100%:** 0 (confirmed absent as required).

---

### Item 3 — Measurements saved with timestamp, operator id, rink/sheet id, point id, depth, severity (server-computed)

**PARTIAL**

Timestamp, operator id, layout id, point id, depth, and severity are all saved and correct. The rink/sheet is only indirectly stored via layout.

| Field | Column | Location |
|---|---|---|
| Timestamp | `ice_depth_sessions.submitted_at` | `submit.ts:139` |
| Operator id | `ice_depth_sessions.employee_id` | `submit.ts:137` |
| Layout id | `ice_depth_sessions.layout_id` | `submit.ts:136` |
| Point id | `ice_depth_measurements.point_id` | `submit.ts:172` |
| Depth value | `ice_depth_measurements.depth_value` | `submit.ts:175` |
| Severity (server-computed) | `ice_depth_measurements.severity` | `submit.ts:165`, `compute.ts:137–145` |
| Threshold snapshot | `ice_depth_sessions.low/high_threshold_snapshot` | `submit.ts:126–130` |

**Gap:** `ice_depth_sessions` has no `rink_id` column. The rink is recoverable via `ice_depth_sessions.layout_id → ice_depth_layouts.rink_id`, but this requires a JOIN. If a layout is later re-assigned to a different rink (via `setLayoutRink` in `admin/ice-depth/actions.ts:263`), historical sessions would silently appear under the new rink — a data-integrity gap.

Evidence:
- `supabase/migrations/00000000000014_ice_depth_schema.sql:228–246` — `ice_depth_sessions` schema; no `rink_id`.
- `supabase/migrations/00000000000083_ice_depth_rinks.sql:64–65` — `rink_id` added to `ice_depth_layouts` only, not to sessions.
- `src/app/reports/ice-depth/_lib/submit.ts:132–148` — insert payload has no `rink_id`.

**Effort to fix:** ~1 hour. New migration: add `rink_id uuid references ice_depth_rinks(id) on delete set null` to `ice_depth_sessions`, snapshot from `layout.rink_id` in `persistIceDepth` step 4, regenerate types.

---

### Item 4 — Historical data viewable with date-range filter

**PASS**

The admin History tab has layout, employee, severity, and full date-range (`from`/`to`) filters.

- `src/app/admin/ice-depth/_components/history-filters.tsx` — `<Input type="date">` for From and To, plus layout/employee/has_low/has_high selects.
- `src/app/admin/ice-depth/page.tsx:329–341` — `HistoryTabLoader` applies `gte("submitted_at", from)` and `lte("submitted_at", to)` to the Supabase query.
- Default window: last 30 days (`defaultDateFrom()` at line 77).
- "Load more" pagination supports up to 2,000 rows (`HISTORY_SHOW = { initial: 50, step: 50, max: 2000 }`).
- Drilldown to per-session detail (measurements + follow-up notes) via `?session=<uuid>`.

**Effort to reach 100%:** 0 (already complete).

---

### Item 5 — Export to CSV/PDF works (@react-pdf/renderer / xlsx)

**PASS**

Both CSV and PDF export are wired and functional for `ice_depth`.

- `package.json:22,38` — `@react-pdf/renderer: ^4.5.1` and `xlsx: ^0.18.5` present.
- `src/lib/exports/module-config.ts:455–521` — `buildIceDepth` fetches sessions + measurements, computes per-session min/max/avg depth, and returns rows with columns `layout`, `cell_readings`, `min_depth`, `max_depth`, `avg_depth`, `submitted_by`, `submitted_at`.
- `src/lib/exports/module-config.ts:669` — `ice_depth: buildIceDepth` registered in `BUILDERS`.
- `src/app/api/exports/route.ts` — `GET /api/exports?module=ice_depth&format=csv|pdf`; `authorizeExport` checks `view` permission; all queries pinned to caller's `facility_id`.
- `src/app/admin/ice-depth/page.tsx:13,144` — `<ExportButton moduleKey="ice_depth" />` in the page header.
- `src/lib/exports/pdf.tsx` uses `@react-pdf/renderer`; `src/lib/exports/csv.ts` uses `xlsx`.

**Effort to reach 100%:** 0 (already complete).

---

### Item 6 — facility_id server-injected

**PASS**

`facility_id` is always pulled server-side from the authenticated employee record; it is never accepted from the client.

- `src/app/reports/ice-depth/actions.ts:57–63` — fetches `{ id, facility_id }` from `employees` by `user_id = current.authUser.id`, passes `employeeRow.facility_id` to `persistIceDepth`.
- `src/app/reports/ice-depth/_lib/submit.ts:59–86` — `args.facilityId` (server-resolved) used in every query: layout validation, settings load, session insert, measurement insert, alert insert.
- `src/app/reports/ice-depth/_lib/offline.ts:51–85` — offline replay path (`handleIceDepthReplay`) also receives `facilityId` from the server, not from the queued payload.
- Client form hidden inputs carry only `layout_id`, `layout_slug`, `measurements_json`, `notes` — no `facility_id`.

**Effort to reach 100%:** 0 (already complete).

---

### Item 7 — Offline support via SW queue

**PASS**

The module has complete offline support: client-side SW queue, idempotent replay, and identical validation/severity pipeline on replay.

- `src/app/reports/ice-depth/_components/submission-form.tsx:310–333` — `handleReviewSubmit` intercepts when `!navigator.onLine`, calls `enqueueSubmission({ moduleKey: "ice_depth", ... })`, shows `QueuedConfirmation` on success or an error if the SW is not controlling the page.
- `public/sw.js:301–323` — `ENQUEUE_SUBMISSION` message handler stores to IndexedDB and triggers Background Sync.
- `src/app/api/offline-sync/route.ts:163–173` — dispatches to `handleIceDepthReplay` when `moduleKey === "ice_depth"`.
- `src/app/reports/ice-depth/_lib/offline.ts` — claims `offline_sync_queue` slot with `onConflict: "local_id"` for idempotency; runs `persistIceDepth` (same engine as online path); releases claim on failure to allow retry.
- `src/app/reports/ice-depth/_lib/compute.ts:42–70` — `parseMeasurements` rejects malformed/negative depths from untrusted offline payloads.

**Effort to reach 100%:** 0 (already complete).

---

### Item 8 — RLS enforced (facility-scoped)

**PASS**

RLS is enabled on all six ice-depth tables with correct facility scoping and covered by the regression test harness.

| Table | RLS | SELECT | INSERT |
|---|---|---|---|
| `ice_depth_settings` | Enabled | `facility_id = current_facility_id() AND has_module_access` | `has_module_admin_access` |
| `ice_depth_layouts` | Enabled | same | `has_module_admin_access` |
| `ice_depth_points` | Enabled | same | `has_module_admin_access` |
| `ice_depth_rinks` | Enabled | same | `has_module_admin_access` |
| `ice_depth_sessions` | Enabled | same | `has_module_access AND employee_id = current_employee_id()` |
| `ice_depth_measurements` | Enabled | same | `has_module_access` |
| `ice_depth_followup_notes` | Enabled | same | `has_module_admin_access` (append-only, no UPDATE/DELETE policy) |

Evidence:
- `supabase/migrations/00000000000014_ice_depth_schema.sql:366–644` — all six tables' policies.
- `supabase/migrations/00000000000083_ice_depth_rinks.sql:114–165` — rinks RLS.
- `supabase/tests/rls_isolation.sql:806–818, 1982` — asserts alice cannot SELECT or INSERT facility-B rows; line 2136–2151 asserts `purge_old_ice_depth_sessions()` is service_role-only.

**Effort to reach 100%:** 0 (already complete).

---

### Item 9 — No AI features

**PASS**

No AI, LLM, OpenAI, Anthropic, embedding, vector, or chat functionality exists in the module.

- `grep -rn "AI|openai|anthropic|gpt|llm|embedding|vector"` across all ice-depth source directories returns zero hits.

**Effort to reach 100%:** 0 (confirmed clean).

---

### Item 10 — Design system compliance (semantic color tokens, not hardcoded)

**PARTIAL**

The post-submit done page and admin views use semantic tokens correctly. The submission form uses hardcoded hex for severity colors and button accents, bypassing the design system.

**Compliant areas:**
- `src/app/reports/ice-depth/[layoutSlug]/done/page.tsx:40–50` — `DONE_COLORS` and `SEV_PILL_CLASS` use `var(--success)`, `var(--destructive)`, `var(--warning)`, and Tailwind classes like `text-success border-success/30 bg-success/10`.
- `src/app/reports/ice-depth/[layoutSlug]/page.tsx:186–193` — header uses `var(--module-ice-depth)`, declared in `src/app/globals.css:239,339`.
- Analytics tab — severity colors come from `ice_depth_settings.low_color / ok_color / high_color`, not hardcoded.

**Non-compliant areas:**

1. `src/app/reports/ice-depth/_components/submission-form.tsx:49–51` — `SEVERITY_COLOR = { ok: "#4DFF00", low: "#F42A2A", high: "#FFB800" }`. Does not reference `var(--success)` / `var(--destructive)` / `var(--warning)`.
2. `src/app/reports/ice-depth/_components/submission-form.tsx:70–72` — `NAVY = "#003B6F"`, `GREEN = "#4DFF00"`, `GREEN_PRESS = "#2E9900"` used throughout measure-phase UI (progress bar gradient, popover borders, submit button).
3. `src/app/reports/ice-depth/_components/submission-form.tsx:428, 453, 517, 940` — additional `rgba(...)` and `#fff` in inline styles.
4. `src/app/reports/ice-depth/[layoutSlug]/done/_components/send-report-button.tsx:60, 70, 99` — hardcoded `#7AFF40`, `#4DFF00`, `#2E9900`, `#051200`, `#F42A2A` (this file is also orphaned — see Additional Finding).

**Note on rink SVG colors:** `src/components/ice-depth/usa-rink.tsx` contains ~40 hardcoded hex values (`#cc0000` goal lines, `#003087` blue lines, `#c8102e` red line). These are USA Hockey official rink marking colors — intrinsic to the diagram spec, not UI theme choices. These are intentional and acceptable.

**Effort to fix:** 2–3 hours. Replace `SEVERITY_COLOR` and the green-gradient constants with CSS custom property references matching the done-page approach (`var(--success)` etc.) and the existing module accent token.

---

## Additional Finding — SendReportButton Orphaned

**Severity: HIGH**

`src/app/reports/ice-depth/[layoutSlug]/done/_components/send-report-button.tsx` exports `SendReportButton` and calls `sendIceDepthReport(sessionId)` from `actions.ts`. The server action (`actions.ts:122–183`) is fully implemented and dispatches to `dispatchRulesForSubmission`. However, `SendReportButton` is never imported or rendered anywhere.

The post-submit CTA section in `done/page.tsx:524–543` includes only `PrintDiagramButton` and two navigation links. The "Send Report" capability is therefore inaccessible from the staff-facing UI, defeating the explicit design comment in `submit.ts:259–264`: "Ice depth does NOT fan out on submit. The reviewer explicitly sends it to the configured send list from the post-submit screen via `sendIceDepthReport`."

**Fix:** Import `SendReportButton` in `done/page.tsx` and render `<SendReportButton sessionId={idParam} />` inside the CTAs block (after `PrintDiagramButton`, before "Submit Another"). Also address the hardcoded colors in that component at the same time.

**Effort:** ~30 minutes.

---

## Scoring Breakdown

| # | Item | Score | Max | Notes |
|---|---|---|---|---|
| 1 | Points DB-driven | 10 | 10 | Complete |
| 2 | No photo feature | 10 | 10 | Confirmed absent |
| 3 | Timestamp / operator / rink-sheet / point / depth / severity | 7 | 10 | rink_id not on sessions; traceability gap |
| 4 | Historical data + date-range filter | 10 | 10 | Complete |
| 5 | Export CSV/PDF | 10 | 10 | Complete |
| 6 | facility_id server-injected | 10 | 10 | Complete |
| 7 | Offline SW queue | 10 | 10 | Complete |
| 8 | RLS enforced | 10 | 10 | Complete |
| 9 | No AI features | 10 | 10 | Confirmed clean |
| 10 | Design system compliance | 3 | 10 | Hardcoded hex in form; orphaned button |
| **Total** | | **79** | **100** | |

---

## Top 5 Gaps (by Severity)

### Gap 1 — SendReportButton orphaned; staff cannot distribute reports
**Severity: HIGH**  
**Files:** `src/app/reports/ice-depth/[layoutSlug]/done/page.tsx` (missing import); `src/app/reports/ice-depth/[layoutSlug]/done/_components/send-report-button.tsx` (defined but unreachable)  
**Fix:** Import and render `<SendReportButton sessionId={idParam} />` in the CTAs block of `done/page.tsx` around line 525.  
**Effort:** 30 minutes

### Gap 2 — Hardcoded severity hex colors in submission-form.tsx bypass design system
**Severity: MEDIUM**  
**File:** `src/app/reports/ice-depth/_components/submission-form.tsx:49–51, 70–72`  
**Evidence:** `SEVERITY_COLOR = { ok: "#4DFF00", low: "#F42A2A", high: "#FFB800" }`, `NAVY = "#003B6F"`, `GREEN = "#4DFF00"`, `GREEN_PRESS = "#2E9900"` — will not adapt to theming or rebrand; dark mode rendering depends on contrast with these fixed values.  
**Fix:** Replace with `var(--success)`, `var(--destructive)`, `var(--warning)` and the module accent token; mirror the approach already used in `done/page.tsx`.  
**Effort:** 2–3 hours

### Gap 3 — No rink_id on ice_depth_sessions (traceability gap)
**Severity: MEDIUM**  
**Files:** `supabase/migrations/00000000000014_ice_depth_schema.sql:228–246`; `src/app/reports/ice-depth/_lib/submit.ts:132–148`  
**Evidence:** If admin reassigns a layout to a different rink via `setLayoutRink()` (`admin/ice-depth/actions.ts:263`), historical sessions silently appear under the new rink.  
**Fix:** New migration adding `rink_id` FK to `ice_depth_sessions`; snapshot from `layout.rink_id` at persist time; regenerate types; add index `(rink_id, submitted_at desc)`.  
**Effort:** 1–1.5 hours

### Gap 4 — Hardcoded colors in orphaned send-report-button.tsx
**Severity: LOW**  
**File:** `src/app/reports/ice-depth/[layoutSlug]/done/_components/send-report-button.tsx:60, 70, 99`  
**Evidence:** `#7AFF40`, `#4DFF00`, `#2E9900`, `#051200`, `#F42A2A` inline.  
**Fix:** Bundle with Gap 1 fix — update to semantic tokens when wiring the button into `done/page.tsx`.  
**Effort:** Bundled with Gap 1 (30 minutes total)

### Gap 5 — Missing rink_id index on sessions (performance, contingent on Gap 3)
**Severity: LOW**  
**File:** Future migration (contingent on Gap 3)  
**Evidence:** Analytics and history queries that filter by rink will need an index on `ice_depth_sessions.rink_id` once the column exists.  
**Fix:** Add `create index idx_ice_depth_sessions_rink on ice_depth_sessions(rink_id, submitted_at desc)` in the same migration as Gap 3.  
**Effort:** Bundled with Gap 3 (15 extra minutes)

---

## Summary of Passed Items

- **Points are fully DB-driven** — no hardcoded coordinates in the submission path; admin editor persists via `ice_depth_points` API.
- **No photo feature** — confirmed completely absent across all ice-depth routes and migrations.
- **Offline support is complete and correct** — SW queue, idempotent replay via `local_id`, same validation/severity engine for online and offline paths; `parseMeasurements` rejects negative/malformed depths from untrusted payloads.
- **RLS is comprehensive** — all six tables (+ rinks) enabled, facility-scoped, covered by `rls_isolation.sql` regression harness including purge function access gate.
- **Exports work** — `ice_depth` registered in `BUILDERS`; `buildIceDepth` fetches sessions + measurements; CSV and PDF wired; `ExportButton` on admin page header.
- **facility_id is always server-injected** — verified in both online and offline replay paths; never client-controlled.
- **Historical data viewable** — admin History tab has full date-range, layout, employee, and severity filters with paginated load-more.
- **No AI features** — clean.
