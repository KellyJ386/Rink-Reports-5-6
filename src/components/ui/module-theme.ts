/**
 * Per-module theming vocabulary and JIT-safe class maps.
 *
 * `ModuleKey` is the single source of truth for *theming* (distinct from the
 * DB/permission `MODULE_NAMES` and the dashboard's own enum). The per-module
 * color tokens (`--module-*`, light + dark) live in `globals.css` and are
 * mapped to Tailwind utilities (`text-module-*`, `bg-module-*`,
 * `border-module-*`) there.
 *
 * IMPORTANT — Tailwind JIT safety: the scanner only ships utility classes it
 * can see as *complete literals* in source. A `text-module-${key}` template
 * literal silently drops the class. So every per-module utility is enumerated
 * here as a full literal string; consumers look the class up by key.
 */

export type ModuleKey =
  | "daily"
  | "ice-depth"
  | "ice-ops"
  | "incidents"
  | "accidents"
  | "refrig"
  | "air"
  | "comms"
  | "scheduling"
  | "paperwork"
  | "dasher"

/** `text-module-*` — for eyebrows, headings, tinted icons. */
export const MODULE_TEXT: Record<ModuleKey, string> = {
  daily: "text-module-daily",
  "ice-depth": "text-module-ice-depth",
  "ice-ops": "text-module-ice-ops",
  incidents: "text-module-incidents",
  accidents: "text-module-accidents",
  refrig: "text-module-refrig",
  air: "text-module-air",
  comms: "text-module-comms",
  scheduling: "text-module-scheduling",
  paperwork: "text-module-paperwork",
  dasher: "text-module-dasher",
}

/** `border-module-*` — full-border accent color. */
export const MODULE_BORDER: Record<ModuleKey, string> = {
  daily: "border-module-daily",
  "ice-depth": "border-module-ice-depth",
  "ice-ops": "border-module-ice-ops",
  incidents: "border-module-incidents",
  accidents: "border-module-accidents",
  refrig: "border-module-refrig",
  air: "border-module-air",
  comms: "border-module-comms",
  scheduling: "border-module-scheduling",
  paperwork: "border-module-paperwork",
  dasher: "border-module-dasher",
}

/** `border-l-module-*` — left-edge-only accent color (pairs with `border-l-4`). */
export const MODULE_BORDER_L: Record<ModuleKey, string> = {
  daily: "border-l-module-daily",
  "ice-depth": "border-l-module-ice-depth",
  "ice-ops": "border-l-module-ice-ops",
  incidents: "border-l-module-incidents",
  accidents: "border-l-module-accidents",
  refrig: "border-l-module-refrig",
  air: "border-l-module-air",
  comms: "border-l-module-comms",
  scheduling: "border-l-module-scheduling",
  paperwork: "border-l-module-paperwork",
  dasher: "border-l-module-dasher",
}

/** `bg-module-*` — solid fills (e.g. icon badges where a utility is preferred). */
export const MODULE_BG: Record<ModuleKey, string> = {
  daily: "bg-module-daily",
  "ice-depth": "bg-module-ice-depth",
  "ice-ops": "bg-module-ice-ops",
  incidents: "bg-module-incidents",
  accidents: "bg-module-accidents",
  refrig: "bg-module-refrig",
  air: "bg-module-air",
  comms: "bg-module-comms",
  scheduling: "bg-module-scheduling",
  paperwork: "bg-module-paperwork",
  dasher: "bg-module-dasher",
}

/**
 * The underlying CSS custom-property name for each module. Used to drive an
 * inline `--module-accent` var (for `color-mix` gradient bands and icon-badge
 * backgrounds) — dark mode is automatic because `.dark` redefines the token.
 */
export const MODULE_ACCENT_VAR: Record<ModuleKey, string> = {
  daily: "--module-daily",
  "ice-depth": "--module-ice-depth",
  "ice-ops": "--module-ice-ops",
  incidents: "--module-incidents",
  accidents: "--module-accidents",
  refrig: "--module-refrig",
  air: "--module-air",
  comms: "--module-comms",
  scheduling: "--module-scheduling",
  paperwork: "--module-paperwork",
  dasher: "--module-dasher",
}

/**
 * Maps a DB/dashboard module name to its theming `ModuleKey`. Lets generic
 * shells that only know the persisted name (e.g. `facility_paperwork`) resolve
 * the right color without a risky global rename.
 */
export function moduleKeyFromDashboard(name: string): ModuleKey | undefined {
  switch (name) {
    case "daily_reports":
      return "daily"
    case "incident_reports":
      return "incidents"
    case "accident_reports":
      return "accidents"
    case "refrigeration":
      return "refrig"
    case "air_quality":
      return "air"
    case "ice_operations":
      return "ice-ops"
    case "dasher_boards":
      return "dasher"
    case "ice_depth":
      return "ice-depth"
    case "communications":
      return "comms"
    case "scheduling":
      return "scheduling"
    case "facility_paperwork":
      return "paperwork"
    default:
      return undefined
  }
}
