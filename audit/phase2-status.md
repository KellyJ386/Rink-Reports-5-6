# Phase 2 — Runtime Verification Status

## Suite exists and is ready
The repo ships a complete Playwright E2E suite (`playwright.config.ts`, 10 spec
files `01-authentication` … `10-quality-checks` incl. `09-multi-tenant-security`,
fixtures, a markdown reporter, graceful skip-with-reason). It targets a
**deployed environment** (staging by default) or a local `pnpm start`.

## Local boot attempt — BLOCKED by sandbox
Per the "boot locally if possible" decision, I attempted it. Blockers:
- **No Docker daemon** — `/var/run/docker.sock` does not exist; `docker info`/`docker ps`
  fail. The Supabase local stack (`supabase start`) requires Docker → cannot boot
  Postgres/API/Studio.
- **No Postgres reachable** (54322 closed).
- **No `.env.local`** — no `NEXT_PUBLIC_SUPABASE_URL`/anon key, so even `pnpm start`
  can't run the app against any DB.
- **Supabase CLI** not installed (not a devDependency; npx fetch didn't yield a
  runnable binary in-sandbox).

Conclusion: a real runtime matrix cannot be produced in this container.

## To run Phase 2 (either path)
1. **Against staging (simplest):** set `e2e/.env.e2e.local` with `E2E_BASE_URL`
   = your staging host + the role passwords (`E2E_ADMIN_PASSWORD` …
   `E2E_JANITORIAL_PASSWORD`, `E2E_INACTIVE_PASSWORD`, `E2E_FACILITY_B_*`).
   Then `pnpm install && pnpm exec playwright install chromium && pnpm test:e2e`.
2. **Local:** provide a Docker-enabled environment + Supabase env + seeded
   accounts; then the same commands with `E2E_START_SERVER=1`.

The static Phase 1 findings + Phase 3 fixes stand on their own; runtime
verification would confirm them end-to-end and populate the per-role matrix in
the final report. Marked **DEFERRED — awaiting environment/credentials**.
