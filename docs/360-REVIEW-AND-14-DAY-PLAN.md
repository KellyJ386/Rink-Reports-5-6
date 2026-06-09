# Rink Reports — 360° Production-Readiness Review & 14-Day Plan

**Review date:** 2026-06-09
**Scope:** Full application — security/auth, database/RLS, frontend/UX, offline/PWA, integrations, ops/CI/CD, code quality
**Baseline verified on this branch:** `pnpm lint` ✅ clean · `pnpm test` ✅ 115/115 passing · `pnpm build` ✅ clean production build

---

## Executive summary

**Verdict: the app is in strong shape — roughly 85% production-ready.** The architecture is sound (clean auth layering, 100% RLS coverage, idempotent offline sync, resilient notification pipeline, five CI gates), and no critical vulnerabilities or data-corruption bugs were found. What remains is concentrated in four areas:

1. **RLS regression-test coverage** — the isolation harness does not yet assert cross-facility isolation on the *highest-value* tables: submissions, scheduling, and communications.
2. **Silent-failure risk in operations** — a missing/misconfigured `CRON_SECRET` fails silently (notifications stop with no alert); Resend has no dev/prod guard (a dev environment with a real key can email real staff); failed email deliveries have no admin visibility.
3. **UX polish gaps** — 11 admin modules render a blank screen while loading (no `loading.tsx`), no admin-level error boundaries, no pagination on admin lists, service-worker retries have no backoff.
4. **Type/test debt** — generated DB types lag migrations (~40 documented `as any` casts), and persist/permission/scheduling logic has no JS unit tests (mitigated today by the SQL harness).

A focused 14 days closes all of these. The plan below sequences the work: **Week 1 = trust & safety** (RLS tests, ops hardening, type regen, deploy dry-run), **Week 2 = polish & launch** (UX gaps, pagination, observability, full QA, go-live).

### Scorecard

| Area | Score | One-line assessment |
|---|---|---|
| Security & auth | 9/10 | Layered guards everywhere, RLS sound, timing-safe cron auth, CSP set. Minor hardening items only. |
| Database & migrations | 8.5/10 | 127 clean migrations, 100% RLS enablement, strategic indexes, retention framework. Test-coverage + types-sync gaps. |
| Offline / PWA | 8.5/10 | Idempotent claim-based replay, IndexedDB queue, safe caching (no authed-HTML caching). Needs retry backoff + error classification. |
| Frontend & UX | 7.5/10 | Consistent "Logbook" pattern, strong forms, good a11y. Missing loading states, error boundaries, pagination. |
| Integrations (Resend, PostHog, PDF, cron) | 7.5/10 | Resilient pipeline (budgets, poison-pill, backoff). Needs env guards and failure visibility. |
| Testing & CI | 7/10 | 115 unit tests on compute layers, 5 CI workflows, SQL RLS harness. Persist/actions/scheduling untested; no smoke tests. |
| Ops & deployment | 8/10 | Excellent DEPLOY.md/READINESS.md, migration auto-deploy workflow. No rollback runbook, no post-deploy verification, no server-side error capture. |

---

## Detailed findings

### 1. Security & auth — STRONG

**What's done well:**
- Every admin server action calls `requireAdmin()`; every staff submission checks `currentUserCan(supabase, module, "submit")`; super-admin operations have explicit `is_super_admin` guards.
- No `USING (true)` RLS policies anywhere; permission helpers (`has_module_access` etc.) are SECURITY DEFINER with pinned `search_path`.
- Offline-sync uses a claim-before-persist pattern with `local_id` idempotency — replays and double-syncs are no-ops.
- All three cron endpoints require `CRON_SECRET` with timing-safe hash comparison and return opaque 401s.
- Exports require `requireAdmin()` + module `view` permission, pin every query to the caller's `facility_id`, and cap date ranges at 90 days.
- CSP, `X-Frame-Options: DENY`, `nosniff`, restrictive `Permissions-Policy` all set in `next.config.ts`.
- No hardcoded secrets; service-role client is function-scoped, server-only, pre-flight validated.

