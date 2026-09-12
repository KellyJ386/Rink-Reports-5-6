import { describe, expect, it } from "vitest"

import {
  describeCoverage,
  evaluateCoverage,
  isContained,
  mergeIntervals,
  openIntervalsForDay,
  type ExceptionRow,
  type HoursRow,
  type Interval,
} from "./coverage"

const TZ = "America/New_York"

// 2026-09-01 is a Tuesday (2). Open 06:00-23:00 Mon-Sat, closed Sunday,
// Wednesday runs late to 02:00.
const HOURS: HoursRow[] = [
  { day_of_week: 0, open_time: null, close_time: null, is_closed: true },
  { day_of_week: 1, open_time: "06:00", close_time: "23:00", is_closed: false },
  { day_of_week: 2, open_time: "06:00", close_time: "23:00", is_closed: false },
  { day_of_week: 3, open_time: "06:00", close_time: "02:00", is_closed: false },
  { day_of_week: 4, open_time: "06:00", close_time: "23:00", is_closed: false },
  { day_of_week: 5, open_time: "06:00", close_time: "23:00", is_closed: false },
  { day_of_week: 6, open_time: "06:00", close_time: "23:00", is_closed: false },
]

/** Facility-local wall clock -> UTC ms. September is EDT (UTC-4). */
function edt(day: number, hour: number, minute = 0): number {
  return Date.UTC(2026, 8, day, hour + 4, minute)
}

function shift(startMs: number, endMs: number): Interval {
  return { startMs, endMs }
}

describe("openIntervalsForDay", () => {
  it("returns the day's window as absolute instants", () => {
    const [i] = openIntervalsForDay("2026-09-01", HOURS, [], TZ)
    expect(i.startMs).toBe(edt(1, 6))
    expect(i.endMs).toBe(edt(1, 23))
  })

  it("returns nothing for a closed weekday", () => {
    // 2026-09-06 is a Sunday.
    expect(openIntervalsForDay("2026-09-06", HOURS, [], TZ)).toEqual([])
  })

  it("extends past midnight into the next day when close precedes open", () => {
    // Wednesday 2026-09-02, 06:00 -> 02:00 Thursday.
    const [i] = openIntervalsForDay("2026-09-02", HOURS, [], TZ)
    expect(i.startMs).toBe(edt(2, 6))
    expect(i.endMs).toBe(edt(3, 2))
  })

  it("lets an exception REPLACE the weekly hours", () => {
    const exceptions: ExceptionRow[] = [
      { exception_date: "2026-09-01", open_time: "09:00", close_time: "12:00", is_closed: false },
    ]
    const [i] = openIntervalsForDay("2026-09-01", HOURS, exceptions, TZ)
    expect(i.startMs).toBe(edt(1, 9))
    expect(i.endMs).toBe(edt(1, 12))
  })

  it("closes the day entirely when the exception says so", () => {
    const exceptions: ExceptionRow[] = [
      { exception_date: "2026-09-01", open_time: null, close_time: null, is_closed: true },
    ]
    expect(openIntervalsForDay("2026-09-01", HOURS, exceptions, TZ)).toEqual([])
  })
})

describe("mergeIntervals", () => {
  it("merges overlapping and abutting intervals", () => {
    expect(mergeIntervals([shift(0, 100), shift(100, 200)])).toEqual([
      { startMs: 0, endMs: 200 },
    ])
    expect(mergeIntervals([shift(0, 150), shift(100, 200)])).toEqual([
      { startMs: 0, endMs: 200 },
    ])
  })

  it("keeps genuinely separate intervals apart", () => {
    expect(mergeIntervals([shift(0, 100), shift(150, 200)])).toHaveLength(2)
  })

  it("discards zero-length intervals", () => {
    expect(mergeIntervals([shift(100, 100)])).toEqual([])
  })
})

describe("isContained", () => {
  it("accepts a window inside an interval, including exact edges", () => {
    expect(isContained(10, 20, [shift(0, 100)])).toBe(true)
    expect(isContained(0, 100, [shift(0, 100)])).toBe(true)
  })

  it("rejects a window escaping either end", () => {
    expect(isContained(-1, 50, [shift(0, 100)])).toBe(false)
    expect(isContained(50, 101, [shift(0, 100)])).toBe(false)
  })

  it("accepts a window spanning two abutting intervals once merged", () => {
    expect(isContained(50, 150, [shift(0, 100), shift(100, 200)])).toBe(true)
  })
})

