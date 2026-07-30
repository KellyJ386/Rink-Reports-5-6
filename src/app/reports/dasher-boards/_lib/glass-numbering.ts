// Glass DISPLAY numbering for the Dasher Boards module. Pure and
// dependency-free (no server-only imports) so vitest can exercise it directly,
// same contract as compute.ts next door.
//
// Why this exists: `label` (G1..Gn) is permanent identity — issue history
// follows it and the retired-labels trigger stops it ever being reused, so it
// can't be bent to match the numbers painted on a rink's actual glass. This
// module resolves a per-rink SCHEME (start point, direction, first number,
// prefix) into the number the UI prints, leaving identity untouched.
//
// Numbering is POSITIONAL: it walks board positions in sequence order, so
// turning a position's glass off (no shielding) doesn't shift the panels after
// it — the position still exists, it just has no glass to label. A door
// carries its own glass, so by default a door consumes a number too.

export type GlassNumberDirection =
  | "follow_boards"
  | "clockwise"
  | "counterclockwise"

export type PerimeterWalkDirection = "clockwise" | "counterclockwise"

export type GlassNumberingScheme = {
  /** Off (the default) = print the permanent G-labels, exactly as before. */
  enabled: boolean
  prefix: string
  /** Number given to the first panel at the numbering start point. */
  start: number
  direction: GlassNumberDirection
  /** Fraction [0,1) of the boundary; null = reuse the board anchor. */
  anchorOffset: number | null
  includeDoors: boolean
}

export const DEFAULT_GLASS_NUMBERING: GlassNumberingScheme = {
  enabled: false,
  prefix: "G",
  start: 1,
  direction: "follow_boards",
  anchorOffset: null,
  includeDoors: true,
}

/** The subset of a positioned asset (board or door) numbering needs. */
export type NumberedPositionLite = {
  id: string
  asset_type: "board_panel" | "door"
  /** The position's glass child id, or null (doors carry their own glass). */
  glassAssetId: string | null
  /** Per-panel override, from the glass row (or the door row). */
  displayNumber: string | null
}

/** The asset columns numbering needs, from any `dasher_boards_assets` row. */
export type NumberedAssetRow = {
  id: string
  asset_type: string
  is_active: boolean
  sequence_position: number | null
  parent_board_id: string | null
  display_number: string | null
}

/**
 * Builds the numbering walk from a rink's raw asset rows: active positions in
 * sequence order, each carrying its glass child's id and whichever row holds
 * the override. Shared by every caller so the walk is defined once — the staff
 * diagram, the admin editor, and the walk PDF must agree exactly.
 */
export function positionsFromAssets(
  assets: readonly NumberedAssetRow[],
): NumberedPositionLite[] {
  const glassByParent = new Map<string, NumberedAssetRow>()
  for (const a of assets) {
    if (a.asset_type === "glass_panel" && a.parent_board_id) {
      glassByParent.set(a.parent_board_id, a)
    }
  }

  return assets
    .filter(
      (a) =>
        (a.asset_type === "board_panel" || a.asset_type === "door") &&
        a.is_active &&
        a.sequence_position !== null,
    )
    .sort((a, b) => a.sequence_position! - b.sequence_position!)
    .map((a) => {
      const glass = glassByParent.get(a.id) ?? null
      return {
        id: a.id,
        asset_type: a.asset_type as "board_panel" | "door",
        glassAssetId: glass?.id ?? null,
        // A door carries its own glass, so its override lives on the door row;
        // a board's lives on the glass child.
        displayNumber:
          a.asset_type === "door"
            ? a.display_number
            : (glass?.display_number ?? null),
      }
    })
}

export const GLASS_NUMBER_PREFIX_RE = /^[A-Za-z0-9-]{0,8}$/
export const GLASS_DISPLAY_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,15}$/
export const GLASS_NUMBER_START_MIN = 0
export const GLASS_NUMBER_START_MAX = 9999

