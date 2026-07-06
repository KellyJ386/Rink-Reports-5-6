import { describe, expect, it } from "vitest"

import {
  addDaysToKey,
  dayKeyInTz,
  dayPartsInTz,
  formatInTz,
  minutesOfDayInTz,
  utcToWallTime,
  wallTimeToUtc,
  weekdayOfKey,
  weekWindowInTz,
} from "./timezone"

describe("wallTimeToUtc", () => {
  it("converts a facility-local wall time to the correct UTC instant (EST)", () => {
    // 2026-01-15 09:00 in New York = 14:00 UTC (EST, -05:00)
    const d = wallTimeToUtc("2026-01-15T09:00", "America/New_York")
    expect(d?.toISOString()).toBe("2026-01-15T14:00:00.000Z")
  })

  it("converts during daylight saving time (EDT)", () => {
    // 2026-07-15 09:00 in New York = 13:00 UTC (EDT, -04:00)
    const d = wallTimeToUtc("2026-07-15T09:00", "America/New_York")
    expect(d?.toISOString()).toBe("2026-07-15T13:00:00.000Z")
  })

  it("handles zones east of UTC", () => {
    // 2026-01-15 09:00 in Helsinki = 07:00 UTC (+02:00)
    const d = wallTimeToUtc("2026-01-15T09:00", "Europe/Helsinki")
    expect(d?.toISOString()).toBe("2026-01-15T07:00:00.000Z")
  })

  it("accepts seconds and a space separator", () => {
    const d = wallTimeToUtc("2026-01-15 09:30:15", "UTC")
    expect(d?.toISOString()).toBe("2026-01-15T09:30:15.000Z")
  })

  it("treats UTC timezone as identity", () => {
    const d = wallTimeToUtc("2026-03-01T23:45", "UTC")
    expect(d?.toISOString()).toBe("2026-03-01T23:45:00.000Z")
  })

  it("converts correctly just after the spring-forward transition", () => {
    // US DST began 2026-03-08 02:00 local; 03:30 EDT = 07:30 UTC.
    const d = wallTimeToUtc("2026-03-08T03:30", "America/New_York")
    expect(d?.toISOString()).toBe("2026-03-08T07:30:00.000Z")
  })

  it("resolves a fall-back ambiguous time to a valid instant", () => {
    // US DST ended 2026-11-01 02:00 local; 01:30 occurs twice (05:30 or
    // 06:30 UTC). Either is acceptable; assert it's one of the two.
    const d = wallTimeToUtc("2026-11-01T01:30", "America/New_York")
    expect([
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]).toContain(d?.toISOString())
  })

  it("passes through strings that carry an explicit offset", () => {
    const d = wallTimeToUtc("2026-01-15T09:00:00-05:00", "Europe/Helsinki")
    expect(d?.toISOString()).toBe("2026-01-15T14:00:00.000Z")
  })

  it("returns null for garbage", () => {
    expect(wallTimeToUtc("not-a-date", "UTC")).toBeNull()
    expect(wallTimeToUtc("", "UTC")).toBeNull()
  })

  it("falls back to runtime-local parsing when timezone is null", () => {
    const d = wallTimeToUtc("2026-01-15T09:00", null)
    const local = new Date("2026-01-15T09:00")
    expect(d?.getTime()).toBe(local.getTime())
  })

  it("falls back gracefully for an unknown timezone id", () => {
    const d = wallTimeToUtc("2026-01-15T09:00", "Not/AZone")
    const local = new Date("2026-01-15T09:00")
    expect(d?.getTime()).toBe(local.getTime())
  })
})

