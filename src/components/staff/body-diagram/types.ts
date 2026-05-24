/**
 * Canonical body part keys used by the SVG diagram. These match
 * `accident_dropdowns.key` for category 'body_part' (see migrations
 * 00000000000010_accident_reports_schema.sql and
 * 00000000000051_accident_witnesses_and_age.sql, which split head_neck into
 * head / face_jaw / neck and added shoulders).
 *
 * `head_neck` is retained for backwards compatibility with historical reports;
 * the staff submission form does not offer it. Read-only renderers should map
 * `head_neck` to both `head` and `neck` so older reports remain visible.
 */
export const BODY_PART_KEYS = [
  "feet",
  "ankles",
  "lower_legs",
  "knees",
  "upper_legs",
  "hips",
  "torso",
  "shoulders",
  "arms",
  "elbows",
  "wrists",
  "hands",
  "fingers",
  "neck",
  "face_jaw",
  "head",
  "head_neck",
] as const

export type BodyPartKey = (typeof BODY_PART_KEYS)[number]

export const LEGACY_BODY_PART_KEYS = ["head_neck"] as const
export type LegacyBodyPartKey = (typeof LEGACY_BODY_PART_KEYS)[number]

export function isLegacyBodyPartKey(key: BodyPartKey): key is LegacyBodyPartKey {
  return (LEGACY_BODY_PART_KEYS as readonly string[]).includes(key)
}

export type BodySide = "front" | "back" | "both" | "none"

export type BodyLaterality = "left" | "right" | "center"

/**
 * Body parts that exist as a left/right pair. Everything else is a single
 * midline ("center") region (head, face, neck, torso, hips, ...).
 */
export const BILATERAL_BODY_PART_KEYS: ReadonlySet<BodyPartKey> = new Set<BodyPartKey>([
  "shoulders",
  "arms",
  "elbows",
  "wrists",
  "hands",
  "fingers",
  "upper_legs",
  "knees",
  "lower_legs",
  "ankles",
  "feet",
])

export function isBilateral(key: BodyPartKey): boolean {
  return BILATERAL_BODY_PART_KEYS.has(key)
}

export function lateralitiesFor(key: BodyPartKey): BodyLaterality[] {
  return isBilateral(key) ? ["left", "right"] : ["center"]
}

export function isBodyLaterality(value: string): value is BodyLaterality {
  return value === "left" || value === "right" || value === "center"
}

/**
 * Selections are a sparse map keyed by `${BodyPartKey}|${BodyLaterality}`,
 * with the view side as the value. A missing key means "none".
 */
export type BodySelections = Record<string, BodySide>

export const EMPTY_BODY_SELECTIONS: BodySelections = {}

export function selectionKey(
  key: BodyPartKey,
  laterality: BodyLaterality
): string {
  return `${key}|${laterality}`
}

export function getSelectionSide(
  selections: BodySelections,
  key: BodyPartKey,
  laterality: BodyLaterality
): BodySide {
  return selections[selectionKey(key, laterality)] ?? "none"
}

export type ResolvedSelection = {
  key: BodyPartKey
  laterality: BodyLaterality
  side: BodySide
}

/** All non-"none" selections, in insertion order. */
export function listSelections(selections: BodySelections): ResolvedSelection[] {
  const out: ResolvedSelection[] = []
  for (const [composite, side] of Object.entries(selections)) {
    if (side === "none") continue
    const sep = composite.indexOf("|")
    if (sep < 0) continue
    const partKey = composite.slice(0, sep)
    const lat = composite.slice(sep + 1)
    if (!isBodyPartKey(partKey) || !isBodyLaterality(lat)) continue
    out.push({ key: partKey, laterality: lat, side })
  }
  return out
}

export const BODY_PART_LABELS: Record<BodyPartKey, string> = {
  feet: "Feet",
  ankles: "Ankles",
  lower_legs: "Lower Legs",
  knees: "Knees",
  upper_legs: "Upper Legs",
  hips: "Hips",
  torso: "Torso",
  shoulders: "Shoulders",
  arms: "Arms",
  elbows: "Elbows",
  wrists: "Wrists",
  hands: "Hands",
  fingers: "Fingers",
  neck: "Neck",
  face_jaw: "Face / Jaw",
  head: "Head",
  head_neck: "Head/Neck",
}

/** Singular forms used when a bilateral part is qualified with Left/Right. */
const BODY_PART_SINGULAR: Partial<Record<BodyPartKey, string>> = {
  shoulders: "Shoulder",
  arms: "Arm",
  elbows: "Elbow",
  wrists: "Wrist",
  hands: "Hand",
  upper_legs: "Upper Leg",
  knees: "Knee",
  lower_legs: "Lower Leg",
  ankles: "Ankle",
  feet: "Foot",
}

/** Human label for a (part, laterality) pair, e.g. "Left Arm" or "Torso". */
export function bodyPartLabel(
  key: BodyPartKey,
  laterality: BodyLaterality
): string {
  if (laterality === "center") return BODY_PART_LABELS[key]
  const base = BODY_PART_SINGULAR[key] ?? BODY_PART_LABELS[key]
  return `${laterality === "left" ? "Left" : "Right"} ${base}`
}

export function isBodyPartKey(value: string): value is BodyPartKey {
  return (BODY_PART_KEYS as readonly string[]).includes(value)
}

export function isBodySide(value: string): value is BodySide {
  return value === "front" || value === "back" || value === "both" || value === "none"
}

/**
 * Cycle behavior on tap:
 * - In the front view: none -> front, front -> none, back -> both, both -> back.
 * - In the back view : none -> back,  back  -> none, front -> both, both -> front.
 *
 * In other words, tapping toggles "this side is selected" without disturbing
 * the other side's selection.
 */
export function nextSide(current: BodySide, view: "front" | "back"): BodySide {
  const has = (s: BodySide, v: "front" | "back"): boolean =>
    s === v || s === "both"
  const otherView = view === "front" ? "back" : "front"
  const hasOther = has(current, otherView)
  const hasThis = has(current, view)
  const nextHasThis = !hasThis
  if (nextHasThis && hasOther) return "both"
  if (nextHasThis && !hasOther) return view
  if (!nextHasThis && hasOther) return otherView
  return "none"
}
