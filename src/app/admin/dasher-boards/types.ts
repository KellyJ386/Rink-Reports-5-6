// Local types for the Dasher Boards admin module.
// Row types come from the generated Supabase types; composite shapes on top.

import type { Tables } from "@/types/database"
import type { GlassNumberDirection } from "@/app/reports/dasher-boards/_lib/glass-numbering"

export type RinkRow = Tables<"dasher_boards_rinks">
export type AssetRow = Tables<"dasher_boards_assets">
export type SubtypeRow = Tables<"dasher_boards_asset_subtypes">
export type IssueCategoryRow = Tables<"dasher_boards_issue_categories">
export type ChecklistItemRow = Tables<"dasher_boards_checklist_items">
export type IssueRow = Tables<"dasher_boards_issues">
export type InspectionRow = Tables<"dasher_boards_inspections">
export type AssetEventRow = Tables<"dasher_boards_asset_events">
export type AssetCheckRow = Tables<"dasher_boards_asset_checks">

export type RinkTemplate = "nhl_200x85" | "olympic_200x100" | "custom"
export const RINK_TEMPLATES: readonly RinkTemplate[] = [
  "nhl_200x85",
  "olympic_200x100",
  "custom",
] as const
export function isRinkTemplate(v: string): v is RinkTemplate {
  return (RINK_TEMPLATES as readonly string[]).includes(v)
}

export type PerimeterDirection = "clockwise" | "counterclockwise"
export function isPerimeterDirection(v: string): v is PerimeterDirection {
  return v === "clockwise" || v === "counterclockwise"
}

export type GlassMaterial = "tempered" | "acrylic" | "polycarbonate"
export const GLASS_MATERIALS: readonly GlassMaterial[] = [
  "tempered",
  "acrylic",
  "polycarbonate",
] as const
export function isGlassMaterial(v: string): v is GlassMaterial {
  return (GLASS_MATERIALS as readonly string[]).includes(v)
}

export type GlassSpecInput = {
  widthIn: number | null
  heightIn: number | null
  thicknessIn: number | null
  material: GlassMaterial | null
  notes: string | null
}

/**
 * The rink's glass numbering scheme as the editor submits it. The start point
 * travels separately (setGlassNumberAnchor) because it is set by clicking the
 * diagram, not by this form.
 */
export type GlassNumberingInput = {
  enabled: boolean
  prefix: string
  start: number
  direction: GlassNumberDirection
  includeDoors: boolean
}

export type Tab = "perimeter" | "checklist" | "lists" | "walks"
export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "perimeter", label: "Perimeter" },
  { key: "checklist", label: "Checklist" },
  { key: "lists", label: "Lists" },
  { key: "walks", label: "Walks" },
]
export function asTab(value: string | undefined): Tab {
  const allowed = TABS.map((t) => t.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as Tab)
    : "perimeter"
}

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }

// ---- Walks tab composites ----

export type EmployeeLite = {
  id: string
  first_name: string
  last_name: string
}

/** One row in the Walks list: an inspection plus resolved inspector + fail tally. */
export type WalkListItem = InspectionRow & {
  inspector: EmployeeLite | null
  failCount: number
  checkCount: number
}

/** One asset_checks row, joined against its asset and (optionally) who checked it. */
export type WalkAssetCheckItem = AssetCheckRow & {
  asset: Pick<AssetRow, "id" | "label" | "asset_type"> | null
  checkedBy: EmployeeLite | null
}

export type WalkDetailData = {
  inspection: InspectionRow
  inspector: EmployeeLite | null
  /** Fails sorted first, per the walk-review use case (what needs attention). */
  checks: WalkAssetCheckItem[]
  /** The rink's glass numbers, keyed by asset id. Empty = show labels. */
  glassNumbers: Record<string, string>
}
