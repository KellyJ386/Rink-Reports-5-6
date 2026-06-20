# SCHED Audit — Employee Scheduling Module (rerun 2026-06-20)

Agent-SCHED. AUDIT ONLY. Supabase ref `bqbdgwlhbhabsibjgwmk`. Next.js 16.2 App Router.

## Grade: 93 / 100

The scheduling module is the most mature in the app. The bespoke pointer-events grid
(drag-create / move / resize), the single-source-of-truth assignment validator, the
swap/claim lifecycle with auto-expiry, the published/draft split with RLS backstop, and
the real read-only month calendar are all present and correctly wired. Deductions are for
a defense-in-depth gap in the staff week view, the unseeded cert-requirement table, and a
few minor color/spec drift items — none are tenant-isolation breaks.

## Schema confirmations (via Supabase MCP)

- **12 `schedule_*` tables present** (all 12): `schedule_availability`, `schedule_compliance_rules`,
  `schedule_notifications`, `schedule_open_shifts`, `schedule_publish_events`,
  `schedule_publish_requests`, `schedule_settings`, `schedule_shifts`, `schedule_swap_requests`,
  `schedule_template_shifts`, `schedule_templates`, `schedule_time_off_requests`. CONFIRMED.
- **RLS enabled on all 12** schedule_* tables (relrowsecurity=true), each with 2–4 policies. CONFIRMED.
- `employees.max_weekly_hours` column — **present**. CONFIRMED.
- `job_area_certification_requirements` table — **present, 0 rows** (unseeded; enforcement logic exists).
- `employee_job_area_assignments` — **present, 212 rows**. CONFIRMED.
- `employee_job_areas` — **present, 10 rows** (single scheduling taxonomy). CONFIRMED.
- `schedule_shifts_no_double_booking` exclusion constraint (migration 140) — **present**. CONFIRMED.
- **`scheduling_assignment_violations` is a SECURITY DEFINER FUNCTION, not a table** (the checklist
  mislabels it). It exists (`prosecdef=true`); DB has an 8-arg variant (migration 118 defined 7 args; a
  later migration added `p_exclude_shift_id2`). It is the single validator called by every
  assignment path (admin create/update, open-shift assign, swap approve, publish approve, staff
  self-claim RPC). No `scheduling_assignment_violations` *table* exists, and none is expected.

## Feature checklist findings (Phase 9)

