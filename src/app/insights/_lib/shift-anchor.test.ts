import { describe, expect, it } from "vitest"

import { shiftAnchor } from "./shift-anchor"

describe("shiftAnchor", () => {
  it("shifts a day by 1", () => {
    expect(shiftAnchor("2026-08-20", "day", 1)).toBe("2026-08-21")
    expect(shiftAnchor("2026-08-20", "day", -1)).toBe("2026-08-19")
  })

  it("crosses a month boundary for day", () => {
    expect(shiftAnchor("2026-08-31", "day", 1)).toBe("2026-09-01")
  })

  it("shifts a week by 7 days", () => {
    expect(shiftAnchor("2026-08-20", "week", 1)).toBe("2026-08-27")
    expect(shiftAnchor("2026-08-20", "week", -1)).toBe("2026-08-13")
  })

  it("shifts a month, clamping the day when the target month is shorter", () => {
    expect(shiftAnchor("2026-01-31", "month", 1)).toBe("2026-02-28")
    expect(shiftAnchor("2026-03-31", "month", -1)).toBe("2026-02-28")
  })

  it("crosses a year boundary for month", () => {
    expect(shiftAnchor("2026-12-15", "month", 1)).toBe("2027-01-15")
    expect(shiftAnchor("2026-01-15", "month", -1)).toBe("2025-12-15")
  })

  it("shifts a year by 12 calendar months", () => {
    expect(shiftAnchor("2026-08-20", "year", 1)).toBe("2027-08-20")
    expect(shiftAnchor("2026-08-20", "year", -1)).toBe("2025-08-20")
  })

  it("a 12-month year shift always lands in the adjacent fiscal year regardless of fiscal start month", () => {
    // Tennity's fiscal year starts July 1. An anchor near the START of one
    // fiscal year, shifted forward 12 months, must land in the NEXT fiscal
    // year (not the same one) -- exercised here as a date-arithmetic fact
    // independent of report_period_bounds itself.
    const anchor = "2026-07-05" // early in FY2026 (2026-07-01..2027-06-30)
    const next = shiftAnchor(anchor, "year", 1) // should be in FY2027
    expect(next).toBe("2027-07-05")
    const prev = shiftAnchor(anchor, "year", -1) // should be in FY2025
    expect(prev).toBe("2025-07-05")
  })
})
