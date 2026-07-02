import { describe, expect, it } from "vitest"

import { monthGridRange } from "./board-model"

describe("monthGridRange", () => {
  it("spans whole weeks around July 2026 with a Sunday start", () => {
    // July 2026: the 1st is a Wednesday, the 31st a Friday. Sunday-start grid
    // runs Jun 28 – Aug 1 (35 days, 5 rows).
    const r = monthGridRange(new Date(2026, 6, 15), 0)
    expect(r.start).toEqual(new Date(2026, 5, 28))
    expect(r.dayCount).toBe(35)
    expect(r.end).toEqual(new Date(2026, 7, 2))
  })

  it("honors a Monday week start", () => {
    // Monday-start grid for July 2026 runs Jun 29 – Aug 2 (35 days).
    const r = monthGridRange(new Date(2026, 6, 15), 1)
    expect(r.start).toEqual(new Date(2026, 5, 29))
    expect(r.dayCount).toBe(35)
  })

  it("produces a 6-row grid when the month needs one", () => {
    // August 2026: the 1st is a Saturday — Sunday-start grid needs 6 rows
    // (Jul 26 – Sep 5, 42 days).
    const r = monthGridRange(new Date(2026, 7, 10), 0)
    expect(r.start).toEqual(new Date(2026, 6, 26))
    expect(r.dayCount).toBe(42)
  })

  it("produces a 4-row grid for a perfectly aligned February", () => {
    // February 2026 has 28 days and starts on a Sunday — a Sunday-start grid
    // is exactly 4 rows with no leading/trailing days.
    const r = monthGridRange(new Date(2026, 1, 14), 0)
    expect(r.start).toEqual(new Date(2026, 1, 1))
    expect(r.dayCount).toBe(28)
  })
})
