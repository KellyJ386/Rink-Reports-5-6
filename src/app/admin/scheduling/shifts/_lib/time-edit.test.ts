import { describe, expect, it } from "vitest"

import { isEndAfterStart, toTimeInput, withTime } from "./time-edit"

describe("toTimeInput", () => {
  it("formats a Date as zero-padded 24h HH:MM", () => {
    expect(toTimeInput(new Date(2026, 0, 5, 9, 30))).toBe("09:30")
    expect(toTimeInput(new Date(2026, 0, 5, 14, 5))).toBe("14:05")
    expect(toTimeInput(new Date(2026, 0, 5, 0, 0))).toBe("00:00")
  })
})

describe("withTime", () => {
  it("applies HH:MM while preserving the calendar date", () => {
    const base = new Date(2026, 2, 17, 8, 0, 0)
    const next = withTime(base, "13:45")
    expect(next.getFullYear()).toBe(2026)
    expect(next.getMonth()).toBe(2)
    expect(next.getDate()).toBe(17)
    expect(next.getHours()).toBe(13)
    expect(next.getMinutes()).toBe(45)
    expect(next.getSeconds()).toBe(0)
  })

  it("does not mutate the input Date", () => {
    const base = new Date(2026, 2, 17, 8, 0, 0)
    withTime(base, "13:45")
    expect(base.getHours()).toBe(8)
  })

  it("returns the date unchanged for malformed or out-of-range input", () => {
    const base = new Date(2026, 2, 17, 8, 15, 0)
    expect(toTimeInput(withTime(base, ""))).toBe("08:15")
    expect(toTimeInput(withTime(base, "9"))).toBe("08:15")
    expect(toTimeInput(withTime(base, "25:00"))).toBe("08:15")
    expect(toTimeInput(withTime(base, "10:75"))).toBe("08:15")
  })

  it("accepts both 1- and 2-digit hours", () => {
    const base = new Date(2026, 2, 17, 8, 0, 0)
    expect(toTimeInput(withTime(base, "7:05"))).toBe("07:05")
    expect(toTimeInput(withTime(base, "07:05"))).toBe("07:05")
  })
})

describe("isEndAfterStart", () => {
  const start = new Date(2026, 2, 17, 9, 0)
  it("is true when end is strictly after start", () => {
    expect(isEndAfterStart(start, new Date(2026, 2, 17, 9, 15))).toBe(true)
  })
  it("is false when end equals start", () => {
    expect(isEndAfterStart(start, new Date(2026, 2, 17, 9, 0))).toBe(false)
  })
  it("is false when end precedes start", () => {
    expect(isEndAfterStart(start, new Date(2026, 2, 17, 8, 45))).toBe(false)
  })
})