**Findings:**

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| S1 | Medium | Export filename interpolated into `Content-Disposition` without RFC 6266 encoding (currently safe via `slug()`, but no defense-in-depth) | `src/app/api/exports/route.ts:61` | Use `filename*=UTF-8''${encodeURIComponent(...)}` |
| S2 | Medium | Super-admin with `facility_id = NULL` calling facility-scoped actions passes `null` into `.eq("facility_id", …)` paths; relies on RLS as the only backstop | `src/app/admin/communications/actions.ts:57-67` | Add explicit null-facility rejection guard |
| S3 | Medium | Invite service health check leaks service-role key format details (prefix, length) to the super-admin UI | `src/app/admin/super-admin/actions.ts:186` | Log details server-side; return generic message to UI |
| S4 | Low | Verify `offline_sync_queue` unique constraint is on `(facility_id, local_id)` not bare `local_id` (client controls `local_id`) | `src/app/api/offline-sync/route.ts:196-212` + migration 31 | Confirm/add composite unique in a migration |
| S5 | Low | No rate limiting on auth or API routes beyond Supabase's built-ins | app-wide | Acceptable for staff app; revisit if exposed publicly |

### 2. Database & migrations — STRONG, with test-coverage gaps

**What's done well:**
- 127 sequential migrations, no duplicate prefixes, destructive changes documented with rollback notes, idempotent seeds (`ON CONFLICT DO NOTHING`, `WHERE NOT EXISTS`).
- 100% RLS enablement across ~111 tables; clean permission hierarchy (super-admin → facility admin → module view/submit → area-level gates), consolidated onto `user_permissions` (migrations 91/99).
- Strategic composite indexes for hot tenant-scoped queries (migrations 23, 92, 96, 112); 21 facility_id indexes.
- Strong integrity: NOT NULL on critical columns, CHECK constraints on 25+ enum-ish columns, contextually correct FK cascade choices, partial unique indexes on thresholds.
- Retention framework: per-facility/per-module `keep_days`, 7 purge functions + fixed 7-year audit-log retention, service-role-only execution.
- `scheduling_assignment_violations()` RPC is a well-designed single source of truth for shift-compliance checks.

**Findings:**

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| D1 | **High** | `rls_isolation.sql` does NOT test cross-facility isolation on submissions (daily, incident, accident, refrigeration, air-quality, ice-ops, ice-depth), communications, scheduling, or notification tables — the highest-value data in the app | `supabase/tests/rls_isolation.sql` | Add isolation assertions for all submission/scheduling/communication tables |
| D2 | Medium | Generated types stale — migrations ~92–127 not reflected in `src/types/database.ts`, causing ~40 documented `as any` casts in 27 files | `src/types/database.ts` | Regenerate via `supabase gen types`; add CI freshness check |
| D3 | Medium | No retention/purge for `offline_sync_queue` (beyond synced rows) and `notification_outbox` — unbounded growth if drains fail | migrations 18/24/37 | Add `purge_old_notification_outbox()` + queue purge to retention cron |
| D4 | Medium | Daily-report checklist seeds (migration 106) are hard-coded to one facility UUID — new production facilities get **zero checklist items** | `supabase/migrations/00000000000106_*.sql` | Auto-seed on facility creation (extend migration 120 trigger) or provide per-facility seed script + runbook entry |
| D5 | Medium | Local `config.toml` has `enable_confirmations = false` and localhost `site_url` — fine locally, but prod Supabase project must be explicitly configured (email confirmations, site URL, signup policy) | `supabase/config.toml` | Add prod auth-config checklist to DEPLOY.md and verify on the hosted project |
| D6 | Low | No down-migrations; rollback = Supabase PITR restore | `supabase/migrations/` | Document rollback runbook (see O3) |

### 3. Offline / PWA — STRONG

