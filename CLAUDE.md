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
```

There is no JS/TS test runner configured. Do not invent one.

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

Generated DB types live in `src/types/database.ts` and are passed as the generic to `createClient<Database>()`. When a migration adds a table that isn't yet in the generated types (e.g. `offline_sync_queue` in `src/app/api/offline-sync/route.ts`), the codebase casts via `as any` with an eslint-disable comment — match that pattern instead of hand-writing types.

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

`supabase/migrations/` is a flat, numerically-ordered set of SQL files (`00000000000001_…sql` … `00000000000037_…sql`). New migrations should keep that monotonic prefix. RLS is enforced — `00000000000004_backbone_rls.sql`, `00000000000030_submission_rls_module_permissions.sql`, and `00000000000029_module_permission_helper.sql` define the permission model that admin/staff routes rely on; check those before touching policies.

`supabase/config.toml` defines local ports (API 54321, DB 54322, Studio 54323).

### UI conventions

- shadcn/ui, "new-york" style, slate base, Lucide icons (`components.json`).
- Path aliases: `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks` (configured in both `tsconfig.json` and `components.json`).
- Shared shell components live in `src/components/app` (staff shell), `src/components/admin` (admin shell), `src/components/auth`, `src/components/staff`, `src/components/offline`.
- Root layout (`src/app/layout.tsx`) forces `dark` class on `<html>` and loads Geist + Anton fonts; don't add a theme toggle without checking what depends on permanent dark mode.

### Report form design pattern

Report submission forms (refrigeration, daily, incidents, etc.) follow a metadata-driven, token-themed convention. There are two reference points: **the baseline that ships today**, and **the richer "Logbook" target design** we're moving toward. Build new report forms with the baseline mechanics and the target styling — never introduce a parallel styling system or hardcode colors (the app is permanent dark mode; always use the semantic tokens in `src/app/globals.css`).

**Baseline (what ships today)** — see `src/app/reports/refrigeration/page.tsx` + `_components/submission-form.tsx`:

- Page shell: `mx-auto w-full max-w-2xl flex flex-col gap-6 px-4 py-8`, a `Reports / <Module>` breadcrumb, an `h1` (`text-2xl font-semibold tracking-tight`), and a muted subtitle.
- Sections render as native `<details open>` cards (`group rounded-xl border bg-card`); the `<summary>` is the clickable header with a `group-open:rotate-180` chevron, and content sits under a `border-t border-border px-4 py-4` body. Equipment subcards are `rounded-lg border bg-background p-3`.
- Fields are **metadata-driven, not hardcoded**: a `FieldInput` component branches on `field.field_type` (`numeric | text | boolean | select`). Numeric inputs are `type="text" inputMode="decimal"`, `h-12 text-base`, with the unit shown both appended to the label (`"Label (unit)"`) and as an inline trailing `text-muted-foreground` span.
- Submit uses `useActionState` + `useFormStatus`; the payload is serialized into a hidden `values_json` input (see `buildRow` / `SubmittedFieldValue` in the form). Field config is loaded server-side from `refrigeration_sections / _equipment / _fields / _thresholds` and assembled into `formSections`. **Reuse this DB-driven model for new modules** rather than hardcoding fields.

**Target ("Logbook") design** — the richer layout we're building toward, expressed with existing primitives (`@/components/ui/{card,button,input,label,select}`) and `globals.css` tokens:

- **Header card** (`Card`): title + subtitle on the left; `View Dashboard` / `Back` / `Dashboard` action buttons on the right; a meta row of employee / facility / date / time / temperature, each with a Lucide icon in a small rounded chip. Meta text uses `text-muted-foreground`.
- **Log Information card** (`Card`): header carries a right-aligned **°F/°C unit toggle**; body is a responsive grid (`grid gap-4 sm:grid-cols-2`, up to 4 cols) of Reading Number, Facility, Employee, Date & Time.
- **Section cards** (Compressor, Condenser, …): one `Card` per section with a bold title and a 2-column field grid (`grid gap-4 sm:grid-cols-2`).
- **Normal-range hint**: a `text-sm text-muted-foreground` line under each numeric field rendered from that field's threshold min/max + unit (the data already lives in `refrigeration_thresholds`).
- **Tokens**: surfaces `bg-card` / `bg-background`, borders `border-border`, hints/labels `text-muted-foreground`, radius `rounded-xl` (cards) / `rounded-lg` (subcards), inputs `h-12 text-base`, primary submit = the default green-gradient `Button` variant (carries `--shadow-press-primary`).

**The gap (read this before building):** the Logbook design is **aspirational — not yet implemented**. Today's form is the simpler `<details>`-based "Refrigeration readings" page; the °F/°C toggle and per-field normal-range hints **do not exist yet** and are net-new work. When moving toward the target, extend the existing metadata-driven field model and the tokens above — do not fork the styling.

### Security headers

`next.config.ts` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive `Permissions-Policy` for every route. Preserve these when adding `headers()` entries.
