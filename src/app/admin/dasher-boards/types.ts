// Local types for the Dasher Boards admin module.
// Row types come from the generated Supabase types; composite shapes on top.

import type { Tables } from "@/types/database"

export type RinkRow = Tables<"dasher_boards_rinks">
export type AssetRow = Tables<"dasher_boards_assets">
export type SubtypeRow = Tables<"dasher_boards_asset_subtypes">
export type IssueCategoryRow = Tables<"dasher_boards_issue_categories">
export type ChecklistItemRow = Tables<"dasher_boards_checklist_items">
export type IssueRow = Tables<"dasher_boards_issues">
export type InspectionRow = Tables<"dasher_boards_inspections">
export type AssetEventRow = Tables<"dasher_boards_asset_events">

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

export type Tab = "perimeter" | "checklist" | "lists"
export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "perimeter", label: "Perimeter" },
  { key: "checklist", label: "Checklist" },
  { key: "lists", label: "Lists" },
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
