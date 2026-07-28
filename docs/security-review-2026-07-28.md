# Rink Reports security review — 2026-07-28

## Executive summary

This review covered the application boundary, authentication redirects, public
and privileged Route Handlers, service-role use, tenant authorization, database
RLS/RPC controls, browser security headers, offline replay, dependencies, secret
scanning, and CI security gates.

One exploitable **medium-severity open redirect** was found in the email OTP /
invite callback and fixed during the review. No cross-tenant data disclosure,
service-role credential exposure, SQL injection, or unauthenticated privileged
mutation was identified in the reviewed paths. The existing defense-in-depth is
strong: tenant identity is generally server-derived, sensitive database access
is protected by RLS and internal RPC gates, cron workers fail closed behind a
timing-safe bearer check, and production uses a nonce-based CSP.

This was a source review, not a penetration test of the deployed Supabase or
Vercel environments. Deployment configuration and live database grants must
still be verified separately.

## Scope and method

- Enumerated all `src/app/api/**/route.ts` handlers, authentication actions,
  redirects, service-role client call sites, and privileged RPC calls.
- Reviewed the proxy session gate and production CSP/security headers.
- Compared server-side authorization with the existing RLS isolation harness
  and the July authorization audit.
- Searched for dynamic code execution, unsafe HTML rendering, command execution,
  untrusted redirects, secret material, and direct service-role use.
- Reviewed dependency-audit exceptions and security CI workflows.
- Ran lint, unit tests, TypeScript checking, production build, cron schedule
  validation, a dependency audit attempt, and a repository secret scan.

## Finding RR-SR-01: email callback open redirect

**Severity:** Medium  
**Status:** Fixed

The email OTP/invite callback accepted any `next` value beginning with one `/`
and rejected only a literal `//`. It then constructed the redirect with
`new URL(next, request.url)`. WHATWG URL parsing treats backslashes as slashes
for special schemes, so a value such as `/\attacker.example` resolves to
`https://attacker.example/`. An attacker able to place a crafted callback URL
in a message or lure a user through a valid authentication flow could redirect
the newly authenticated user to a phishing origin.

The callback now uses the already-tested shared login redirect validator, which
rejects both slash and backslash protocol-relative forms, control characters,
absolute URLs, and non-path values. Regression coverage includes both
`/\host` and `/\/host` forms.

## Confirmed controls

### Authentication and authorization

- Protected application prefixes are session-gated by the proxy, while admin
  layouts/actions apply stronger role or module checks.
- Login throttling uses independent IP and normalized-email buckets. The
  service-role-only rate-limit RPC prevents clients from forging a victim's
  counter.
- Offline replay derives facility and employee identity from the authenticated
  session, validates queue ownership, and rechecks module submit permission.
- Service-role write paths reviewed have explicit caller/facility checks or are
  protected cron/capability endpoints. The service key remains server-only.
- The SQL isolation harness exercises cross-tenant RLS and privileged RPC
  boundaries, including previously remediated authorization gaps.

### API and browser boundary

- Cron endpoints fail closed when `CRON_SECRET` is absent and compare bearer
  credentials using SHA-256 plus `timingSafeEqual`.
- Public information requests enforce field caps, email shape validation, and a
  fail-closed IP rate limit before the intentionally public insert.
- Schedule calendar feeds validate high-entropy capability tokens and hard-pin
  queries to the token's employee and facility.
- Production responses apply a nonce-based script CSP, deny framing and MIME
  sniffing, restrict browser capabilities, and enable HSTS.
- Export filenames are encoded defensively and exported sensitive content is
  marked `Cache-Control: no-store`.

### Supply chain and operations

- CI blocks new high/critical production dependency advisories and scans full
  PR history with gitleaks.
- Accepted dependency findings are documented with reachability analysis and
  explicit remediation triggers.
- Post-deploy smoke checks verify database/env health and confirm cron routes
  reject an invalid bearer.

## Residual risks and recommendations

| Priority | Risk / recommendation | Owner action |
|---|---|---|
| P1 | Source review cannot prove deployed RLS/grants match migrations. | Run the RLS isolation suite against a fresh database on every relevant PR and keep production schema-drift comparison enabled with a read-only connection. |
| P1 | Two high dependency advisories are accepted based on current reachability assumptions (`sharp`, `brace-expansion`). | Re-run `pnpm audit --prod` on every dependency update and remove each exception immediately when a compatible upstream fix ships. Do not route attacker-uploaded images through the vulnerable `sharp` path. |
| P2 | Capability calendar URLs expose published shift details to anyone holding the token. | Keep tokens out of logs/support tickets, provide rotation, and consider omitting free-form shift notes if they may contain sensitive data. |
| P2 | `style-src 'unsafe-inline'` remains in CSP because of extensive dynamic inline styling. | Track a staged CSS/custom-property refactor; do not add `'unsafe-inline'` to `script-src`. |
| P2 | Login rate limiting intentionally fails open during limiter outages. | Monitor rate-limit RPC failures and rely on Supabase Auth throttling as the secondary control; alert on sustained failures. |
| P3 | Health checks disclose coarse dependency status publicly. | Keep the unauthenticated response limited to coarse booleans and monitor probing; retain detailed data behind the cron bearer. |

## Verification limitations

- The registry audit endpoint returned HTTP 403 in this environment, so current
  advisory data could not be independently refreshed during this review. CI's
  networked `pnpm audit --prod --audit-level high` remains the authoritative
  gate.
- No production credentials were used and no live tenant data was accessed.
- The secret scan covered the current repository tree locally; CI remains
  responsible for scanning full Git history.
