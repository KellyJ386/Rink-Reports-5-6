# Dependency audit exceptions

`pnpm audit --prod --audit-level high` runs in CI (`.github/workflows/security-scan.yml`)
and **blocks** on any new high/critical advisory. The advisories below are
explicitly accepted via `pnpm.auditConfig.ignoreGhsas` in `package.json`
because they have no clean registry fix today. Each must be revisited when an
upstream fix lands.

| GHSA | Package | Path | Why accepted | Remediation |
|------|---------|------|--------------|-------------|
| GHSA-87xg-pxx2-7hvx | `dompurify` | `.>posthog-js>dompurify` | XSS in DOMPurify 3.4.4, pulled transitively by `posthog-js`. PostHog is **client-side error capture only with autocapture OFF** (see `posthog-provider.tsx`); the app does not feed untrusted HTML through DOMPurify. The pin is `posthog-js`'s, not ours. | Bump when a `posthog-js` release ships DOMPurify ≥ 3.4.11 (which also clears the sub-high dompurify family below), then drop this ignore. |

## Below the CI gate — tracked, not ignored

The advisories below are **low/moderate**, so the high-only CI gate passes
without any `ignoreGhsas` entry. They are recorded here so they get revisited
instead of riding along silently. Inventory as of **2026-07-08**
(`pnpm audit --prod --json`).

**DOMPurify 3.4.4 via `.>posthog-js>dompurify`** — same exposure rationale as
the accepted high above (error capture only, autocapture off, no untrusted
HTML through DOMPurify): GHSA-76mc-f452-cxcm (moderate, patched ≥ 3.4.7),
GHSA-hpcv-96wg-7vj8 (moderate, ≥ 3.4.6), GHSA-r47g-fvhr-h676 (moderate,
≥ 3.4.6), GHSA-rp9w-3fw7-7cwq (moderate, ≥ 3.4.7), GHSA-cmwh-pvxp-8882
(moderate, ≥ 3.4.11), GHSA-gvmj-g25r-r7wr (low, ≥ 3.4.8), GHSA-vxr8-fq34-vvx9
(low, ≥ 3.4.9), GHSA-x4vx-rjvf-j5p4 (low, no patched version published).
*Remediation trigger:* a `posthog-js` release bundling DOMPurify ≥ 3.4.11
clears the entire family — check `pnpm why dompurify` after each posthog-js
bump.

**`uuid` 8.3.2 via `.>exceljs>uuid`** — GHSA-w5hq-g745-h8pq (moderate,
patched ≥ 11.1.1): missing buffer bounds check in v3/v5/v6 when a `buf`
argument is provided. exceljs uses uuid internally to mint workbook part ids
on write; no attacker-controlled input reaches that call path, and the module
is admin-only and lazy-loaded (`src/components/admin/bulk-upload/`).
*Remediation trigger:* drop when an `exceljs` release bumps its `uuid`
dependency past v8.

**Next.js internal pins via `.>next>…`** — GHSA-qx2v-qp2m-jg93 (moderate,
`postcss` < 8.5.10: XSS via unescaped `</style>` in stringify output) and
GHSA-4x5r-pxfx-6jf8 (low, `styled-jsx>@babel/core` < 7.29.6: arbitrary file
read via sourceMappingURL). Both are build-toolchain dependencies vendored by
Next; the app never stringifies untrusted CSS and builds run in CI/Vercel, not
on user input. Next 16.2.10 still pins `postcss` 8.4.31.
*Remediation trigger:* re-run `pnpm audit --prod` after each `next` patch
bump; these disappear when Next updates its internal pins.

## Notably fixed

- **GHSA-4r6h-8v6p-xvw6 (prototype pollution) and GHSA-5pgg-2g8v-p4x9 (ReDoS)
  in `xlsx` (SheetJS)** were remediated on 2026-07-08 by replacing `xlsx` with
  `exceljs` in the admin bulk-upload feature
  (`src/components/admin/bulk-upload/`) — SheetJS never shipped a patched
  build to the npm registry, only to their own CDN. Both ignores have been
  dropped from `pnpm.auditConfig.ignoreGhsas`. Note: `exceljs` cannot read
  legacy `.xls` (BIFF) files, so the importer now accepts `.csv`/`.xlsx` only.

- **Next.js middleware/proxy-bypass advisories** (multiple high) were resolved
  by upgrading `next` 16.2.4 → 16.2.9. These were directly relevant: this app's
  auth gating runs in `src/proxy.ts`, so a proxy-bypass advisory is a real
  exposure, not a theoretical one. No ignore is recorded for these — they are
  genuinely patched.
