# Dependency audit exceptions

`pnpm audit --prod --audit-level high` runs in CI (`.github/workflows/security-scan.yml`)
and **blocks** on any new high/critical advisory. Advisories accepted via
`pnpm.auditConfig.ignoreGhsas` in `package.json` are recorded in the table
below because they have no clean registry fix. Each must be revisited when an
upstream fix lands.

| GHSA | Package | Path | Why accepted | Remediation |
|------|---------|------|--------------|-------------|
| *(none currently — the ignore list is empty as of 2026-07-08)* | | | | |

## Below the CI gate — tracked, not ignored

The advisories below are **low/moderate**, so the high-only CI gate passes
without any `ignoreGhsas` entry. They are recorded here so they get revisited
instead of riding along silently. Inventory as of **2026-07-08**
(`pnpm audit --prod --json`).

**`uuid` 8.3.2 via `.>exceljs>uuid`** — GHSA-w5hq-g745-h8pq (moderate,
patched ≥ 11.1.1): missing buffer bounds check in v3/v5/v6 when a `buf`
argument is provided. exceljs uses uuid internally to mint workbook part ids
on write; no attacker-controlled input reaches that call path, and the module
is admin-only and lazy-loaded (`src/components/admin/bulk-upload/`).
*Remediation trigger:* drop when an `exceljs` release bumps its `uuid`
dependency past v8.

**`postcss` 8.4.31 via `.>next>postcss`** — GHSA-qx2v-qp2m-jg93 (moderate,
patched ≥ 8.5.10): XSS via unescaped `</style>` in stringify output. postcss
is a build-toolchain dependency vendored by Next; the app never stringifies
untrusted CSS and builds run in CI/Vercel, not on user input. Next 16.2.10
still pins postcss 8.4.31.
*Remediation trigger:* re-run `pnpm audit --prod` after each `next` patch
bump; this disappears when Next updates its internal pin.

## Notably fixed

- **The entire DOMPurify advisory family via `posthog-js`** — one high
  (GHSA-87xg-pxx2-7hvx, previously the only `ignoreGhsas` entry) plus eight
  low/moderate siblings (GHSA-76mc-f452-cxcm, GHSA-hpcv-96wg-7vj8,
  GHSA-r47g-fvhr-h676, GHSA-rp9w-3fw7-7cwq, GHSA-cmwh-pvxp-8882,
  GHSA-gvmj-g25r-r7wr, GHSA-vxr8-fq34-vvx9, GHSA-x4vx-rjvf-j5p4) — was cleared
  on 2026-07-08 by bumping `posthog-js` 1.383.3 → 1.398.4, which bundles
  DOMPurify 3.4.11. The ignore was dropped; `pnpm.auditConfig.ignoreGhsas` is
  now empty.

- **GHSA-4x5r-pxfx-6jf8 (low, `@babel/core` via `.>next>styled-jsx`)** —
  cleared by the same 2026-07-08 dependency refresh (in-range transitive
  update past 7.29.6).

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
