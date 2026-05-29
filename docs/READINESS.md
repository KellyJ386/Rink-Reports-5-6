# App-readiness review

Status snapshot from a code-review + production-readiness pass across the app
(Next.js 16.2 / React 19.2 / Supabase, permanent dark-mode PWA). Companion to
the deploy runbook in [`DEPLOY.md`](./DEPLOY.md).

## Verdict

**Go, with one operator prerequisite.** The application is structurally
production-ready: every staff report module and admin module is fully
implemented, CI gates are in place, and auth/RLS/security headers are
well-layered. The only true pre-prod blocker is an **operator task** — the
one-time Supabase migration-history reconciliation required before the
migration-delivery workflow can run (see WS3 below).

## Go/no-go by area

| Area | Status | Notes |
| --- | --- | --- |
| Report modules (staff) | ✅ Ready | All 11 flows implemented (refrigeration, daily, incidents, accidents, ice-depth, ice-operations, air-quality, communications, scheduling, facility-paperwork, offline-queue). No stubs. |
| Admin modules | ✅ Ready | All 14 modules implemented (CRUD, filtering, exports, permissions, audit log). No scaffolding. |
| CI gates | ✅ Ready | `ci.yml` (lint, `tsc --noEmit`, build), `rls-isolation.yml`, `migration-prefix-check.yml`, `cron-schedule-check.yml`. |
| Auth / session | ✅ Ready | `src/proxy.ts` → `updateSession()`; `getUser()` immediately after client creation; protected-route + login redirects sound. |
| RLS / permissions | ✅ Ready | Facility isolation + role tier + module/area permissions, enforced at DB level; covered by `supabase/tests/rls_isolation.sql`. |
| Supabase clients | ✅ Ready | anon vs service-role split correct; service-role key validated before use; no secrets in `NEXT_PUBLIC_*`. |
| Security headers | ✅ Ready | CSP (prod), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` in `next.config.ts`. |
| Offline / PWA | ✅ Ready | SW-owned IndexedDB queue + replay; idempotent server upsert; status/retry UI. Input validation hardened — see WS1. |
| Accessibility | ✅ Ready (improved) | Rink SVG now keyboard-operable + labeled — see WS2. Admin buttons already carry visible text labels. |
| Migration delivery | ⚠️ Operator action | `deploy-migrations.yml` is live but requires a one-time reconciliation first — see WS3. |

## Workstreams in this pass

### WS1 — offline-sync input validation (done)
`src/app/api/offline-sync/route.ts` now validates the request body with a zod
schema (`localId`, `moduleKey` non-empty strings; `action` enum defaulting to
`submit`; `payload` record; optional positive-int `startedAt`) and returns `400`
on malformed input. The schema guarantees `startedAt` is a positive integer when
present, so the `started_at` timestamp can no longer become `Invalid Date`.
Existing auth, employee resolution, and the idempotent upsert
(`onConflict: "local_id", ignoreDuplicates: true`) are unchanged.

### WS2 — accessibility (done)
`src/components/ice-depth/usa-rink.tsx`: the rink SVG now carries an explicit
`role="img"` with a descriptive `aria-label`, and the interactive measurement
points are keyboard-operable (`tabIndex={0}` + Enter/Space `onKeyDown` mirroring
the click handler), so the diagram is usable without a mouse. A sweep of the
admin detail panels found buttons already carry visible text labels (e.g.
"Back to list", "Go to Facility Settings") and several components already use
`aria-label`, so no further changes were needed there.

### WS3 — migration delivery (operator prerequisite — NOT a code change)
`.github/workflows/deploy-migrations.yml` is present, active (push to `main`
touching `supabase/migrations/**`, plus `workflow_dispatch`), guarded against an
unset project ref, and its header documents the required secrets/vars. **No
in-repo change is needed.** Before relying on it, an operator must perform the
one-time history reconciliation, because the remote history uses timestamp-style
versions while the repo uses `00000000000NN` prefixes:

1. `supabase link --project-ref <ref>`
2. `supabase migration list --linked` — compare local vs remote
3. For every migration whose schema is **already** in the DB:
   `supabase migration repair --status applied <version> [<version> ...]`
   (treat the grandfathered duplicate prefix `00000000000088` as covering both
   files; **do not rename them**)
4. `supabase migration list --linked` — confirm alignment
5. Provision repo secrets/vars: `SUPABASE_ACCESS_TOKEN` (secret),
   `SUPABASE_DB_PASSWORD` (secret), `SUPABASE_PROJECT_REF` (variable)

After reconciliation, `supabase db push` is incremental and the workflow keeps
it that way on every merge. Full detail in [`DEPLOY.md` §8](./DEPLOY.md).

## Deferred / follow-up

- **Logbook UI rollout** (separate PR): extend the refrigeration °F/°C toggle,
  per-field normal-range hints, and meta-chip header to the other
  temperature-bearing modules. Feature work, not a readiness blocker.
- **Screen-reader deep audit** of the large Communications/Scheduling forms.

## Out of scope (intentional)

Console logging in cron routes (structured monitoring), the documented `as any`
casts for not-yet-generated DB types, and adding a JS/TS test runner
(`CLAUDE.md` forbids — DB regression coverage lives in `rls_isolation.sql`).
