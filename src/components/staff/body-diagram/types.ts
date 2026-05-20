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

export type BodySelections = Record<BodyPartKey, BodySide>

export const EMPTY_BODY_SELECTIONS: BodySelections = {
  feet: "none",
  ankles: "none",
  lower_legs: "none",
  knees: "none",
  upper_legs: "none",
  hips: "none",
  torso: "none",
  shoulders: "none",
  arms: "none",
  elbows: "none",
  wrists: "none",
  hands: "none",
  fingers: "none",
  neck: "none",
  face_jaw: "none",
  head: "none",
  head_neck: "none",
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
