import { describe, expect, it } from "vitest"

import {
  combineAssetAndChildCheckStatus,
  combineDisplayCondition,
  computeDueItemIds,
  firstPendingIndex,
  guidedStepStatus,
  latestCheckStatus,
  nextLabel,
  summarizeGuidedWalk,
  thicknessToFraction,
  worstOpenSeverity,
  type AssetCheckStatus,
  type ChecklistItemLite,
  type GuidedStep,
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

describe("latestCheckStatus", () => {
  it("returns null with no checks", () => {
    expect(latestCheckStatus([])).toBeNull()
  })

  it("returns the only check's status", () => {
    expect(latestCheckStatus([{ status: "fail", effectiveAt: "2026-07-01T00:00:00Z" }])).toBe(
      "fail",
    )
  })

  it("picks the status with the max effectiveAt regardless of array order", () => {
    expect(
      latestCheckStatus([
        { status: "fail", effectiveAt: "2026-07-01T00:00:00Z" },
        { status: "pass", effectiveAt: "2026-07-02T00:00:00Z" },
      ]),
    ).toBe("pass")
    expect(
      latestCheckStatus([
        { status: "pass", effectiveAt: "2026-07-02T00:00:00Z" },
        { status: "fail", effectiveAt: "2026-07-01T00:00:00Z" },
      ]),
    ).toBe("pass")
  })

  it("a later Pass supersedes an earlier Fail from a different walk", () => {
    expect(
      latestCheckStatus([
        { status: "fail", effectiveAt: "2026-06-01T00:00:00Z" },
        { status: "pass", effectiveAt: "2026-07-20T00:00:00Z" },
      ]),
    ).toBe("pass")
  })
})

describe("combineAssetAndChildCheckStatus", () => {
  it("fail wins on either side, regardless of which is 'more recent'", () => {
    expect(combineAssetAndChildCheckStatus("fail", "pass")).toBe("fail")
    expect(combineAssetAndChildCheckStatus("pass", "fail")).toBe("fail")
    expect(combineAssetAndChildCheckStatus("fail", "fail")).toBe("fail")
    expect(combineAssetAndChildCheckStatus("fail", null)).toBe("fail")
    expect(combineAssetAndChildCheckStatus(null, "fail")).toBe("fail")
  })

  it("a later pass on the glass does not clear an unaddressed board fail", () => {
    // Board failed, then glass was separately checked and passed — the
    // board's own problem is still there. This is the exact case
    // `latestCheckStatus` would get wrong if the two histories were merged
    // and re-sorted by time instead of combined this way.
    expect(combineAssetAndChildCheckStatus("fail", "pass")).toBe("fail")
  })

  it("pass wins when neither side is failing", () => {
    expect(combineAssetAndChildCheckStatus("pass", "pass")).toBe("pass")
    expect(combineAssetAndChildCheckStatus("pass", null)).toBe("pass")
    expect(combineAssetAndChildCheckStatus(null, "pass")).toBe("pass")
  })

  it("null when neither side has ever been checked", () => {
    expect(combineAssetAndChildCheckStatus(null, null)).toBeNull()
  })
})

describe("combineDisplayCondition", () => {
  it("severity A always wins, even over a fail check", () => {
    expect(
      combineDisplayCondition({ worstOpenSeverity: "a", latestCheckStatus: "fail" }),
    ).toBe("alert")
    expect(
      combineDisplayCondition({ worstOpenSeverity: "a", latestCheckStatus: null }),
    ).toBe("alert")
  })

  it("severity B/C wins over a fail check", () => {
    expect(
      combineDisplayCondition({ worstOpenSeverity: "b", latestCheckStatus: "fail" }),
    ).toBe("warn")
    expect(
      combineDisplayCondition({ worstOpenSeverity: "c", latestCheckStatus: "fail" }),
    ).toBe("warn")
  })

  it("a bare fail with no open issue is flagged", () => {
    expect(
      combineDisplayCondition({ worstOpenSeverity: null, latestCheckStatus: "fail" }),
    ).toBe("flagged")
  })

  it("a pass with no open issue is clear", () => {
    expect(
      combineDisplayCondition({ worstOpenSeverity: null, latestCheckStatus: "pass" }),
    ).toBeNull()
  })

  it("nothing at all is clear", () => {
    expect(
      combineDisplayCondition({ worstOpenSeverity: null, latestCheckStatus: null }),
    ).toBeNull()
  })
})

describe("guidedStepStatus", () => {
  const board: GuidedStep = { id: "b1" }
  const boardWithGlass: GuidedStep = { id: "b2", glassChildId: "g2" }
  const none = new Set<string>()

  it("is pending when untouched and unvisited", () => {
    expect(guidedStepStatus(board, {}, none)).toBe("pending")
  })

  it("is implicit when visited without an explicit check", () => {
    expect(guidedStepStatus(board, {}, new Set(["b1"]))).toBe("implicit")
  })

  it("an explicit check always wins over visited", () => {
    expect(guidedStepStatus(board, { b1: "pass" }, new Set(["b1"]))).toBe("pass")
    expect(guidedStepStatus(board, { b1: "fail" }, new Set(["b1"]))).toBe("fail")
  })

  it("a glass-child fail makes the step fail, even with a board pass", () => {
    expect(
      guidedStepStatus(boardWithGlass, { b2: "pass", g2: "fail" }, none),
    ).toBe("fail")
  })

  it("a glass-child pass alone makes the step pass", () => {
    expect(guidedStepStatus(boardWithGlass, { g2: "pass" }, none)).toBe("pass")
  })

  it("visits on the glass child do not mark the step visited", () => {
    // Visited-ness is tracked by the positioned (board/door) id only.
    expect(guidedStepStatus(boardWithGlass, {}, new Set(["g2"]))).toBe("pending")
  })
})

describe("summarizeGuidedWalk", () => {
  const steps: GuidedStep[] = [
    { id: "b1" },
    { id: "b2", glassChildId: "g2" },
    { id: "b3" },
    { id: "d1" },
  ]

  it("everything untouched is an implicit pass", () => {
    expect(summarizeGuidedWalk(steps, {})).toEqual({
      explicitPass: 0,
      fail: 0,
      implicitPass: 4,
      total: 4,
    })
  })

  it("counts explicit passes, fails, and the untouched remainder", () => {
    const checks: Record<string, AssetCheckStatus> = {
      b1: "pass",
      b3: "fail",
    }
    expect(summarizeGuidedWalk(steps, checks)).toEqual({
      explicitPass: 1,
      fail: 1,
      implicitPass: 2,
      total: 4,
    })
  })

  it("a glass-child fail counts the whole step as fail (not pass)", () => {
    const checks: Record<string, AssetCheckStatus> = {
      b2: "pass",
      g2: "fail",
    }
    expect(summarizeGuidedWalk(steps, checks)).toEqual({
      explicitPass: 0,
      fail: 1,
      implicitPass: 3,
      total: 4,
    })
  })

  it("empty step list", () => {
    expect(summarizeGuidedWalk([], {})).toEqual({
      explicitPass: 0,
      fail: 0,
      implicitPass: 0,
      total: 0,
    })
  })
})

describe("firstPendingIndex", () => {
  const steps: GuidedStep[] = [
    { id: "b1" },
    { id: "b2", glassChildId: "g2" },
    { id: "b3" },
  ]

  it("starts at 0 on a fresh walk", () => {
    expect(firstPendingIndex(steps, {}, new Set())).toBe(0)
  })

  it("skips explicitly checked steps (including via the glass child)", () => {
    expect(firstPendingIndex(steps, { b1: "pass", g2: "fail" }, new Set())).toBe(2)
  })

  it("skips steps already advanced past this session", () => {
    expect(firstPendingIndex(steps, { b1: "pass" }, new Set(["b2"]))).toBe(2)
  })

  it("returns steps.length when nothing is pending", () => {
    expect(
      firstPendingIndex(steps, { b1: "pass", b3: "fail" }, new Set(["b2"])),
    ).toBe(3)
    expect(firstPendingIndex([], {}, new Set())).toBe(0)
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
