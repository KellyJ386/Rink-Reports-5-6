# Rink Reports UI Design Baseline

This document records the visual baseline every module must follow. The
**Accident Report** module (`src/app/reports/accidents/`) was the original
visual reference; this doc captures that look, expressed through
**shared, token-based primitives** (no inline styles, no raw hexes).

## Source of truth

- **Tokens**: `src/app/globals.css` — semantic CSS variables + the
  `@theme inline` mapping that exposes them as Tailwind v4 utilities.
- **Primitives**: `src/components/ui/`.
- **Rule**: every color, radius, shadow, and font size used in a module
  must resolve to a token via a utility class. The **only** sanctioned
  inline `style` is a dynamic DB color (severity dropdowns) routed
  through `severity.tsx`. Any other `style={{}}` or raw `#hex` in
  `src/app/reports/**` or `src/app/admin/**` is a regression.

## Fonts

| Use | Family | Token / Utility |
| --- | --- | --- |
| Body | Geist | `font-sans` (default) via `--font-geist-sans` |
| Display headings | Anton | `.font-display` (added in `globals.css`, maps to `var(--font-anton)`) |
| Monospace | Geist Mono | `font-mono` via `--font-geist-mono` |

`.font-display` is the canonical way to invoke Anton — never re-type the
font stack inline.

## Color tokens (semantic layer)

Brand anchors: `--action-green #69BE28`, `--rink-navy #002244`.

| Token | Utility examples | Use |
| --- | --- | --- |
| `--background` / `--foreground` | `bg-background`, `text-foreground` | Page canvas + body text |
| `--card` / `--card-foreground` | `bg-card`, `text-card-foreground` | Card / section surfaces |
| `--foreground-strong` | `text-foreground-strong` | Strong headings (navy-700 light) |
| `--muted` / `--muted-foreground` | `bg-muted`, `text-muted-foreground` | Subtle surface + secondary text |
| `--border` / `--input` | `border-border`, `border-input` | Borders, input borders |
| `--ring` | `ring-ring` | Focus ring (green) |
| `--primary` / `--primary-foreground` | `bg-primary`, `text-primary-foreground` | Primary action (green w/ navy ink) |
| `--accent` / `--accent-foreground` | `bg-accent`, `text-accent-foreground` | Hover surface |
| `--destructive` (+ `-soft`) | `bg-destructive`, `text-destructive`, `bg-destructive-soft` | Errors |
| `--success` / `--warning` / `--info` (+ `-soft`) | `bg-success-soft`, etc. | Status banners + pills |
| `--navy-700` | `bg-[var(--navy-700)]`, `text-[var(--navy-700)]` | Mode-constant brand navy (numbered section circles use this so white digits stay legible in dark mode) |
| `--module-*` | `text-module-accidents`, `bg-module-incidents`, etc. | Per-module accent (eyebrow color, tile chip) |

Module accent tokens: `--module-daily`, `--module-ice-depth`,
`--module-ice-ops`, `--module-incidents`, `--module-accidents`,
`--module-refrig`, `--module-air`, `--module-comms`,
`--module-scheduling`, `--module-paperwork`.

## Shadows + radius

| Token | Utility | Use |
| --- | --- | --- |
| `--shadow-elev-1` | `shadow-[var(--shadow-elev-1)]` | Section cards, inputs, list rows |
| `--shadow-elev-2` | `shadow-[var(--shadow-elev-2)]` | Elevated cards, popovers |
| `--shadow-elev-3` | `shadow-[var(--shadow-elev-3)]` | Hover on elevated, modals |
| `--shadow-press-primary` | (built into `<Button variant="default">`) | The signature green-gradient press shadow |

Radius scale: `--radius` (10px base) exposed as `rounded-sm/md/lg/xl`.
Section cards use `rounded-xl`; list rows / inputs `rounded-md`.

## Type scale

| Slot | Classes |
| --- | --- |
| Display H1 | `font-display text-[clamp(30px,6vw,44px)] uppercase tracking-[0.01em] leading-none text-foreground` |
| Section H2 / SectionHead title | `font-display text-[22px] uppercase tracking-[-0.01em] text-foreground` |
| Card title | `text-base font-semibold tracking-tight` |
| Body | `text-sm` (lists, forms), `text-base` (inputs) |
| Helper / muted | `text-xs text-muted-foreground` |
| Eyebrow | `text-[10px] font-extrabold uppercase tracking-[0.16em]` (color from `text-module-*` or `text-muted-foreground`) |
| Label | from `<Label>` — `text-sm font-medium` |

## Page header pattern

Use the extended `PageHeader` primitive:

```tsx
<PageHeader
  variant="display"
  module="accidents"
  breadcrumb={<Breadcrumb segments={[{label:"Reports",href:"/reports"},{label:"Accident Report"}]} />}
  eyebrow="Staff report"
  title="Accident Report"
  description="You can edit a submission for up to 24 hours after you submit it."
  actions={/* optional right-side buttons */}
/>
```

- `variant="default"` keeps the existing Geist `text-2xl/3xl font-semibold`
  look used by admin pages.
- `variant="display"` renders the Anton display title with the eyebrow +
  optional breadcrumb above. `module` colors the eyebrow via
  `text-module-*`.

## Section card pattern

