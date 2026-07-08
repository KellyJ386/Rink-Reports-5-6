# RinkReports 5-6 — Master Interactive Element Inventory (Phase 0)

Generated 2026-07-01 by the read-only discovery pass (10 parallel subagents; no code modified).
Full per-section tables with `ID | Module | Route | Element | Type | Handler | Destination | Status` live in `audit/phase0/`:

| Section | File | Scope |
|---|---|---|
| 0.1 Route map | phase0/01-routes.md | 84 pages/handlers + layouts/guards + proxy rules |
| 0.2a Admin elements (pass 1) | phase0/02-admin-elements.md | accident-reports, air-quality, audit-log, employees list, facility, permissions, modules, super-admin, … |
| 0.2a-ii Admin gap-fill (A2) | phase0/02b-admin-elements-gapfill.md | departments, employees bulk/form, exports, facility-documents, ice-operations, incident-reports, lists, retention, roles, daily-reports areas, … |
| 0.2a-iii Admin final (A3) | phase0/02c-admin-elements-final.md | spaces, refrigeration setup/settings, communications tabs, ice-depth admin |
| 0.2b Admin scheduling | phase0/03-admin-scheduling-elements.md | grid, publish flow, swaps, time-off, templates, job-areas, compliance, settings |
| 0.2c Staff reports | phase0/04-reports-elements.md | all 11 staff modules + done screens + ice-depth photo check |
| 0.2d Shells/auth/global | phase0/05-global-elements.md | sidebars, header, tab bar, splash, auth, account, dashboard |
| 0.3 Forms | phase0/06-forms.md | 38 forms w/ validation + submit/success/error paths |
| 0.4 Modals | phase0/07-modals.md | 31 modals w/ open/close/confirm paths |
| 0.5 Back-nav + colors | phase0/08-backnav-colors.md | 28 back controls + brand-token sweep |

## Element counts

| Inventory area | Elements | WIRED | UNWIRED | SUSPECT / VERIFY |
|---|---|---|---|---|
| Admin (non-scheduling), 3 passes | 408 | 408 | 0 | 0 |
| Admin scheduling | 111 | 111 | 0 | 0 |
| Staff reports (11 modules) | 81 | 80 | 0 | 1 (R-009 router.back) |
| Shells / auth / dashboard / splash | 71 | 71 | 0 | 0 |
| Forms | 38 | 38 | 0 | 0 (1 client-only validation → Phase 1) |
| Modals | 31 | 25 | 0 | 4 SUSPECT + 2 VERIFY |
| Back-navigation controls | 28 | 27 | 0 | 1 (B-001, same as R-009) |
| **Total (elements + forms + modals)** | **~740** | — | **0** | **7 distinct items** |

## Zero UNWIRED elements found

No dead `onClick`, empty handler, `() => {}`, TODO stub, or `href="#"` was found anywhere. Every SUSPECT item is a quality/robustness concern, not a dead control:

1. **B-001 / R-009** — refrigeration submission form "Back" uses `router.back()` (`src/app/reports/refrigeration/_components/submission-form.tsx:466`): breaks on deep link / refresh. Only occurrence app-wide.
2. **M-004** — delete facility space uses `window.confirm()` (`spaces-tab.tsx:215`).
3. **M-021** — delete rink uses `window.confirm()` (`ice-depth/rinks-tab.tsx:85`).
4. **M-022** — delete scheduling template uses `window.confirm()` (`templates-client.tsx:186`).
5. **M-023** — delete job area uses `window.confirm()` (`job-areas-client.tsx:112`). (A3 pass found the same `window.confirm` pattern on ~15 more admin delete buttons — see 02c/07 notes; consistency decision for Phase 3.)
6. **M-030 / M-031** — employee-detail delete and layout-editor point overlay: confirmation/close paths need Phase 1 verification.
7. **F-038** — public splash "Request information" form is the only form without server-side field validation (API route rate-limits; depth check in Phase 1).

## Mission-invariant reality check (discovered in Phase 0, to be verified in Phase 1)

| Mission assumption | Reality in this codebase |
|---|---|
| Next.js 15 | **Next.js 16.2 / React 19.2** (CLAUDE.md; no middleware.ts — `src/proxy.ts`) |
| Five-tier RBAC (super_admin→org_admin→facility_manager→supervisor→staff) | Live roles are **super_admin / admin / manager / staff** + per-facility custom roles; authorization resolved through `user_permissions` (permission model), not fixed tiers. RBAC audit will use the real model. |
| Offline-first via Dexie.js | **No Dexie.** Offline queue = service worker (`public/sw.js`) → `enqueueSubmission()` → `/api/offline-sync` upsert on `local_id`. Audit targets this. |
| No tRPC | ✅ Confirmed — zero tRPC references; Server Actions + route handlers only. |
| Pro Shop POS module | **Does not exist** in this codebase. |
| Ice Rentals Scheduling module | **Does not exist.** (Closest: `admin/spaces` facility spaces + employee scheduling.) |
| Ten modules | Actual staff modules: daily, refrigeration, incidents, **accidents**, ice-operations, air-quality, ice-depth, scheduling, **communications**, **facility-paperwork** + Admin console. |
| Daily Reports "20 tabs" | Daily areas are admin-configurable with a cap enforced in `areas-tab.tsx` (add button disabled at cap) — exact cap verified in Phase 1. |
| Ice depth: no photo feature | ✅ Confirmed — no photo/camera/upload code in ice-depth. |
| #4DFF00 / #002244 brand; #69BE28 deprecated | ✅ Confirmed — `--rr-green: #4DFF00`, `--rr-navy: #002244` in globals.css; **zero** #69BE28 occurrences (already purged). |
| password reset / session expiry / signup | `/update-password` + super-admin `sendPasswordReset` exist; **no `/signup` route** (accounts provisioned via admin). Session expiry handled by proxy `updateSession()`. |

## Route-coverage cross-check

Every navigation destination used by the staff shell, admin shell, bottom tab bar, and splash resolves to a real route in 01-routes.md. One asymmetry: **`/admin/roles` exists but is absent from the admin sidebar nav** (reachable from employee flows) — flag for Phase 1 Agent A to confirm intentional.
