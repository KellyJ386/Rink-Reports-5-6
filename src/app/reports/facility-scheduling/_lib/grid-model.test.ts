import { describe, expect, it } from "vitest"

import {
  blockGeometry,
  bookingMinutesOnDay,
  formatMinuteLabel,
  gridExtent,
  hourTicks,
  resolveDayWindow,
  snapToSlot,
  type ExceptionRow,
  type HoursRow,
} from "./grid-model"

const TZ = "America/New_York"

// 2026-09-01 is a Tuesday (day_of_week 2).
const HOURS: HoursRow[] = [
  { day_of_week: 0, open_time: null, close_time: null, is_closed: true },
  { day_of_week: 2, open_time: "06:00", close_time: "23:00", is_closed: false },
  { day_of_week: 3, open_time: "06:00", close_time: "02:00", is_closed: false },
]

describe("resolveDayWindow", () => {
  it("reads the weekly row for the date's weekday", () => {
    const w = resolveDayWindow("2026-09-01", HOURS, [])
    expect(w.isClosed).toBe(false)
    expect(w.openMinute).toBe(360)
    expect(w.closeMinute).toBe(1380)
    expect(w.wrapsMidnight).toBe(false)
  })

  it("marks a closed weekday closed", () => {
    // 2026-09-06 is a Sunday.
    expect(resolveDayWindow("2026-09-06", HOURS, []).isClosed).toBe(true)
  })

  it("flags a day that runs past midnight", () => {
    // Wednesday 06:00-02:00.
    const w = resolveDayWindow("2026-09-02", HOURS, [])
    expect(w.wrapsMidnight).toBe(true)
  })

  it("treats a missing weekday row as closed rather than guessing", () => {
    expect(resolveDayWindow("2026-09-04", HOURS, []).isClosed).toBe(true)
  })

  it("lets an exception REPLACE the weekly hours entirely", () => {
    const exceptions: ExceptionRow[] = [
      {
        exception_date: "2026-09-01",
        open_time: "09:00",
        close_time: "13:00",
        is_closed: false,
        label: "Maintenance morning",
      },
    ]
    const w = resolveDayWindow("2026-09-01", HOURS, exceptions)
    expect(w.openMinute).toBe(540)
    expect(w.closeMinute).toBe(780)
    expect(w.exceptionLabel).toBe("Maintenance morning")
  })

  it("closes the day when the exception says closed, whatever the weekly row says", () => {
    const exceptions: ExceptionRow[] = [
      {
        exception_date: "2026-09-01",
        open_time: null,
        close_time: null,
        is_closed: true,
        label: "Thanksgiving",
      },
    ]
    const w = resolveDayWindow("2026-09-01", HOURS, exceptions)
    expect(w.isClosed).toBe(true)
    expect(w.exceptionLabel).toBe("Thanksgiving")
  })
})

describe("gridExtent", () => {
  const openWindow = resolveDayWindow("2026-09-01", HOURS, [])

  it("spans the operating hours when nothing escapes them", () => {
    const e = gridExtent(openWindow, [{ startMinute: 600, endMinute: 660 }])
    expect(e.startMinute).toBe(360)
    expect(e.endMinute).toBe(1380)
  })

  it("STRETCHES to include an out-of-hours booking rather than hiding it", () => {
    // Booking outside hours is allowed — it raises a coverage flag, it is not
    // blocked — so the grid must be able to show one.
    const e = gridExtent(openWindow, [{ startMinute: 240, endMinute: 300 }])
    expect(e.startMinute).toBe(240)
  })

  it("still shows a usable span on a closed day", () => {
    const closed = resolveDayWindow("2026-09-06", HOURS, [])
    const e = gridExtent(closed, [])
    expect(e.endMinute - e.startMinute).toBeGreaterThanOrEqual(120)
  })

  it("pads to whole hours so the axis labels stay tidy", () => {
    const e = gridExtent(openWindow, [{ startMinute: 337, endMinute: 1391 }])
    expect(e.startMinute % 60).toBe(0)
    expect(e.endMinute % 60).toBe(0)
  })

  it("never runs past the end of the day", () => {
    const e = gridExtent(openWindow, [{ startMinute: 0, endMinute: 1440 }])
    expect(e.startMinute).toBeGreaterThanOrEqual(0)
    expect(e.endMinute).toBeLessThanOrEqual(1440)
  })
})