**What's done well:**
- Service worker is genuinely production-grade: network-only navigation (no authenticated-HTML caching — kiosk-safe), versioned cache with cleanup, FIFO IndexedDB queue ordered by `startedAt`, gated `skipWaiting` (no mid-shift updates), Background Sync API + online-event dual trigger.
- All 9 staff report flows enqueue offline (verified: refrigeration, daily, incidents, accidents, air-quality, ice-depth, ice-operations, communications compose, scheduling availability/time-off). Scheduling shift-claiming is intentionally online-only (depends on live state) — correct call.
- Replay handlers on `/api/offline-sync` follow a consistent parse → validate → permission → claim → persist → mark-synced pattern; permanent errors are rejected *before* claiming so they retry correctly.
- Note: the generic queue-row fallback for unrecognized modules is defensive dead code — facility-paperwork is read-only and never enqueues, so there is **no** offline data-loss path there (a concern raised and disproven during this review).

**Findings:**

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| P1 | Medium | No retry backoff in `replayQueue()` — when the endpoint is down, the SW hot-loops 4 attempts per tick | `public/sw.js:129-163` | Exponential backoff (1s/5s/15s/60s) before re-registering sync |
| P2 | Medium | Retry logic doesn't distinguish 4xx (permanent — stop retrying) from 5xx/network (transient — retry); failures store generic "HTTP 503"/"network error" so staff can't see *why* a report failed | `public/sw.js:148-156` | Classify by status class; persist `lastError` and surface it in `/reports/offline-queue` |
| P3 | Medium | Double-submit while offline can overwrite the first queued payload (IndexedDB upsert on `localId`) | `src/lib/offline/use-sync-queue.ts:65-83` | Already regenerates `localId` post-enqueue in forms — audit all 9 forms do this; add collision-resistant ID generation |
| P4 | Low | No `beforeunload` unsaved-data warning on long forms (refrigeration, accidents) | report forms | Add dirty-state guard to multi-section forms |
| P5 | Low | No offline-status banner on incidents/communications forms (others have it) | `src/app/reports/incidents/_components/submission-form.tsx` | Standardize `isOnline` messaging across all 9 forms |

### 4. Integrations (Resend, PostHog, PDF, cron) — GOOD, needs guard rails

**What's done well:**
- Notification pipeline: time-budget enforcement, bounded PDF concurrency (4), poison-pill `PERMANENT:` marking, per-(facility, module, record) PDF dedup, defense-in-depth facility check on rendered PDFs, email backoff ladder (1m/5m/15m/60m, 5 attempts).
- Missing `RESEND_API_KEY` degrades gracefully — rows stay pending and flush once configured.
- PostHog: lazy-loaded, autocapture off, memory-only persistence, error boundaries capture exceptions with `digest`.
- `check-cron-schedule.mjs` CI guard keeps cron routes ↔ `vercel.json` in sync; schedules are staggered to avoid collisions.
- `.env.example` is complete — every `process.env.*` in the codebase is documented.

**Findings:**

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| I1 | **High** | No dev/prod guard on Resend — a dev environment with a real API key will send real emails to real staff | `src/lib/notifications/transport/email.ts` | Require `NODE_ENV === "production"` or an explicit `RESEND_ENABLED=true` flag |
| I2 | **High** | Missing/misconfigured `CRON_SECRET` ⇒ all three crons 401 forever, silently — notifications and retention just stop | deployment config | Health endpoint + post-deploy smoke test (see O1); alert on consecutive cron failures |
| I3 | Medium | Terminally-failed email deliveries (`email_status='failed'`) have no admin UI and no alerting — important notifications can vanish silently | `send-communications/route.ts:330-347` | Admin "failed deliveries" view with manual retry |
| I4 | Medium | PostHog error capture has no PII scrubbing (incident/accident text can land in events); no env gating against dev contamination | `src/components/app/posthog-provider.tsx` | Scrub error payloads; gate key by environment |
| I5 | Low | PDF source-row fetch has no query timeout — a slow DB query can burn the cron's 60s budget | `src/lib/notifications/pdf/render.tsx` | Add timeout; skip slow rows |

