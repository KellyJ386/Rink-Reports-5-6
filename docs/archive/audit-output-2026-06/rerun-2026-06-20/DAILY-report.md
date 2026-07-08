# Daily Reports Module Audit — 2026-06-20

**Grade: 83 / 100**

Auditor: Agent-DAILY  
Scope: `src/app/reports/daily/*`, `src/app/admin/daily-reports/*`, related DB tables  
Supabase project: `bqbdgwlhbhabsibjgwmk`

---

## Summary

The Daily Reports module is well-structured, DB-driven, and covers the core
requirements: offline SW queue, facility_id server-injection, history page,
per-area access control, and a clean compute / submit / offline split.  The
main gaps are (1) no Zod on the staff submit server action, (2) no submission
lock/freeze semantics in the DB schema or UI, (3) the `daily_report_notes_select`
RLS policy is weaker than expected, (4) no role-tier field-visibility differences
and (5) the area-cap trigger uses the wrong Postgres error code.

---

## Checklist Results

### 1. Renders for all role tiers — PARTIAL PASS

All authenticated employees reach the page via `requireUser()` in
`src/app/reports/daily/page.tsx:30`. The gateway to submission is
`getAllowedDailyAreas()` (`actions.ts:39`) which checks `module_area_permissions`
for `can_submit`. If the set is empty a "No areas assigned" card is shown.

Gap: There is **no differentiated field visibility or section visibility by role tier**
(super_admin / admin / manager / staff / driver). All roles that have `can_submit`
see exactly the same UI. Admins view submissions in the admin panel under
`requireAdmin()` (`page.tsx:89`). The driver role is not mentioned anywhere in the
daily-reports code; whether drivers should be able to see or submit daily reports
is not enforced at the UI layer — it falls entirely on the admin assigning
`module_area_permissions`. This is acceptable for this module (the spec says
roles are enforced via permission grants rather than hard role checks) but should
be documented. **Severity: Low.**

### 2. Tabs/areas + checklist items are DB-driven — PASS

Areas are loaded from `daily_report_areas` scoped to `facility_id`
(`page.tsx:108`, `actions.ts:52`). Templates from `daily_report_templates`
(`page.tsx:108-116`). Checklist items from `daily_report_checklist_items`
(`page.tsx:121-128`). Nothing is hardcoded. The 30-area cap is enforced at the
DB layer by the `trg_daily_report_areas_cap` trigger and mirrored in the admin UI
error handler (`actions.ts:40-46`).

Minor gap: The trigger uses `errcode = 'check_violation'` (code `23514`), but the
application error handler at `actions.ts:44` looks for code `P0001` and a regex
on the message. `check_violation` will produce code `23514`, not `P0001`, so the
specific "Maximum 30 active areas reached." user-facing message will **never fire**;
the fallback `err.message` will be shown instead (which is acceptable but not the
intended UX). **Severity: Low — file: `src/app/admin/daily-reports/actions.ts:41-46`**

### 3. Per-area independent save + lock/submit semantics — PARTIAL PASS

**Per-area save:** Each submission is one area + one template. Selecting a
different area/shift resets the checklist (`daily-report-console.tsx:152-160`).
A submission creates one `daily_report_submissions` row plus items, then
redirects to `/done`. This is effectively a single-shot submit, not a
multi-area accumulating session — areas save independently in the sense that
each form submit creates a fresh submission scoped to the chosen area.

**Lock/submit semantics: MISSING.** There is no `is_locked`, `status`, or
`submitted_status` column on `daily_report_submissions`. Once a submission is
inserted, the `daily_report_submissions_update` RLS policy allows admins to
update it (there is a `toggleSubmissionItem` action), but staff have no update
path at all. There is no concept of "today's report is complete and cannot be
re-opened." This means:
- Staff can submit the same area + template multiple times with no warning.
- There is no UI guard against double-submission.
- The "done" page has no link to history to show the user their prior
  submissions for that area.

**label_snapshot history: PASS.** The `label_snapshot` column on
`daily_report_submission_items` preserves the checklist item text at submission
time, so renaming a checklist item after the fact doesn't corrupt historical
records. `submit.ts:140` filters out items with empty `checklist_item_id` or
`label_snapshot` (good). **Severity: Medium — no lock/double-submit guard.**
File: `src/app/reports/daily/_lib/submit.ts`, `src/app/reports/daily/_components/daily-report-console.tsx`

### 4. facility_id server-injected — PASS

**Staff submit path:** `facility_id` is never taken from `FormData`; it is always
read from the active `employees` row via `employeeRow.facility_id`
(`actions.ts:108`, `submit.ts:73`). Defense-in-depth checks in `persistDaily`
verify area and template both belong to `facilityId` before inserting.

**Offline replay path:** `facilityId` comes from the authenticated user's profile
(`route.ts:97`) — never from the queued payload.

