import { describe, expect, it } from "vitest"

import { formatDateKey, periodLabel } from "./period-label"

describe("formatDateKey", () => {
  it("formats a date key as itself regardless of options", () => {
    expect(formatDateKey("2026-08-20", { month: "short", day: "numeric" })).toBe("Aug 20")
  })
})

describe("periodLabel", () => {
  it("labels a day with its full weekday", () => {
    expect(periodLabel("day", "2026-08-20", "2026-08-20")).toBe("Thursday, August 20, 2026")
  })
  it("labels a week as a range", () => {
    expect(periodLabel("week", "2026-08-23", "2026-08-29")).toBe("Aug 23 – Aug 29, 2026")
  })
  it("labels a month by name and year", () => {
    expect(periodLabel("month", "2026-07-01", "2026-07-31")).toBe("July 2026")
  })
  it("labels a fiscal year as a short range", () => {
    expect(periodLabel("year", "2026-07-01", "2027-06-30")).toBe("Jul 2026 – Jun 2027")
  })
})
