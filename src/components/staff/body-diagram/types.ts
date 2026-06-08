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
 *
 * Regions split into two groups:
 *   - midline regions (head, face_jaw, neck, torso, hips, legacy head_neck)
 *     have only a front/back axis.
 *   - paired regions (arms, shoulders, legs, etc.) are independently
 *     selectable per laterality (left vs right) AND per view (front/back).
 */

export const MIDLINE_BODY_PART_KEYS = [
  "head",
  "face_jaw",
  "neck",
  "torso",
  "hips",
  "head_neck",
] as const

export const PAIRED_BODY_PART_KEYS = [
  "shoulders",
  // `arms` is retained for backwards compatibility with historical reports
  // (it used to cover the whole arm). New submissions split it into the
  // independently-selectable upper_arms / lower_arms, mirroring the
  // upper_legs / lower_legs pattern.
  "arms",
  "upper_arms",
  "lower_arms",
  "elbows",
  "wrists",
  "hands",
  "fingers",
  "upper_legs",
  "knees",
  "lower_legs",
  "ankles",
  "feet",
] as const

export type MidlineBodyPartKey = (typeof MIDLINE_BODY_PART_KEYS)[number]
export type PairedBodyPartKey = (typeof PAIRED_BODY_PART_KEYS)[number]
export type BodyPartKey = MidlineBodyPartKey | PairedBodyPartKey

// Order matters: drives the "Add by list" alternative + the selected-rows
// summary. Keep bottom-up for clinical scanning.
export const BODY_PART_KEYS: readonly BodyPartKey[] = [
  "feet",
  "ankles",
  "lower_legs",
  "knees",
  "upper_legs",
  "hips",
  "torso",
  "shoulders",
  "upper_arms",
  "lower_arms",
  "elbows",
  "wrists",
  "hands",
  "fingers",
  "neck",
  "face_jaw",
  "head",
  // Legacy keys: never offered to new submissions, kept so historical reports
  // still read/render.
  "arms",
  "head_neck",
]

export const LEGACY_BODY_PART_KEYS = ["arms", "head_neck"] as const
export type LegacyBodyPartKey = (typeof LEGACY_BODY_PART_KEYS)[number]

export function isLegacyBodyPartKey(key: BodyPartKey): key is LegacyBodyPartKey {
  return (LEGACY_BODY_PART_KEYS as readonly string[]).includes(key)
}

export function isPairedBodyPartKey(
  key: BodyPartKey
): key is PairedBodyPartKey {
  return (PAIRED_BODY_PART_KEYS as readonly string[]).includes(key)
}

export function isMidlineBodyPartKey(
  key: BodyPartKey
): key is MidlineBodyPartKey {
  return (MIDLINE_BODY_PART_KEYS as readonly string[]).includes(key)
}

// "side" describes which view(s) the injury appears on (the diagram has a
// Front View and a Back View). For paired regions this is held per laterality.
export type BodySide = "front" | "back" | "both" | "none"

export type Laterality = "left" | "right"

export type PairedSelection = { left: BodySide; right: BodySide }

export type RegionSelection = BodySide | PairedSelection

export type BodySelections = {
  head: BodySide
  face_jaw: BodySide
  neck: BodySide
  torso: BodySide
  hips: BodySide
  head_neck: BodySide
  shoulders: PairedSelection
  arms: PairedSelection
  upper_arms: PairedSelection
  lower_arms: PairedSelection
  elbows: PairedSelection
  wrists: PairedSelection
  hands: PairedSelection
  fingers: PairedSelection
  upper_legs: PairedSelection
  knees: PairedSelection
  lower_legs: PairedSelection
  ankles: PairedSelection
  feet: PairedSelection
}

export const EMPTY_PAIRED: PairedSelection = { left: "none", right: "none" }

export const EMPTY_BODY_SELECTIONS: BodySelections = {
  head: "none",
  face_jaw: "none",
  neck: "none",
  torso: "none",
  hips: "none",
  head_neck: "none",
  shoulders: { left: "none", right: "none" },
  arms: { left: "none", right: "none" },
  upper_arms: { left: "none", right: "none" },
  lower_arms: { left: "none", right: "none" },
  elbows: { left: "none", right: "none" },
  wrists: { left: "none", right: "none" },
  hands: { left: "none", right: "none" },
  fingers: { left: "none", right: "none" },
  upper_legs: { left: "none", right: "none" },
  knees: { left: "none", right: "none" },
  lower_legs: { left: "none", right: "none" },
  ankles: { left: "none", right: "none" },
  feet: { left: "none", right: "none" },
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
  upper_arms: "Upper Arms",
  lower_arms: "Lower Arms",
  elbows: "Elbows",
  wrists: "Wrists",
  hands: "Hands",
  fingers: "Fingers",
  neck: "Neck",
  face_jaw: "Face / Jaw",
  head: "Head",
  head_neck: "Head/Neck",
}

export function isBodyPartKey(value: string): value is BodyPartKey {
  return (
    (MIDLINE_BODY_PART_KEYS as readonly string[]).includes(value) ||
    (PAIRED_BODY_PART_KEYS as readonly string[]).includes(value)
  )
}

export function isBodySide(value: string): value is BodySide {
  return (
    value === "front" || value === "back" || value === "both" || value === "none"
  )
}

export function isLaterality(value: string): value is Laterality {
  return value === "left" || value === "right"
}

/**
 * Cycle behavior on tap for a single front/back axis:
 * - In the front view: none -> front, front -> none, back -> both, both -> back.
 * - In the back view : none -> back,  back  -> none, front -> both, both -> front.
 *
 * For paired regions, the diagram applies this independently to each
 * laterality (left vs right), so tapping the right arm never disturbs the
 * left arm's selection.
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

// Helpers used by readers/serializers.

export function pairedIsEmpty(p: PairedSelection): boolean {
  return p.left === "none" && p.right === "none"
}

export function regionHasSelection(
  key: BodyPartKey,
  value: RegionSelection
): boolean {
  if (isPairedBodyPartKey(key)) return !pairedIsEmpty(value as PairedSelection)
  return (value as BodySide) !== "none"
}
