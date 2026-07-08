# Phase 10 Design System Compliance — DESIGN Audit Report
**Date:** 2026-06-20  
**Auditor:** Agent-DESIGN  
**Canonical reference:** `src/app/reports/refrigeration/_components/submission-form.tsx`

---

## 1. Token Definition Location

**Primary source of truth:** `src/app/globals.css` — defines all `--rr-*` raw brand tokens and semantic layer (`--primary`, `--background`, `--border`, etc.) in `:root`/`.light`/`.dark` variants. Tailwind v4 consumes these via `@import "tailwindcss"` with no `tailwind.config.*`.

**`src/lib/tokens.ts` — EXISTS.** The spec's reference to `lib/tokens.ts` as "likely stale" is incorrect. The file exists and is the TypeScript mirror of the CSS `--rr-*` block. Its header explicitly states components should use Tailwind utility classes (`bg-primary`, `bg-rr-green`, etc.) and import `rr` only when a raw JS string is genuinely required (canvas, inline SVG, charting). The file defines `rr.green = "#4DFF00"` (the current brand primary), not `#69BE28`.

---

## 2. Token Audit — #69BE28 Deprecated Color Occurrences

**Total occurrences across `src/`: 18** (15 in production code, 3 in `globals.css` comments/ramp definition)

| # | File | Line(s) | Context |
|---|------|---------|---------|
| 1 | `src/app/globals.css` | 10, 25, 59 | Comment, semantic alias note, `--green-500` ramp stop. NOT a production color leak — the ramp entry is expected; `--action-green` correctly redirects to `#4DFF00`. |
| 2 | `src/components/splash/request-information.tsx` | 33, 345, 422 | 3× inline `background: "linear-gradient(180deg, #82CC36 0%, #69BE28 100%)"` — splash/marketing page. Should use `rr.green` via `tokens.ts` or CSS vars. |
| 3 | `src/components/app/pwa-install-prompt.tsx` | 208, 210, 226, 247, 258 | 5× occurrences in Tailwind arbitrary-value classes (`bg-[#69BE28]`, `border-[#69BE28]/40`, `text-[#69BE28]`, `ring-[#69BE28]`). The inline comment at line 18 claims these are "intentionally fixed" for the offline dark-mode UI — but they use the deprecated token, not `#4DFF00`. This is the largest concentration of the deprecated color in production UI. |
| 4 | `src/components/ice-depth/usa-rink.tsx` | 212 | `stroke = isCurrent ? "#69BE28" : ...` — SVG stroke for active measurement point. Should use `rr.green` from tokens.ts (a valid raw-JS use case). |
| 5 | `src/app/admin/ice-depth/_components/layout-editor.tsx` | 674, 681 | SVG circle `stroke="#69BE28"` and conditional stroke for selected state. Should use `rr.green`. |
| 6 | `src/app/admin/departments/_components/department-form.tsx` | 114 | `defaultValue={editing?.color ?? "#69BE28"}` — default color picker value for departments. Should default to `rr.green`. |
| 7 | `src/app/page.tsx` | 267, 408 | Landing/splash page inline styles: `background: "#69BE28"` and a gradient using it. Should use `rr.green` / `rr.greenInk`. |

### Other Notable Hardcoded Hex Colors (non-69BE28)

- **`src/app/reports/scheduling/my-schedule/page.tsx`:** `const NAVY = "#003B6F"`, `const GREEN = "#4DFF00"`, `const GREEN_INK = "#1F6B00"` — uses correct green primary but defines local constants instead of importing from `rr` or using Tailwind utilities.
- **`src/app/reports/scheduling/page.tsx`:** `const NAVY = "#003B6F"`, `const NAVY_DARK = "#001A3A"`, `const GREEN = "#4DFF00"`, `const GREEN_DARK = "#3DB800"` — same pattern; values partially match `rr.*` but are not imported from `tokens.ts`.
- **`src/app/reports/scheduling/_components/week-calendar.tsx`:** `background: GREEN` (local constant `#4DFF00`) used in inline style for dots.
- **`src/lib/notifications/pdf/templates/`** (ice-depth.tsx, readings.tsx, incident.tsx, accident.tsx, refrigeration.tsx): Extensive hardcoded hex colors (Tailwind slate/red/yellow/green scale equivalents like `#0f172a`, `#475569`, `#64748b`, `#94a3b8`, `#dc2626`, `#16a34a`, etc.). These are PDF generation contexts where CSS variables cannot be used (react-pdf renders outside the browser CSS cascade). This is acceptable and necessary; not flagged as a violation.

