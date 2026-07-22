import { describe, expect, it } from "vitest"

import {
  boundaryPathD,
  buildPerimeterSegments,
  nearestArcLength,
  PERIMETER_LENGTH,
  perimeterNormalAt,
  perimeterPointAt,
} from "./perimeter-geometry"

const X0 = 62.5
const X1 = 317.5
const Y0 = 70
const Y1 = 670

describe("perimeterPointAt", () => {
  it("total length matches the rounded-rect formula", () => {
    // 2*(255-168) + 2*(600-168) + 2π*84
    expect(PERIMETER_LENGTH).toBeCloseTo(2 * 87 + 2 * 432 + 2 * Math.PI * 84, 6)
  })

  it("starts at the top-edge midpoint and wraps", () => {
    expect(perimeterPointAt(0)).toEqual({ x: 190, y: Y0 })
    const wrapped = perimeterPointAt(PERIMETER_LENGTH)
    expect(wrapped.x).toBeCloseTo(190, 6)
    expect(wrapped.y).toBeCloseTo(Y0, 6)
  })

  it("hits the straight edges at known arc lengths", () => {
    // Half the top straight (43.5) + a quarter corner puts us on the right edge.
    const arc = (Math.PI / 2) * 84
    const p = perimeterPointAt(43.5 + arc + 10)
    expect(p.x).toBeCloseTo(X1, 6)
    expect(p.y).toBeCloseTo(Y0 + 84 + 10, 6)

    // Halfway around lands on the bottom edge (mirror of the start).
    const q = perimeterPointAt(PERIMETER_LENGTH / 2)
    expect(q.y).toBeCloseTo(Y1, 6)
    expect(q.x).toBeCloseTo(190, 6)
  })

  it("stays on or inside the bounding box everywhere", () => {
    for (let i = 0; i < 200; i++) {
      const p = perimeterPointAt((PERIMETER_LENGTH * i) / 200)
      expect(p.x).toBeGreaterThanOrEqual(X0 - 1e-6)
      expect(p.x).toBeLessThanOrEqual(X1 + 1e-6)
      expect(p.y).toBeGreaterThanOrEqual(Y0 - 1e-6)
      expect(p.y).toBeLessThanOrEqual(Y1 + 1e-6)
    }
  })

  it("outward normals point away from the rink center", () => {
    for (let i = 0; i < 50; i++) {
      const s = (PERIMETER_LENGTH * i) / 50
      const p = perimeterPointAt(s)
      const n = perimeterNormalAt(s)
      // Moving along the normal must increase distance from the center.
      const cx = 190
      const cy = 370
      const d0 = Math.hypot(p.x - cx, p.y - cy)
      const d1 = Math.hypot(p.x + n.x * 5 - cx, p.y + n.y * 5 - cy)
      expect(d1).toBeGreaterThan(d0)
    }
  })
})