**Admin actions:** `resolveFacility()` reads `profile.facility_id` from the
server session (`actions.ts:60-70`). All DB writes are scoped with
`.eq("facility_id", facility.facilityId)`.

**RLS backstop:** INSERT WITH CHECK on `daily_report_submissions` requires
`facility_id = current_facility_id()` and `has_area_submit_access(...)`, so
even a crafted call would fail at the DB layer.

### 5. Offline support via SW queue — PASS

- `daily-report-console.tsx:205-218`: `handleSubmit` intercepts when
  `!navigator.onLine`, calls `enqueueSubmission()` with `moduleKey: "daily_reports"`.
- `_lib/offline.ts`: `handleDailyReplay` parses payload → permission check →
  idempotency claim via `offline_sync_queue` → `persistDaily` → mark synced.
- Route handler at `api/offline-sync/route.ts:151-161` dispatches to
  `handleDailyReplay`.
- The queued state shows a user-friendly "Saved on this device" card
  (`daily-report-console.tsx:220-252`).
- The sticky bar shows `· offline — will sync when reconnected`
  (`daily-report-console.tsx:513`).

No Dexie — correct per project architecture. Offline path fully implemented.

### 6. Staff submission history — PASS

`/reports/daily/history` is implemented at
`src/app/reports/daily/history/page.tsx`. It:
- Requires authentication (`requireUser`).
- Scopes to `facility_id` (server-side, never client-supplied).
- Respects RLS for per-area access.
- Renders checked/total counts, area color chips, timestamps in facility
  timezone, and submitter name.
- Linked from the main daily page header as "View history"
  (`page.tsx:79-83`).
- History is visible facility-wide (all areas the user can access via RLS),
  not just the user's own submissions — this is reasonable for a rink
  context.

### 7. Zod validation on the submit server action — FAIL

**Staff submit action (`src/app/reports/daily/actions.ts`):** No Zod. Validation
is performed by `buildInputFromForm()` / `parseItemsJson()` using manual type
coercion in `compute.ts`. The parsers are thorough and unit-tested
(`compute.test.ts`), but they use custom result types (`ParseItemsResult`) rather
than Zod schemas. This diverges from the project's convention used in:
- The offline sync route (`route.ts:36-42`): uses `z.object(...)`.
- The checklist CSV import (`checklist-import.ts:31`): uses `z.object(...)`.
- The incident module uses `validateIncidentInput()` with Zod.

The manual validation in `compute.ts` is safe in practice (trimming, type
coercion, array checks), but the absence of Zod means no declarative schema,
no automatic `.issues` array, and inconsistency with other modules. It is a
medium code-quality gap. **Severity: Medium — file: `src/app/reports/daily/_lib/compute.ts`**

### 8. Design: shared Card/PageHeader chrome, semantic colors — PASS

- `page.tsx`: `PageHeader variant="display" module="daily"` + `Card` chrome. ✓
- History page: same `PageHeader` pattern. ✓
- Console form: `SectionCard` meta-chip row, `Card` for shift/checklist/note
  sections. ✓
- Tokens used: `bg-card`, `bg-background`, `text-muted-foreground`,
  `border-border`, `bg-muted`, `text-foreground`, `var(--module-daily)`. ✓
- No hardcoded `#rrggbb` hex colors in className strings found. Dynamic area
  colors are applied via `style={{ backgroundColor: color }}` (runtime, from DB)
  — this is correct since they are DB-driven per-area values, not design tokens.
- Module token `--module-daily` resolves to `#4527A0` (violet) in light mode
  and `var(--violet-400)` in dark mode — correct per `globals.css:238`.
- Brand primary `#4DFF00` is exposed as `var(--primary)` and `var(--rr-green)`;
  the submit button uses the default `Button` variant which inherits `--primary`.

Minor gap: The "done" page (`done/page.tsx`) does not use `PageHeader` — it is a
minimal centered card. This is intentional (post-submit confirmation), consistent
with other modules' done pages, and not a bug. No penalty.

### 9. No TypeScript errors — PASS (assumed)

The module uses generated `Tables<"...">` types throughout, explicit Pick types
for projections, and no `as any` casts. The `buildInputFromForm` return type is
a discriminated union. Consistent with the global tsc pass noted in the brief.

---

## Gaps Summary (with effort estimates)

