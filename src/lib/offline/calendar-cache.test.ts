import { describe, expect, it } from "vitest"

import {
  CACHE_AFTER_DAYS,
  CACHE_BEFORE_DAYS,
  CACHE_TTL_MS,
  bookingsForDayKey,
  bookingsInWindow,
  isFresh,
  type CachedBooking,
} from "./calendar-cache"

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0)

function booking(id: string, startsAt: string): CachedBooking {
  return {
    id,
    rinkId: "r1",
    rinkName: "Main Rink",
    rinkShortCode: "MAIN",
    typeName: "Ice Rental",
    typeColor: "#002244",
    customerName: "Chargers",
    title: null,
    startsAt,
    endsAt: startsAt,
    bufferMinutesAfter: 15,
    status: "confirmed",
    coverageStatus: "covered",
  }
}

describe("isFresh", () => {
  it("accepts a cache written just now", () => {
    expect(isFresh(new Date(NOW).toISOString(), NOW)).toBe(true)
  })

  it("accepts one just inside the TTL and rejects one just outside", () => {
    expect(isFresh(new Date(NOW - CACHE_TTL_MS + 1000).toISOString(), NOW)).toBe(true)
    expect(isFresh(new Date(NOW - CACHE_TTL_MS - 1000).toISOString(), NOW)).toBe(false)
  })

  it("keeps a cache stamped in the future rather than discarding it", () => {
    // A device whose clock jumped should degrade to showing data, not to
    // showing nothing.
    expect(isFresh(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true)
  })

  it("rejects an unparseable timestamp", () => {
    expect(isFresh("not-a-date", NOW)).toBe(false)
  })
})

describe("bookingsInWindow", () => {
  it("keeps bookings inside the rolling window", () => {
    const rows = [
      booking("in-past", new Date(NOW - 3 * 86_400_000).toISOString()),
      booking("in-future", new Date(NOW + 30 * 86_400_000).toISOString()),
    ]
    expect(bookingsInWindow(rows, NOW).map((b) => b.id)).toEqual([
      "in-past",
      "in-future",
    ])
  })

  it("drops anything outside it, so the cache cannot grow unbounded", () => {
    const rows = [
      booking("too-old", new Date(NOW - (CACHE_BEFORE_DAYS + 2) * 86_400_000).toISOString()),
      booking("too-far", new Date(NOW + (CACHE_AFTER_DAYS + 2) * 86_400_000).toISOString()),
      booking("keep", new Date(NOW).toISOString()),
    ]
    expect(bookingsInWindow(rows, NOW).map((b) => b.id)).toEqual(["keep"])
  })

  it("ignores rows with an unparseable start", () => {
    expect(bookingsInWindow([booking("bad", "nope")], NOW)).toEqual([])
  })
})

describe("bookingsForDayKey", () => {
  // Deliberately a facility-zone-aware stub: comparing ISO prefixes would use
  // UTC and drop evening bookings into the wrong day.
  const toDayKey = (iso: string) => {
    const d = new Date(iso)
    const local = new Date(d.getTime() - 4 * 3_600_000) // UTC-4
    return local.toISOString().slice(0, 10)
  }

  it("selects the right local day and sorts by start", () => {
    const rows = [
      booking("late", "2026-09-15T23:00:00.000Z"), // 19:00 local Sep 15
      booking("early", "2026-09-15T14:00:00.000Z"), // 10:00 local Sep 15
      booking("next-day", "2026-09-16T14:00:00.000Z"),
    ]
    expect(bookingsForDayKey(rows, "2026-09-15", toDayKey).map((b) => b.id)).toEqual([
      "early",
      "late",
    ])
  })

  it("attributes a late-evening booking to the local day, not the UTC one", () => {
    // 22:00 local Sep 15 is 02:00 UTC Sep 16 — a naive ISO prefix would file it
    // under the 16th.
    const rows = [booking("evening", "2026-09-16T02:00:00.000Z")]
    expect(bookingsForDayKey(rows, "2026-09-15", toDayKey).map((b) => b.id)).toEqual([
      "evening",
    ])
  })
})