describe("buildPerimeterSegments", () => {
  const assets = Array.from({ length: 20 }, (_, i) => ({
    id: `a${i + 1}`,
    label: `B${i + 1}`,
    asset_type: "board_panel" as const,
  }))

  it("returns one equal-length span per asset with joint gaps", () => {
    const segs = buildPerimeterSegments(assets, "clockwise")
    expect(segs).toHaveLength(20)
    const spans = segs.map((s) => s.endS - s.startS)
    for (const span of spans) {
      expect(span).toBeCloseTo(PERIMETER_LENGTH / 20 - 2, 6)
    }
    // No NaN anywhere in the generated paths.
    for (const s of segs) {
      expect(s.pathD).not.toContain("NaN")
      expect(s.glassPathD).not.toContain("NaN")
    }
  })

  it("clockwise position 1 starts at the anchor and moves +x along the top", () => {
    const segs = buildPerimeterSegments(assets, "clockwise")
    const first = segs[0]
    expect(first.startS).toBeCloseTo(1, 6) // half joint gap
    const start = perimeterPointAt(first.startS)
    expect(start.y).toBeCloseTo(Y0, 6)
    expect(start.x).toBeGreaterThan(190) // moving rightward from the midpoint
  })

  it("counterclockwise mirrors the walk from the same anchor", () => {
    const cw = buildPerimeterSegments(assets, "clockwise")
    const ccw = buildPerimeterSegments(assets, "counterclockwise")
    // First CCW segment sits on the opposite side of the anchor from CW.
    const cwMid = cw[0].mid
    const ccwMid = ccw[0].mid
    expect(cwMid.x).toBeGreaterThan(190)
    expect(ccwMid.x).toBeLessThan(190)
    expect(ccwMid.y).toBeCloseTo(Y0, 1)
  })

  it("labels ride outward of the boundary", () => {
    const segs = buildPerimeterSegments(assets, "clockwise")
    for (const s of segs) {
      const cx = 190
      const cy = 370
      const dMid = Math.hypot(s.mid.x - cx, s.mid.y - cy)
      const dLabel = Math.hypot(s.labelAnchor.x - cx, s.labelAnchor.y - cy)
      expect(dLabel).toBeGreaterThan(dMid)
    }
  })

  it("handles a single asset and empty input", () => {
    expect(buildPerimeterSegments([], "clockwise")).toEqual([])
    const one = buildPerimeterSegments(assets.slice(0, 1), "clockwise")
    expect(one).toHaveLength(1)
    expect(one[0].endS - one[0].startS).toBeCloseTo(PERIMETER_LENGTH - 2, 6)
  })

  it("anchorOffset rotates the ring without changing span sizes or order", () => {
    const base = buildPerimeterSegments(assets, "clockwise")
    const rotated = buildPerimeterSegments(assets, "clockwise", 100)
    expect(rotated.map((s) => s.label)).toEqual(base.map((s) => s.label))
    for (let i = 0; i < base.length; i++) {
      expect(rotated[i].endS - rotated[i].startS).toBeCloseTo(
        base[i].endS - base[i].startS,
        6,
      )
      // Every point on the rotated ring is the base ring shifted by exactly
      // the offset (mod the perimeter) — the rotation is rigid, not a
      // relabel or a resize. startS/endS are raw (unwrapped) arc lengths, so
      // compare the actual boundary points instead.
      const basePoint = perimeterPointAt(base[i].startS + 100)
      const rotatedPoint = perimeterPointAt(rotated[i].startS)
      expect(rotatedPoint.x).toBeCloseTo(basePoint.x, 6)
      expect(rotatedPoint.y).toBeCloseTo(basePoint.y, 6)
    }
  })

  it("a full-perimeter anchorOffset is equivalent to no offset (wraps)", () => {
    const base = buildPerimeterSegments(assets, "clockwise")
    const wrapped = buildPerimeterSegments(assets, "clockwise", PERIMETER_LENGTH)
    for (let i = 0; i < base.length; i++) {
      const basePoint = perimeterPointAt(base[i].startS)
      const wrappedPoint = perimeterPointAt(wrapped[i].startS)
      expect(wrappedPoint.x).toBeCloseTo(basePoint.x, 6)
      expect(wrappedPoint.y).toBeCloseTo(basePoint.y, 6)
    }
  })
})

describe("boundaryPathD", () => {
  it("returns a non-empty SVG path covering the whole loop", () => {
    const d = boundaryPathD()
    expect(d.startsWith("M ")).toBe(true)
    expect(d).toContain("L ")
  })
})

describe("nearestArcLength", () => {
  it("recovers the arc length of a point on the boundary", () => {
    for (const s of [0, 50, 300, 800, PERIMETER_LENGTH - 10]) {
      const p = perimeterPointAt(s)
      const found = nearestArcLength(p)
      // Sample resolution is 2 units, so recovery is exact to within that.
      const diff = Math.min(
        Math.abs(found - s),
        PERIMETER_LENGTH - Math.abs(found - s),
      )
      expect(diff).toBeLessThanOrEqual(2)
    }
  })

  it("finds the closest boundary point for an off-boundary click", () => {
    // A point well outside the ring, near the top edge — nearest s should
    // land near the top-edge midpoint (s=0), not on the opposite wall.
    const s = nearestArcLength({ x: 190, y: 20 })
    const dist = Math.min(s, PERIMETER_LENGTH - s)
    expect(dist).toBeLessThan(20)
  })
})
