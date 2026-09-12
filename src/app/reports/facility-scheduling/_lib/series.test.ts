import { describe, expect, it } from "vitest"

import {
  MAX_OCCURRENCES,
  applyResolution,
  describeRecurrence,
  generateOccurrences,
  type PlannedOccurrence,
  type RecurrenceSpec,
} from "./series"

const TZ = "America/New_York"

function spec(overrides: Partial<RecurrenceSpec> = {}): RecurrenceSpec {
  return {
    daysOfWeek: [2], // Tuesday
    startTime: "18:00",
    endTime: "20:00",
    seriesStartDate: "2026-09-01",
    seriesEndDate: "2026-09-29",
    intervalWeeks: 1,
    ...overrides,
  }
}

/** Facility-local hour of an instant, for asserting wall-clock stability. */
function localHour(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: TZ,
    }).format(new Date(iso)),
  )
}

describe("generateOccurrences", () => {
  it("expands a weekly pattern across the date range", () => {
    const r = generateOccurrences(spec(), TZ)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.occurrences.map((o) => o.dayKey)).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ])
  })

  it("handles several days per week", () => {
    const r = generateOccurrences(
      spec({ daysOfWeek: [1, 3], seriesEndDate: "2026-09-14" }),
      TZ,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.occurrences.map((o) => o.dayKey)).toEqual([
      "2026-09-02", // Wed
      "2026-09-07", // Mon
      "2026-09-09",
      "2026-09-14",
    ])
  })

  it("honours a fortnightly interval, anchored to the start week", () => {
    const r = generateOccurrences(spec({ intervalWeeks: 2 }), TZ)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.occurrences.map((o) => o.dayKey)).toEqual([
      "2026-09-01",
      "2026-09-15",
      "2026-09-29",
    ])
  })

  it("KEEPS THE WALL CLOCK across a DST change", () => {
    // US DST ends 2026-11-01. A 6pm contract must stay 6pm on both sides —
    // generating by adding 7*24h to the previous instant would slip to 5pm.
    const r = generateOccurrences(
      spec({ seriesStartDate: "2026-10-20", seriesEndDate: "2026-11-17" }),
      TZ,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.occurrences).toHaveLength(5)
    for (const o of r.occurrences) {
      expect(localHour(o.startsAt)).toBe(18)
    }
    // And the underlying UTC instants genuinely differ across the boundary,
    // proving the conversion actually happened rather than being a no-op.
    const utcHours = new Set(r.occurrences.map((o) => new Date(o.startsAt).getUTCHours()))
    expect(utcHours.size).toBe(2)
  })

  it("keeps the wall clock across the spring-forward change too", () => {
    // US DST begins 2027-03-14.
    const r = generateOccurrences(
      spec({ seriesStartDate: "2027-03-02", seriesEndDate: "2027-03-30" }),
      TZ,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const o of r.occurrences) expect(localHour(o.startsAt)).toBe(18)
  })

  it("supports a slot running past midnight", () => {
    const r = generateOccurrences(
      spec({ startTime: "22:00", endTime: "01:00", seriesEndDate: "2026-09-08" }),
      TZ,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.occurrences[0].crossesMidnight).toBe(true)
    const durationH =
      (new Date(r.occurrences[0].endsAt).getTime() -
        new Date(r.occurrences[0].startsAt).getTime()) /
      3_600_000
    expect(durationH).toBe(3)
  })

  it("includes an occurrence falling exactly on the end date", () => {
    const r = generateOccurrences(spec({ seriesEndDate: "2026-09-01" }), TZ)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.occurrences).toHaveLength(1)
  })

  it("rejects a pattern that produces nothing rather than silently creating an empty series", () => {
    // Fridays only, in a range containing no Friday.
    const r = generateOccurrences(
      spec({ daysOfWeek: [5], seriesStartDate: "2026-09-01", seriesEndDate: "2026-09-03" }),
      TZ,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/no dates/i)
  })

  it("rejects a backwards date range", () => {
    const r = generateOccurrences(
      spec({ seriesStartDate: "2026-09-29", seriesEndDate: "2026-09-01" }),
      TZ,
    )
    expect(r.ok).toBe(false)
  })

  it("rejects an empty day selection", () => {
    expect(generateOccurrences(spec({ daysOfWeek: [] }), TZ).ok).toBe(false)
  })

  it("rejects equal start and end times", () => {
    const r = generateOccurrences(spec({ startTime: "18:00", endTime: "18:00" }), TZ)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/same/i)
  })

  it("rejects a malformed time instead of generating garbage instants", () => {
    expect(generateOccurrences(spec({ startTime: "6pm" }), TZ).ok).toBe(false)
    expect(generateOccurrences(spec({ endTime: "25:00" }), TZ).ok).toBe(false)
  })

  it("rejects an out-of-range interval", () => {
    expect(generateOccurrences(spec({ intervalWeeks: 0 }), TZ).ok).toBe(false)
    expect(generateOccurrences(spec({ intervalWeeks: 99 }), TZ).ok).toBe(false)
  })

  it("refuses a range that would create an unreasonable number of bookings", () => {
    // Every day for three years is a typo, not a contract.
    const r = generateOccurrences(
      spec({
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        seriesStartDate: "2026-01-01",
        seriesEndDate: "2029-01-01",
      }),
      TZ,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain(String(MAX_OCCURRENCES))
  })
})

describe("applyResolution", () => {
  const base: PlannedOccurrence = {
    dayKey: "2026-09-01",
    startsAt: "2026-09-01T22:00:00.000Z",
    endsAt: "2026-09-02T00:00:00.000Z",
    crossesMidnight: false,
    resolution: { kind: "book" },
    conflict: false,
  }

  it("books an unmodified occurrence as-is", () => {
    expect(applyResolution(base)).toEqual({
      startsAt: base.startsAt,
      endsAt: base.endsAt,
    })
  })

  it("drops a skipped occurrence", () => {
    expect(applyResolution({ ...base, resolution: { kind: "skip" } })).toBeNull()
  })

  it("shifts both ends, preserving duration", () => {
    const shifted = applyResolution({
      ...base,
      resolution: { kind: "shift", minutes: 30 },
    })
    expect(shifted).not.toBeNull()
    const before =
      new Date(base.endsAt).getTime() - new Date(base.startsAt).getTime()
    const after =
      new Date(shifted!.endsAt).getTime() - new Date(shifted!.startsAt).getTime()
    expect(after).toBe(before)
    expect(new Date(shifted!.startsAt).toISOString()).toBe("2026-09-01T22:30:00.000Z")
  })

  it("shifts backwards for a negative offset", () => {
    const shifted = applyResolution({
      ...base,
      resolution: { kind: "shift", minutes: -60 },
    })
    expect(new Date(shifted!.startsAt).toISOString()).toBe("2026-09-01T21:00:00.000Z")
  })
})

describe("describeRecurrence", () => {
  it("reads as a sentence a rink manager would recognise", () => {
    expect(describeRecurrence(spec())).toBe(
      "Every week on Tue, 18:00–20:00, 2026-09-01 to 2026-09-29",
    )
    expect(describeRecurrence(spec({ intervalWeeks: 2, daysOfWeek: [1, 3] }))).toBe(
      "Every other week on Mon, Wed, 18:00–20:00, 2026-09-01 to 2026-09-29",
    )
  })
})
