import { describe, expect, it } from "vitest"

import {
  isValidCron,
  nextRunAfter,
  parseCron,
  wallPartsInTimeZone,
} from "./cron-schedule"

describe("parseCron", () => {
  it("rejects malformed expressions", () => {
    expect(parseCron("")).toBeNull()
    expect(parseCron("* * * *")).toBeNull() // 4 fields
    expect(parseCron("60 * * * *")).toBeNull() // minute out of range
    expect(parseCron("* 24 * * *")).toBeNull() // hour out of range
    expect(parseCron("a * * * *")).toBeNull()
    expect(parseCron("*/0 * * * *")).toBeNull() // zero step
  })

  it("parses *, lists, ranges, and steps", () => {
    const f = parseCron("0,30 9-17 * * 1-5")!
    expect([...f.minute].sort((a, b) => a - b)).toEqual([0, 30])
    expect([...f.hour].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(f.domRestricted).toBe(false)
    expect(f.dowRestricted).toBe(true)
    expect([...f.dow].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it("expands step ranges", () => {
    expect([...parseCron("*/15 * * * *")!.minute].sort((a, b) => a - b)).toEqual([
      0, 15, 30, 45,
    ])
  })

  it("treats 7 as Sunday", () => {
    expect(parseCron("0 0 * * 7")!.dow.has(0)).toBe(true)
  })
})

describe("isValidCron", () => {
  it("matches parseCron", () => {
    expect(isValidCron("0 9 * * 1")).toBe(true)
    expect(isValidCron("nonsense")).toBe(false)
  })
})

describe("wallPartsInTimeZone", () => {
  it("reflects the local wall clock", () => {
    // 2026-01-02T03:30Z is 2026-01-01 19:30 in US/Pacific (Thursday).
    const parts = wallPartsInTimeZone(
      new Date("2026-01-02T03:30:00Z"),
      "America/Los_Angeles",
    )
    expect(parts).toMatchObject({ minute: 30, hour: 19, dom: 1, month: 1, dow: 4 })
  })

  it("falls back to UTC for an invalid zone", () => {
    const parts = wallPartsInTimeZone(
      new Date("2026-06-21T12:34:00Z"),
      "Not/AZone",
    )
    expect(parts).toMatchObject({ minute: 34, hour: 12, month: 6, dom: 21 })
  })
})

describe("nextRunAfter", () => {
  it("finds the next daily 9am UTC run", () => {
    const next = nextRunAfter("0 9 * * *", new Date("2026-06-21T08:00:00Z"), "UTC")
    expect(next?.toISOString()).toBe("2026-06-21T09:00:00.000Z")
  })

  it("rolls to the next day when today's slot has passed", () => {
    const next = nextRunAfter("0 9 * * *", new Date("2026-06-21T10:00:00Z"), "UTC")
    expect(next?.toISOString()).toBe("2026-06-22T09:00:00.000Z")
  })

  it("is strictly after `from` (never returns the same minute)", () => {
    const next = nextRunAfter("0 9 * * *", new Date("2026-06-21T09:00:00Z"), "UTC")
    expect(next?.toISOString()).toBe("2026-06-22T09:00:00.000Z")
  })

  it("respects the timezone (9am Pacific, not UTC)", () => {
    // 09:00 America/Los_Angeles on 2026-06-21 (PDT, UTC-7) == 16:00Z.
    const next = nextRunAfter(
      "0 9 * * *",
      new Date("2026-06-21T00:00:00Z"),
      "America/Los_Angeles",
    )
    expect(next?.toISOString()).toBe("2026-06-21T16:00:00.000Z")
  })

  it("honors day-of-week (next Monday 08:00 UTC)", () => {
    // 2026-06-21 is a Sunday; next Monday is 2026-06-22.
    const next = nextRunAfter("0 8 * * 1", new Date("2026-06-21T12:00:00Z"), "UTC")
    expect(next?.toISOString()).toBe("2026-06-22T08:00:00.000Z")
  })

  it("returns null for a malformed expression", () => {
    expect(nextRunAfter("bad", new Date(), "UTC")).toBeNull()
  })
})
