# Out-of-band production change — citext/pg_trgm relocation (July 2026)

Records a manual, out-of-band change applied directly to the live Supabase
project (`bqbdgwlhbhabsibjgwmk`, "Rink Reports 5-6") that **cannot** be
captured as a `supabase/migrations/*.sql` file. Companion to
`production-reconciliation-2026-06.md`, which documents the same kind of
repo/prod divergence for a different reason (version-string mismatch); this
one is a permanent, structural divergence.

## What changed

```sql
create schema if not exists extensions;
alter extension citext set schema extensions;
alter extension pg_trgm set schema extensions;
```

Run manually via the Supabase Dashboard SQL Editor on 2026-07-01. Verified
afterward:

```sql
select e.extname, e.extowner::regrole as owner, n.nspname as schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where e.extname in ('citext', 'pg_trgm', 'btree_gist', 'pgcrypto');
```

```
 extname  |    owner       |   schema
----------+----------------+-------------
 pgcrypto | postgres       | extensions
 btree_gist | supabase_admin | extensions
 citext   | supabase_admin | extensions
 pg_trgm  | supabase_admin | extensions
```

The Security Advisor's `extension_in_public` finding for `citext`/`pg_trgm`
is gone (re-checked via `get_advisors` immediately after).

## Why this is not a migration file

This closes the last item deferred from migration 163
(`00000000000163_lock_down_internal_rpc_functions.sql`). A migration doing
the same `ALTER EXTENSION ... SET SCHEMA` was drafted and pushed
(`00000000000165_move_extensions_out_of_public.sql`, PR #242) but had to be
reverted — it fails everywhere the repo's own tooling replays migrations,
with `ERROR: must be owner of extension citext`:

- `rls-isolation` and `schema-drift` CI (fresh `supabase/postgres` container
  per PR)
- `deploy-migrations.yml`'s `supabase db push` against this same project
- a contributor's local `supabase start`

Root cause, confirmed by querying the live project: `citext`, `pg_trgm`, and
even **`btree_gist`** (installed by our own migration 140, running as the
`postgres` role) are all owned by `supabase_admin`, a true superuser
(`rolsuper = true`). The `postgres` role — what every migration, CI job, and
the deploy pipeline connects as — is not a member of `supabase_admin`, and
Postgres 16+ refuses to let a non-superuser grant membership in a superuser
role (rolcreaterole does not override this). Supabase appears to reassign
ownership of every extension to `supabase_admin` platform-wide regardless of
which role issues `CREATE EXTENSION`, so **no SQL statement the `postgres`
role can run will ever relocate an already-installed extension** on this
platform. The Dashboard SQL Editor's session evidently carries enough
privilege to do it directly; a migration file replayed as `postgres` never
will.

## Resulting divergence (expected, not a bug)

A from-scratch replay of `supabase/migrations/**` (CI, or a new contributor's
`supabase start`) will **always** produce `citext`/`pg_trgm` in `public` —
migration 1 installs them there and no migration relocates them, for the
reason above. The live project now has them in `extensions`. This is a
permanent, accepted divergence between "what the migrations produce" and
"current prod state" for these two objects only.

This is exactly the case `schema-drift.yml`'s second job (`prod-drift`,
gated on the optional `SUPABASE_DB_URL` secret) exists for: it compares a
version-stable **signature** (function signatures, table columns, RLS
policies — not raw extension/schema placement) between the repo-built schema
and live prod, and is non-fatal by design since "prod may briefly lead/lag a
migration merge." If `SUPABASE_DB_URL` is ever wired up, expect it to
surface `citext_*`/`gtrgm_*` function signatures as prod-only (living in
`extensions.*` there, `public.*` in the repo build) — that's this documented
divergence, not new drift.

## Do NOT

- Add a migration attempting `alter extension citext set schema extensions;`
  again — it will fail identically every time, for every future PR, per the
  root cause above.
- "Fix" the divergence by trying to move `citext`/`pg_trgm` back to `public`
  from a migration — same ownership problem in reverse.

## If this ever needs to be repeated (new project, disaster recovery, etc.)

Run the three statements at the top of this doc manually via the Supabase
Dashboard SQL Editor (or ask Supabase support) — never via a checked-in
migration.
