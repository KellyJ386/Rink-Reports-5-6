# PWA Persistent Login — Verification & Dashboard Settings

Goal: a staff member installs the home-screen app, logs in once, and stays
logged in across shifts (weeks) without the session silently dying in
standalone mode. This note records what was **verified in code** (no
changes were needed) and the **dashboard-only settings** to apply —
same pattern as `phase5-config-items.md`. Nothing here touches RLS,
RBAC, or server-side tenancy.

## Verified in code (no changes needed)

- **Cookie-based sessions everywhere.** Both `@/lib/supabase/server`
  (`createServerClient`) and `@/lib/supabase/client`
  (`createBrowserClient`) run on `@supabase/ssr` cookies — nothing
  session-critical lives in `localStorage`, so iOS standalone-mode
  storage quirks can't strand the session. Explicit `sameSite: "lax"`,
  `secure` in production (`AUTH_COOKIE_OPTIONS` in
  `src/lib/supabase/session.ts`).
- **Cookie lifetime is ~400 days regardless of our options.**
  `@supabase/ssr` force-sets `maxAge` to its 400-day default on every
  cookie write (verified in `cookies.js` — user `cookieOptions` merge
  over defaults but `maxAge` is always overridden back). The auth
  cookies are not session-scoped and survive browser/app restarts.
- **Session refresh on every request.** `src/proxy.ts` (Next 16's
  middleware replacement — do **not** add a `middleware.ts`) calls
  `updateSession()`, which runs `supabase.auth.getUser()` and re-issues
  rotated cookies via server `Set-Cookie` on each request. Server-set
  cookies are also outside Safari's 7-day script-writable-storage purge
  (see `pwa-ios-storage-risk.md`).
- **Local/dev auth config** (`supabase/config.toml`): `jwt_expiry = 3600`,
  `enable_refresh_token_rotation = true`,
  `refresh_token_reuse_interval = 10`. The offline queue's retry policy
  is engineered around the 1-hour access-token TTL (401 is classified
  transient; see `public/sw.js` and `src/lib/offline/retry-policy.ts`).
- **No security constraint conflicts.** Persistent login here is purely
  refresh-token longevity; no RLS policy, permission helper, or
  `facility_id` injection point is involved. The July 2026 authorization
  audit (`authorization-audit-2026-07.md`) already covers the
  SECURITY DEFINER surface the Supabase advisors warn about.

## Dashboard settings to apply (hosted project "Rink Reports 5-6")

The hosted auth config (GoTrue) is not readable through the tooling used
here, so verify each current value in the dashboard while applying:

1. **JWT (access token) expiry — keep at 3600s.**
   Authentication → Sessions. Persistence comes from refresh tokens, not
   this value; raising it only widens the exposure window of the
   (necessarily non-httpOnly) auth cookie, and the offline retry policy
   assumes ~1h.
2. **Time-boxed sessions and inactivity timeout — both "never".**
   Authentication → Sessions (Pro-plan features). Either setting, if
   enabled, is exactly the "session silently dies between shifts"
   failure this work exists to prevent. Refresh tokens otherwise have no
   expiry in Supabase.
3. **Refresh token rotation — keep enabled; raise reuse interval
   10s → 30s.** Authentication → Sessions → "Detect and revoke
   potentially compromised refresh tokens". Rink-side networks are
   flaky: a retried refresh can re-present a just-rotated token, and a
   too-tight reuse interval turns a radio hiccup into a hard logout.
   30s absorbs retries without meaningfully weakening reuse detection.
   Mirror in `supabase/config.toml` (`refresh_token_reuse_interval = 30`)
   if changed, so local matches hosted.
4. **Single-session-per-user — leave disabled.** Staff legitimately hold
   a phone session and a shared-kiosk session at once; enforcing single
   session would log the phone out every kiosk login.
5. **Leaked-password protection — enable** (pre-existing advisor
   `auth_leaked_password_protection`, still WARN as of 2026-09-03; steps
   already in `phase5-config-items.md` §1 and the launch checklist).

## Residual risk (not fixable by settings)

A device offline for more than ~1 hour holds an expired access token no
setting can refresh without network. This costs a re-login at worst,
never data: the SW queue keeps items owned by an unresolvable session
(null-owner invariant R-1 in `public/sw.js`) and replays 401 as
transient once the user is signed back in.
