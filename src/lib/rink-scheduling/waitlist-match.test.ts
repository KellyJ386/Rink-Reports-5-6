import { describe, expect, it } from "vitest"

import {
  countMatchedEntries,
  matchWaitlistEntries,
  type FreedSlot,
  type WaitlistEntryLike,
} from "./waitlist-match"

const FREED: FreedSlot = {
  dayKey: "2026-09-04",
  rinkId: "rink-a",
  startMinute: 18 * 60, // 6:00 PM
  endMinute: 19 * 60, // 7:00 PM
}

function entry(overrides: Partial<WaitlistEntryLike>): WaitlistEntryLike {
  return {
    id: "e1",
    desired_date: "2026-09-04",
    rink_id: null,
    start_minute: null,
    end_minute: null,
    ...overrides,
  }
}

describe("matchWaitlistEntries", () => {
  it("matches an any-time, any-rink entry for the same date", () => {
    expect(matchWaitlistEntries([entry({})], FREED)).toHaveLength(1)
  })

  it("rejects a different date", () => {
    expect(matchWaitlistEntries([entry({ desired_date: "2026-09-05" })], FREED)).toHaveLength(0)
  })

  it("honors a rink preference both ways", () => {
    expect(matchWaitlistEntries([entry({ rink_id: "rink-a" })], FREED)).toHaveLength(1)
    expect(matchWaitlistEntries([entry({ rink_id: "rink-b" })], FREED)).toHaveLength(0)
  })

  it("overlaps time windows half-open", () => {
    // Wants 5:00-6:00 PM; freed starts exactly at 6:00 PM — no overlap.
    expect(
      matchWaitlistEntries([entry({ start_minute: 17 * 60, end_minute: 18 * 60 })], FREED),
    ).toHaveLength(0)
    // Wants 6:30-8:00 PM — overlaps.
    expect(
      matchWaitlistEntries([entry({ start_minute: 18 * 60 + 30, end_minute: 20 * 60 })], FREED),
    ).toHaveLength(1)
  })

  it("handles a past-midnight entry window against an evening slot", () => {
    // Wants 11:00 PM to 1:00 AM (end_minute 1500) — no overlap with 6-7 PM.
    expect(
      matchWaitlistEntries([entry({ start_minute: 23 * 60, end_minute: 1500 })], FREED),
    ).toHaveLength(0)
  })
})

describe("countMatchedEntries", () => {
  it("counts each entry once across many freed slots", () => {
    const entries = [entry({ id: "a" }), entry({ id: "b", desired_date: "2026-09-11" })]
    const slots: FreedSlot[] = [
      FREED,
      { ...FREED, startMinute: 20 * 60, endMinute: 21 * 60 }, // same day, matches "a" again
      { ...FREED, dayKey: "2026-09-11" }, // matches "b"
    ]
    expect(countMatchedEntries(entries, slots)).toBe(2)
  })
})
