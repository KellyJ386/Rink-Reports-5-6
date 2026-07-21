// Pure geometry for the Dasher Boards perimeter diagram. No React, no
// server-only imports — unit-tested by perimeter-geometry.test.ts.
//
// The boundary is the same rounded rectangle the Ice Depth diagram draws its
// ice surface with (viewBox 380×740; interior rect x 62.5–317.5, y 70–670,
// corner radius 84). This module is a SIBLING of ice-depth's rink-geometry —
// it deliberately does not import from or modify the ice-depth component tree,
// so that module's regression surface stays untouched.
//
// Parameterization: arc length s ∈ [0, PERIMETER_LENGTH) measured from the
// midpoint of the TOP edge (the diagram's zamboni end — sequence position 1
// starts at the rink's perimeter_anchor_label, which the facility names),
// walking CLOCKWISE in screen space. Counterclockwise rinks mirror s.

export const RINK_W = 380
export const RINK_H = 740

const X0 = 62.5
const X1 = 317.5
const Y0 = 70
const Y1 = 670
const R = 84

const W = X1 - X0 // 255
const H = Y1 - Y0 // 600
const STRAIGHT_X = W - 2 * R // 87  (horizontal straight run)
const STRAIGHT_Y = H - 2 * R // 432 (vertical straight run)
const ARC = (Math.PI / 2) * R // quarter-corner arc length

export const PERIMETER_LENGTH = 2 * STRAIGHT_X + 2 * STRAIGHT_Y + 4 * ARC

export type PerimeterPoint = { x: number; y: number }

/**
 * Point on the boundary at arc length `s` from the top-edge midpoint,
 * clockwise. `s` wraps modulo PERIMETER_LENGTH.
 */
export function perimeterPointAt(s: number): PerimeterPoint {
  let t = s % PERIMETER_LENGTH
  if (t < 0) t += PERIMETER_LENGTH

  const half = STRAIGHT_X / 2

  // 1. Top edge, midpoint → right straight end.
  if (t < half) return { x: X0 + R + half + t, y: Y0 }
  t -= half

  // 2. Top-right corner (center (X1-R, Y0+R)), -90° → 0°.
  if (t < ARC) {
    const a = -Math.PI / 2 + t / R
    return { x: X1 - R + R * Math.cos(a), y: Y0 + R + R * Math.sin(a) }
  }
  t -= ARC

  // 3. Right edge, downward.
  if (t < STRAIGHT_Y) return { x: X1, y: Y0 + R + t }
  t -= STRAIGHT_Y

  // 4. Bottom-right corner (center (X1-R, Y1-R)), 0° → 90°.
  if (t < ARC) {
    const a = t / R
    return { x: X1 - R + R * Math.cos(a), y: Y1 - R + R * Math.sin(a) }
  }
  t -= ARC

  // 5. Bottom edge, right → left.
  if (t < STRAIGHT_X) return { x: X1 - R - t, y: Y1 }
  t -= STRAIGHT_X

  // 6. Bottom-left corner (center (X0+R, Y1-R)), 90° → 180°.
  if (t < ARC) {
    const a = Math.PI / 2 + t / R
    return { x: X0 + R + R * Math.cos(a), y: Y1 - R + R * Math.sin(a) }
  }
  t -= ARC

  // 7. Left edge, upward.
  if (t < STRAIGHT_Y) return { x: X0, y: Y1 - R - t }
  t -= STRAIGHT_Y

  // 8. Top-left corner (center (X0+R, Y0+R)), 180° → 270°.
  if (t < ARC) {
    const a = Math.PI + t / R
    return { x: X0 + R + R * Math.cos(a), y: Y0 + R + R * Math.sin(a) }
  }
  t -= ARC

  // 9. Top edge, left straight start → midpoint.
  return { x: X0 + R + t, y: Y0 }
}

/**
 * Outward unit normal at arc length `s` (points away from the ice). Derived
 * from neighboring samples, so it is exact on straights and near-exact on
 * corners.
 */
export function perimeterNormalAt(s: number): PerimeterPoint {
  const eps = 0.5
  const a = perimeterPointAt(s - eps)
  const b = perimeterPointAt(s + eps)
  const tx = b.x - a.x
  const ty = b.y - a.y
  const len = Math.hypot(tx, ty) || 1
  // Clockwise walk in screen coords (y down): the ice is to the walker's
  // right, so the outward normal is the LEFT-hand normal (ty, -tx).
  return { x: ty / len, y: -tx / len }
}

export type PerimeterDirection = "clockwise" | "counterclockwise"

export type PositionedAssetLite = {
  id: string
  label: string
  asset_type: "board_panel" | "door"
}

export type PerimeterSegment = {
  assetId: string
  label: string
  assetType: "board_panel" | "door"
  /** SVG path along the boundary for this asset's span (with joint gaps). */
  pathD: string
  /** Same span offset a few units, for the glass layer overlay. */
  glassPathD: string
  /** Midpoint of the span, on the boundary. */
  mid: PerimeterPoint
  /** Label anchor, offset outward from the boundary. */
  labelAnchor: PerimeterPoint
  startS: number
  endS: number
}

const JOINT_GAP = 2 // arc-length gap at each joint so segments read as panels
const SAMPLE_STEP = 4 // boundary sampling resolution for path polylines
const LABEL_OFFSET = 13 // outward label distance
const GLASS_INSET = -7 // glass overlay sits just inside the boards

function spanPath(s0: number, s1: number, offset: number): string {
  const pts: string[] = []
  const n = Math.max(2, Math.ceil((s1 - s0) / SAMPLE_STEP))
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n
    const p = perimeterPointAt(s)
    if (offset !== 0) {
      const nrm = perimeterNormalAt(s)
      pts.push(`${(p.x + nrm.x * offset).toFixed(2)} ${(p.y + nrm.y * offset).toFixed(2)}`)
    } else {
      pts.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    }
  }
  return `M ${pts[0]} L ${pts.slice(1).join(" L ")}`
}

/**
 * Divides the boundary into equal arc-length spans — one per positioned asset,
 * in the given drawing order. Position 1 starts at the anchor (top-edge
 * midpoint); `counterclockwise` mirrors the walk.
 */
export function buildPerimeterSegments(
  assets: readonly PositionedAssetLite[],
  direction: PerimeterDirection = "clockwise",
): PerimeterSegment[] {
  const n = assets.length
  if (n === 0) return []
  const span = PERIMETER_LENGTH / n
  const sign = direction === "clockwise" ? 1 : -1

  return assets.map((asset, i) => {
    // Walk in the chosen direction; normalize so s0 < s1 for sampling.
    const rawStart = sign * span * i
    const rawEnd = sign * span * (i + 1)
    const s0 = Math.min(rawStart, rawEnd) + JOINT_GAP / 2
    const s1 = Math.max(rawStart, rawEnd) - JOINT_GAP / 2
    const midS = (s0 + s1) / 2
    const mid = perimeterPointAt(midS)
    const nrm = perimeterNormalAt(midS)
    return {
      assetId: asset.id,
      label: asset.label,
      assetType: asset.asset_type,
      pathD: spanPath(s0, s1, 0),
      glassPathD: spanPath(s0 + 1, s1 - 1, GLASS_INSET),
      mid,
      labelAnchor: { x: mid.x + nrm.x * LABEL_OFFSET, y: mid.y + nrm.y * LABEL_OFFSET },
      startS: s0,
      endS: s1,
    }
  })
}