```tsx
<SectionCard>
  <SectionHead n={1} title="Person involved" sub="Optional subtitle" />
  {/* fields */}
</SectionCard>
```

- Card chrome: `bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-elev-1)] flex flex-col`.
- Numbered circle: `bg-[var(--navy-700)] text-white font-display size-9 rounded-full grid place-items-center`.
- Title: `font-display text-[22px] uppercase text-foreground`.
- Sub: `text-xs text-muted-foreground`.
- For native `<details>` disclosures (refrigeration), apply the same
  classes directly to `<details>`/`<summary>` — don't replace the element.

## Form field pattern

`FormField` is purely presentational and does NOT set `aria-*` on the
control — controls keep explicit `aria-invalid` / `aria-describedby` /
`autoComplete` / `enterKeyHint` props so existing `useActionState` field
errors and focus-on-first-error effects keep working.

```tsx
<FormField label="Injured person's name" required htmlFor="injured_person_name" error={state.fieldErrors?.injured_person_name}>
  <Input id="injured_person_name" name="injured_person_name" required ... />
</FormField>
```

Inputs use `<Input>` (h-10 default; pass `className="h-12 text-base"` for
the larger field heights staff report forms use on mobile).

## Button hierarchy

| Variant | Use |
| --- | --- |
| `default` / `gradient` | Primary submit — green gradient + `--shadow-press-primary` |
| `warm` | Coral secondary CTA |
| `destructive` | Delete / destructive action |
| `outline` | Default secondary button |
| `secondary` | Neutral surface action |
| `ghost` | Inline / tertiary action |
| `link` | Inline link styled action |

Sizes: `sm` (h-9), `default` (h-11), `lg` (h-12), `icon` (size-11).

Never re-implement the green gradient; always use `<Button variant="default">`.

## Tab navigation

Use `TabNav` for URL-driven (Link-based) tab bars. Canonical look:

- Container: `flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-1`.
- Active: `bg-primary text-primary-foreground`.
- Inactive: `text-muted-foreground hover:bg-accent hover:text-accent-foreground`.

The Radix `Tabs` primitive (`tabs.tsx`) remains for in-page (non-URL)
client tabs — same active/inactive token mapping.

## Lists + tables

- **`DataList`** — bordered, divided vertical list for "recent
  submissions" feeds. Chrome: `bg-card border border-border rounded-xl
  overflow-hidden shadow-[var(--shadow-elev-1)]`; rows
  `flex items-center gap-3 px-3.5 py-3 border-b border-border last:border-0 hover:bg-accent/40`.
- **`DataTable`** — semantic `<table>` for admin history/config. Same
  card chrome; header row `text-xs uppercase tracking-wide text-muted-foreground`;
  body rows `border-b border-border last:border-0`.

## Severity / status colors

- **Static severity** that maps to a known meaning → use `<Badge variant="success|warning|error|info|destructive|special|secondary|outline">`.
- **Data-driven severity** (DB `dropdown.color` hex) → use the
  `SeverityPill` / `SeverityDot` / `SeverityPillGroup` primitives. These
  are the **only** components allowed to use an inline `style` for color;
  layout and typography are still utility classes.

## Empty + loading states

- `EmptyState` (existing) — centered placeholder card with icon + title
  + description + action.
- `LoadingState` / `Skeleton` — shared skeleton primitives for route
  `loading.tsx` files. Respects `prefers-reduced-motion` (already globally
  handled in `globals.css`).

## Spacing scale + section gaps

- Page shell: `mx-auto w-full max-w-2xl flex flex-col gap-6 px-4 py-8`
  (staff reports). Admin pages use `flex flex-col gap-6 p-4 md:p-6`
  full-width.
- Card internal padding: `p-5` for `SectionCard`; `p-3` for nested
  subcards (`rounded-lg border bg-background p-3`).
- Field stacks: `flex flex-col gap-2` per field; `gap-4` between fields
  in a section.

## What was extracted and tokenized

| Was (Accident Report inline) | Now (token utility) |
| --- | --- |
| `RED = "#F42A2A"` (eyebrow) | `text-module-accidents` |
| `NAVY = "#003B6F"` (numbered circle bg) | `bg-[var(--navy-700)]` |
| `NAVY_DARK = "#001A3A"` (submit text) | `<Button variant="default">` → `text-primary-foreground` (already navy) |
| `GREEN = "#4DFF00"` (submit bg) | `<Button variant="default">` → green gradient via `--shadow-press-primary` |
| Inline `borderRadius: 14, padding: 20` | `rounded-xl p-5` (SectionCard) |
| Inline `background: var(--card), border: 1px solid var(--border)` | `bg-card border border-border` (SectionCard) |
| Inline `boxShadow: "0 1px 3px rgba(0,0,0,.05)"` | `shadow-[var(--shadow-elev-1)]` |
| Inline severity pill `background: color + "20"` | `<SeverityPill color={...}>` |
| Inline `fontFamily: "var(--font-anton), Anton, ..."` | `font-display` utility |

## Verification

Run after each module:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
grep -rn "style={{" src/app/reports src/app/admin     # only severity.tsx-routed dynamic colors expected
grep -rEn "#[0-9A-Fa-f]{3,6}" src/app/reports src/app/admin   # only DB-color fallbacks expected
```