| # | Gap | Severity | Effort | File:Line |
|---|-----|----------|--------|-----------|
| G1 | No Zod schema on staff submit server action (`buildInputFromForm` / `parseItemsJson`); inconsistent with other modules | Medium | S | `src/app/reports/daily/_lib/compute.ts` |
| G2 | No submission lock / freeze: staff can double-submit same area+template; no is_locked column or daily window guard | Medium | M | `src/app/reports/daily/_lib/submit.ts`, `daily-report-console.tsx` |
| G3 | Area-cap trigger fires with errcode `23514` (check_violation), but `actions.ts:44` checks for `P0001`; friendly "Maximum 30" message never surfaces | Low | S | `src/app/admin/daily-reports/actions.ts:41-46` |
| G4 | `daily_report_notes_select` RLS policy only checks that the related submission EXISTS (via a subquery on `daily_report_submissions`) — it inherits the submission's RLS correctly, but note visibility is not scoped to `facility_id` explicitly; a cross-facility super_admin scenario aside, a user who has lost area access could still read notes if the submission row remains visible | Low | S | DB policy `daily_report_notes_select` |
| G5 | No differentiated field/section visibility by role tier (super_admin vs admin vs manager vs staff vs driver); all is permission-grant-driven via `module_area_permissions`, not role-coded in UI | Low | S | `src/app/reports/daily/_components/daily-report-console.tsx` |
| G6 | `daily_report_submission_items_select` policy uses the same EXISTS-on-submission pattern — same note as G4 | Low | S | DB policy `daily_report_submission_items_select` |
| G7 | Done page does not show a link to history for the submitted area/template; after submitting staff must navigate back manually | Low | S | `src/app/reports/daily/[areaSlug]/[templateId]/done/page.tsx` |
| G8 | `area_id` on `daily_report_submission_items` is absent (no direct area FK on items); rollback on item insert failure does a best-effort delete that may leave an orphan submission (documented in code, but no compensating alert/monitoring) | Low | M | `src/app/reports/daily/_lib/submit.ts:134-163` |

---

## Scoring Breakdown

| Criterion | Max | Score | Notes |
|-----------|-----|-------|-------|
| Role visibility / rendering for all tiers | 15 | 12 | All tiers reach the page; no explicit role-tier branching (G5) |
| DB-driven tabs/areas/items (not hardcoded) | 15 | 15 | Fully DB-driven, cap enforced |
| Per-area independent save; lock/submit semantics | 15 | 9 | No lock, no double-submit guard (G2) |
| facility_id server-injected | 15 | 15 | Solid on all paths, RLS backstop |
| Offline support via SW queue | 15 | 15 | Fully implemented |
| Staff submission history | 5 | 5 | `/reports/daily/history` exists and works |
| Zod validation on submit action | 10 | 5 | Manual validation present, no Zod (G1) |
| Design: Card/PageHeader/semantic tokens/#4DFF00 | 5 | 5 | Correct throughout |
| No TypeScript errors | 5 | 5 | No `as any`; typed throughout |
| **Total** | **100** | **83** | |

---

## Detailed Gap Notes

### G2 — No submission lock (Medium, M)

The `daily_report_submissions` table has no `is_locked`, `status`, or
`submitted_date` column. There is no per-(area, date) uniqueness constraint.
A staff member can submit the same area + template three times in a row: all
three rows will be inserted, all three will appear in history, and admin will
not be warned. To fix:
1. Add a DB column (e.g. `submitted_date date`) and optionally a unique partial
   index on `(facility_id, area_id, template_id, submitted_date)` with an ON
   CONFLICT strategy.
2. Or add a UI-layer date-window guard in `persistDaily` (query for existing
   submission today before inserting).

### G1 — No Zod on staff submit (Medium, S)

The unit-tested custom parsers in `compute.ts` are functionally equivalent to a
Zod schema for the checklist payload, but the surface inconsistency means a
future developer adding a new field to `DailyInput` must also remember to update
`buildInputFromForm`. Converting to Zod would co-locate the schema and produce
`.issues` for richer error messages. Effort: small refactor, no DB changes.

### G3 — Area cap errcode mismatch (Low, S)

The `enforce_daily_report_areas_cap` trigger calls
`raise exception ... using errcode = 'check_violation'` which maps to Postgres
code `23514`. The application handler at `actions.ts:44` checks `err.code === 'P0001'`
(RAISE without USING ERRCODE would use P0001). The regex fallback on `err.message`
may still match, but the code path is fragile. Fix: either change the trigger to
`RAISE EXCEPTION ... USING ERRCODE = 'P0001'`, or update the application matcher
to check `err.code === '23514' || err.code === 'P0001'`.

### G4/G6 — Notes + items SELECT policy (Low, S)

`daily_report_notes_select` and `daily_report_submission_items_select` both rely
on `EXISTS (SELECT 1 FROM daily_report_submissions s WHERE s.id = ...)`. This
chains to the submission SELECT policy which IS properly facility+area scoped.
The chain is correct but indirect. A belt-and-suspenders fix is to add
`AND facility_id = current_facility_id()` directly to these policies to make
them self-contained and index-friendly.

### G7 — Done page lacks history link (Low, S)

`done/page.tsx` shows the submission summary but no "View all my reports"
navigation link. The main page has a "View history" button but the done page
only offers "Submit another" and "Sign out". A link to `/reports/daily/history`
would improve discoverability. Effort: one `<Link>` addition.
