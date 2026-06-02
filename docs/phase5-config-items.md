# Phase 5 — Dashboard-only config items (exact steps)

These two advisor findings can't be fixed via SQL/migration from tooling; they're
project-level settings. Steps to action each.

## 1. Enable leaked-password protection (SECURITY advisor: `auth_leaked_password_protection`)

Supabase Auth can reject passwords found in the HaveIBeenPwned breach corpus. Currently **disabled**.

**Dashboard:** Authentication → **Policies** (or **Providers → Email** → Password settings)
→ enable **"Leaked password protection"** (a.k.a. "Check passwords against HaveIBeenPwned").
Save.

**CLI alternative** (`supabase` ≥ 1.180), in `supabase/config.toml`:
```toml
[auth]
# ...
enable_hibp_check = true   # leaked-password (HaveIBeenPwned) protection
```
then `supabase config push` (or apply via the Management API `PATCH /v1/projects/{ref}/config/auth`
with `{"password_hibp_enabled": true}`).

Impact: only affects new sign-ups / password changes; no migration, no downtime.

## 2. Move `citext` and `pg_trgm` out of the `public` schema (SECURITY advisor: `extension_in_public`)

Both extensions are installed in `public`. Best practice is a dedicated `extensions` schema
so extension objects don't share the API-exposed namespace.

**⚠️ Risk — do NOT do this casually.** `citext` backs the `users.email` / `employees.email`
column types, and `pg_trgm` backs any trigram index/search. Moving a type's schema while
columns depend on it is invasive and can break the API's type resolution. Recommended
handling:

- **Lowest risk: leave as-is.** This is a `WARN`, not an error; many production Supabase
  projects run extensions in `public`. The exposure is theoretical here.
- **If you want it clean:** do it on a **dev branch** first, full migration:
  1. `CREATE SCHEMA IF NOT EXISTS extensions;`
  2. `ALTER EXTENSION pg_trgm SET SCHEMA extensions;` (no type columns depend on it → low risk)
  3. `citext`: more involved — columns use the `citext` type. Either keep `citext` in `public`
     (pragmatic) or plan a typed migration of the email columns. **Recommend keeping `citext`
     in `public`** and only relocating `pg_trgm`.
  4. Add `extensions` to the database `search_path` so unqualified references still resolve.
  5. Verify the PostgREST schema cache reloads cleanly and email columns still validate.

**Recommendation:** action #1 (leaked-password) now — it's free and safe. Defer/skip #2
(extension schema) unless a security review specifically requires it; if pursued, relocate
only `pg_trgm`, leave `citext` in `public`.
