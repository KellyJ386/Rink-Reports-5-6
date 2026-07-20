import { describe, expect, it } from "vitest"

import {
  expandRecurrenceDates,
  MAX_OCCURRENCES,
  MAX_RANGE_DAYS,
  validateRecurrenceSpec,
  type RecurrenceSpec,
} from "./recurrence"

// All fixture weekdays below were cross-checked against
// `new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()` (the same probe
// addDaysToKey/weekdayOfKey use) before being hand-written into the
// expected arrays.
//
// 2026-07-19 = Sunday (0)   2026-07-26 = Sunday (0)   2026-08-02 = Sunday (0)
// 2026-07-20 = Monday (1)   2026-07-23 = Thursday (4) 2026-07-27 = Monday (1)
// 2026-07-30 = Thursday (4) 2026-08-01 = Saturday (6) 2026-08-09 = Sunday (0)
// 2028-02-25 = Friday (5)   2028-02-29 = Tuesday (2)  2028-03-01 = Wednesday (3)
// 2028-03-02 = Thursday (4)
// 2025-12-25 = Thursday (4) 2026-01-01 = Thursday (4) 2026-01-08 = Thursday (4)

describe("expandRecurrenceDates", () => {
  it("excludes the anchor date even when its weekday is selected", () => {
    const spec: RecurrenceSpec = {
      anchorKey: "2026-07-19", // Sunday
      daysOfWeek: [0],
      untilKey: "2026-08-09", // Sunday, 3 weeks out
    }
    expect(expandRecurrenceDates(spec)).toEqual([
      "2026-07-26",
      "2026-08-02",
      "2026-08-09",
    ])
  })

  it("filters by weekday across a multi-week range", () => {
    const spec: RecurrenceSpec = {
      anchorKey: "2026-07-19", // Sunday
      daysOfWeek: [1, 4], // Monday, Thursday
      untilKey: "2026-08-01", // Saturday, 13 days out
    }
    expect(expandRecurrenceDates(spec)).toEqual([
      "2026-07-20",
      "2026-07-23",
      "2026-07-27",
      "2026-07-30",
    ])
  })

  it("includes untilKey when it lands on a selected weekday (inclusive)", () => {
    const spec: RecurrenceSpec = {
      anchorKey: "2026-07-19", // Sunday
      daysOfWeek: [0],
      untilKey: "2026-07-26", // the very next Sunday
    }
    expect(expandRecurrenceDates(spec)).toEqual(["2026-07-26"])
  })

  it("excludes the day after untilKey", () => {
    const spec: RecurrenceSpec = {
      anchorKey: "2026-07-19", // Sunday
      daysOfWeek: [0],
      untilKey: "2026-07-25", // the Saturday before that Sunday
    }
    expect(expandRecurrenceDates(spec)).toEqual([])
  })

  it("handles a month boundary and a Feb-29 leap day together", () => {
    const spec: RecurrenceSpec = {
      anchorKey: "2028-02-25", // Friday
      daysOfWeek: [2, 3], // Tuesday, Wednesday
      untilKey: "2028-03-02", // Thursday
    }
    expect(expandRecurrenceDates(spec)).toEqual([
      "2028-02-29",
      "2028-03-01",
    ])
  })

  it("handles a year boundary", () => {
    const spec: RecurrenceSpec = {
      anchorKey: "2025-12-25", // Thursday
      daysOfWeek: [4], // Thursday
      untilKey: "2026-01-08",
    }
    expect(expandRecurrenceDates(spec)).toEqual([
      "2026-01-01",
      "2026-01-08",
    ])
  })

  it("dedupes duplicate daysOfWeek entries instead of duplicating dates", () => {
    const withDupes = expandRecurrenceDates({
      anchorKey: "2026-07-19",
      daysOfWeek: [0, 0, 0],
      untilKey: "2026-08-09",
    })
    const deduped = expandRecurrenceDates({
      anchorKey: "2026-07-19",
      daysOfWeek: [0],
      untilKey: "2026-08-09",
    })
    expect(withDupes).toEqual(deduped)
  })

  it("returns dates in ascending order deterministically", () => {
    const spec: RecurrenceSpec = {
      anchorKey: "2026-07-19",
      daysOfWeek: [1, 4, 0],
      untilKey: "2026-08-09",
    }
    const first = expandRecurrenceDates(spec)
    const second = expandRecurrenceDates(spec)
    expect(first).toEqual(second)
    const sorted = [...first].sort()
    expect(first).toEqual(sorted)
  })

  it("is safe (returns []) when untilKey is at or before anchorKey", () => {
    expect(
      expandRecurrenceDates({
        anchorKey: "2026-07-19",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        untilKey: "2026-07-19",
      }),
    ).toEqual([])
    expect(
      expandRecurrenceDates({
        anchorKey: "2026-07-19",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        untilKey: "2026-07-01",
      }),
    ).toEqual([])
  })

  it("is safe (returns []) on malformed keys or an empty/invalid daysOfWeek", () => {
    expect(
      expandRecurrenceDates({
        anchorKey: "not-a-date",
        daysOfWeek: [0],
        untilKey: "2026-08-09",
      }),
    ).toEqual([])
    expect(
      expandRecurrenceDates({
        anchorKey: "2026-07-19",
        daysOfWeek: [],
        untilKey: "2026-08-09",
      }),
    ).toEqual([])
    expect(
      expandRecurrenceDates({
        anchorKey: "2026-07-19",
        daysOfWeek: [7, -1],
        untilKey: "2026-08-09",
      }),
    ).toEqual([])
  })

  it("produces exactly 84 dates when every weekday is selected over the max range", () => {
    const dates = expandRecurrenceDates({
      anchorKey: "2026-07-19",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      untilKey: "2026-10-11", // anchor + 84 days
    })
    expect(dates).toHaveLength(MAX_RANGE_DAYS)
  })
})