describe("hourTicks", () => {
  it("marks each whole hour in the extent", () => {
    expect(hourTicks(360, 540)).toEqual([360, 420, 480, 540])
  })
})

describe("blockGeometry", () => {
  const extent = { startMinute: 360, endMinute: 1080 } // 06:00-18:00, 720 min

  it("positions a block proportionally", () => {
    const g = blockGeometry(720, 780, 0, extent) // 12:00-13:00
    expect(g.topPct).toBeCloseTo(50, 5)
    expect(g.heightPct).toBeCloseTo((60 / 720) * 100, 5)
  })

  it("renders the resurfacing buffer as its own tail", () => {
    const g = blockGeometry(720, 780, 15, extent)
    expect(g.bufferPct).toBeCloseTo((15 / 720) * 100, 5)
  })

  it("clamps a block that starts before the visible window", () => {
    const g = blockGeometry(300, 420, 0, extent)
    expect(g.topPct).toBe(0)
    expect(g.heightPct).toBeCloseTo((60 / 720) * 100, 5)
  })

  it("truncates a block running past the window instead of overflowing", () => {
    const g = blockGeometry(1020, 1200, 30, extent)
    expect(g.topPct + g.heightPct).toBeLessThanOrEqual(100.001)
    expect(g.bufferPct).toBe(0)
  })
})

describe("bookingMinutesOnDay", () => {
  // September is EDT (UTC-4).
  const start = "2026-09-01T22:00:00.000Z" // 18:00 local
  const end = "2026-09-01T23:00:00.000Z" // 19:00 local

  it("converts stored instants to local minutes", () => {
    const m = bookingMinutesOnDay(start, end, "2026-09-01", TZ)
    expect(m).toEqual({ startMinute: 1080, endMinute: 1140 })
  })

  it("returns null for a different day", () => {
    expect(bookingMinutesOnDay(start, end, "2026-09-02", TZ)).toBeNull()
  })

  it("clamps a booking that began the previous day", () => {
    // 23:00 local Sep 1 -> 01:00 local Sep 2.
    const s = "2026-09-02T03:00:00.000Z"
    const e = "2026-09-02T05:00:00.000Z"
    const m = bookingMinutesOnDay(s, e, "2026-09-02", TZ)
    expect(m).toEqual({ startMinute: 0, endMinute: 60 })
  })

  it("extends to end-of-day for a booking continuing past midnight", () => {
    const s = "2026-09-02T03:00:00.000Z" // 23:00 local Sep 1
    const e = "2026-09-02T05:00:00.000Z" // 01:00 local Sep 2
    const m = bookingMinutesOnDay(s, e, "2026-09-01", TZ)
    expect(m).toEqual({ startMinute: 1380, endMinute: 1440 })
  })

  it("does not attribute a midnight-ending booking to the following day", () => {
    // Ends exactly at 00:00 local Sep 2 — it belongs to Sep 1.
    const s = "2026-09-02T02:00:00.000Z" // 22:00 local Sep 1
    const e = "2026-09-02T04:00:00.000Z" // 00:00 local Sep 2
    expect(bookingMinutesOnDay(s, e, "2026-09-02", TZ)).toBeNull()
    expect(bookingMinutesOnDay(s, e, "2026-09-01", TZ)).not.toBeNull()
  })
})

describe("formatMinuteLabel", () => {
  it("reads as a wall clock", () => {
    expect(formatMinuteLabel(0)).toBe("12 AM")
    expect(formatMinuteLabel(360)).toBe("6 AM")
    expect(formatMinuteLabel(720)).toBe("12 PM")
    expect(formatMinuteLabel(1080)).toBe("6 PM")
    expect(formatMinuteLabel(1110)).toBe("6:30 PM")
  })
})

describe("snapToSlot", () => {
  it("snaps to the facility's slot increment", () => {
    expect(snapToSlot(1087, 30)).toBe(1080)
    expect(snapToSlot(1096, 30)).toBe(1110)
    expect(snapToSlot(1087, 15)).toBe(1080)
  })

  it("is a no-op for a nonsensical increment rather than dividing by zero", () => {
    expect(snapToSlot(1087, 0)).toBe(1087)
  })
})
