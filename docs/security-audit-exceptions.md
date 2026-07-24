# Dependency audit exceptions

`pnpm audit --prod --audit-level high` runs in CI (`.github/workflows/security-scan.yml`)
and **blocks** on any new high/critical advisory. Advisories accepted via
`pnpm.auditConfig.ignoreGhsas` in `package.json` are recorded in the table
below because they have no clean registry fix. Each must be revisited when an
upstream fix lands.

| GHSA | Package | Path | Why accepted | Remediation |
|------|---------|------|--------------|-------------|
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | sharp | `.>next>sharp` | libvips codec-parsing CVEs (CVE-2026-33327, -33328, -35590, -35591). `sharp` is bundled transitively by Next for `next/image` optimization — the app never routes user-uploaded images through it, only build-time and static assets served via `next/image`. Still unpatched (`sharp@0.34.5` bundled by `next@16.2.11`) as of 2026-07-24. | Re-run `pnpm audit --prod` after each `next` patch bump; drop this entry once Next updates its internal `sharp` pin to ≥0.35.0 (the patched version). |

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

- **Three new `next` high advisories** — GHSA-m99w-x7hq-7vfj (DoS in the App
  Router via Server Actions), GHSA-89xv-2m56-2m9x (SSRF in Server Actions),
  and GHSA-p9j2-gv94-2wf4 (SSRF in rewrites via an attacker-controlled
  destination hostname) — were cleared on 2026-07-24 by bumping `next`
  16.2.10 → 16.2.11 (and `eslint-config-next` to match). All patched at
  `next@16.2.11`; no ignore recorded.

- **`postcss` 8.4.31 via `.>next>postcss`** — GHSA-6g55-p6wh-862q (high,
  patched ≥ 8.5.12: arbitrary file read / info disclosure via an
  attacker-controlled `sourceMappingURL` in CSS comments), which supersedes
  the previously-tracked moderate GHSA-qx2v-qp2m-jg93 (both fixed by the same
  bump). `next@16.2.11` still vendors an unpatched `postcss@8.4.31` alongside
  the project's own `postcss@8.5.16` (via `@tailwindcss/postcss`) — cleared on
  2026-07-24 by adding `"postcss": "^8.5.16"` to `pnpm.overrides`, forcing the
  whole tree onto the already-present patched version instead of waiting on
  Next to update its internal pin. *Re-check trigger:* if a future `next` bump
  vendors its own patched postcss, the override can likely be dropped (verify
  no regression first).