describe("validateRecurrenceSpec", () => {
  const base: RecurrenceSpec = {
    anchorKey: "2026-07-19",
    daysOfWeek: [0],
    untilKey: "2026-08-09",
  }

  it("accepts a well-formed spec", () => {
    expect(validateRecurrenceSpec(base)).toEqual({ ok: true })
  })

  it("accepts a range of exactly MAX_RANGE_DAYS", () => {
    const result = validateRecurrenceSpec({
      anchorKey: "2026-07-19",
      daysOfWeek: [0],
      untilKey: "2026-10-11", // anchor + 84 days
    })
    expect(result).toEqual({ ok: true })
  })

  it("rejects a range one day past MAX_RANGE_DAYS", () => {
    const result = validateRecurrenceSpec({
      anchorKey: "2026-07-19",
      daysOfWeek: [0],
      untilKey: "2026-10-12", // anchor + 85 days
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(new RegExp(`${MAX_RANGE_DAYS}`))
  })

  it("rejects an expansion exceeding MAX_OCCURRENCES (every day of week, full range)", () => {
    const result = validateRecurrenceSpec({
      anchorKey: "2026-07-19",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      untilKey: "2026-10-11", // anchor + 84 days -> 84 occurrences > 62
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(new RegExp(`${MAX_OCCURRENCES}`))
    }
  })

  it("rejects an empty daysOfWeek array", () => {
    const result = validateRecurrenceSpec({ ...base, daysOfWeek: [] })
    expect(result).toEqual({
      ok: false,
      error: "Select at least one day of the week.",
    })
  })

  it("rejects out-of-range weekday values", () => {
    for (const bad of [[7], [-1], [0, 8]]) {
      const result = validateRecurrenceSpec({ ...base, daysOfWeek: bad })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/0 \(Sunday\)/)
    }
  })

  it("rejects untilKey equal to anchorKey", () => {
    const result = validateRecurrenceSpec({
      ...base,
      untilKey: base.anchorKey,
    })
    expect(result).toEqual({
      ok: false,
      error: "End date must be after the anchor date.",
    })
  })

  it("rejects untilKey before anchorKey", () => {
    const result = validateRecurrenceSpec({
      ...base,
      untilKey: "2026-07-01",
    })
    expect(result).toEqual({
      ok: false,
      error: "End date must be after the anchor date.",
    })
  })

  it("rejects a malformed anchorKey (invalid calendar date)", () => {
    const result = validateRecurrenceSpec({ ...base, anchorKey: "2026-02-30" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/anchor date/i)
  })

  it("rejects a malformed untilKey (wrong format)", () => {
    const result = validateRecurrenceSpec({ ...base, untilKey: "2026-1-1" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/end date/i)
  })

  it("rejects garbage strings for either key", () => {
    expect(
      validateRecurrenceSpec({ ...base, anchorKey: "garbage" }).ok,
    ).toBe(false)
    expect(
      validateRecurrenceSpec({ ...base, untilKey: "garbage" }).ok,
    ).toBe(false)
  })

  it("treats duplicate daysOfWeek values as a single day (no occurrence inflation)", () => {
    const withDupes = validateRecurrenceSpec({
      ...base,
      daysOfWeek: [0, 0, 0, 0],
    })
    expect(withDupes).toEqual({ ok: true })
  })
})
