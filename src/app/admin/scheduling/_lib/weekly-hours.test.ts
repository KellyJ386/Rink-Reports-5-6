import { describe, expect, it } from "vitest"

import {
  roundHours,
  shiftDurationHours,
  tallyWeeklyHoursByEmployee,
  type TallyItem,
} from "./weekly-hours"

const H = 3_600_000

describe("shiftDurationHours", () => {
  it("subtracts the break from gross duration", () => {
    expect(shiftDurationHours(0, 8 * H, 30)).toBe(7.5)
    expect(shiftDurationHours(0, 8 * H, 0)).toBe(8)
  })
  it("never returns negative", () => {
    expect(shiftDurationHours(0, 10 * 60_000, 30)).toBe(0)
    expect(shiftDurationHours(5 * H, 0, 0)).toBe(0)
  })
})

describe("tallyWeeklyHoursByEmployee", () => {
  const weekStart = Date.UTC(2026, 5, 7) // Sun
  const weekEnd = Date.UTC(2026, 5, 14)

  const items: TallyItem[] = [
    { employeeId: "a", startMs: weekStart + 9 * H, endMs: weekStart + 17 * H, breakMinutes: 30 }, // 7.5
    { employeeId: "a", startMs: weekStart + 24 * H + 9 * H, endMs: weekStart + 24 * H + 13 * H, breakMinutes: 0 }, // 4
    { employeeId: "b", startMs: weekStart + 2 * H, endMs: weekStart + 6 * H, breakMinutes: 0 }, // 4
    { employeeId: null, startMs: weekStart + 1 * H, endMs: weekStart + 5 * H, breakMinutes: 0 }, // ignored (open)
    { employeeId: "a", startMs: weekEnd + 1 * H, endMs: weekEnd + 5 * H, breakMinutes: 0 }, // next week, excluded
    { employeeId: "a", startMs: weekStart - H, endMs: weekStart + H, breakMinutes: 0 }, // prev week, excluded
  ]

  it("sums net hours per employee within the week window", () => {
    const totals = tallyWeeklyHoursByEmployee(items, weekStart, weekEnd)
    expect(totals.get("a")).toBeCloseTo(11.5)
    expect(totals.get("b")).toBeCloseTo(4)
  })

  it("ignores unassigned shifts and out-of-window shifts", () => {
    const totals = tallyWeeklyHoursByEmployee(items, weekStart, weekEnd)
    expect(totals.has("")).toBe(false)
    expect([...totals.keys()].sort()).toEqual(["a", "b"])
  })
})

describe("roundHours", () => {
  it("rounds to one decimal", () => {
    expect(roundHours(37.46)).toBe(37.5)
    expect(roundHours(40)).toBe(40)
  })
})