### 5. Frontend & UX — GOOD, needs polish

**What's done well:**
- All 9 staff modules + 15 admin modules present, routable, no stubs, no TODO/FIXME anywhere in `src/`, zero dead nav links.
- Forms: consistent client+server validation, `useFormStatus` double-submit protection, post-submit `done/` redirects, errors via `useActionState` → toast.
- Accessibility above average: `FormField` enforces label pairing, `aria-describedby` error association, focus-to-first-error, skip link, Radix focus traps, 48px primary touch targets.
- The "Logbook" pattern is consistently applied; deviations (air-quality badges, ice-depth SVG, accidents body diagram) are intentional and documented in CLAUDE.md.
- Bundle discipline: xlsx lazy-loaded on demand, @react-pdf server-only, PostHog deferred.
- PWA: complete manifest, `viewportFit: cover`, mobile sidebars, dark/light tokens.

**Findings:**

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| F1 | Medium | 11 admin modules have no `loading.tsx` — blank screen during data fetch: departments, daily-reports, incident-reports, scheduling, exports, audit-log, facility-documents, retention, roles, super-admin | `src/app/admin/*` | Copy skeleton pattern from `admin/employees/loading.tsx` |
| F2 | Medium | No `error.tsx` anywhere under `/admin` or `/reports` — all failures fall to the global boundary, losing module context | `src/app/admin/`, `src/app/reports/` | Add segment boundaries at least at `/admin` and `/reports` level |
| F3 | Medium | No pagination on admin lists: schedule shifts, daily-report submissions, refrigeration reports load unbounded; employees hard-capped at 500 | `src/app/admin/scheduling/page.tsx` etc. | `.range()` + "Load more" on the four heaviest lists |
| F4 | Low | Body-diagram SVG uses hardcoded hex colors (no dark-mode adaptation) | `src/components/staff/body-diagram/body-diagram.tsx:27-31` | Map to CSS tokens |
| F5 | Low | No granular Suspense within `/admin/scheduling` sub-routes | `src/app/admin/scheduling/*` | Per-segment `loading.tsx` |

### 6. Testing, CI & ops — ADEQUATE, biggest improvement opportunity

**What's done well:**
- 5 CI workflows: build/lint/typecheck, RLS isolation harness on migration PRs, migration-prefix collision guard, cron-schedule alignment, migration auto-deploy (`supabase db push` on merge).
- 115 passing unit tests across 6 compute modules; vitest correctly scoped to pure logic.
- Documentation is genuinely excellent: `DEPLOY.md` (300+ line runbook), `READINESS.md`, CLAUDE.md, 12 docs total.

**Findings:**

| # | Severity | Finding | Fix |
|---|---|---|---|
| O1 | **High** | No post-deploy smoke test — a broken deploy (bad env var, dead cron) sits unnoticed | Add `/api/health` endpoint (checks env presence, DB reachability) + post-deploy GitHub Action hitting health + cron endpoints |
| O2 | Medium | No server-side error capture — server actions swallow errors into `{ error }` returns; ops can't see failure rates | Add a `logServerError(context, err)` helper (PII-scrubbed `console.error` + optional PostHog server capture) to action catch blocks |
| O3 | Medium | No rollback runbook for a bad migration in prod (PITR exists but undocumented) | Add "migration broke prod" runbook to DEPLOY.md |
| O4 | Medium | Untested logic: all 8 `persist*` pipelines, server actions (~1,900 LOC), `src/lib/permissions/check.ts`, scheduling `datetime.ts`/enforcement, units conversion, export field mapping; incidents + air-quality compute never extracted from actions.ts | Extract + test (see Days 8–9) |
| O5 | Low | No dependency-vulnerability/secret scanning in CI | Add `pnpm audit` + secret-scan workflow |
| O6 | Low | Swap-approval state machine doesn't reject status `applied`; README doesn't mention `cp .env.example .env.local` | One-line guards/docs fixes |
| O7 | Low | Stale artifacts: empty `agents/` directory, `reports/offline-queue` `.gitkeep` leftovers | Clean up |

