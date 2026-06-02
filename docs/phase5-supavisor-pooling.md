# Phase 5 — Connection pooling for Vercel serverless (Supavisor)

**Why:** the app runs on Vercel serverless (Next.js 16). Every server component / route
handler / server action that calls `createClient()` opens a Postgres connection. Under
1,000-facility fan-out, direct connections (port **5432**) exhaust Postgres' connection
slots almost immediately — each serverless invocation is its own short-lived process with
no shared pool. Supabase's **Supavisor** pooler in **transaction mode** (port **6543**) is
the fix: it multiplexes thousands of client connections onto a small backend pool.

This is a connection-string + dashboard change, not a code/SQL change, so it can't be fully
done from this environment. Exact steps below.

## What to change

### 1. Use the transaction-mode pooler URL for the app's runtime queries
In the Supabase dashboard → **Project Settings → Database → Connection string → "Transaction"**:

- Host: `aws-0-<region>.pooler.supabase.com`
- Port: **6543** (transaction mode), user `postgres.<project_ref>`
- This is the URL serverless functions should use for normal queries.

> Note: this project's app talks to Postgres through **PostgREST** via
> `@supabase/ssr` (`NEXT_PUBLIC_SUPABASE_URL` + anon key), **not** a raw `DATABASE_URL`.
> PostgREST already pools on Supabase's side, so the most acute pooix risk is any path
> that uses a **direct Postgres connection** — i.e. the service-role/admin client and any
> migration/seed tooling. Audit for those:
> - `src/lib/supabase/admin.ts` (`createAdminClient`) — still goes through PostgREST (URL+service key), so it's pooled by Supabase. Good.
> - Any future `postgres`/`pg`/Prisma/Drizzle usage **must** use the **6543 transaction** URL.

### 2. Set the env vars (Vercel → Project → Settings → Environment Variables)
- `DATABASE_URL` → **transaction pooler** (6543) — for app runtime if/when a direct driver is added.
- `DIRECT_URL` → **direct** (5432) — for migrations only (Supabase CLI / `db push`), which need a session connection and must bypass the pooler.

### 3. Transaction-mode caveats (must hold for app code)
- **No session-level state**: prepared statements across calls, `SET`/`LISTEN`/`NOTIFY`,
  advisory locks, and `SET LOCAL ROLE` outside a txn won't persist. The RLS model here sets
  JWT claims per request via PostgREST, so this is fine — but any raw-driver code must not
  rely on session state.
- Keep transactions short; the pooler returns the backend connection at COMMIT.

## Verification checklist
- [ ] Confirm app runtime points at PostgREST (URL+anon/service key) — already true here.
- [ ] If a direct Postgres driver is introduced, its connection string is the **6543** pooler URL.
- [ ] Migrations use the **5432 direct** URL (`DIRECT_URL`).
- [ ] Load test (see `phase5-load-test` once run): watch `pg_stat_activity` count stays bounded
      under concurrent serverless invocations rather than climbing toward `max_connections`.

## Status
Reachable from tooling: nothing to apply in-repo (no raw DB driver today). The action is
**dashboard/env-var config** + a guardrail to use 6543 for any future direct driver. No
code change required at this time; documented so it's not forgotten when a direct driver
or heavier seeding tool is added.
