# Launch checklist — go-live runbook

The single page to execute on launch day. Compiled from the 14-day
production-readiness plan (`360-REVIEW-AND-14-DAY-PLAN.md`), `DEPLOY.md`
(full runbook), and `READINESS.md`. Every code/infra item below was completed
and verified during Weeks 1–2; what remains is the **human-run, credentialed
deploy** — nothing here is executed automatically.

## State at end of Week 2 (verified 2026-06-10)

- 135 migrations apply cleanly to a fresh database; RLS isolation harness
  green end-to-end (cross-facility isolation for all submission/scheduling/
  communication tables, purge/seed execute gates §2k–§2m).
- `pnpm lint`, `tsc --noEmit`, `pnpm test` (251 unit tests across 20 suites),
  `pnpm build` all clean; generated DB types verified fresh against the
  migrated schema; cron routes ↔ `vercel.json` schedules aligned (3/3).
- All 9 report modules follow the tested compute/submit/actions split; all
  admin modules have loading skeletons; segment error boundaries at /admin,
  /admin/scheduling, /reports; heavy admin lists paginate.
- Server errors are PII-scrubbed + logged (and shipped to PostHog in prod);
  failed email deliveries are visible and retryable in
  Communications → Deliveries.

## Pre-deploy (operator, with credentials)

- [ ] **One-time migration-history reconciliation** done on the production
      Supabase project (DEPLOY.md §8) — prerequisite for
      `deploy-migrations.yml`. (Performed during Week 1 Day 7 dry-run;
      re-verify it still holds.)
- [ ] Vercel env vars set (DEPLOY.md §3): `NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
      `NEXT_PUBLIC_SITE_URL` (production domain), `CRON_SECRET` (32+ random
      chars), `RESEND_API_KEY`, `RESEND_FROM`.
- [ ] Email gate: `RESEND_ENABLED` unset (production auto-enables) or
      explicitly `true` in production ONLY; Resend domain + DNS verified
      (DEPLOY.md §2/§4).
- [ ] Analytics gate: `NEXT_PUBLIC_POSTHOG_KEY` set in production only (or
      rely on the env gate); `NEXT_PUBLIC_POSTHOG_ENABLED` NOT set to true
      anywhere non-production.
- [ ] Supabase Auth (hosted project, DEPLOY.md §9): email confirmations ON,
      `site_url` = production domain, signup policy confirmed.
- [ ] **Leaked-password (HaveIBeenPwned) protection enabled** on the hosted
      project (clears the `auth_leaked_password_protection` Supabase advisor).
      This is a **hosted-platform-only** setting — self-hosted GoTrue / the
      local dev stack has no equivalent, and `supabase/config.toml`'s `[auth]`
      schema has no key for it (confirmed against the CLI's own generated
      template: no `password_hibp_enabled` or similar appears anywhere in
      `supabase init`'s output), so this cannot be expressed as a repo config
      change or a migration — it must be toggled per-project on the hosted
      side. Enable via **Dashboard → Authentication → Sign In / Providers →
      Password → "Leaked password protection"** for project
      `bqbdgwlhbhabsibjgwmk`, or via the Management API
      (`PATCH https://api.supabase.com/v1/projects/bqbdgwlhbhabsibjgwmk/config/auth`
      with a body enabling the HIBP check — confirm the exact field name
      against the current Management API reference before scripting this, as
      it requires a Supabase access token this repo/session does not have).
      Re-run the Supabase security advisors after enabling to confirm the
      advisory clears.
- [ ] PITR enabled on the Supabase project; rollback runbook reviewed
      (DEPLOY.md §10).

## Deploy

- [ ] Merge the release PR to `main`; Vercel auto-deploys; the migration
      workflow pushes `supabase/migrations/**`.
- [ ] Post-deploy smoke workflow green (`/api/health` + all three cron routes
      respond 200 with the bearer).
- [ ] `grep -r "sb_secret_" .next/` on the build output returns nothing
      (DEPLOY.md §5).

## Post-deploy verification

- [ ] DEPLOY.md §5 smoke tests: sign-in, protected-route redirect, offline
      PWA round-trip on one module.
- [ ] All three crons show successful runs in Vercel logs
      (drain-notifications, send-communications, run-retention-purge — the
      retention run should report the migration-134 outbox/sync-queue purges
      in `results`).
- [ ] One real end-to-end report → routing rule → PDF → email verified;
      recipient row reaches `email_status='sent'`; nothing stuck in
      Communications → Deliveries.
- [ ] New-facility seed path verified: create a test facility (super-admin) →
      `/admin/daily-reports` shows the 17-area catalog (migration 135).
- [ ] PostHog: pageviews + a forced client error arrive from production;
      nothing arrives from previews/dev.
- [ ] Device QA matrix executed and signed off
      (`docs/QA-DEVICE-CHECKLIST.md`).

## 24-hour hypercare

- [ ] Monitor Vercel function logs for `[server-error]` lines (structured,
      scrubbed — `context` tells you which action/cron).
- [ ] Check `/api/health` and the Deliveries tab at +2h, +12h, +24h.
- [ ] Confirm the first overnight retention purge ran (admin → Retention
      shows fresh `last_purged_at`).

## If something breaks

- Bad migration → DEPLOY.md §10 (PITR restore runbook, comms template).
- Emails not sending → check `RESEND_ENABLED` gate reason in `/api/health`,
  then Communications → Deliveries for per-recipient errors.
- Crons silent → smoke workflow + `CRON_SECRET` (rotation notes in
  DEPLOY.md §6).