---

## The 14-day plan to production

Assumes one developer full-time; each day lists concrete tasks with acceptance criteria. **Week 1 makes the app safe to launch; Week 2 makes it pleasant and observable, ending in go-live.**

### Week 1 — Trust & safety

**Day 1 — Stop the silent failures (I1, I2, O1)**
- Add `RESEND_ENABLED` / `NODE_ENV` guard to email transport; log-and-skip when not production.
- Build `/api/health`: verifies required env vars present, DB reachable, returns version/commit. Super-admin-visible status.
- Add post-deploy smoke workflow: hit `/api/health` and each cron route with the bearer token; fail loudly on non-200.
- ✅ *Done when: a deploy with a missing CRON_SECRET fails the smoke check within minutes, and a dev clone can never email real staff.*

**Day 2 — Regenerate DB types & kill the `as any` debt (D2)**
- `supabase gen types typescript` against the migrated schema; replace the ~40 documented casts in 27 files.
- Add a CI step that regenerates types and diffs (fails if stale).
- ✅ *Done when: `grep -r "as any" src | wc -l` ≈ 0 and CI guards freshness.*

**Days 3–4 — RLS isolation tests for the crown jewels (D1)**
- Extend `supabase/tests/rls_isolation.sql` with facility-B negative assertions for: all 7 submission-family tables, communication messages/recipients/alerts, schedule shifts/swaps/availability/time-off/notifications, `notification_outbox`, and change-log tables.
- Verify (and fix if needed) the `offline_sync_queue` unique constraint scope (S4).
- ✅ *Done when: the harness fails if any of these tables leak across facilities, and CI runs it.*

**Day 5 — Service-worker resilience (P1, P2, P3)**
- Exponential backoff between replay attempts; classify 4xx as permanent (no retry) vs 5xx/network as transient.
- Persist `lastError` per queued item; render it in `/reports/offline-queue`.
- Audit all 9 forms for post-enqueue `localId` regeneration; strengthen ID generation.
- Bump SW cache version; verify update-prompt flow.
- ✅ *Done when: airplane-mode submit → server 500 on reconnect → backoff retries → eventual success, with visible per-item status throughout.*

**Day 6 — Security hardening pass (S1–S3, O6)**
- RFC 6266-encode export filenames; null-facility guard in facility-scoped actions; scrub service-role debug info from the invite health check UI; reject `applied` status in swap approval.
- Run `pnpm audit`; add dependency + secret scanning to CI (O5).
- ✅ *Done when: all five small fixes merged with the security CI step green.*

**Day 7 — Production environment dry-run (D5, O3, parts of DEPLOY.md §8)**
- Perform the one-time Supabase migration-history reconciliation against the production project (documented prerequisite).
- Configure prod auth: email confirmations ON, correct `site_url`, signup policy; verify Resend domain/DNS; set all Vercel env vars; confirm crons fire (check smoke workflow + Vercel logs).
- Write the "migration broke prod" rollback runbook (PITR restore steps, comms template, downtime window).
- ✅ *Done when: a full staging→prod deploy runs end-to-end and the runbook is reviewed.*

### Week 2 — Polish, observability, launch

**Day 8 — Finish the submit-pipeline refactor + tests (O4 part 1)**
- Extract `compute.ts` from incidents and air-quality `actions.ts` (matching the other 7 modules); add vitest suites for both.
- Add unit tests for `src/lib/units` and `src/lib/permissions/check.ts`.
- ✅ *Done when: all 9 modules follow compute/submit/actions and test count grows from 115 to ~160+.*

