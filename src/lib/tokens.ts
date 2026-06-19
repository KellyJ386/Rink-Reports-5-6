/**
 * RinkReports design tokens — the canonical brand palette (TypeScript mirror).
 *
 * The SAME hex values live as `--rr-*` CSS custom properties in
 * `src/app/globals.css`, and the semantic token layer there (--primary,
 * --background, --border, …) maps onto them. So components should style
 * themselves with Tailwind utility classes — `bg-primary`, `border-border`,
 * `bg-rr-green`, `text-rr-navy-dark` — NOT by inlining these hexes.
 *
 * Import `rr` only when a raw string is genuinely required in JS (canvas, an
 * inline SVG fill, a charting lib). Keep this file in sync with the `--rr-*`
 * block in globals.css; they are two faces of one source of truth.
 */
export const rr = {
  green: "#4DFF00",
  greenInk: "#1A9B00",
  greenHover: "#45E600", // primary-button hover (green darkened ~10%)
  greenShadow: "#2E9900", // primary-button hard press lip
  navy: "#002244",
  navyDark: "#001630",
  bg: "#F5F6F8",
  bg2: "#ECEEF1",
  line: "#E2E5EA",
  lineSoft: "#EEF0F3",
  grey: "#8A92A0",
  greyDark: "#5A6273",
  yellow: "#FFD600",
  red: "#F42A2A",
} as const

export type RinkTokenName = keyof typeof rr
export type RinkTokenValue = (typeof rr)[RinkTokenName]
