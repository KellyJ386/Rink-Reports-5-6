# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Heads up: Next.js 16 + React 19

This project runs on **Next.js 16.2** and **React 19.2** — not the versions in your training data. Conventions and APIs have shifted. Before writing routing, middleware, server-component, or config code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices. Concrete examples already in this repo:

- **No `middleware.ts`.** Request interception lives in `src/proxy.ts`, which exports a `proxy()` function plus a `config.matcher`. Edits to auth/session redirects go here, not in a middleware file.
- ESLint config uses the new `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` flat-config entry points (`eslint.config.mjs`).
- Tailwind is **v4** with `@tailwindcss/postcss`; there is no `tailwind.config.*` — config lives in `src/app/globals.css`.

## Commands

```bash
pnpm install      # install (pnpm; lockfile is pnpm-lock.yaml)
pnpm dev          # next dev
pnpm build        # next build
pnpm start        # next start
pnpm lint         # eslint (flat config)
pnpm test         # vitest run (unit tests, *.test.ts)
```

The JS/TS test runner is **vitest** (`pnpm test` / `pnpm test:watch`), added for
the refrigeration submission helpers. It is intentionally scoped to **pure,
dependency-free logic** — `vitest.config.ts` runs in a plain Node environment with
no jsdom/React setup. Do not import `server-only` modules (e.g. anything pulling
`@/lib/supabase/server` or `@/lib/notifications/dispatch`) into a test; keep
testable logic in a pure module and unit-test that (see
`src/app/reports/refrigeration/_lib/compute.ts` + `compute.test.ts`, split out
from the server-only `submit.ts`). Cross-tenant / RLS behavior is still covered by
the SQL harness below, not vitest.

For the database, **`supabase/tests/rls_isolation.sql`** is the
single regression-coverage script for cross-facility isolation
and the new permission/dispatch/PDF gates added in PR #49. It runs
as one transaction that ROLLBACKs at the end; failures raise so
psql exits non-zero. The workflow `.github/workflows/rls-isolation.yml`
runs it on every PR that touches `supabase/migrations/**`,
`supabase/tests/**`, or `supabase/config.toml`. Locally:

```bash
supabase start                                              # boots stack + applies migrations
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
```

When adding a new RLS policy or SECURITY DEFINER function whose
job is tenant isolation, add an assertion here.

Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` before `pnpm dev`.

## Architecture

### Auth and request flow

1. `src/proxy.ts` matches every non-asset request and delegates to `updateSession()` in `src/lib/supabase/session.ts`. That helper refreshes the Supabase auth cookie, then enforces two redirects:
   - Unauthenticated user hitting `/admin`, `/reports`, or `/dashboard` → `/login?redirectTo=…`.
   - Authenticated user hitting `/login` or `/signup` → `/dashboard`.
   Do not insert logic between `createServerClient(...)` and `supabase.auth.getUser()` — the comment in that file warns of subtle logout bugs.

2. Inside server components / route handlers, **always go through `src/lib/auth`** rather than calling Supabase directly:
   - `getCurrentUser()` — returns `{ authUser, profile } | null`. Wrapped in React `cache()` so layout + page share one DB round-trip.
   - `requireUser()` / `requireAdmin()` — server-only guards that `redirect("/login")` or `redirect("/forbidden")`. `requireAdmin` allows `users.is_super_admin = true` OR an active `employees` row with `role.key in (admin, gm, super_admin)`, scoped to the user's `facility_id` if set.
   The `/forbidden` route exists specifically so admin-denied users get a real message instead of a login bounce.

### Supabase clients (pick the right one)

- `@/lib/supabase/server` — for server components, route handlers, server actions. Uses `next/headers` cookies.
- `@/lib/supabase/client` — for `"use client"` components only.
- `@/lib/supabase/session` — only called from `src/proxy.ts`; do not import elsewhere.

Generated DB types live in `src/types/database.ts` and are passed as the generic to `createClient<Database>()`. **When a migration changes the schema, regenerate the types in the same PR**: run `pnpm types:write` with `DATABASE_URL` pointing at a fully-migrated local database (`supabase start`, then `postgresql://postgres:postgres@127.0.0.1:54322/postgres`); see `scripts/generate-database-types.mjs`. CI enforces freshness (`pnpm types:check` in the rls-isolation workflow). Do NOT bridge schema gaps with `as any` casts — that pattern is retired; it once hid a call to a DB function that didn't exist (fixed in migration 128).

### App Router layout

`src/app` uses route groups and nested layouts:

- `(auth)/login`, `(auth)/signup`, `(auth)/logout` — public auth pages.
- `admin/*` — admin console; layout calls `requireAdmin`. Each module (scheduling, employees, retention, exports, etc.) keeps its UI in `_components/` and module-specific server code in `_lib/` (underscore-prefixed = not routable).
- `reports/*` — staff-facing report submission flows, mirrored against admin modules (daily, incidents, accidents, ice-depth, ice-operations, refrigeration, air-quality, communications, scheduling). Many use dynamic segments like `[areaSlug]/[templateId]` and a `done/` subroute for the post-submit screen.
- `api/offline-sync/route.ts` — the only API route; receives queued submissions from the service worker.

### Offline / PWA

This app is a PWA. The service worker (`public/sw.js`) owns the offline submission queue; the client never writes to `offline_sync_queue` directly:

- `src/components/app/sw-register.tsx` registers `/sw.js` at app root.
- `src/lib/offline/use-sync-queue.ts` exposes `useSyncQueue()`, `enqueueSubmission()`, and `retryFailedSubmissions()` — all of which `postMessage` to the SW.
- On flush, the SW POSTs to `/api/offline-sync` which upserts into `offline_sync_queue` with `onConflict: "local_id"` for idempotency.
When adding a new submission flow, route writes through the SW queue + this endpoint rather than calling Supabase directly from the browser.

