import { describe, expect, it } from "vitest"

import { isCacheForToday } from "./daily-areas-cache"

// 2026-07-18T03:30:00Z. In UTC that's July 18; in America/Chicago (UTC-5,
// DST) it's still July 17 — the classic near-midnight divergence.
const NOW = new Date("2026-07-18T03:30:00Z")

describe("isCacheForToday", () => {
  it("matches a same-day snapshot in the facility timezone", () => {
    expect(
      isCacheForToday({ businessDate: "2026-07-17", timezone: "America/Chicago" }, NOW),
    ).toBe(true)
    expect(
      isCacheForToday({ businessDate: "2026-07-18", timezone: "UTC" }, NOW),
    ).toBe(true)
  })

  it("rejects a snapshot from a previous business date", () => {
    expect(
      isCacheForToday({ businessDate: "2026-07-17", timezone: "UTC" }, NOW),
    ).toBe(false)
    expect(
      isCacheForToday({ businessDate: "2026-07-16", timezone: "America/Chicago" }, NOW),
    ).toBe(false)
  })

  it("null timezone falls back to UTC", () => {
    expect(isCacheForToday({ businessDate: "2026-07-18", timezone: null }, NOW)).toBe(true)
    expect(isCacheForToday({ businessDate: "2026-07-17", timezone: null }, NOW)).toBe(false)
  })

  it("garbage timezone falls back to UTC instead of throwing", () => {
    expect(
      isCacheForToday({ businessDate: "2026-07-18", timezone: "Not/AZone" }, NOW),
    ).toBe(true)
  })
})
