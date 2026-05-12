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

There is no test runner configured. Do not invent one.

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

### Security headers

`next.config.ts` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive `Permissions-Policy` for every route. Preserve these when adding `headers()` entries.