describe("dayKeyInTz", () => {
  it("buckets a UTC instant onto the facility-local calendar day", () => {
    // 02:00 UTC on Jan 16 is still Jan 15 in New York (21:00 EST).
    expect(dayKeyInTz("2026-01-16T02:00:00.000Z", "America/New_York")).toBe(
      "2026-01-15"
    )
    expect(dayKeyInTz("2026-01-16T02:00:00.000Z", "UTC")).toBe("2026-01-16")
  })

  it("buckets across the eastern day boundary", () => {
    // 22:00 UTC on Jan 15 is already Jan 16 in Tokyo (+09:00).
    expect(dayKeyInTz("2026-01-15T22:00:00.000Z", "Asia/Tokyo")).toBe(
      "2026-01-16"
    )
  })
})

describe("dayPartsInTz", () => {
  it("returns the facility-local weekday and day-of-month", () => {
    // 2026-01-16T02:00Z = Thursday Jan 15 in New York.
    const p = dayPartsInTz("2026-01-16T02:00:00.000Z", "America/New_York")
    expect(p).toEqual({ dayOfWeek: 4, dayOfMonth: 15 })
    // Same instant in UTC is Friday Jan 16.
    const q = dayPartsInTz("2026-01-16T02:00:00.000Z", "UTC")
    expect(q).toEqual({ dayOfWeek: 5, dayOfMonth: 16 })
  })
})

describe("minutesOfDayInTz", () => {
  it("returns facility-local minutes since midnight", () => {
    // 2026-01-16T02:00Z = 21:00 (9pm) the previous day in New York.
    expect(minutesOfDayInTz("2026-01-16T02:00:00.000Z", "America/New_York")).toBe(
      21 * 60,
    )
    // Same instant is 02:00 in UTC.
    expect(minutesOfDayInTz("2026-01-16T02:00:00.000Z", "UTC")).toBe(2 * 60)
  })
  it("handles a half-hour and midnight cleanly", () => {
    expect(minutesOfDayInTz("2026-06-01T17:30:00.000Z", "UTC")).toBe(17 * 60 + 30)
    expect(minutesOfDayInTz("2026-06-01T00:00:00.000Z", "UTC")).toBe(0)
  })
})

describe("addDaysToKey", () => {
  it("does pure calendar math across month and year boundaries", () => {
    expect(addDaysToKey("2026-01-30", 3)).toBe("2026-02-02")
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28")
  })
})

describe("weekdayOfKey", () => {
  it("returns the calendar weekday of a key", () => {
    expect(weekdayOfKey("2026-07-02")).toBe(4) // Thursday
    expect(weekdayOfKey("2026-07-05")).toBe(0) // Sunday
    expect(weekdayOfKey("2026-07-06")).toBe(1) // Monday
  })
})