---

## 3. Typography

**Fonts loaded globally in `src/app/layout.tsx`:**
- `Geist` (sans-serif body/UI) → CSS var `--font-geist-sans`
- `Geist_Mono` (mono) → CSS var `--font-geist-mono`
- `Anton` (display) → CSS var `--font-anton`
- `JetBrains_Mono` (data/times) → CSS var `--font-jetbrains-mono`

**`globals.css` font roles:**
```
--font-display: var(--font-anton), Anton, Impact, "Arial Narrow", sans-serif;
--font-mono:    var(--font-jetbrains-mono), "JetBrains Mono", ui-monospace, ...
```

**Typography compliance findings:**

| Module | Typography Status |
|--------|------------------|
| Refrigeration | Uses Tailwind `font-semibold`, `text-xl`, `text-lg` — no display/Anton in section headers. PageHeader handles display type. Pass. |
| Accidents | `font-display` class on `<h2>` correctly. Pass. |
| Ice Depth (report) | Defines `const DISPLAY_FONT = "var(--font-anton)..."` inline instead of using `font-display` Tailwind class. Mixed: some pages use `font-display` class, others inline style. Partial compliance. |
| Ice Depth (done page) | `style={{ fontFamily: DISPLAY_FONT }}` inline — should be `className="font-display"`. Minor violation. |
| Scheduling (staff) | `const DISPLAY_FONT` and `const GREEN` constants — bypasses token system with local duplicates. `font-display` not used; inline `fontFamily` instead. |
| Admin Scheduling | Properly uses `font-display`, `font-mono` Tailwind classes throughout `board-pieces.tsx`, `week-grid.tsx`, `week-board.tsx`. Pass. |
| Incidents | No display-font usage on headings — uses default `font-semibold`. Acceptable per CLAUDE.md (flat form pattern). |
| Daily | No display-font usage — acceptable for flat checklist form. |
| Air Quality | No display-font violations noted. |

---

## 4. Shared Components Audit

**Confirmed shared primitives in `src/components/ui/`:**
- `card.tsx` ✓
- `button.tsx` ✓
- `badge.tsx` ✓
- `page-header.tsx` ✓
- `section-card.tsx` ✓
- `stat-card.tsx` ✓

### Module-by-module primitive adoption

| Module | Card | Button | Badge | PageHeader | SectionCard | Notes |
|--------|------|--------|-------|------------|-------------|-------|
| Refrigeration | ✓ | ✓ | — | ✓ | ✓ | Canonical reference; fully compliant |
| Daily | ✓ | ✓ | — | ✓ | — | Uses PageHeader; Card for sections |
| Incidents | ✓ | ✓ | — | ✓ | — | PageHeader in list + detail views |
| Accidents | ✓ | ✓ | — | — | ✓ | Uses SectionCard; missing PageHeader on submission form (has custom header) |
| Ice Depth | — | ✓ | — | — | — | No Card/PageHeader/SectionCard on submission form; bespoke SVG canvas layout. Per CLAUDE.md: "treat as special case." |
| Ice Operations | ✓ | ✓ | ✓ | ✓ | ✓ | Good compliance |
| Air Quality | — | ✓ | — | ✓ | ✓ (via SectionCard import) | Good compliance |
| Scheduling (staff) | — | — | — | — | — | Entirely inline-styled canvas-like rendering; no shadcn primitives |
| Admin | ✓ | ✓ | ✓ | ✓ | — | Broad PageHeader adoption; SectionCard rarely needed |
| Nav/Shell | — | ✓ | — | — | — | Shell components use their own layout patterns; appropriate |