export function isGlassNumberDirection(v: string): v is GlassNumberDirection {
  return (
    v === "follow_boards" || v === "clockwise" || v === "counterclockwise"
  )
}

/**
 * Reads the scheme off a rink row. Kept here (rather than inline at each call
 * site) so the DB column names appear exactly once outside the SQL.
 */
export function schemeFromRink(rink: {
  glass_numbering_enabled: boolean
  glass_number_prefix: string
  glass_number_start: number
  glass_number_direction: string
  glass_number_anchor_offset: number | null
  glass_number_include_doors: boolean
}): GlassNumberingScheme {
  return {
    enabled: rink.glass_numbering_enabled,
    prefix: rink.glass_number_prefix,
    start: rink.glass_number_start,
    direction: isGlassNumberDirection(rink.glass_number_direction)
      ? rink.glass_number_direction
      : "follow_boards",
    anchorOffset: rink.glass_number_anchor_offset,
    includeDoors: rink.glass_number_include_doors,
  }
}

/**
 * How far into the ordered ring the numbering starts, as an INDEX into
 * `positioned`. The scheme's anchor is an arc-length fraction on the boundary,
 * and the ring is drawn as equal spans from the board anchor, so the panel
 * covering the glass anchor is just the span that fraction falls into.
 *
 * Returns 0 when the two anchors coincide (the default) — the common case
 * where glass numbering simply starts at sequence position 1.
 */
export function numberingStartIndex(
  count: number,
  scheme: Pick<GlassNumberingScheme, "anchorOffset">,
  boardDirection: PerimeterWalkDirection,
  boardAnchorOffset: number,
): number {
  if (count <= 0) return 0
  if (scheme.anchorOffset === null) return 0

  // Distance from the board anchor to the glass anchor, walked in the
  // direction the ring is drawn, normalized to [0, 1).
  const sign = boardDirection === "clockwise" ? 1 : -1
  const delta = (scheme.anchorOffset - boardAnchorOffset) * sign
  const wrapped = ((delta % 1) + 1) % 1
  return Math.floor(wrapped * count) % count
}

/**
 * Resolves each position's glass number.
 *
 * Returns a map keyed by BOTH the position's own asset id and its glass child
 * id, so a caller holding either row can look the number up without knowing
 * which is which. Positions excluded from numbering (doors, when
 * `includeDoors` is false) are absent from the map.
 *
 * Disabled schemes return an empty map — callers fall back to `label`, which
 * is what every surface printed before this feature existed.
 */
export function computeGlassNumbers(
  positioned: readonly NumberedPositionLite[],
  scheme: GlassNumberingScheme,
  boardDirection: PerimeterWalkDirection,
  boardAnchorOffset: number,
): Map<string, string> {
  const numbers = new Map<string, string>()
  if (!scheme.enabled || positioned.length === 0) return numbers

  const walkForward =
    scheme.direction === "follow_boards"
      ? true
      : scheme.direction === boardDirection

  const startIndex = numberingStartIndex(
    positioned.length,
    scheme,
    boardDirection,
    boardAnchorOffset,
  )

  // Walk the ring from the start index, in the scheme's direction, wrapping
  // once. Only counted positions advance the running number, so excluding
  // doors closes the gap rather than leaving a hole in the sequence.
  let next = scheme.start
  for (let step = 0; step < positioned.length; step++) {
    const offset = walkForward ? step : -step
    const index =
      ((startIndex + offset) % positioned.length + positioned.length) %
      positioned.length
    const position = positioned[index]

    if (position.asset_type === "door" && !scheme.includeDoors) continue

    const value = position.displayNumber ?? `${scheme.prefix}${next}`
    numbers.set(position.id, value)
    if (position.glassAssetId) numbers.set(position.glassAssetId, value)
    next += 1
  }

  return numbers
}

