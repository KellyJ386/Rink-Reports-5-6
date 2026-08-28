// Pure, dependency-free display-label resolution and search matching for the
// custom segment-label layer (migration 259). No server-only imports — unit
// tested by vitest (display-label.test.ts) in a plain Node environment.
//
// Resolution order, everywhere a segment's name is printed:
//   1. custom_label        — the facility's own name ("Zam Gate Left")
//   2. glass scheme number — when numbering is on and the row is covered
//   3. label               — the permanent identity (B12/G12/D3)
// The permanent label is ALWAYS the identity history follows; surfaces that
// show both render "Zam Gate Left (B12)" so a row stays traceable at a
// glance (same convention as formatGlassLabelWithIdentity).

import {
  glassLabelOf,
  type GlassNumberLookup,
} from "./glass-numbering"

export type DisplayLabeledAsset = {
  id: string
  label: string
  asset_type: string
  custom_label: string | null
  aliases: string[]
}

export type SegmentLabelSource = "custom" | "glass_number" | "identity"

/**
 * What to print for one segment, and where it came from. Boards never take a
 * glass number (the numbers map is keyed by position id for the glass mounted
 * on them — same guard as formatAssetLabel), but a custom label wins on any
 * type.
 */
export function resolveSegmentLabel(
  asset: DisplayLabeledAsset,
  numbers?: GlassNumberLookup,
): { display: string; identity: string; source: SegmentLabelSource } {
  const custom = asset.custom_label?.trim()
  if (custom) {
    return { display: custom, identity: asset.label, source: "custom" }
  }
  if (asset.asset_type !== "board_panel") {
    const numbered = glassLabelOf(asset, numbers)
    if (numbered !== asset.label) {
      return { display: numbered, identity: asset.label, source: "glass_number" }
    }
  }
  return { display: asset.label, identity: asset.label, source: "identity" }
}

/** "Zam Gate Left (B12)" when the display diverges from identity. */
export function formatSegmentLabelWithIdentity(
  asset: DisplayLabeledAsset,
  numbers?: GlassNumberLookup,
): string {
  const { display, identity } = resolveSegmentLabel(asset, numbers)
  return display !== identity ? `${display} (${identity})` : display
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Case-insensitive substring match against everything a person might call
 * the segment: its custom label, permanent label, resolved glass number, and
 * every alias ("the Zam gate glass"). An empty/whitespace query matches
 * nothing — callers treat that as "no filter", not "highlight everything".
 */
export function segmentMatchesQuery(
  asset: DisplayLabeledAsset,
  query: string,
  numbers?: GlassNumberLookup,
): boolean {
  const q = normalize(query)
  if (q.length === 0) return false
  const { display } = resolveSegmentLabel(asset, numbers)
  if (normalize(display).includes(q)) return true
  if (normalize(asset.label).includes(q)) return true
  if (asset.custom_label && normalize(asset.custom_label).includes(q)) {
    return true
  }
  return asset.aliases.some((alias) => normalize(alias).includes(q))
}

/**
 * The ids to highlight on the diagram for a search query. Glass rows match on
 * behalf of their position: callers pass positioned assets WITH their glass
 * children so "the Zam gate glass" (an alias on the glass row) lights up the
 * position it rides.
 */
export function matchingSegmentIds(
  assets: readonly DisplayLabeledAsset[],
  query: string,
  numbers?: GlassNumberLookup,
): Set<string> {
  const ids = new Set<string>()
  if (normalize(query).length === 0) return ids
  for (const asset of assets) {
    if (segmentMatchesQuery(asset, query, numbers)) ids.add(asset.id)
  }
  return ids
}