describe("evaluateCoverage", () => {
  const base = {
    timeZone: TZ,
    hours: HOURS,
    exceptions: [] as ExceptionRow[],
  }

  it("is covered when inside hours and inside one published shift", () => {
    // Booking 18:00-19:00 + 15 min buffer; shift 17:00-21:00.
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(1, 18),
        blocksUntilMs: edt(1, 19, 15),
        publishedShifts: [shift(edt(1, 17), edt(1, 21))],
      }),
    ).toBe("covered")
  })

  it("flags gap_hours for a booking before opening", () => {
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(1, 5),
        blocksUntilMs: edt(1, 6),
        publishedShifts: [shift(edt(1, 4), edt(1, 8))],
      }),
    ).toBe("gap_hours")
  })

  it("flags gap_hours when only the BUFFER escapes closing time", () => {
    // 22:00-23:00 is inside hours, but the flood runs to 23:15.
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(1, 22),
        blocksUntilMs: edt(1, 23, 15),
        publishedShifts: [shift(edt(1, 20), edt(2, 0))],
      }),
    ).toBe("gap_hours")
  })

  it("flags gap_staffing when no shift is published at all", () => {
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(1, 18),
        blocksUntilMs: edt(1, 19),
        publishedShifts: [],
      }),
    ).toBe("gap_staffing")
  })

  it("flags gap_staffing when the shift ends before the buffer does", () => {
    // The resurfacing still needs somebody in the building.
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(1, 18),
        blocksUntilMs: edt(1, 19, 15),
        publishedShifts: [shift(edt(1, 17), edt(1, 19))],
      }),
    ).toBe("gap_staffing")
  })

  it("requires ONE shift to span the window, not a relay of two", () => {
    // 17:00-19:00 and 19:00-21:00 leave a changeover moment with nobody
    // committed to the whole booking.
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(1, 18),
        blocksUntilMs: edt(1, 20),
        publishedShifts: [
          shift(edt(1, 17), edt(1, 19)),
          shift(edt(1, 19), edt(1, 21)),
        ],
      }),
    ).toBe("gap_staffing")
  })

  it("flags gap_both when outside hours AND unstaffed", () => {
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(1, 4),
        blocksUntilMs: edt(1, 5),
        publishedShifts: [],
      }),
    ).toBe("gap_both")
  })

  it("flags everything on a day the facility is closed", () => {
    // Sunday 2026-09-06.
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(6, 12),
        blocksUntilMs: edt(6, 13),
        publishedShifts: [shift(edt(6, 8), edt(6, 20))],
      }),
    ).toBe("gap_hours")
  })

  it("accepts a late booking on a day whose hours run past midnight", () => {
    // Wednesday closes at 02:00 Thursday, so 23:00-00:30 is inside hours.
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(2, 23),
        blocksUntilMs: edt(3, 0, 30),
        publishedShifts: [shift(edt(2, 22), edt(3, 2))],
      }),
    ).toBe("covered")
  })

  it("accepts an early-morning booking covered by the PREVIOUS day's late hours", () => {
    // 00:30-01:30 Thursday is covered by Wednesday's 06:00-02:00 window.
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(3, 0, 30),
        blocksUntilMs: edt(3, 1, 30),
        publishedShifts: [shift(edt(2, 22), edt(3, 2))],
      }),
    ).toBe("covered")
  })

  it("respects a holiday closure over the weekly hours", () => {
    expect(
      evaluateCoverage({
        ...base,
        exceptions: [
          { exception_date: "2026-09-01", open_time: null, close_time: null, is_closed: true },
        ],
        startsAtMs: edt(1, 12),
        blocksUntilMs: edt(1, 13),
        publishedShifts: [shift(edt(1, 8), edt(1, 20))],
      }),
    ).toBe("gap_hours")
  })

  it("treats a shift matching the window exactly as covering it", () => {
    expect(
      evaluateCoverage({
        ...base,
        startsAtMs: edt(1, 18),
        blocksUntilMs: edt(1, 19),
        publishedShifts: [shift(edt(1, 18), edt(1, 19))],
      }),
    ).toBe("covered")
  })
})

describe("describeCoverage", () => {
  it("reads as a clause that fits into an alert sentence", () => {
    expect(describeCoverage("gap_hours")).toBe(
      "falls outside the facility's operating hours",
    )
    expect(describeCoverage("gap_both")).toContain("and")
  })
})
