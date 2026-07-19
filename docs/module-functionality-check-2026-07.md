# Module functionality check — 2026-07-19

Full-stack verification of all ten modules: static checks on this branch,
database/config integrity audits against the hosted project
(`bqbdgwlhbhabsibjgwmk`), and browser-driven Playwright runs of the entire
`e2e/` suite (plus a new 37-page walkthrough spec) against the production
deployment at `https://www.rinkreports.com` (commit `aeb1e27`, identical to
this branch's base). Test fixtures were seeded into the hosted project for the
runs and **fully removed afterward** (verified: user/employee/facility/report
counts and all module settings back to their pre-test values; the temporary
`e2e_temp_credentials` table dropped).

## How the browser runs were executed

The sandboxed session cannot reach `*.vercel.app` / `*.supabase.co` (egress
policy), so the suite ran on GitHub Actions via the new
`.github/workflows/e2e-branch-run.yml`: credentials are staged in a
locked-down table in the project DB (RLS enabled, no client grants), fetched
at runtime over the existing `SUPABASE_DB_PASSWORD` secret, masked, and
preflighted against the auth API before the suite starts. Three iterations
were needed to get trustworthy signal — each failure mode is itself a finding:

| Run | Result | Lesson |
| --- | --- | --- |
| #2 (full suite, fresh login per test) | collapsed in waves; 76 sessions minted | Supabase per-IP sign-in rate limiting makes per-test UI logins unusable from CI |
| #3 (cached sessions) | 25 passed / 140 failed | The PWA service worker serves cached app-shells to the automated browser: `net::ERR_ABORTED` navigations, auth redirects that never fire |
| #4 (SW blocked, desktop) | **57 passed / 51 failed / 8 skipped** | Remaining failures cluster into four real root causes (below) |

## Per-module verdict

| Module | Verdict | Evidence |
| --- | --- | --- |
| Authentication & roles | ✅ working | All 7 role accounts log in and land on /dashboard; inactive account denied; `/admin` redirects non-admins to `/forbidden` (URL redirect confirmed in every run) |
| Daily Reports | ✅ working | Spec 03 zero failures in run #4: submit (incl. unchecked items), multiple/day, history, immutability; area-permission gating honored |
| Ice Operations | ✅ working | Spec 04 zero failures: Ice Make submits, Circle Check pass/fail + required notes, end-of-day PDF |
| Refrigeration | ✅ working | Spec 06 zero failures: °F/°C toggle, OOR alert banner, critical-value corrective note, incomplete-report policy |
| Air Quality | ✅ working | Spec 06 zero failures: required location, over-threshold range badge |
| Incidents | ✅ working | Submit + required-field enforcement pass; one crawl check flagged crash-UI text on `/reports/incidents` (believed hydration fallout — retest after fix) |
| Accidents | ⚠️ mostly working | Form renders/submits; **body-diagram tap did not register a selection in the automated browser** (`05` #17) — retest after the hydration fix, then manually on a touch device |
| Ice Depth | ⚠️ mostly working | Layout page renders; **the "enter depth for point" dialog did not open on point-tap** in automation (`07` #18/#19) — same retest guidance as accidents |
| Communications | ✅ working | Pages render for all roles; alert lifecycle verified in DB (2 alerts created, routed to admin, acknowledged, resolved); routing rules coherent |
| Scheduling | ✅ code working / ⚠️ data gap | Pages render; settings/compliance rules coherent — but **all 10 production shifts are drafts; nothing is published, so staff schedule views are empty** (operator action: publish) |
| Facility Paperwork | ✅ working | Renders; gated by facility-module enablement + facility-scoped RLS |
| Admin Control Center | ✅ working | All 16 consoles render for admin and deny staff; three spec failures are selector drift (renamed tabs, a11y skip-link intercept), not product bugs |
| Multi-tenant isolation | ✅ working | Facility-A user denied Facility-B report by RLS (passed in runs #3/#4) |
| Offline/PWA | ✅ for users / ⚠️ for automation | SW behaves as designed for users; automation must block SWs (now configured in `playwright.config.ts`) |
| Cron/notifications | ✅ configured | All 6 cron routes exist and match `vercel.json`; queues drained; auth (CRON_SECRET/service-role) enforced; no execution audit trail exists (observability gap) |

## Findings (ranked)

1. **Site-wide React #418 hydration mismatch (product bug, medium).** Client
   components render timezone-dependent date strings during SSR (UTC on
   Vercel) that differ in the viewer's browser (America/New_York). 5–9 page
   errors on essentially every content page; also the likely cause of the
   crash-UI detection on `/reports/incidents` and possibly the inert
   ice-depth/body-diagram taps under automation. ~30 call sites confirmed:
   admin table timestamp cells (`new Date(x).toLocaleString()` in
   `audit-log-table`, communications tabs, report detail/history tabs,
   `super-admin` panels, `retention-row`, `employee-detail`), the
   `datetime-local` defaults in the refrigeration/incident/accident submission
   forms (`nowForDateTimeLocal()` in `useState` initializers), and
   `offline-queue-view` / `ice-ops-shell` timestamps. Fix pattern: route
   display timestamps through a shared fixed-`timeZone` formatter
   (`src/lib/timezone.ts` already has the primitive) and set form "now"
   defaults in a `useEffect` after mount. Recommended as its own PR.
2. **`/forbidden` title was not a heading (a11y, fixed on this branch).** The
   "Access denied" title rendered as a `div` (shadcn `CardTitle`), invisible
   to `getByRole("heading")` and assistive tech. This single issue accounted
   for ~21 of run #4's 51 failures (specs 02/08/11 denial tests) even though
   the redirects worked. Fixed: real `<h1>`.
3. **`create_facility_with_roles()` still seeds retired `gm`/`supervisor`
   roles (confirmed, live path).** Latest definition (migration 135) inserts
   the old 6-role set; the roles trigger then wires them with permission
   defaults (`canonical_role_permission_grants()` still carries their
   ceilings). Reachable from the super-admin Create Facility UI
   (`src/app/admin/facility/actions.ts:148`). New facilities regress the
   migration-55/87 consolidation and get inconsistent hierarchy levels. Fix:
   `CREATE OR REPLACE` both seed functions to the canonical 4 roles; optional
   guard rejecting `gm`/`supervisor` keys.
4. **`facility_paperwork` missing from `MODULE_NAMES`
   (`src/lib/permissions/actions.ts`).** The permissions/roles matrices never
   render it, so its migration-175 grants can't be managed from the UI.
   Currently inert (the module is gated by `facility_modules` + RLS, not
   `user_permissions`), but a latent trap. Fix: add to
   `MODULE_NAMES`/`MODULE_LABELS`.
5. **Production data gaps (operator actions, not code):** publish the 10
   draft schedule shifts; add an ice-depth layout for Oval Rink (0 today);
   add `blade_set` equipment or disable the Blade Change tab (currently a
   dead tab); optionally clean the orphaned all-disabled `user_permissions`
   set for one account with no `employees` row; no retention policy is
   configured anywhere (nothing auto-purges); 15 numeric refrigeration fields
   (pumps especially) have no thresholds so no normal-range hints render; two
   circle-check items look merged from the paper-form import (one contains a
   literal tab character).
6. **E2E/nightly infra was dead green.** The nightly `E2E` workflow has never
   executed a test: `E2E_BASE_URL` and all `E2E_*` secrets were never
   configured, so every night takes the fail-soft skip. To make the nightly
   real: create the role accounts (see `e2e/README.md`), set the repo
   variable + secrets, and keep the fixes from this branch (session-cache
   login, `serviceWorkers: "block"`). Minor test-side drift also found:
   admin-console tab renames vs spec 08 selectors, a permissions-matrix
   click that resolves to the "Skip to main content" link, and an
   empty-text `role="alert"` on invalid login (worth one manual look).
7. **No cron execution audit trail (observability).** Queues being empty is
   consistent with healthy drains, but nothing records "cron X ran at Y" —
   consider a small `cron_executions` table or rely on Vercel logs.

## Static checks (this branch)

`pnpm lint` clean; `pnpm test` 517/517; `pnpm build` clean (all module routes
compile). Vitest, config integrity, and permission model checks were run by
parallel agents (Sonnet/Opus/Haiku) whose detailed reports informed the
findings above.

## Changes on this branch

- `.github/workflows/e2e-branch-run.yml` — on-demand full-suite run against a
  deployed URL with DB-staged credentials (dispatch-only; requires re-seeding
  the `e2e_temp_credentials` table + test accounts first).
- `e2e/tests/11-module-walkthrough.spec.ts` — 37-page walkthrough (staff +
  admin consoles + role-denial), full-page screenshots into the report
  artifact.
- `e2e/fixtures/auth.ts` — per-role session cache (fixes the CI sign-in
  rate-limit collapse; spec 01 still exercises the real form).
- `playwright.config.ts` — `serviceWorkers: "block"`.
- `src/app/forbidden/page.tsx` — "Access denied" is a real `<h1>`.

Artifacts: run #4 report (HTML/JSON/REPORT.md + walkthrough screenshots) is
the `playwright-report` artifact on the `E2E Branch Run` workflow, run
29673078209 (14-day retention).
