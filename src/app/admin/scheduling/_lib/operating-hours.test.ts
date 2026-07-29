import { describe, expect, it } from "vitest"

import {
  DEFAULT_OPERATING_HOURS,
  hhmmToMinutes,
  isOutsideOperatingHours,
  isValidHHMM,
  minutesToHhmm,
  resolveOperatingHours,
  timeOnDay,
} from "./operating-hours"

describe("isValidHHMM", () => {
  it("accepts valid 24h times", () => {
    expect(isValidHHMM("00:00")).toBe(true)
    expect(isValidHHMM("06:30")).toBe(true)
    expect(isValidHHMM("23:59")).toBe(true)
  })
  it("accepts 24:00 as the end-of-day sentinel", () => {
    // A rink open until midnight must be expressible; "23:59" is not midnight.
    expect(isValidHHMM("24:00")).toBe(true)
  })
  it("rejects malformed or out-of-range values", () => {
    expect(isValidHHMM("24:01")).toBe(false)
    expect(isValidHHMM("25:00")).toBe(false)
    expect(isValidHHMM("6:30")).toBe(false)
    expect(isValidHHMM("06:60")).toBe(false)
    expect(isValidHHMM("morning")).toBe(false)
    expect(isValidHHMM(630)).toBe(false)
    expect(isValidHHMM(null)).toBe(false)
  })
})

describe("hhmmToMinutes / minutesToHhmm", () => {
  it("converts to minutes since midnight", () => {
    expect(hhmmToMinutes("00:00")).toBe(0)
    expect(hhmmToMinutes("06:30")).toBe(390)
    expect(hhmmToMinutes("23:00")).toBe(1380)
    expect(hhmmToMinutes("24:00")).toBe(1440)
  })
  it("round-trips back to a wall-clock string", () => {
    for (const m of [0, 390, 1380, 1440]) {
      expect(hhmmToMinutes(minutesToHhmm(m))).toBe(m)
    }
    expect(minutesToHhmm(1440)).toBe("24:00")
    expect(minutesToHhmm(360)).toBe("06:00")
  })
  it("clamps out-of-range minutes", () => {
    expect(minutesToHhmm(-30)).toBe("00:00")
    expect(minutesToHhmm(9999)).toBe("24:00")
  })
})

describe("resolveOperatingHours", () => {
  it("reads the schedule_settings minute columns", () => {
    expect(
      resolveOperatingHours({
        operating_hours_start_minute: 300,
        operating_hours_end_minute: 1335,
      })
    ).toEqual({ start: "05:00", end: "22:15" })
  })

  it("supports a midnight close", () => {
    expect(
      resolveOperatingHours({
        operating_hours_start_minute: 360,
        operating_hours_end_minute: 1440,
      })
    ).toEqual({ start: "06:00", end: "24:00" })
  })

  it("prefers schedule_settings over the legacy facilities jsonb", () => {
    expect(
      resolveOperatingHours(
        {
          operating_hours_start_minute: 300,
          operating_hours_end_minute: 1320,
        },
        { scheduling: { operating_hours: { start: "08:00", end: "20:00" } } }
      )
    ).toEqual({ start: "05:00", end: "22:00" })
  })

  it("falls back to the legacy facilities jsonb when the columns are unset", () => {
    expect(
      resolveOperatingHours(null, {
        scheduling: { operating_hours: { start: "05:00", end: "22:15" } },
      })
    ).toEqual({ start: "05:00", end: "22:15" })
  })

  it("falls back to defaults when unset everywhere", () => {
    expect(resolveOperatingHours()).toEqual(DEFAULT_OPERATING_HOURS)
    expect(resolveOperatingHours(null, {})).toEqual(DEFAULT_OPERATING_HOURS)
    expect(resolveOperatingHours({}, { scheduling: {} })).toEqual(
      DEFAULT_OPERATING_HOURS
    )
  })

  it("falls back per-field when one legacy bound is malformed", () => {
    expect(
      resolveOperatingHours(null, {
        scheduling: { operating_hours: { start: "nope", end: "20:00" } },
      })
    ).toEqual({ start: DEFAULT_OPERATING_HOURS.start, end: "20:00" })
  })

  it("falls back wholesale on an inverted or zero-length window", () => {
    expect(
      resolveOperatingHours(null, {
        scheduling: { operating_hours: { start: "22:00", end: "06:00" } },
      })
    ).toEqual(DEFAULT_OPERATING_HOURS)
    expect(
      resolveOperatingHours(null, {
        scheduling: { operating_hours: { start: "09:00", end: "09:00" } },
      })
    ).toEqual(DEFAULT_OPERATING_HOURS)
    expect(
      resolveOperatingHours({
        operating_hours_start_minute: 1320,
        operating_hours_end_minute: 360,
      })
    ).toEqual(DEFAULT_OPERATING_HOURS)
  })

  it("ignores non-integer or out-of-range column values", () => {
    expect(
      resolveOperatingHours({
        operating_hours_start_minute: 12.5,
        operating_hours_end_minute: 1440,
      })
    ).toEqual(DEFAULT_OPERATING_HOURS)
    expect(
      resolveOperatingHours({
        operating_hours_start_minute: 360,
        operating_hours_end_minute: 2000,
      })
    ).toEqual(DEFAULT_OPERATING_HOURS)
  })
})

describe("timeOnDay", () => {
  it("positions the given time on the base day", () => {
    const base = new Date(2026, 5, 9, 13, 45, 30, 100) // local
    const d = timeOnDay(base, "06:00")
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5)
    expect(d.getDate()).toBe(9)
    expect(d.getHours()).toBe(6)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
    expect(d.getMilliseconds()).toBe(0)
  })
})

describe("isOutsideOperatingHours", () => {
  const hours = { start: "06:00", end: "23:00" }
  const check = (
    startMinute: number,
    endMinute: number,
    endDayOffset = 0,
    h = hours
  ) => isOutsideOperatingHours({ startMinute, endMinute, endDayOffset, hours: h })

  it("accepts a shift fully inside the window", () => {
    expect(check(9 * 60, 17 * 60)).toBe(false)
  })

  it("accepts a shift touching both bounds exactly", () => {
    expect(check(6 * 60, 23 * 60)).toBe(false)
  })

  it("flags a shift starting before open", () => {
    expect(check(5 * 60, 12 * 60)).toBe(true)
  })

  it("flags a shift ending after close", () => {
    expect(check(20 * 60, 23 * 60 + 30)).toBe(true)
  })

  it("flags an overnight shift as running past close, not as wrapping", () => {
    // 22:00 → 02:00 next day: 1560 absolute minutes vs a 1380 close.
    expect(check(22 * 60, 2 * 60, 1)).toBe(true)
  })

  it("allows a midnight close to accept a shift ending at midnight", () => {
    // The shift's end lands on the NEXT calendar day at minute 0, which on the
    // absolute axis is exactly 1440 — the 24:00 close.
    const open247 = { start: "06:00", end: "24:00" }
    expect(check(18 * 60, 0, 1, open247)).toBe(false)
    // …and the same shift is still flagged under a 23:00 close.
    expect(check(18 * 60, 0, 1)).toBe(true)
  })

  it("still flags a shift running past a midnight close", () => {
    const open247 = { start: "06:00", end: "24:00" }
    expect(check(22 * 60, 1 * 60, 1, open247)).toBe(true)
  })
})
