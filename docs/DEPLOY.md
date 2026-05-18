# Production deploy runbook

This runbook covers a clean production deploy to Vercel + Supabase. Existing deploys only need to follow §6 (post-deploy smoke tests) after each release.

> Local dev setup is in the top-level `README.md`. This document is operational — what to provision, what to verify, what to watch.

---

## 1. Supabase project

1. Create a new project in the Supabase dashboard (Pro plan recommended for prod — log retention, point-in-time recovery).
2. Note the project values from **Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (server-only, never exposed to the browser)
3. Apply migrations:

   ```bash
   # Link the local repo to the remote project
   supabase link --project-ref <project-ref>

   # Push every migration in supabase/migrations/ in numeric order
   supabase db push
   ```

4. Confirm RLS isolation passes against the remote database:

   ```bash
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
   ```

   The script runs in one transaction and ROLLBACKs at the end; any failure raises and exits non-zero.

5. Bootstrap the first super-admin (no public signup path):

   ```sql
   -- In the SQL editor
   insert into auth.users (email, ...) values (...);             -- or use Supabase Studio
   update public.users set is_super_admin = true where id = '<uuid>';
   ```

## 2. Resend (email transport)

1. Verify the sending domain in the Resend dashboard.
2. The DNS-record set required is documented in `.env.example` next to the `RESEND_FROM` variable. Both `SPF`, `DKIM` (the `resend._domainkey.<sub>` TXT), and `DMARC` records are needed; verification will fail without all three.
3. After verification, generate an API key and note it for `RESEND_API_KEY`.

> If Resend is left unconfigured, `/api/cron/send-communications` skips the run and leaves recipient rows in `pending`; once secrets are provisioned the backlog flushes on the next cron tick. There's no need to clear the queue.

## 3. Vercel project

1. Connect the GitHub repository to a new Vercel project. Framework preset: **Next.js**.
2. Generate a long random string for `CRON_SECRET` (e.g. `openssl rand -hex 32`). The same secret authenticates all three cron routes.
3. Set the following project environment variables (all environments unless noted):

   | Variable | Scope | Source |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | Supabase Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Production + Preview | Supabase Settings → API (server-only — do **not** prefix with `NEXT_PUBLIC_`) |
   | `CRON_SECRET` | Production + Preview | generated |
   | `RESEND_API_KEY` | Production + Preview | Resend dashboard |
   | `RESEND_FROM` | Production + Preview | e.g. `Rink Reports <noreply@send.example.com>` — must match the Resend verified domain |
   | `NEXT_PUBLIC_SITE_URL` | per-env | Production: the canonical site URL with no trailing slash, e.g. `https://rink.example.com` |

4. Cron schedules are committed in `vercel.json`:

   - `*/5 * * * *` → `/api/cron/drain-notifications` (in-app inbox fan-out)
   - `2-59/5 * * * *` → `/api/cron/send-communications` (Resend email delivery; staggered after drain)
   - `17 3 * * *` → `/api/cron/run-retention-purge` (daily, off-peak UTC)

   Vercel reads `vercel.json` automatically; no UI configuration is needed.

5. First deploy: trigger from the Vercel UI or push to `main`. Confirm a green build.

## 4. DNS & TLS

1. Add the production domain in Vercel (Settings → Domains). Vercel issues a Let's Encrypt cert automatically.
2. Point the apex / `www` records as the dashboard instructs.
3. Verify `NEXT_PUBLIC_SITE_URL` matches the canonical domain — it's the base used in invitation and password-reset email links.

## 5. Production smoke tests (run after first deploy and after any release that touches auth, cron, or migrations)

In order. Stop at the first failure.

1. **Public surfaces respond.**

   ```bash
   curl -sI https://<domain>/login | head -1                    # 200
   curl -sI https://<domain>/robots.txt | head -1               # 200, body "Disallow: /"
   curl -sI https://<domain>/sw.js | head -1                    # 200
   ```

2. **Security headers present.**

   ```bash
   curl -sI https://<domain>/login | grep -iE \
     'content-security-policy|x-frame-options|x-content-type-options'
   ```

   Expect all three. The `Content-Security-Policy` header is only set in production builds (see `next.config.ts`).

3. **Auth + redirect.** Visit `https://<domain>/admin` in a private window. Should redirect to `/login?redirectTo=/admin`. Sign in as the super-admin; should land on `/dashboard`.

4. **Cron endpoints reachable (negative path).** Without auth:

   ```bash
   curl -i https://<domain>/api/cron/drain-notifications        # 401
   curl -i https://<domain>/api/cron/send-communications        # 401
   curl -i https://<domain>/api/cron/run-retention-purge        # 401
   ```

5. **Cron endpoints reachable (positive path).** With the secret:

   ```bash
   curl -i -H "Authorization: Bearer $CRON_SECRET" \
     https://<domain>/api/cron/drain-notifications              # 200, {"ok":true,...}
   ```

   In Vercel logs, find the `[cron/drain-notifications] run complete {...}` line — confirms structured logging is wired.

6. **Email delivery.** Have the super-admin compose a communication addressed to a test recipient. Within ~5 min the recipient row should advance `email_status` from `pending` → `sent` and the email arrive in the recipient's inbox. If it stays `pending`, the most common cause is missing or unverified `RESEND_FROM`.

7. **Offline submission.** From a phone, install the PWA, put the device in airplane mode, submit a daily report. The form should report queued. Bring the device online; within ~30 seconds the queue should drain and the row appear in admin.

## 6. Routine maintenance

- **Migrations:** new SQL files go in `supabase/migrations/` with a monotonically increasing prefix. Add an assertion to `supabase/tests/rls_isolation.sql` for any new RLS policy or SECURITY DEFINER function whose job is tenant isolation. The `.github/workflows/rls-isolation.yml` workflow runs the script on every migration-touching PR.
- **Retention purges:** Admins configure `retention_settings.auto_purge` per module in `/admin/retention`. The daily `run-retention-purge` cron processes those rows; the UI surfaces `last_purged_at` after each run. The `offline_sync_queue` table is purged on a fixed 90-day TTL within the same cron (synced rows only — pending/failed rows are kept for triage).
- **Releases:** PRs merge to `main`, Vercel auto-deploys. The CSP, the security headers, and the cron schedule all live in tracked files, so nothing has to be re-configured in Vercel after a deploy.
- **Rotating CRON_SECRET:** generate a new value, update Vercel env, redeploy. The crons will start using the new secret immediately; no overlap window is required because Vercel's scheduler reads the env var per invocation.

## 7. Things this app deliberately does not do

- **No client-side caching of authenticated HTML.** The service worker caches static `_next/static/*` only; navigation requests are network-only with a synthetic offline page on failure. This is intentional — shared rink-office kiosks must not serve user A's rendered admin pages to user B.
- **No SW auto-update mid-session.** A new service worker stays in `waiting` until the user clicks "Reload" on the in-app update toast, so a deploy can't swap the IndexedDB submission queue under a staff member filling out a report.
- **No public signup path.** New employees are invited via the admin Employees flow; the invite email lands them at `/update-password`. Self-serve `/signup` exists for super-admin bootstrap only.
