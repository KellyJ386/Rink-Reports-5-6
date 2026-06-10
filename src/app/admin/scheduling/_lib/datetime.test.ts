import { describe, expect, it } from "vitest"

import {
  addDays,
  durationHours,
  formatDateLabel,
  parseISODate,
  startOfUtcDay,
  toISODate,
  weekEndExclusive,
  weekStartFor,
} from "./datetime"

// All assertions here are timezone-independent: the helpers do their math in
// UTC, so the suite must pass identically under any TZ environment variable.

describe("parseISODate", () => {
  it("parses YYYY-MM-DD as UTC midnight regardless of host timezone", () => {
    const d = parseISODate("2026-06-10")!
    expect(d.toISOString()).toBe("2026-06-10T00:00:00.000Z")
  })

  it("accepts full ISO timestamps", () => {
    const d = parseISODate("2026-06-10T15:30:00.000Z")!
    expect(d.toISOString()).toBe("2026-06-10T15:30:00.000Z")
  })

  it("returns null for empty, null, undefined, and garbage", () => {
    expect(parseISODate("")).toBeNull()
    expect(parseISODate(null)).toBeNull()
    expect(parseISODate(undefined)).toBeNull()
    expect(parseISODate("not-a-date")).toBeNull()
  })
})

describe("toISODate", () => {
  it("formats using the UTC calendar date", () => {
    expect(toISODate(new Date("2026-06-10T00:00:00.000Z"))).toBe("2026-06-10")
    // 23:59 UTC is still the same UTC day even where local time has rolled over.
    expect(toISODate(new Date("2026-06-10T23:59:59.000Z"))).toBe("2026-06-10")
  })

  it("round-trips with parseISODate", () => {
    for (const s of ["2026-01-01", "2028-02-29", "2026-12-31"]) {
      expect(toISODate(parseISODate(s)!)).toBe(s)
    }
  })

  it("zero-pads month and day", () => {
    expect(toISODate(new Date("2026-03-05T12:00:00.000Z"))).toBe("2026-03-05")
  })
})

describe("startOfUtcDay / addDays", () => {
  it("truncates to UTC midnight", () => {
    expect(
      startOfUtcDay(new Date("2026-06-10T18:45:12.345Z")).toISOString(),
    ).toBe("2026-06-10T00:00:00.000Z")
  })

  it("addDays is exact 24h arithmetic, stable across US DST boundaries", () => {
    // 2026-03-08 is the US spring-forward date; UTC day math must not drift.
    const beforeDst = parseISODate("2026-03-07")!
    expect(toISODate(addDays(beforeDst, 2))).toBe("2026-03-09")
    // Fall-back (2026-11-01) likewise.
    const beforeFallBack = parseISODate("2026-10-31")!
    expect(toISODate(addDays(beforeFallBack, 2))).toBe("2026-11-02")
    expect(toISODate(addDays(beforeDst, -7))).toBe("2026-02-28")
  })
})

describe("weekStartFor / weekEndExclusive", () => {
  // 2026-06-10 is a Wednesday (UTC).
  const wed = parseISODate("2026-06-10")!

  it("anchors to the requested week start day", () => {
    expect(toISODate(weekStartFor(wed, 0))).toBe("2026-06-07") // Sunday
    expect(toISODate(weekStartFor(wed, 1))).toBe("2026-06-08") // Monday
    expect(toISODate(weekStartFor(wed, 3))).toBe("2026-06-10") // Wednesday itself
    expect(toISODate(weekStartFor(wed, 4))).toBe("2026-06-04") // previous Thursday
    expect(toISODate(weekStartFor(wed, 6))).toBe("2026-06-06") // Saturday
  })

  it("normalizes out-of-range week start days (negative and >6)", () => {
    expect(toISODate(weekStartFor(wed, 7))).toBe(toISODate(weekStartFor(wed, 0)))
    expect(toISODate(weekStartFor(wed, -1))).toBe(toISODate(weekStartFor(wed, 6)))
  })

  it("returns UTC midnight even for a mid-day input", () => {
    const midDay = new Date("2026-06-10T17:00:00.000Z")
    expect(weekStartFor(midDay, 0).toISOString()).toBe(
      "2026-06-07T00:00:00.000Z",
    )
  })

  it("weekEndExclusive is exactly 7 days later", () => {
    const start = weekStartFor(wed, 0)
    expect(toISODate(weekEndExclusive(start))).toBe("2026-06-14")
  })

  it("handles weeks spanning a month/year boundary", () => {
    const newYearsDay = parseISODate("2026-01-01")! // Thursday
    expect(toISODate(weekStartFor(newYearsDay, 0))).toBe("2025-12-28")
  })
})

describe("formatDateLabel", () => {
  it("formats in UTC so the label matches the ISO date", () => {
    expect(formatDateLabel(parseISODate("2026-06-10")!)).toBe("Wed, Jun 10")
  })
})

describe("durationHours", () => {
  it("computes fractional hours from ISO timestamps", () => {
    expect(
      durationHours("2026-06-10T09:00:00.000Z", "2026-06-10T17:30:00.000Z"),
    ).toBe(8.5)
  })

  it("floors negative (inverted) ranges at 0", () => {
    expect(
      durationHours("2026-06-10T17:00:00.000Z", "2026-06-10T09:00:00.000Z"),
    ).toBe(0)
  })

  it("uses absolute time, not wall-clock time, across DST", () => {
    // Midnight→06:00 Eastern on spring-forward night is only 5 real hours.
    expect(
      durationHours("2026-03-08T00:00:00-05:00", "2026-03-08T06:00:00-04:00"),
    ).toBe(5)
  })
})