**Day 9 — Scheduling logic tests (O4 part 2)**
- Unit tests for `_lib/datetime.ts` (UTC week math, DST boundaries), date-param parsing in `types.ts`, and `computeComplianceWarnings()` (extracted to pure form).
- Add scheduling RLS assertions if any were deferred from Day 4.
- ✅ *Done when: the scheduling module's date/compliance math is regression-protected.*

**Day 10 — Admin UX gaps (F1, F2, F5)**
- `loading.tsx` skeletons for all 11 missing admin modules; `error.tsx` boundaries at `/admin`, `/admin/scheduling`, and `/reports`; per-segment loading inside scheduling sub-routes.
- ✅ *Done when: throttled-network navigation shows skeletons everywhere and a thrown server error shows a contextual recovery UI, not the global boundary.*

**Day 11 — Pagination + retention (F3, D3)**
- `.range()` + "Load more" on schedule shifts, daily-report submissions, refrigeration reports, employees.
- Migration adding `purge_old_notification_outbox()` and `offline_sync_queue` purge; wire both into the retention cron; add RLS-harness coverage for the new functions.
- ✅ *Done when: admin lists stay fast at 10k rows and no table grows unbounded.*

**Day 12 — Observability + failed-delivery visibility (O2, I3, I4)**
- `logServerError()` helper (PII-scrubbed) wired into server-action catch blocks and cron handlers; optional PostHog server-side capture.
- Admin view for failed `communication_recipients`/outbox rows with manual retry.
- PII scrub + env gating for PostHog client capture.
- ✅ *Done when: ops can answer "what failed today and why" from the admin console.*

**Day 13 — Full QA pass + seeding for new facilities (D4, P4, P5, F4)**
- Auto-seed daily-report checklists on facility creation (extend the migration-120 trigger pattern) or ship the per-facility seed script + runbook entry.
- Device QA: real phone/tablet offline round-trip for all 9 modules, dark-mode sweep, PWA install, kiosk logout behavior.
- Add `beforeunload` guards to long forms; standardize offline banners; tokenize body-diagram colors.
- ✅ *Done when: a brand-new facility is usable out of the box and the device matrix passes.*

**Day 14 — Launch**
- Final green run: lint, test (~180+), build, RLS harness, smoke workflow.
- Deploy to production; execute DEPLOY.md smoke tests (curl checks, sign-in, offline PWA test); verify crons + first real notification email; confirm PostHog events arriving.
- 24-hour hypercare: monitor Vercel function logs, `/api/health`, failed-delivery view.
- ✅ *Done when: production traffic flows, all three crons have logged successful runs, and one real end-to-end report → notification → PDF → email has been verified.*

### Sequencing rationale & risks

- **Type regen (Day 2) before everything else that touches code** — eliminates `as any` noise that would otherwise pollute every subsequent diff.
- **RLS tests (Days 3–4) are the single highest-leverage item**: they protect the most sensitive asset (cross-facility data) forever, not just at launch.
- **Deploy dry-run mid-plan (Day 7), not at the end** — the migration-history reconciliation is the riskiest one-time operator task; doing it on Day 14 would be reckless.
- **Slack built in**: Days 8–9 and 12 are compressible if anything from Week 1 slips. The only items that should never be cut: Days 1, 3–4, 7, 14.

### Launch-day checklist (condensed from DEPLOY.md + this review)

- [ ] `CRON_SECRET` set (32+ random chars) and smoke workflow green
- [ ] `SUPABASE_SERVICE_ROLE_KEY` valid (super-admin health check passes)
- [ ] `NEXT_PUBLIC_SITE_URL` = production domain; Supabase auth `site_url` matches; email confirmations ON
- [ ] `RESEND_API_KEY` + `RESEND_FROM` configured, domain verified, `RESEND_ENABLED` only in prod
- [ ] `grep -r "sb_secret_" .next/` returns nothing after build
- [ ] RLS harness green including new submission/scheduling/communication assertions
- [ ] All three crons confirmed running in Vercel logs
- [ ] New-facility seed path verified (checklists present)
- [ ] Rollback runbook reviewed; PITR confirmed enabled on the Supabase project
