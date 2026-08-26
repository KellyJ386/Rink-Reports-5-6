import { describe, expect, it } from "vitest"

import {
  addMonthsToKey,
  buildMonthGrid,
  daysInMonth,
  monthGridRange,
  monthLabel,
  monthStartKey,
  type MonthBookingLike,
} from "./month-model"

const TZ = "America/New_York"

function bk(over: Partial<MonthBookingLike> & { id: string }): MonthBookingLike {
  return {
    starts_at: "2026-08-12T22:00:00.000Z", // 6pm EDT
    ends_at: "2026-08-12T23:30:00.000Z",
    rink_id: "r1",
    status: "confirmed",
    coverage_status: "covered",
    ...over,
  }
}

describe("monthStartKey", () => {
  it("returns the first of the key's month", () => {
    expect(monthStartKey("2026-08-19")).toBe("2026-08-01")
    expect(monthStartKey("2026-08-01")).toBe("2026-08-01")
  })
})

describe("daysInMonth", () => {
  it("knows the ordinary lengths", () => {
    expect(daysInMonth(2026, 0)).toBe(31)
    expect(daysInMonth(2026, 3)).toBe(30)
  })

  it("handles February in common and leap years", () => {
    expect(daysInMonth(2026, 1)).toBe(28)
    expect(daysInMonth(2028, 1)).toBe(29)
  })

  it("applies the centurial leap rule", () => {
    expect(daysInMonth(1900, 1)).toBe(28)
    expect(daysInMonth(2000, 1)).toBe(29)
  })
})

