# Rink Reports — End-to-End Tests (Playwright)

Browser-driven E2E coverage for the staff PWA and admin console. These tests
run against a **deployed environment** (staging by default) and exercise real
auth, RLS, report submission, and admin flows.

> These are distinct from the **vitest** unit tests (`pnpm test`), which cover
> pure, dependency-free logic, and from the **SQL RLS harness**
> (`supabase/tests/rls_isolation.sql`). E2E here is the black-box layer on top.

## Quick start

```bash
# 1. Install (Playwright is already a devDependency)
pnpm install
pnpm exec playwright install chromium   # skip if browsers are preinstalled

# 2. Configure environment + credentials
cp e2e/.env.e2e.example e2e/.env.e2e.local
#   …then edit e2e/.env.e2e.local: set E2E_BASE_URL and the E2E_*_PASSWORD vars.

# 3. Run
pnpm test:e2e                 # all tests, both projects (desktop + mobile)
pnpm test:e2e -- 01-authentication
pnpm test:e2e:headed         # watch it drive a browser
pnpm test:e2e:ui             # Playwright UI mode
pnpm test:e2e:report         # open the HTML report after a run
```

The final markdown report lands at **`e2e/report/REPORT.md`**, the browsable
HTML report at **`e2e/report/html/`**, and machine-readable JSON at
**`e2e/report/results.json`**. Failure screenshots, traces, and videos are
saved under `e2e/report/artifacts/`. None of these are committed (gitignored).

## Configuration

All config is via env vars (see `e2e/.env.e2e.example` for the full list and
defaults). Passwords are **never** hard-coded — each role reads its password
from its own `E2E_<ROLE>_PASSWORD` var.

| Var | Purpose |
| --- | --- |
| `E2E_BASE_URL` | Environment under test (default `http://localhost:3000`). |
| `E2E_START_SERVER=1` | Have Playwright boot `pnpm start` itself (local runs). |
| `E2E_<ROLE>_PASSWORD` | Password for each of the 7 staging roles. |
| `E2E_<ROLE>_EMAIL` | Override the default `<role>-test@rinkreports.com`. |
| `E2E_INACTIVE_*` | The deactivated account for the "cannot log in" check. |
| `E2E_FACILITY_B_*` | Facility-B user + a Facility-B report URL for isolation. |
| `E2E_DAILY_REPORT_PATH`, `E2E_ICE_DEPTH_LAYOUT_SLUG` | Seed-specific deep links. |

### Graceful skips

Tests that need a credential or seed value that isn't set **skip with a
reason** instead of failing, so the suite stays green against a partially
seeded environment and self-documents what it needs. The skip reasons are
collected in `REPORT.md`. Provide the missing env var to un-skip.

## CI

`.github/workflows/e2e.yml` runs the full suite nightly at **06:00 UTC**
against the deployed target, and can be run on demand from the Actions tab
(**E2E → Run workflow**), optionally with a `url` input to override the base
URL for that run. It installs chromium only (both Playwright projects are
chromium-based) and uploads `e2e/report/` — HTML report, `REPORT.md`,
`results.json`, failure traces/screenshots/videos — as a `playwright-report`
artifact (14-day retention) when the run fails.

Configuration lives in GitHub Actions **repo variables** (non-secret) and
**secrets**:

| Kind | Name | Purpose |
| --- | --- | --- |
| variable | `E2E_BASE_URL` | Deployed environment to test (e.g. staging). |
| variable | `E2E_FACILITY_B_REPORT_PATH` | Optional; Facility-B report URL (section 9). |
| variable | `E2E_DAILY_REPORT_PATH` | Optional; daily-report deep link. |
| variable | `E2E_ICE_DEPTH_LAYOUT_SLUG` | Optional; ice-depth layout slug. |
| secret | `E2E_ADMIN_PASSWORD` … `E2E_JANITORIAL_PASSWORD` | The 7 role passwords (ADMIN, MANAGER, SUPERVISOR, ICETECH, FRONTDESK, CONCESSIONS, JANITORIAL). |
| secret | `E2E_INACTIVE_PASSWORD` | Deactivated account. |
| secret | `E2E_FACILITY_B_PASSWORD` | Facility-B user (multi-tenant isolation). |

The workflow is **fail-soft**: if `E2E_BASE_URL` or `E2E_ADMIN_PASSWORD` is
not configured it logs a notice and exits green rather than failing nightly —
and, as always, individual tests missing a credential or seed value skip with
a reason instead of failing.

## Layout

```
e2e/
  fixtures/
    env.ts            # dependency-free .env.e2e loader
    users.ts          # the 7 roles, emails, password env vars, expectations
    auth.ts           # login()/logout(), storage-state cache, `test` + loginAs
  utils/
    nav.ts            # module routes, expectForbidden/isAccessDenied helpers
    console-guard.ts  # collects console/page errors (section 10)
    markdown-reporter.ts  # writes e2e/report/REPORT.md
  tests/
    01-authentication.spec.ts
    02-role-permissions.spec.ts
    03-daily-reports.spec.ts
    04-ice-operations.spec.ts
    05-incidents-accidents.spec.ts
    06-refrigeration-air-quality.spec.ts
    07-ice-depth.spec.ts
    08-admin-control-center.spec.ts
    09-multi-tenant-security.spec.ts
    10-quality-checks.spec.ts
  TEST-PLAN.md         # maps every requested scenario → spec/test
```

## Staging data prerequisites

For full (un-skipped, green) coverage the staging environment should have:

1. The seven role accounts above, **active**, each in **Facility A**, with
   `user_permissions` matching their department (see `users.ts`
   `expectedModules` — treat these as the contract and reconcile seed to them).
2. One **deactivated** account (`E2E_INACTIVE_*`).
3. A second **Facility B** with its own user (`E2E_FACILITY_B_*`) and at least
   one report whose URL you put in `E2E_FACILITY_B_REPORT_PATH`.
4. At least one daily-reports area/template the department users can submit to,
   plus an ice-depth layout, refrigeration thresholds, and air-quality reading
   types configured (these power the submission specs).
5. Module alert toggles in a known state (e.g. refrigeration `oorAlertsEnabled`
   ON for the "triggers alert" test, a second module with it OFF for the
   "does not trigger" test).

Where a scenario depends on data the test can't introspect (specific failed
items triggering a Communications alert, the 24-hour accident edit window,
email recipients), the test asserts what it safely can and annotates the rest
with `test.fixme`/skip + a TODO pointing at the seed requirement. Search the
specs for `TODO(seed)` to find these.

## Notes on app behavior the tests rely on

- Login posts to a server action that redirects to `/dashboard`; middleware
  (`src/proxy.ts`) bounces authenticated users off `/login`.
- Non-admins hitting `/admin/*` are redirected to `/forbidden` ("Access
  denied"). Unauthenticated users hitting protected routes go to
  `/login?redirectTo=…`.
- Inactive accounts are denied at `requireUser`/`requireAdmin` (→ `/forbidden`)
  and may also be rejected at the Supabase sign-in step.
- Reports are immutable to staff after submit; incidents/accidents allow a
  24-hour edit window; accident reports have **no photo upload**.
```
