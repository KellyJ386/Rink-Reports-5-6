# Dependency audit exceptions

`pnpm audit --prod --audit-level high` runs in CI (`.github/workflows/security-scan.yml`)
and **blocks** on any new high/critical advisory. The advisories below are
explicitly accepted via `pnpm.auditConfig.ignoreGhsas` in `package.json`
because they have no clean registry fix today. Each must be revisited when an
upstream fix lands.

| GHSA | Package | Path | Why accepted | Remediation |
|------|---------|------|--------------|-------------|
| GHSA-4r6h-8v6p-xvw6 | `xlsx` | `.>xlsx` | Prototype pollution in SheetJS. No patched version exists on the npm registry — SheetJS publishes fixes only via their own CDN (`https://cdn.sheetjs.com`). `xlsx` is **admin-only** and **lazy-loaded** (employee bulk-upload, `src/components/admin/bulk-upload/`); it never runs for staff or unauthenticated users. | Migrate the dependency to the SheetJS CDN tarball (`pnpm add https://cdn.sheetjs.com/xlsx-<latest>/xlsx-<latest>.tgz`) and re-test the bulk-upload parse/template flows, then drop this ignore. |
| GHSA-5pgg-2g8v-p4x9 | `xlsx` | `.>xlsx` | ReDoS in SheetJS. Same package/path/exposure as above. | Same as above — the CDN build fixes both xlsx advisories at once. |
| GHSA-87xg-pxx2-7hvx | `dompurify` | `.>posthog-js>dompurify` | XSS in DOMPurify 3.4.4, pulled transitively by `posthog-js`. PostHog is **client-side error capture only with autocapture OFF** (see `posthog-provider.tsx`); the app does not feed untrusted HTML through DOMPurify. The pin is `posthog-js`'s, not ours. | Bump when a `posthog-js` release ships DOMPurify ≥ 3.4.5, then drop this ignore. |

## Notably fixed

- **Next.js middleware/proxy-bypass advisories** (multiple high) were resolved
  by upgrading `next` 16.2.4 → 16.2.9. These were directly relevant: this app's
  auth gating runs in `src/proxy.ts`, so a proxy-bypass advisory is a real
  exposure, not a theoretical one. No ignore is recorded for these — they are
  genuinely patched.