describe("weekWindowInTz", () => {
  it("computes a Sunday-start week from a key anchor", () => {
    // 2026-07-02 is a Thursday; the containing Sunday-start week is Jun 28 – Jul 4.
    const w = weekWindowInTz("2026-07-02", 0, "UTC")
    expect(w.startKey).toBe("2026-06-28")
    expect(w.dayKeys).toHaveLength(7)
    expect(w.dayKeys[6]).toBe("2026-07-04")
    expect(w.startUtc.toISOString()).toBe("2026-06-28T00:00:00.000Z")
    expect(w.endUtc.toISOString()).toBe("2026-07-05T00:00:00.000Z")
  })

  it("honors a Monday week start", () => {
    const w = weekWindowInTz("2026-07-02", 1, "UTC")
    expect(w.startKey).toBe("2026-06-29") // the preceding Monday
    expect(w.dayKeys[6]).toBe("2026-07-05")
  })

  it("anchors on an exact week-start date without backing up", () => {
    const w = weekWindowInTz("2026-07-06", 1, "UTC") // a Monday, Monday start
    expect(w.startKey).toBe("2026-07-06")
  })

  it("buckets a UTC instant onto the facility-local calendar first", () => {
    // 2026-07-05T02:00Z is still Saturday Jul 4 in Los Angeles (19:00 PDT),
    // so the Sunday-start week is Jun 28 — not Jul 5.
    const w = weekWindowInTz(
      new Date("2026-07-05T02:00:00.000Z"),
      0,
      "America/Los_Angeles"
    )
    expect(w.startKey).toBe("2026-06-28")
    // Facility-local midnight Jun 28 = 07:00 UTC (PDT, -07:00).
    expect(w.startUtc.toISOString()).toBe("2026-06-28T07:00:00.000Z")
    expect(w.endUtc.toISOString()).toBe("2026-07-05T07:00:00.000Z")
  })

  it("spans a DST transition with wall-clock midnights on both edges", () => {
    // US DST began 2026-03-08 02:00. Week of Mar 8 in New York:
    // start midnight is EST (-05:00), end midnight (Mar 15) is EDT (-04:00).
    const w = weekWindowInTz("2026-03-10", 0, "America/New_York")
    expect(w.startKey).toBe("2026-03-08")
    expect(w.startUtc.toISOString()).toBe("2026-03-08T05:00:00.000Z")
    expect(w.endUtc.toISOString()).toBe("2026-03-15T04:00:00.000Z")
  })

  it("falls back to runtime-local midnights when timezone is null", () => {
    const w = weekWindowInTz("2026-07-02", 0, null)
    expect(w.startKey).toBe("2026-06-28")
    const local = new Date("2026-06-28T00:00:00")
    expect(w.startUtc.getTime()).toBe(local.getTime())
  })

  it("normalizes an out-of-range weekStartDay", () => {
    const w = weekWindowInTz("2026-07-02", 8, "UTC") // 8 → 1 (Monday)
    expect(w.startKey).toBe("2026-06-29")
  })
})

describe("utcToWallTime", () => {
  it("renders the facility-local wall clock of a UTC instant", () => {
    expect(utcToWallTime("2026-01-15T18:00:00.000Z", "America/New_York")).toBe(
      "2026-01-15T13:00"
    )
    expect(utcToWallTime("2026-07-04T17:30:00.000Z", "America/Los_Angeles")).toBe(
      "2026-07-04T10:30"
    )
  })

  it("round-trips with wallTimeToUtc across DST regimes", () => {
    for (const wall of ["2026-01-10T09:15", "2026-07-10T21:45"]) {
      for (const tz of ["America/Denver", "Europe/Berlin", "UTC"]) {
        const instant = wallTimeToUtc(wall, tz)!
        expect(utcToWallTime(instant, tz)).toBe(wall)
      }
    }
  })

  it("falls back to the runtime-local zone when timezone is null", () => {
    const local = new Date(2026, 5, 8, 14, 30) // runtime-local Jun 8 14:30
    expect(utcToWallTime(local, null)).toBe("2026-06-08T14:30")
  })

  it("returns null for unparseable input", () => {
    expect(utcToWallTime("not-a-date", "UTC")).toBeNull()
  })
})

describe("formatInTz", () => {
  it("renders the facility wall-clock, not UTC", () => {
    expect(formatInTz("2026-01-15T20:00:00.000Z", "America/Chicago")).toBe(
      "Jan 15, 2026, 2:00 PM"
    )
    expect(formatInTz("2026-07-04T17:30:00.000Z", "America/Los_Angeles")).toBe(
      "Jul 4, 2026, 10:30 AM"
    )
  })

  it("honors custom Intl options", () => {
    expect(
      formatInTz("2026-01-15T20:00:00.000Z", "UTC", {
        hour: "numeric",
        minute: "2-digit",
      })
    ).toBe("8:00 PM")
  })

  it("falls back to the runtime zone for a null or invalid timezone", () => {
    const instant = new Date(Date.UTC(2026, 0, 15, 20, 0))
    const local = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(instant)
    expect(formatInTz(instant, null)).toBe(local)
    expect(formatInTz(instant, "Not/AZone")).toBe(local)
  })

  it("returns unparseable string input unchanged", () => {
    expect(formatInTz("not-a-date", "UTC")).toBe("not-a-date")
  })
})