### Database / migrations

`supabase/migrations/` is a flat, numerically-ordered set of SQL files (`00000000000001_…sql` … `00000000000099_…sql`). New migrations should keep that monotonic prefix (one file per prefix — no duplicates). RLS is enforced — `00000000000004_backbone_rls.sql`, `00000000000030_submission_rls_module_permissions.sql`, and `00000000000029_module_permission_helper.sql` define the permission model that admin/staff routes rely on; check those before touching policies. The module-level RLS helpers (`has_module_access` / `has_module_admin_access` / `has_area_access`) read `user_permissions` as of `00000000000091_unify_permission_helpers.sql`; the legacy `module_permissions` table was removed in `00000000000099_drop_dead_legacy_permission_tables.sql` (`module_area_permissions` and `role_module_permission_defaults` are retained).

`supabase/config.toml` defines local ports (API 54321, DB 54322, Studio 54323).

### UI conventions

- shadcn/ui, "new-york" style, slate base, Lucide icons (`components.json`).
- Path aliases: `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks` (configured in both `tsconfig.json` and `components.json`).
- Shared shell components live in `src/components/app` (staff shell), `src/components/admin` (admin shell), `src/components/auth`, `src/components/staff`, `src/components/offline`.
- Root layout (`src/app/layout.tsx`) applies a `light` or `dark` class to `<html>` via a pre-paint inline script that reads `localStorage['rr-theme']`, then falls back to the OS `prefers-color-scheme` (and to `light` if that fails). `ThemeToggle` (`src/components/app/theme-toggle.tsx`) flips and persists the choice. Loads Geist + Anton fonts. **Both themes are supported** — never hardcode colors; use the semantic tokens in `globals.css`, which defines `:root`/`.light` and `.dark` variants so components adapt automatically.

### Report form design pattern

Report submission forms (refrigeration, daily, incidents, etc.) follow a metadata-driven, token-themed convention built on the shared `Card` / `SectionCard` / `PageHeader` primitives. Never introduce a parallel styling system or hardcode colors (the app supports both light and dark mode; always use the semantic tokens in `src/app/globals.css` so components render correctly in either theme).

**The "Logbook" reference — `src/app/reports/refrigeration/_components/submission-form.tsx`.** This is the canonical, fully-implemented layout; mirror it when building or upgrading a form:

- Page shell: `mx-auto w-full max-w-2xl flex flex-col gap-6 px-4 py-8`. The form itself renders a `PageHeader variant="display" module="refrig"` (breadcrumb + eyebrow + Anton title + actions), then a `SectionCard` meta-chip row (employee / facility / date / time / temperature, each a Lucide icon in a small rounded chip), then card-based sections.
- **Section cards**: one `<Card className="gap-4 py-5">` per section, an `h2` (`px-6 text-lg font-semibold tracking-tight`), and a `px-6` body whose fields sit in a responsive grid (`grid gap-4 sm:grid-cols-2`). Subgroups (equipment) get a `text-sm font-semibold text-muted-foreground` label above their own grid.
- **°F/°C unit toggle** (`UnitToggle`): a right-aligned `role="switch"` in the "Log Information" card header. Temperature fields store canonically in °F; flipping the toggle converts the visible text once (no per-keystroke round-tripping). See `setUnit` and `isTempUnit` from `@/lib/units`.
- **Per-field normal-range hint** (`NormalRangeHint`): a `text-sm text-muted-foreground` "Normal: min – max unit" line under each numeric field, from that field's resolved threshold min/max (`refrigeration_thresholds`), unit-converted to the active display unit.
- Fields are **metadata-driven, not hardcoded**: a `FieldInput` component branches on `field.field_type` (`numeric | text | boolean | select`). Numeric inputs are `type="text" inputMode="decimal"`, `h-12 text-base`, with the unit appended to the label (`"Label (unit)"`) and as an inline trailing `text-muted-foreground` span.
- Submit uses `useActionState` + `useFormStatus`; the payload is serialized into a hidden `values_json` input (see `buildRow` / `SubmittedFieldValue`). Field config is loaded server-side from `refrigeration_sections / _equipment / _fields / _thresholds` and assembled into `formSections`. **Reuse this DB-driven model for new modules** rather than hardcoding fields.
- **Tokens**: surfaces `bg-card` / `bg-background`, borders `border-border`, hints/labels `text-muted-foreground`, radius `rounded-xl` (cards) / `rounded-lg` (subcards), inputs `h-12 text-base`, primary submit = the default green-gradient `Button` variant.

**How the other report forms relate** (don't assume they all look identical):

- **incidents**, **daily** — flat field / checklist forms wrapped in the same `Card` chrome (Reporter / Incident details cards; Checklist + Notes cards). No temperature or thresholds, so no toggle / range hints.
- **accidents** — uses `SectionCard` + numbered `SectionHead` chrome (a richer variant of the card layout) with a body diagram, severity pills, and a sticky submit bar.
- **air-quality** — already **threshold-aware** with live `RangeBadgePill`s (Within range / Warn / Alert) from `warn_min/max` + `alert_min/max`. This is intentionally richer than a static range hint; don't replace it with the refrigeration hint pattern. Temperature is one of several DB-driven reading types, so there is no single global °F/°C toggle.
- **ice-depth** — a bespoke two-phase (measure → review) interactive form around a tap-driven USA-hockey rink SVG, tuned for Bluetooth calipers. It measures **depth, not temperature** (so a °F/°C toggle is meaningless) and already has per-point severity + summary-stat feedback. Treat it as a special case; do not Card-ify or add a temp toggle.

### Security headers

`next.config.ts` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive `Permissions-Policy` for every route. Preserve these when adding `headers()` entries.
