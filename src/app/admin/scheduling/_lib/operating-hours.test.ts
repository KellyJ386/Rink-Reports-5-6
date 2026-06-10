import { describe, expect, it } from "vitest"

import {
  DEFAULT_OPERATING_HOURS,
  hhmmToMinutes,
  isValidHHMM,
  resolveOperatingHours,
  timeOnDay,
} from "./operating-hours"

describe("isValidHHMM", () => {
  it("accepts valid 24h times", () => {
    expect(isValidHHMM("00:00")).toBe(true)
    expect(isValidHHMM("06:30")).toBe(true)
    expect(isValidHHMM("23:59")).toBe(true)
  })
  it("rejects malformed or out-of-range values", () => {
    expect(isValidHHMM("24:00")).toBe(false)
    expect(isValidHHMM("6:30")).toBe(false)
    expect(isValidHHMM("06:60")).toBe(false)
    expect(isValidHHMM("morning")).toBe(false)
    expect(isValidHHMM(630)).toBe(false)
    expect(isValidHHMM(null)).toBe(false)
  })
})

describe("hhmmToMinutes", () => {
  it("converts to minutes since midnight", () => {
    expect(hhmmToMinutes("00:00")).toBe(0)
    expect(hhmmToMinutes("06:30")).toBe(390)
    expect(hhmmToMinutes("23:00")).toBe(1380)
  })
})

describe("resolveOperatingHours", () => {
  it("reads configured hours from facility settings jsonb", () => {
    const settings = {
      scheduling: { operating_hours: { start: "05:00", end: "22:15" } },
    }
    expect(resolveOperatingHours(settings)).toEqual({
      start: "05:00",
      end: "22:15",
    })
  })

  it("falls back to defaults when unset", () => {
    expect(resolveOperatingHours({})).toEqual(DEFAULT_OPERATING_HOURS)
    expect(resolveOperatingHours(null)).toEqual(DEFAULT_OPERATING_HOURS)
    expect(resolveOperatingHours({ scheduling: {} })).toEqual(
      DEFAULT_OPERATING_HOURS
    )
  })

  it("falls back per-field when one bound is malformed", () => {
    const settings = {
      scheduling: { operating_hours: { start: "nope", end: "20:00" } },
    }
    expect(resolveOperatingHours(settings)).toEqual({
      start: DEFAULT_OPERATING_HOURS.start,
      end: "20:00",
    })
  })

  it("falls back wholesale on an inverted or zero-length window", () => {
    expect(
      resolveOperatingHours({
        scheduling: { operating_hours: { start: "22:00", end: "06:00" } },
      })
    ).toEqual(DEFAULT_OPERATING_HOURS)
    expect(
      resolveOperatingHours({
        scheduling: { operating_hours: { start: "09:00", end: "09:00" } },
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
