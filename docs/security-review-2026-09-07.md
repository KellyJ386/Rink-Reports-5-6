# Rink Reports source security review — 2026-09-07

## Assessment boundary

This review covered application source at the parent of the remediation commit:
authentication redirects, public and privileged Route Handlers, service-role call
sites, tenant authorization, database RLS/RPC migrations and tests, offline
replay, browser headers, dependency controls, and security CI.

This was **not** a penetration test and did not inspect effective production
configuration, deployed response headers, live database grants, or tenant data.
Within the reviewed source paths, no additional candidate cross-tenant disclosure,
service-role credential exposure, SQL injection, or unauthenticated privileged
mutation was identified. That statement must not be interpreted as assurance
about controls outside this assessment boundary.

## Finding RR-SR-01: email callback open redirect

**Severity:** Medium  
**Status:** Remediated with automated regression coverage

The email OTP/invite callback accepted any `next` value beginning with `/` and
rejected only literal `//`. It passed the result to `new URL(next, request.url)`.
WHATWG parsing treats backslashes as slashes for HTTPS URLs, so a value such as
`/\attacker.example` resolved to `https://attacker.example/`. A crafted callback
could therefore send a newly authenticated user to a phishing origin.

The remediation puts redirect validation in shared authentication infrastructure.
Both password login and the callback accept only non-ambiguous absolute paths
whose parsed origin remains equal to a fixed validation origin. The callback
falls back to `/update-password` for every invalid target.

## Evidence register

| Control | Source evidence | Verification performed | Result |
|---|---|---|---|
| Login and callback targets remain same-origin | `src/lib/auth/safe-redirect.ts`; auth consumers | Table-driven utility tests and callback `Location` response tests | Pass |
| Callback handles PKCE, OTP, and failed exchanges safely | `src/app/(auth)/callback/route.ts` | Route Handler unit tests with mocked Supabase auth | Pass |
| Protected page prefixes require a verified session | `src/lib/supabase/session.ts` | Source inspection | Pass in source; deployed behavior not tested |
| Admin and tenant mutations have application and database gates | `src/lib/auth/**`; `src/lib/permissions/**`; migrations | Source inventory compared with `supabase/tests/rls_isolation.sql` | Present; fresh PostgreSQL harness delegated to CI |
| Offline replay derives tenant and employee server-side | `src/app/api/offline-sync/route.ts`; replay handlers | Source inspection and existing unit suite | Pass in reviewed source |
| Cron service-role workers require a bearer secret | `src/app/api/cron/**/route.ts` | Source inspection; schedule parity check | Pass in reviewed source |
| Public lead submission is bounded and rate-limited | `src/app/api/information-requests/route.ts` | Source inspection | Pass in reviewed source |
| Production script CSP is nonce-based | `src/lib/supabase/session.ts`; `next.config.ts` | Source inspection | Present in source; deployed headers not tested |
| Production dependencies meet advisory policy | `package.json`; `pnpm-lock.yaml` | Local registry audit attempted | Inconclusive locally: registry returned HTTP 403 |
| Repository history contains no secrets | `.github/workflows/security-scan.yml` | Current-tree pattern inspection | Full-history result delegated to CI gitleaks |

## Confirmed source controls

- Tenant and employee identifiers on offline replay are derived from the verified
  session, and queued ownership is checked before persistence.
- Cron routes fail closed when `CRON_SECRET` is absent and compare hashed bearer
  values with `timingSafeEqual`.
- The public information-request endpoint caps every field and fails closed when
  its service-role-only rate limiter is unavailable.
- Calendar feeds validate capability-token shape and scope service-role reads to
  the token's employee and facility.
- Production configuration includes a nonce-based script CSP, frame denial,
  MIME-sniffing prevention, HSTS, referrer restrictions, and a permissions policy.
- CI includes production dependency auditing, full-history secret scanning,
  migration/RLS isolation checks, and post-deployment health checks.

## Residual risks and actions

| Priority | Risk | Required action |
|---|---|---|
| P1 | Migrated source does not prove production RLS and grants match. | Keep fresh-database RLS tests blocking and enable the optional read-only production schema-drift comparison. |
| P1 | Accepted `sharp` and `brace-expansion` advisories depend on reachability assumptions. | Recheck on every dependency update, remove exceptions when compatible fixes ship, and do not send attacker-uploaded images through the accepted `sharp` path. |
| P2 | Calendar URLs are bearer capabilities containing published shift details. | Prevent token logging, preserve user-accessible rotation, and avoid sensitive free-form notes in calendar output. |
| P2 | CSP retains `style-src 'unsafe-inline'` for dynamic UI styles. | Refactor toward classes or custom properties incrementally; never extend this exception to scripts. |
| P2 | Login application throttling intentionally fails open during limiter outages. | Alert on limiter failures and retain Supabase Auth throttling as the independent fallback. |
| P3 | Public health responses reveal coarse dependency status. | Keep unauthenticated output coarse and detailed diagnostics bearer-protected. |

## Verification limitations

- The npm registry audit endpoint returned HTTP 403, so advisory state was not
  refreshed locally. The networked CI command `pnpm audit --prod --audit-level
  high` remains authoritative.
- No production credentials or tenant data were used.
- No claims are made here about deployed configuration or controls marked as
  delegated to CI in the evidence register.
