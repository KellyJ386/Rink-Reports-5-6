import { describe, expect, it } from "vitest"

import {
  computeDueItemIds,
  nextLabel,
  thicknessToFraction,
  worstOpenSeverity,
  type ChecklistItemLite,
} from "./compute"

describe("nextLabel", () => {
  it("starts at 1 on an empty rink", () => {
    expect(nextLabel("board_panel", [], [])).toBe("B1")
    expect(nextLabel("door", [], [])).toBe("D1")
  })

  it("allocates past the live high-water mark", () => {
    expect(nextLabel("board_panel", ["B1", "B2", "B40"], [])).toBe("B41")
  })

  it("never reuses retired labels (conversion keeps history)", () => {
    // B12 became D5: B12 is retired; a later board gets B41, not B12.
    expect(
      nextLabel("board_panel", ["B1", "B40", "D5"], ["B12"]),
    ).toBe("B41")
    // Retired label above the live max still bumps the counter.
    expect(nextLabel("door", ["D1"], ["D7"])).toBe("D8")
  })

  it("ignores labels of other types and non-numeric suffixes", () => {
    expect(nextLabel("glass_panel", ["B9", "G2", "G3X", "D4"], [])).toBe("G3")
  })
})

describe("worstOpenSeverity", () => {
  it("returns null for no open issues", () => {
    expect(worstOpenSeverity([])).toBeNull()
  })
  it("ranks a > b > c", () => {
    expect(worstOpenSeverity(["c", "b"])).toBe("b")
    expect(worstOpenSeverity(["b", "a", "c"])).toBe("a")
    expect(worstOpenSeverity(["c"])).toBe("c")
  })
})

describe("computeDueItemIds", () => {
  const items: ChecklistItemLite[] = [
    { id: "d1", cadence: "daily", due_month: null },
    { id: "w1", cadence: "weekly", due_month: null },
    { id: "m1", cadence: "monthly", due_month: null },
    { id: "y1", cadence: "yearly", due_month: 7 },
  ]

  const base = {
    items,
    todayKey: "2026-07-20", // a Monday
    todayWeekday: 1,
    inspectionWeekday: 1,
    completedWalkDayKeys: [] as string[],
    answeredItemIdsThisMonth: new Set<string>(),
  }

  it("daily items are always due", () => {
    const due = computeDueItemIds({ ...base, todayWeekday: 3 })
    expect(due.has("d1")).toBe(true)
  })

  it("weekly items are due only on the rink's inspection weekday", () => {
    expect(computeDueItemIds(base).has("w1")).toBe(true)
    expect(computeDueItemIds({ ...base, todayWeekday: 2 }).has("w1")).toBe(false)
    expect(
      computeDueItemIds({ ...base, inspectionWeekday: 4 }).has("w1"),
    ).toBe(false)
  })

  it("monthly items are due only on the month's first walk", () => {
    expect(computeDueItemIds(base).has("m1")).toBe(true)
    // A completed walk earlier this month clears the monthly due-ness...
    expect(
      computeDueItemIds({
        ...base,
        completedWalkDayKeys: ["2026-07-06"],
      }).has("m1"),
    ).toBe(false)
    // ...but a walk from LAST month does not (month boundary).
    expect(
      computeDueItemIds({
        ...base,
        completedWalkDayKeys: ["2026-06-29"],
      }).has("m1"),
    ).toBe(true)
  })

  it("yearly items are due only in their due_month and until answered", () => {
    expect(computeDueItemIds(base).has("y1")).toBe(true) // July, due_month 7
    expect(
      computeDueItemIds({ ...base, todayKey: "2026-08-03" }).has("y1"),
    ).toBe(false)
    expect(
      computeDueItemIds({
        ...base,
        answeredItemIdsThisMonth: new Set(["y1"]),
      }).has("y1"),
    ).toBe(false)
  })

  it("a skipped week keeps weekly items on the configured weekday only", () => {
    // Tuesday after a skipped Monday: weekly is NOT due (cadence is
    // weekday-anchored, not overdue-accumulating, per product decision 3).
    const due = computeDueItemIds({
      ...base,
      todayKey: "2026-07-21",
      todayWeekday: 2,
    })
    expect(due.has("w1")).toBe(false)
  })
})

describe("thicknessToFraction", () => {
  it("renders common glass thicknesses", () => {
    expect(thicknessToFraction(0.625)).toBe("5/8")
    expect(thicknessToFraction(0.5)).toBe("1/2")
    expect(thicknessToFraction(0.75)).toBe("3/4")
    expect(thicknessToFraction(0.1875)).toBe("3/16")
  })
  it("renders whole and mixed numbers", () => {
    expect(thicknessToFraction(1)).toBe("1")
    expect(thicknessToFraction(1.25)).toBe("1 1/4")
    expect(thicknessToFraction(0.9375)).toBe("15/16")
  })
  it("falls back to the decimal for off-grid values", () => {
    expect(thicknessToFraction(0.63)).toBe("5/8") // within 1/32 of 5/8
    expect(thicknessToFraction(0.6)).toBe("0.6") // not close to a 16th
  })
})