**One-off component concerns:**
- `src/app/reports/scheduling/page.tsx` and `my-schedule/page.tsx`: Build a custom card-like layout with inline styles and raw hex constants rather than using `Card`/`PageHeader`. This is the most significant primitive-reuse gap.
- `src/app/reports/ice-depth/[layoutSlug]/page.tsx`: The interactive rink layout is intentionally bespoke (per CLAUDE.md); no shared Card chrome needed. Acceptable.

---

## 5. Per-Module Design Grades

Scoring rubric: token compliance (30%), primitive reuse (30%), typography (20%), dark mode safety (20%).

| Module | Grade /100 | Notes |
|--------|-----------|-------|
| Refrigeration | **95** | Canonical reference; excellent token + primitive use. Minor: section `<h2>` uses `text-xl font-semibold` not `font-display`. |
| Ice Operations | **88** | Good SectionCard/PageHeader/Button/Badge use; no color violations. |
| Air Quality | **85** | PageHeader + SectionCard; `RangeBadgePill` intentionally richer. No color violations. |
| Incidents | **82** | PageHeader + Card; flat form acceptable per spec. No color violations. |
| Daily | **80** | PageHeader + Card; flat checklist. No violations. Missing display type on headings. |
| Admin | **78** | Broad PageHeader adoption, shadcn components throughout. Minor: some admin sub-pages lack SectionCard; one `#69BE28` each in ice-depth layout-editor and departments form. |
| Accidents | **75** | SectionCard+SectionHead pattern; no PageHeader on submission form (custom header). No color violations. |
| Nav/Shell | **72** | Appropriate shell patterns; `pwa-install-prompt.tsx` has 5 hardcoded `#69BE28` instances (largest single-file concentration). |
| Ice Depth | **65** | Intentionally bespoke SVG form — CLAUDE.md sanctions this. However: inline `DISPLAY_FONT` constant instead of `font-display` class, `#69BE28` in `usa-rink.tsx` SVG stroke (should be `rr.green`), inline monospace font style objects. |
| Scheduling (staff) | **48** | Worst offender: entirely inline-styled with raw hex constants (`#003B6F`, `#001A3A`, `#4DFF00`, `#3DB800`), no shadcn Card/PageHeader/SectionCard, fontFamily as inline style object. The values are mostly correct brand colors but bypass the token system entirely. |

---

## 6. Summary Findings

### Critical
1. **`src/components/app/pwa-install-prompt.tsx`** — 5× `#69BE28` in Tailwind arbitrary classes; largest production UI concentration of the deprecated token.
2. **`src/app/reports/scheduling/page.tsx` + `my-schedule/page.tsx`** — Fully bypasses token system and shadcn primitives; raw hex constants, inline styles, no Card/PageHeader.

### High
3. **`src/components/splash/request-information.tsx`** — 3× `#69BE28` gradient backgrounds in splash page.
4. **`src/app/page.tsx`** — 2× `#69BE28` in landing page inline styles.
5. **`src/components/ice-depth/usa-rink.tsx`** — `#69BE28` SVG stroke should use `rr.green` from tokens.ts.

### Medium
6. **`src/app/admin/ice-depth/_components/layout-editor.tsx`** — 2× `#69BE28` SVG strokes.
7. **`src/app/admin/departments/_components/department-form.tsx`** — `#69BE28` default color picker value.
8. **Ice Depth (report) + done page** — Inline `fontFamily` style objects instead of `font-display` Tailwind class.

### Low / Informational
9. `lib/tokens.ts` EXISTS and is the correct JS escape hatch; its docstring correctly mandates Tailwind utility classes for components.
10. PDF templates (`src/lib/notifications/pdf/templates/`) use hardcoded hex — necessary for react-pdf context; not a CSS variable violation.
11. Scheduling (admin) is COMPLIANT; the issue is confined to the staff-facing scheduling pages.

---

## 7. Overall Design Grade

**Overall: 76 / 100**

The design system foundation is solid — globals.css tokens, lib/tokens.ts mirror, shadcn/ui primitives, and PageHeader/SectionCard patterns are well-established and broadly adopted. The main drag is the deprecated `#69BE28` appearing in 15 production code locations (3 files with multiple uses each: `pwa-install-prompt`, `request-information`, `page.tsx`), and the staff scheduling module being a near-total outlier from the token system.