/**
 * Number lookups cross a server/client boundary as plain objects and stay Maps
 * inside the editor, so every consumer-facing helper below takes either.
 */
export type GlassNumberLookup =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>

function lookup(
  numbers: GlassNumberLookup | undefined,
  id: string,
): string | undefined {
  if (!numbers) return undefined
  return numbers instanceof Map
    ? numbers.get(id)
    : (numbers as Readonly<Record<string, string>>)[id]
}

/**
 * The short form for tight surfaces (sheet buttons, chips): the rink's number
 * when it has one, otherwise the permanent label.
 */
export function glassLabelOf(
  asset: { id: string; label: string },
  numbers?: GlassNumberLookup,
): string {
  return lookup(numbers, asset.id) ?? asset.label
}

/**
 * What to print for one asset: the scheme number when numbering is on and this
 * asset is covered by it, otherwise the permanent label.
 *
 * `identity` is always the label — surfaces that show both (the admin panel,
 * the walk PDF) render "#12 (G12)" so the row is still traceable to its
 * history at a glance.
 */
export function resolveGlassLabel(
  asset: { id: string; label: string },
  numbers: GlassNumberLookup,
): { display: string; identity: string; isNumbered: boolean } {
  const number = lookup(numbers, asset.id)
  return {
    display: number ?? asset.label,
    identity: asset.label,
    isNumbered: number !== undefined,
  }
}

/** "#12 (G12)" when numbered, plain "G12" otherwise. */
export function formatGlassLabelWithIdentity(
  asset: { id: string; label: string },
  numbers: GlassNumberLookup,
): string {
  const { display, identity, isNumbered } = resolveGlassLabel(asset, numbers)
  return isNumbered && display !== identity
    ? `${display} (${identity})`
    : display
}

/**
 * How any asset reads on a mixed list (walk checks, printed issues).
 *
 * Only GLASS-bearing rows carry a glass number: the glass panel itself, and a
 * door (which carries its own glass). A board panel always prints its own
 * label — the numbers map is keyed by position id as well as glass id, so
 * without this guard a board would print the number belonging to the glass
 * mounted on it.
 */
export function formatAssetLabel(
  asset: { id: string; label: string; asset_type: string },
  numbers: GlassNumberLookup,
): string {
  if (asset.asset_type === "board_panel") return asset.label
  return formatGlassLabelWithIdentity(asset, numbers)
}

/**
 * Preview strip for the admin editor: the first few numbers, an ellipsis, and
 * the last — so an admin sees the effect of a scheme change before saving it.
 */
export function previewGlassNumbers(
  positioned: readonly NumberedPositionLite[],
  scheme: GlassNumberingScheme,
  boardDirection: PerimeterWalkDirection,
  boardAnchorOffset: number,
  sampleSize = 3,
): string[] {
  const counted = positioned.filter(
    (p) => scheme.includeDoors || p.asset_type !== "door",
  )
  if (counted.length === 0) return []

  const numbers = computeGlassNumbers(
    positioned,
    { ...scheme, enabled: true },
    boardDirection,
    boardAnchorOffset,
  )
  const startIndex = numberingStartIndex(
    positioned.length,
    scheme,
    boardDirection,
    boardAnchorOffset,
  )
  const walkForward =
    scheme.direction === "follow_boards"
      ? true
      : scheme.direction === boardDirection

  // Re-walk in the same order the numbers were assigned, so the preview reads
  // in numbering order rather than sequence order.
  const ordered: string[] = []
  for (let step = 0; step < positioned.length; step++) {
    const offset = walkForward ? step : -step
    const index =
      ((startIndex + offset) % positioned.length + positioned.length) %
      positioned.length
    const value = numbers.get(positioned[index].id)
    if (value !== undefined) ordered.push(value)
  }

  if (ordered.length <= sampleSize + 1) return ordered
  return [...ordered.slice(0, sampleSize), "…", ordered[ordered.length - 1]]
}