describe("addMonthsToKey", () => {
  it("steps forward and back within a year", () => {
    expect(addMonthsToKey("2026-08-15", 1)).toBe("2026-09-15")
    expect(addMonthsToKey("2026-08-15", -1)).toBe("2026-07-15")
  })

  it("crosses the year boundary in both directions", () => {
    expect(addMonthsToKey("2026-12-10", 1)).toBe("2027-01-10")
    expect(addMonthsToKey("2026-01-10", -1)).toBe("2025-12-10")
  })

  it("clamps to the target month's last day instead of overflowing", () => {
    // The bug this exists to prevent: Jan 31 + 1 must not become Mar 2/3.
    expect(addMonthsToKey("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonthsToKey("2028-01-31", 1)).toBe("2028-02-29")
    expect(addMonthsToKey("2026-03-31", -1)).toBe("2026-02-28")
    expect(addMonthsToKey("2026-05-31", 1)).toBe("2026-06-30")
  })

  it("steps a whole year at a time", () => {
    expect(addMonthsToKey("2026-08-15", 12)).toBe("2027-08-15")
    expect(addMonthsToKey("2026-08-15", -12)).toBe("2025-08-15")
  })

  it("is a no-op for zero", () => {
    expect(addMonthsToKey("2026-08-15", 0)).toBe("2026-08-15")
  })
})

describe("monthGridRange", () => {
  it("pads out to whole Sunday-to-Saturday weeks", () => {
    // 2026-08-01 is a Saturday, 2026-08-31 a Monday.
    expect(monthGridRange("2026-08-01")).toEqual({
      fromKey: "2026-07-26",
      toKey: "2026-09-05",
    })
  })

  it("adds no padding when the month already starts Sunday and ends Saturday", () => {
    // 2026-02-01 is a Sunday, 2026-02-28 a Saturday.
    expect(monthGridRange("2026-02-01")).toEqual({
      fromKey: "2026-02-01",
      toKey: "2026-02-28",
    })
  })

  it("accepts any day in the month, not just the first", () => {
    expect(monthGridRange("2026-08-19")).toEqual(monthGridRange("2026-08-01"))
  })

  it("always spans a whole number of weeks", () => {
    for (const key of ["2026-01-01", "2026-02-01", "2026-08-01", "2028-02-01"]) {
      const { fromKey, toKey } = monthGridRange(key)
      const days =
        (Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / 86_400_000 + 1
      expect(days % 7).toBe(0)
    }
  })
})

describe("buildMonthGrid", () => {
  it("lays out complete Sunday-first weeks covering the month", () => {
    const grid = buildMonthGrid("2026-08-19", [], TZ, "2026-08-19")
    expect(grid.monthKey).toBe("2026-08-01")
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true)
    expect(grid.weeks[0][0].dayKey).toBe("2026-07-26")
    expect(grid.weeks.at(-1)!.at(-1)!.dayKey).toBe("2026-09-05")
  })

  it("marks leading and trailing padding days as out of month", () => {
    const grid = buildMonthGrid("2026-08-19", [], TZ, "2026-08-19")
    const flat = grid.weeks.flat()
    expect(flat.find((c) => c.dayKey === "2026-07-31")!.inMonth).toBe(false)
    expect(flat.find((c) => c.dayKey === "2026-08-01")!.inMonth).toBe(true)
    expect(flat.find((c) => c.dayKey === "2026-08-31")!.inMonth).toBe(true)
    expect(flat.find((c) => c.dayKey === "2026-09-01")!.inMonth).toBe(false)
  })

  it("flags today", () => {
    const grid = buildMonthGrid("2026-08-19", [], TZ, "2026-08-19")
    const today = grid.weeks.flat().filter((c) => c.isToday)
    expect(today).toHaveLength(1)
    expect(today[0].dayKey).toBe("2026-08-19")
  })

  it("places a booking on its facility-local day, not its UTC day", () => {
    // 2026-08-13T01:00Z is 9pm on the 12th in New York.
    const grid = buildMonthGrid(
      "2026-08-19",
      [bk({ id: "a", starts_at: "2026-08-13T01:00:00.000Z", ends_at: "2026-08-13T02:00:00.000Z" })],
      TZ,
      "2026-08-19",
    )
    const flat = grid.weeks.flat()
    expect(flat.find((c) => c.dayKey === "2026-08-12")!.bookings.map((b) => b.id)).toEqual(["a"])
    expect(flat.find((c) => c.dayKey === "2026-08-13")!.bookings).toHaveLength(0)
  })

  it("shows a midnight-spanning booking on both days", () => {
    // 10pm–1am local: 2026-08-13T02:00Z → 2026-08-13T05:00Z.
    const grid = buildMonthGrid(
      "2026-08-19",
      [bk({ id: "late", starts_at: "2026-08-13T02:00:00.000Z", ends_at: "2026-08-13T05:00:00.000Z" })],
      TZ,
      "2026-08-19",
    )
    const flat = grid.weeks.flat()
    expect(flat.find((c) => c.dayKey === "2026-08-12")!.bookings.map((b) => b.id)).toEqual(["late"])
    expect(flat.find((c) => c.dayKey === "2026-08-13")!.bookings.map((b) => b.id)).toEqual(["late"])
  })

  it("does not carry a booking ending exactly at local midnight into the next day", () => {
    // Ends 2026-08-13T04:00Z = exactly midnight local.
    const grid = buildMonthGrid(
      "2026-08-19",
      [bk({ id: "m", starts_at: "2026-08-13T02:00:00.000Z", ends_at: "2026-08-13T04:00:00.000Z" })],
      TZ,
      "2026-08-19",
    )
    const flat = grid.weeks.flat()
    expect(flat.find((c) => c.dayKey === "2026-08-12")!.bookings.map((b) => b.id)).toEqual(["m"])
    expect(flat.find((c) => c.dayKey === "2026-08-13")!.bookings).toHaveLength(0)
  })

  it("sorts a day's bookings by start time", () => {
    const grid = buildMonthGrid(
      "2026-08-19",
      [
        bk({ id: "late", starts_at: "2026-08-12T23:00:00.000Z", ends_at: "2026-08-12T23:45:00.000Z" }),
        bk({ id: "early", starts_at: "2026-08-12T14:00:00.000Z", ends_at: "2026-08-12T15:00:00.000Z" }),
      ],
      TZ,
      "2026-08-19",
    )
    const cell = grid.weeks.flat().find((c) => c.dayKey === "2026-08-12")!
    expect(cell.bookings.map((b) => b.id)).toEqual(["early", "late"])
  })

  it("hides cancelled bookings by default and shows them on request", () => {
    const rows = [bk({ id: "x", status: "cancelled" })]
    const hidden = buildMonthGrid("2026-08-19", rows, TZ, "2026-08-19")
    expect(hidden.weeks.flat().find((c) => c.dayKey === "2026-08-12")!.bookings).toHaveLength(0)

    const shown = buildMonthGrid("2026-08-19", rows, TZ, "2026-08-19", { showCancelled: true })
    const cell = shown.weeks.flat().find((c) => c.dayKey === "2026-08-12")!
    expect(cell.bookings).toHaveLength(1)
    // A cancelled booking is visible but never counted as live.
    expect(cell.liveCount).toBe(0)
  })

  it("filters to one rink when asked", () => {
    const rows = [bk({ id: "a", rink_id: "r1" }), bk({ id: "b", rink_id: "r2" })]
    const all = buildMonthGrid("2026-08-19", rows, TZ, "2026-08-19")
    expect(all.weeks.flat().find((c) => c.dayKey === "2026-08-12")!.bookings).toHaveLength(2)

    const one = buildMonthGrid("2026-08-19", rows, TZ, "2026-08-19", { rinkId: "r2" })
    expect(one.weeks.flat().find((c) => c.dayKey === "2026-08-12")!.bookings.map((b) => b.id)).toEqual(["b"])
  })

  it("flags a day carrying any coverage gap", () => {
    const grid = buildMonthGrid(
      "2026-08-19",
      [bk({ id: "ok" }), bk({ id: "gap", coverage_status: "gap_staffing" })],
      TZ,
      "2026-08-19",
    )
    const flat = grid.weeks.flat()
    expect(flat.find((c) => c.dayKey === "2026-08-12")!.hasCoverageGap).toBe(true)
    expect(flat.find((c) => c.dayKey === "2026-08-11")!.hasCoverageGap).toBe(false)
  })

  it("does not let a cancelled booking raise the coverage flag", () => {
    const grid = buildMonthGrid(
      "2026-08-19",
      [bk({ id: "gone", status: "cancelled", coverage_status: "gap_both" })],
      TZ,
      "2026-08-19",
      { showCancelled: true },
    )
    expect(grid.weeks.flat().find((c) => c.dayKey === "2026-08-12")!.hasCoverageGap).toBe(false)
  })

  it("counts only in-month live bookings in the month total", () => {
    const grid = buildMonthGrid(
      "2026-08-19",
      [
        bk({ id: "inside" }),
        // 2026-07-30, a padding day at the top of the grid.
        bk({ id: "padding", starts_at: "2026-07-30T22:00:00.000Z", ends_at: "2026-07-30T23:00:00.000Z" }),
      ],
      TZ,
      "2026-08-19",
    )
    expect(grid.monthLiveCount).toBe(1)
  })

  it("counts a midnight-spanning booking once per day it occupies", () => {
    const grid = buildMonthGrid(
      "2026-08-19",
      [bk({ id: "late", starts_at: "2026-08-13T02:00:00.000Z", ends_at: "2026-08-13T05:00:00.000Z" })],
      TZ,
      "2026-08-19",
    )
    // Deliberate: the ice is occupied on both dates, so both cells show it.
    expect(grid.monthLiveCount).toBe(2)
  })

  it("ignores bookings outside the rendered grid entirely", () => {
    const grid = buildMonthGrid(
      "2026-08-19",
      [bk({ id: "far", starts_at: "2027-01-05T18:00:00.000Z", ends_at: "2027-01-05T19:00:00.000Z" })],
      TZ,
      "2026-08-19",
    )
    expect(grid.weeks.flat().every((c) => c.bookings.length === 0)).toBe(true)
    expect(grid.monthLiveCount).toBe(0)
  })

  it("survives an unparseable timestamp instead of throwing", () => {
    const grid = buildMonthGrid(
      "2026-08-19",
      [bk({ id: "bad", starts_at: "not-a-date" }), bk({ id: "good" })],
      TZ,
      "2026-08-19",
    )
    expect(grid.weeks.flat().find((c) => c.dayKey === "2026-08-12")!.bookings.map((b) => b.id)).toEqual(["good"])
  })

  it("falls back to today's month when the focus key is malformed", () => {
    expect(buildMonthGrid("garbage", [], TZ, "2026-08-19").monthKey).toBe("2026-08-01")
  })

  it("renders a 6-row grid for a month that needs one", () => {
    // 2026-05-01 is a Friday and May has 31 days → spills to six weeks.
    expect(buildMonthGrid("2026-05-01", [], TZ, "2026-05-01").weeks).toHaveLength(6)
  })

  it("renders a 4-row grid for a non-leap February starting Sunday", () => {
    expect(buildMonthGrid("2026-02-01", [], TZ, "2026-02-01").weeks).toHaveLength(4)
  })

  it("handles a DST spring-forward day without dropping it", () => {
    // 2026-03-08 is the US spring-forward date; that day is only 23h long.
    const grid = buildMonthGrid(
      "2026-03-08",
      [bk({ id: "dst", starts_at: "2026-03-08T18:00:00.000Z", ends_at: "2026-03-08T19:00:00.000Z" })],
      TZ,
      "2026-03-08",
    )
    const cell = grid.weeks.flat().find((c) => c.dayKey === "2026-03-08")!
    expect(cell.bookings.map((b) => b.id)).toEqual(["dst"])
    expect(grid.weeks.flat().filter((c) => c.dayKey === "2026-03-08")).toHaveLength(1)
  })

  it("produces every day exactly once across the grid", () => {
    const grid = buildMonthGrid("2026-08-19", [], TZ, "2026-08-19")
    const keys = grid.weeks.flat().map((c) => c.dayKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("monthLabel", () => {
  it("renders a human month and year", () => {
    expect(monthLabel("2026-08-01")).toBe("August 2026")
    expect(monthLabel("2026-01-15")).toBe("January 2026")
    expect(monthLabel("2026-12-31")).toBe("December 2026")
  })
})