| Feature | Status | Notes |
|---|---|---|
| Week-view bespoke grid (drag-create/edit/delete) | PASS | `week-grid.tsx` — pointer-events create/move/resize, preview overlay, now-line, heatmap. react-big-calendar absent (correctly removed). |
| Job-area taxonomy single source; competency from assignments | PASS | `employee_job_areas` (10) + `employee_job_area_assignments` (212). No hardcoded taxonomy arrays found. `not_qualified` code checks assignments. |
| Cert requirements per job area enforced at assignment | PASS (logic) | Migration 118 lines 192-210 loops `job_area_certification_requirements`, emits `cert_missing:<name>` vs active `employee_certifications`. Table is 0-row (unseeded) — logic correct but unexercised. |
| max_weekly_hours warn/block + admin setter | PASS | `grid-warnings.ts:54-113` computes per-employee cap warning; `enforceBlocking` hard-blocks when `block_on_violations`. Admin setter in `employee-form.tsx:420` + `employees/actions.ts:151,256,365`. |
| Swap/claim flow (create→notify→approve/deny) | PASS | `schedule_swap_requests` status check `pending/accepted/manager_approved/denied/cancelled/expired`; `scheduling_apply_swap`, `scheduling_notify_swap_request`, `scheduling_claim_open_shift` (re-runs validator as hard block). |
| Auto-expiry for swap/claim | PASS | Migration 139: `swap_expiry_hours` setting, BEFORE INSERT trigger sets `expires_at`, two batched (`FOR UPDATE SKIP LOCKED`) sweepers, cron `/api/cron/expire-scheduling` (timing-safe CRON_SECRET auth, service-role). |
| Published/draft — staff see published only | PASS (RLS) | `schedule_shifts_select` policy grants module-access (non-admin) rows only when `status <> 'draft'`. Backstop is sound. See Gap #1 for the app-layer hole. |
| Month view (real read-only calendar) | PASS | `month-grid.tsx` — whole-week grid honoring `week_start_day`, event chips, +N overflow, click-to-jump. Remediation confirmed (no placeholder toast). |
| facility_id server-injected; RLS enforced | PASS | `grid-actions.ts:132` comment + `resolveFacility()` from session; `assertOwned()` (175-210) verifies employee/job-area belong to facility (FKs don't enforce tenant). |

## Gaps (severity · file:line · effort)

### 1. (MEDIUM) Staff week view omits the published filter — relies solely on RLS
`src/app/reports/scheduling/my-schedule/page.tsx:171-185`. The `view=week` branch filters only by
date range and never applies `.eq("status","published")`, unlike the list branch (line 182). Drafts
are kept out only by the `schedule_shifts_select` RLS policy. This is defense-in-depth erosion, not a
live leak (RLS holds), but the asymmetry is a latent bug if RLS is ever relaxed or the query runs
under elevated context. Also `statusFilter` is computed (129-131) then ignored in week mode.
**Effort: S** (add the status filter to the week branch).

### 2. (LOW) `job_area_certification_requirements` is unseeded (0 rows)
DB confirms 0 rows. Cert enforcement (`cert_missing:`) in migration 118 is correct but never fires in
practice. No `scheduling_assignment_violations` regression assertion seen seeding a requirement.
**Effort: S** (seed a row + add an RLS-harness assertion for the cert branch).

### 3. (LOW) Legacy brand green `#69BE28` still appears in shipped staff/splash UI
`src/components/splash/request-information.tsx:33,345,422`, `src/components/app/pwa-install-prompt.tsx`
(multiple), `src/app/page.tsx:267,408`, `department-form.tsx:114` default. `globals.css:25` documents
`#4DFF00` as the replacement for legacy `#69BE28`, yet the legacy hex persists hardcoded. Scheduling's
own `my-schedule/page.tsx` correctly uses `#4DFF00`. Flagged per audit directive.
**Effort: S–M** (token-ize remaining hardcoded hexes).

### 4. (LOW) Migration 118 comment/signature drift vs deployed function
`supabase/migrations/00000000000118_scheduling_assignment_violations.sql` defines a 7-arg function;
the live DB has an 8-arg version (`p_exclude_shift_id2`). A later migration extended it but the 118
header comment and `enforcement.ts:56-67` narrowing-cast comment still reference the 7-arg shape.
Stale documentation, not a functional defect.
**Effort: S** (doc/comment sync).

### 3-table-name note (INFORMATIONAL): the checklist's `scheduling_assignment_violations` "table (0 rows)"
does not exist as a table and should not — it is the validator function. No action.

### 5. (LOW) Per-keystroke / heavy validator calls in grid preview path
`grid-warnings.ts` + `enforcement.ts` issue an RPC plus 3 parallel selects per warning collection;
the grid preview action (`previewSchema`) can call this frequently during interaction. No caching/
debounce observed at the action layer. Potential DB chattiness on large boards.
**Effort: M** (debounce client preview calls / batch).

### 6. (LOW) `as unknown as string` casts to feed nullable RPC args
`src/app/admin/scheduling/_lib/enforcement.ts:65-66` narrows nullable `jobAreaId`/`excludeShiftId`
through `as unknown as string` to satisfy generated non-nullable RPC arg types. CLAUDE.md retires the
`as any` bridge pattern; this is the sanctioned-but-adjacent variant (commented as a pg-meta
limitation). Cleaner fix: regenerate types or mark args optional in the generator.
**Effort: S–M.**

## Overall

Tenant isolation, the unified validator, expiry lifecycle, and grid UX are solid and production-grade.
No HIGH-severity gaps. The single most actionable item is Gap #1 (staff week-view published filter)
for defense-in-depth parity with the list view.
