import { describe, expect, it } from "vitest"

import {
  blockRect,
  buildCoverageGrid,
  clampHour,
  dateToDecimalHour,
  fmtHour,
  hoursToY,
  layoutOverlappingSpans,
  snapHour,
  yToHour,
} from "./grid-geometry"

describe("fmtHour", () => {
  it("formats whole hours with am/pm", () => {
    expect(fmtHour(6)).toBe("6a")
    expect(fmtHour(12)).toBe("12p")
    expect(fmtHour(13)).toBe("1p")
    expect(fmtHour(0)).toBe("12a")
  })
  it("formats half/quarter hours with minutes", () => {
    expect(fmtHour(14.5)).toBe("2:30p")
    expect(fmtHour(9.25)).toBe("9:15a")
  })
})

describe("snapHour", () => {
  it("snaps to the nearest 15 minutes by default", () => {
    expect(snapHour(9.1)).toBe(9)
    expect(snapHour(9.2)).toBe(9.25)
    expect(snapHour(9.37)).toBe(9.25)
    expect(snapHour(9.4)).toBe(9.5)
  })
  it("respects a custom step", () => {
    expect(snapHour(9.4, 1)).toBe(9)
    expect(snapHour(9.6, 1)).toBe(10)
  })
})

describe("clampHour", () => {
  it("clamps into range", () => {
    expect(clampHour(4, 6, 23)).toBe(6)
    expect(clampHour(25, 6, 23)).toBe(23)
    expect(clampHour(10, 6, 23)).toBe(10)
  })
})

describe("hoursToY / yToHour", () => {
  it("round-trips on grid boundaries", () => {
    const hourStart = 6
    const rowH = 30
    expect(hoursToY(6, hourStart, rowH)).toBe(0)
    expect(hoursToY(7, hourStart, rowH)).toBe(30)
    expect(yToHour(0, 6, 23, rowH)).toBe(6)
    expect(yToHour(30, 6, 23, rowH)).toBe(7)
  })
  it("snaps and clamps when converting y to hour", () => {
    // 7px into a 30px row ≈ 0.233h → snaps to 0.25h above hourStart
    expect(yToHour(7, 6, 23, 30)).toBe(6.25)
    // Way past the end clamps to hourEnd
    expect(yToHour(10000, 6, 23, 30)).toBe(23)
  })
})

describe("blockRect", () => {
  it("positions and sizes a block from decimal hours", () => {
    const { top, height } = blockRect(8, 12, 6, 30)
    expect(top).toBe((8 - 6) * 30 + 1)
    expect(height).toBe((12 - 8) * 30 - 2)
  })
  it("keeps a minimum height for tiny blocks", () => {
    const { height } = blockRect(8, 8.1, 6, 30)
    expect(height).toBe(30 * 0.5)
  })
})

describe("buildCoverageGrid", () => {
  it("counts concurrent spans per day/hour", () => {
    const grid = buildCoverageGrid(
      [
        { day: 0, s: 6, e: 8 },
        { day: 0, s: 7, e: 9 },
        { day: 1, s: 6, e: 7 },
      ],
      6,
      4, // hours 6,7,8,9
    )
    // Day 0: hour 6 → 1, hour 7 → 2, hour 8 → 1, hour 9 → 0
    expect(grid[0]).toEqual([1, 2, 1, 0])
    // Day 1: hour 6 → 1, rest 0
    expect(grid[1]).toEqual([1, 0, 0, 0])
    // Untouched day stays zeroed
    expect(grid[5]).toEqual([0, 0, 0, 0])
  })
  it("ignores out-of-range day indices", () => {
    const grid = buildCoverageGrid([{ day: 9, s: 6, e: 8 }], 6, 2)
    expect(grid.every((row) => row.every((c) => c === 0))).toBe(true)
  })
})

describe("layoutOverlappingSpans", () => {
  it("gives a lone span full width", () => {
    const slots = layoutOverlappingSpans([{ id: "a", s: 9, e: 17 }])
    expect(slots.get("a")).toEqual({ col: 0, cols: 1 })
  })

  it("splits two overlapping spans into two columns", () => {
    const slots = layoutOverlappingSpans([
      { id: "a", s: 9, e: 17 },
      { id: "b", s: 10, e: 14 },
    ])
    expect(slots.get("a")).toEqual({ col: 0, cols: 2 })
    expect(slots.get("b")).toEqual({ col: 1, cols: 2 })
  })

  it("splits three concurrent spans into three columns", () => {
    const slots = layoutOverlappingSpans([
      { id: "a", s: 8, e: 16 },
      { id: "b", s: 8, e: 16 },
      { id: "c", s: 9, e: 12 },
    ])
    const cols = ["a", "b", "c"].map((id) => slots.get(id)!)
    expect(cols.every((s) => s.cols === 3)).toBe(true)
    expect(new Set(cols.map((s) => s.col))).toEqual(new Set([0, 1, 2]))
  })

  it("does not treat spans that touch end-to-start as overlapping", () => {
    const slots = layoutOverlappingSpans([
      { id: "a", s: 6, e: 12 },
      { id: "b", s: 12, e: 18 },
    ])
    expect(slots.get("a")).toEqual({ col: 0, cols: 1 })
    expect(slots.get("b")).toEqual({ col: 0, cols: 1 })
  })

  it("keeps separate clusters independent within one day", () => {
    const slots = layoutOverlappingSpans([
      { id: "a", s: 6, e: 9 },
      { id: "b", s: 7, e: 10 },
      { id: "c", s: 14, e: 18 },
    ])
    expect(slots.get("a")!.cols).toBe(2)
    expect(slots.get("b")!.cols).toBe(2)
    // The afternoon shift never overlaps the morning pair → full width.
    expect(slots.get("c")).toEqual({ col: 0, cols: 1 })
  })

  it("reuses a freed column within a cluster (chain overlap)", () => {
    // a spans the whole cluster; b ends before c starts, so b and c share the
    // second column and the cluster is 2 wide, not 3.
    const slots = layoutOverlappingSpans([
      { id: "a", s: 8, e: 16 },
      { id: "b", s: 8, e: 10 },
      { id: "c", s: 11, e: 15 },
    ])
    expect(slots.get("a")).toEqual({ col: 0, cols: 2 })
    expect(slots.get("b")).toEqual({ col: 1, cols: 2 })
    expect(slots.get("c")).toEqual({ col: 1, cols: 2 })
  })

  it("handles an empty list", () => {
    expect(layoutOverlappingSpans([]).size).toBe(0)
  })
})

describe("dateToDecimalHour", () => {
  it("converts hours and minutes to a decimal hour", () => {
    const d = new Date(2026, 3, 21, 14, 30, 0)
    expect(dateToDecimalHour(d)).toBe(14.5)
  })
})
